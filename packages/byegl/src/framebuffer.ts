import type { TgpuRoot } from 'typegpu';
import type { ByeGLTexture } from './texture.ts';
import { $internal } from './types.ts';

/**
 * The internal state of byegl framebuffers
 */
export class ByeGLFramebufferInternal {
  readonly #root: TgpuRoot;

  colorAttachments: (ByeGLTexture | null)[] = Array.from({ length: 16 }, () => null);

  #depthTexture: GPUTexture | undefined;

  constructor(root: TgpuRoot) {
    this.#root = root;
  }

  getOrCreateDepthTexture(width: number, height: number): GPUTexture {
    if (
      !this.#depthTexture ||
      this.#depthTexture.width !== width ||
      this.#depthTexture.height !== height
    ) {
      this.#depthTexture?.destroy();
      this.#depthTexture = this.#root.device.createTexture({
        size: [width, height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    return this.#depthTexture;
  }

  destroy() {
    this.#depthTexture?.destroy();
    this.#depthTexture = undefined;
  }
}

export class ByeGLFramebuffer {
  readonly [$internal]: ByeGLFramebufferInternal;

  constructor(root: TgpuRoot) {
    this[$internal] = new ByeGLFramebufferInternal(root);
  }
}
