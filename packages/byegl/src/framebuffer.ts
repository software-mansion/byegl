import { TgpuRoot } from 'typegpu';
import { $internal } from './types.ts';

const gl = WebGL2RenderingContext;

/**
 * The internal state of byegl framebuffers
 */
export class ByeGLFramebufferInternal {
  readonly #root: TgpuRoot;

  constructor(root: TgpuRoot) {
    this.#root = root;
  }

  destroy() {}
}

export class ByeGLFramebuffer {
  readonly [$internal]: ByeGLFramebufferInternal;

  constructor(root: TgpuRoot) {
    this[$internal] = new ByeGLFramebufferInternal(root);
  }
}
