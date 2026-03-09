import type { TgpuRoot } from 'typegpu';
import { $internal } from './types.ts';

/**
 * The internal state of byegl framebuffers
 */
export class ByeGLFramebufferInternal {
  constructor(_root: TgpuRoot) {}

  destroy() {}
}

export class ByeGLFramebuffer {
  readonly [$internal]: ByeGLFramebufferInternal;

  constructor(root: TgpuRoot) {
    this[$internal] = new ByeGLFramebufferInternal(root);
  }
}
