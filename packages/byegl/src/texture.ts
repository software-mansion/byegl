import { TgpuRoot } from 'typegpu';
import { $internal } from './types.ts';

/**
 * The internal state of byegl textures
 */
export class ByeGLTextureInternal {
  readonly #root: TgpuRoot;

  #size: [number, number] | undefined;
  #gpuTexture: GPUTexture | undefined;
  gpuTextureDirty = true;

  #gpuSampler: GPUSampler | undefined;
  gpuSamplerDirty = true;

  /**
   * If true, this texture was imported from an existing WebGPU texture.
   */
  #imported = false;

  constructor(root: TgpuRoot) {
    this.#root = root;
  }

  get size(): [number, number] | undefined {
    return this.#size;
  }

  set size(size: readonly [number, number]) {
    if (!this.#size || size[0] !== this.#size[0] || size[1] !== this.#size[1]) {
      this.#size = [...size];
      this.gpuTextureDirty = true;
    }
  }

  importExistingWebGPUTexture(texture: GPUTexture) {
    if (this.#gpuTexture === texture) {
      return;
    }

    this.#imported = true;

    // Cleaning up old texture, if it exists
    this.#gpuTexture?.destroy();

    this.#gpuTexture = texture;
    this.size = [texture.width, texture.height];
    this.gpuTextureDirty = false;
  }

  get gpuTexture(): GPUTexture {
    if (!this.gpuTextureDirty) {
      return this.#gpuTexture!;
    }
    this.gpuTextureDirty = false;

    if (this.#imported) {
      console.warn('Had to recreate imported buffer');
    } else {
      // Cleaning up old texture, if it exists
      this.#gpuTexture?.destroy();
    }

    this.#gpuTexture = this.#root.device.createTexture({
      label: 'ByeGL Texture',
      size: this.#size!,
      format: 'rgba8unorm',
      dimension: '2d',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_DST,
    });

    return this.#gpuTexture;
  }

  get gpuSampler(): GPUSampler {
    if (!this.gpuSamplerDirty) {
      return this.#gpuSampler!;
    }
    this.gpuSamplerDirty = false;

    this.#gpuSampler = this.#root.device.createSampler({
      // TODO: Adapt based on gl.* API usage
      label: 'ByeGL Sampler',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
    });

    return this.#gpuSampler;
  }

  get gpuTextureView(): GPUTextureView {
    return this.gpuTexture.createView();
  }

  destroy() {
    this.#gpuTexture?.destroy();
  }
}

export class ByeGLTexture {
  readonly [$internal]: ByeGLTextureInternal;

  constructor(root: TgpuRoot) {
    this[$internal] = new ByeGLTextureInternal(root);
  }
}
