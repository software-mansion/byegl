import type { TgpuRoot } from 'typegpu';
import { $internal } from './types.ts';

const gl = WebGL2RenderingContext;

function internalformatToWebGPU(internalformat: GLenum): GPUTextureFormat {
  switch (internalformat) {
    case gl.RGBA4:
    case gl.RGB5_A1:
    case gl.RGB565:
    case gl.RGBA8:
    case gl.RGB8:
      return 'rgba8unorm';
    case gl.DEPTH_COMPONENT16:
      return 'depth16unorm';
    case gl.DEPTH_COMPONENT24:
      return 'depth24plus';
    case gl.DEPTH_COMPONENT32F:
      return 'depth32float';
    case gl.DEPTH_STENCIL:
    case gl.DEPTH24_STENCIL8:
      return 'depth24plus-stencil8';
    case gl.DEPTH32F_STENCIL8:
      return 'depth32float-stencil8';
    case gl.STENCIL_INDEX8:
      return 'stencil8';
    default:
      return 'rgba8unorm';
  }
}

/**
 * The internal state of a byegl renderbuffer.
 *
 * Renderbuffers are off-screen surfaces that can be attached to a framebuffer
 * as a color, depth, or depth-stencil attachment. Unlike textures they cannot
 * be sampled from shaders, which allows the driver to use tile-memory-friendly
 * formats. In byegl they are backed by a WebGPU texture with
 * RENDER_ATTACHMENT usage.
 *
 * The interface deliberately mirrors the subset of ByeGLTextureInternal that
 * #createRenderPass reads (`gpuTextureView`, `gpuTexture`, `formatInfo`) so
 * that color-attachment handling in the render-pass builder works for both
 * textures and renderbuffers without branching.
 */
export class ByeGLRenderbufferInternal {
  readonly #root: TgpuRoot;

  width = 0;
  height = 0;
  internalFormat: GLenum = 0;

  #gpuTexture: GPUTexture | undefined;
  #gpuTextureView: GPUTextureView | undefined;
  #webgpuFormat: GPUTextureFormat = 'rgba8unorm';

  constructor(root: TgpuRoot) {
    this.#root = root;
  }

  get gpuTexture(): GPUTexture {
    if (!this.#gpuTexture) {
      throw new Error(
        'Renderbuffer storage has not been allocated (call gl.renderbufferStorage first)',
      );
    }
    return this.#gpuTexture;
  }

  get gpuTextureView(): GPUTextureView {
    if (!this.#gpuTextureView) {
      throw new Error(
        'Renderbuffer storage has not been allocated (call gl.renderbufferStorage first)',
      );
    }
    return this.#gpuTextureView;
  }

  get formatInfo(): { webgpuFormat: GPUTextureFormat } {
    return { webgpuFormat: this.#webgpuFormat };
  }

  allocate(internalformat: GLenum, width: number, height: number): void {
    this.#gpuTexture?.destroy();
    this.width = width;
    this.height = height;
    this.internalFormat = internalformat;
    this.#webgpuFormat = internalformatToWebGPU(internalformat);

    this.#gpuTexture = this.#root.device.createTexture({
      label: 'ByeGL Renderbuffer',
      size: [width, height],
      format: this.#webgpuFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.#gpuTextureView = this.#gpuTexture.createView();
  }

  destroy(): void {
    this.#gpuTexture?.destroy();
    this.#gpuTexture = undefined;
    this.#gpuTextureView = undefined;
  }
}

export class ByeGLRenderbuffer {
  readonly [$internal]: ByeGLRenderbufferInternal;

  constructor(root: TgpuRoot) {
    this[$internal] = new ByeGLRenderbufferInternal(root);
  }
}
