import { $internal } from './types.ts';
import { WgslGeneratorResult } from './wgsl/wgsl-generator.ts';

export class ByeGLShader implements WebGLShader {
  readonly [$internal]: {
    type: GLenum;
    source: string | null;
    destroyed: boolean;
  };

  constructor(type: GLenum) {
    this[$internal] = {
      type,
      source: null,
      destroyed: false,
    };
  }
}

class ByeGLProgramInternals {
  vert: ByeGLShader | undefined;
  frag: ByeGLShader | undefined;
  compiled: WgslGeneratorResult | undefined;
  infoLog: string = '';
  wgpuShaderModule: GPUShaderModule | undefined;

  constructor() {}
}

export class ByeGLProgram implements WebGLProgram {
  readonly [$internal]: ByeGLProgramInternals;

  constructor() {
    this[$internal] = new ByeGLProgramInternals();
  }
}
