import { $internal } from './types.ts';

// WebGLUniformLocation
export class DeGLUniformLocation {
  readonly [$internal]: number;

  constructor(idx: number) {
    this[$internal] = idx;
  }
}
