import { TgpuRoot } from 'typegpu';
import { $internal } from './types.ts';

const gl = WebGL2RenderingContext;

// Part of the 'EXT_texture_filter_anisotropic' extension
const TEXTURE_MAX_ANISOTROPY_EXT = 0x84fe;

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

  #parameters = new Map<GLenum, number | boolean>([
    [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR],
    [gl.TEXTURE_WRAP_S, gl.REPEAT],
    [gl.TEXTURE_WRAP_T, gl.REPEAT],
    [
      TEXTURE_MAX_ANISOTROPY_EXT,
      0 /* TODO: not sure about this default, it's not in the docs, have to investigate */,
    ],

    // WebGL2 specific parameters
    // Texture mipmap level
    [
      gl.TEXTURE_BASE_LEVEL,
      0 /* TODO: not sure about this default, it's not in the docs, have to investigate */,
    ],
    // Texture Comparison function
    // gl.LEQUAL (default value), gl.GEQUAL, gl.LESS, gl.GREATER, gl.EQUAL, gl.NOTEQUAL, gl.ALWAYS, gl.NEVER.
    [gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL],
    // Texture comparison mode
    // gl.NONE (default value), gl.COMPARE_REF_TO_TEXTURE.
    [gl.TEXTURE_COMPARE_MODE, gl.NONE],
    // Maximum texture mipmap array level
    [
      gl.TEXTURE_MAX_LEVEL,
      0 /* TODO: not sure about this default, it's not in the docs, have to investigate */,
    ],
    // Texture maximum level-of-detail value
    [
      gl.TEXTURE_MAX_LOD,
      0 /* TODO: not sure about this default, it's not in the docs, have to investigate */,
    ],
    // Texture minimum level-of-detail value	Any float values.
    [
      gl.TEXTURE_MIN_LOD,
      0 /* TODO: not sure about this default, it's not in the docs, have to investigate */,
    ],
    // Wrapping function for texture coordinate r
    // gl.REPEAT (default value), gl.CLAMP_TO_EDGE, gl.MIRRORED_REPEAT.
    [gl.TEXTURE_WRAP_R, gl.REPEAT],
  ]);

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

  setParameter(parameter: GLenum, value: GLint | GLboolean | GLenum) {
    this.#parameters.set(parameter, value);
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
