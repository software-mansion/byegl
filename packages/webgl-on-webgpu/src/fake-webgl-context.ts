import * as shaderkit from 'shaderkit';

const $internal = Symbol('degl-internals');

class FakeWebGLShader implements WebGLShader {
  readonly #type: GLenum;
  readonly [$internal]: {
    source: string | undefined;
  };

  constructor(type: GLenum) {
    this.#type = type;
    this[$internal] = {
      source: undefined,
    };
  }
}

export class FakeWebGLContext {
  constructor() {}

  createShader(type: GLenum): WebGLShader | null {
    return new FakeWebGLShader(type);
  }

  shaderSource(shader: FakeWebGLShader, source: string): void {
    shader[$internal].source = source;
  }

  compileShader(shader: FakeWebGLShader): void {
    console.log('Compiling shader...', shader[$internal].source);
    const ast = shaderkit.parse(shader[$internal].source ?? '');
    console.log(ast);
  }
}
