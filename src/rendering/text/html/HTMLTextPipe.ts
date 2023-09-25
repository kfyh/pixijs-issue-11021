import { ExtensionType } from '../../../extensions/Extensions';
import { BigPool } from '../../../utils/pool/PoolGroup';
import { updateQuadBounds } from '../../../utils/updateQuadBounds';
import { Texture } from '../../renderers/shared/texture/Texture';
import { BatchableSprite } from '../../sprite/shared/BatchableSprite';

import type { RenderPipe } from '../../renderers/shared/instructions/RenderPipe';
import type { Renderable } from '../../renderers/shared/Renderable';
import type { Renderer } from '../../renderers/types';
import type { HTMLTextStyle } from '../HtmlTextStyle';
import type { TextView } from '../TextView';

export class HTMLTextPipe implements RenderPipe<TextView>
{
    /** @ignore */
    public static extension = {
        type: [
            ExtensionType.WebGLPipes,
            ExtensionType.WebGPUPipes,
            ExtensionType.CanvasPipes,
        ],
        name: 'htmlText',
    } as const;

    private _renderer: Renderer;

    private _gpuText: Record<number, {
        textureNeedsUploading: boolean;
        generatingTexture: boolean;
        texture: Texture,
        currentKey: string,
        batchableSprite: BatchableSprite,
    }> = Object.create(null);

    constructor(renderer: Renderer)
    {
        this._renderer = renderer;
    }

    public validateRenderable(renderable: Renderable<TextView>): boolean
    {
        const gpuText = this._getGpuText(renderable);

        const newKey = renderable.view._getKey();

        if (gpuText.textureNeedsUploading)
        {
            gpuText.textureNeedsUploading = false;

            return true;
        }

        if (gpuText.currentKey !== newKey)
        {
            // TODO - could look into optimising this a tad!
            // if its a single texture, then we could just swap it?
            // same for CanvasText..
            return true;
        }

        return false;
    }

    public addRenderable(renderable: Renderable<TextView>)
    {
        const gpuText = this._getGpuText(renderable);

        const batchableSprite = gpuText.batchableSprite;

        if (renderable.view._didUpdate)
        {
            this._updateText(renderable);
        }

        this._renderer.renderPipes.batch.addToBatch(batchableSprite);
    }

    public updateRenderable(renderable: Renderable<TextView>)
    {
        const gpuText = this._getGpuText(renderable);
        const batchableSprite = gpuText.batchableSprite;

        if (renderable.view._didUpdate)
        {
            this._updateText(renderable);
        }

        batchableSprite.batcher.updateElement(batchableSprite);
    }

    public destroyRenderable(renderable: Renderable<TextView>)
    {
        this._destroyRenderableById(renderable.uid);
    }

    private _destroyRenderableById(renderableUid: number)
    {
        const gpuText = this._gpuText[renderableUid];

        this._renderer.htmlText.decreaseReferenceCount(gpuText.currentKey);

        BigPool.return(gpuText.batchableSprite);

        this._gpuText[renderableUid] = null;
    }

    private _updateText(renderable: Renderable<TextView>)
    {
        const newKey = renderable.view._getKey();
        const gpuText = this._getGpuText(renderable);
        const batchableSprite = gpuText.batchableSprite;

        if (gpuText.currentKey !== newKey)
        {
            this._updateGpuText(renderable).catch((e) =>
            {
                console.error(e);
            });
        }

        renderable.view._didUpdate = false;

        const padding = renderable.view._style.padding;

        updateQuadBounds(batchableSprite.bounds, renderable.view.anchor, batchableSprite.texture, padding);
    }

    private async _updateGpuText(renderable: Renderable<TextView>)
    {
        renderable.view._didUpdate = false;

        const gpuText = this._getGpuText(renderable);

        if (gpuText.generatingTexture) return;

        const newKey = renderable.view._getKey();

        this._renderer.htmlText.decreaseReferenceCount(gpuText.currentKey);

        gpuText.generatingTexture = true;

        gpuText.currentKey = newKey;

        const view = renderable.view;

        const resolution = view.resolution ?? this._renderer.resolution;

        const texture = await this._renderer.htmlText.getManagedTexture(
            view.text,
            resolution,
            view._style as HTMLTextStyle,
            view._getKey()
        );

        const batchableSprite = gpuText.batchableSprite;

        batchableSprite.texture = gpuText.texture = texture;

        gpuText.generatingTexture = false;

        gpuText.textureNeedsUploading = true;
        renderable.view.onUpdate();

        const padding = renderable.view._style.padding;

        updateQuadBounds(batchableSprite.bounds, renderable.view.anchor, batchableSprite.texture, padding);
    }

    private _getGpuText(renderable: Renderable<TextView>)
    {
        return this._gpuText[renderable.uid] || this._initGpuText(renderable);
    }

    private _initGpuText(renderable: Renderable<TextView>)
    {
        const view = renderable.view;

        view._style.update();

        const gpuTextData: HTMLTextPipe['_gpuText'][number] = {
            texture: Texture.EMPTY,
            currentKey: '--',
            batchableSprite: BigPool.get(BatchableSprite),
            textureNeedsUploading: false,
            generatingTexture: false,
        };

        gpuTextData.batchableSprite.sprite = renderable;
        gpuTextData.batchableSprite.texture = Texture.EMPTY;
        gpuTextData.batchableSprite.bounds = [0, 1, 0, 0];

        this._gpuText[renderable.uid] = gpuTextData;

        // TODO perhaps manage this outside this pipe? (a bit like how we update / add)
        renderable.on('destroyed', () =>
        {
            this.destroyRenderable(renderable);
        });

        return gpuTextData;
    }

    public destroy()
    {
        for (const i in this._gpuText)
        {
            this._destroyRenderableById(i as unknown as number);
        }

        this._gpuText = null;
        this._renderer = null;
    }
}

