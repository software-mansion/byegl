import * as shaderkit from 'shaderkit';
import { generate } from '../common/wgsl-generator';

const $internal = Symbol('degl-internals');

class DeGLShader implements WebGLShader {
  readonly [$internal]: {
    type: GLenum;
    source: string | undefined;
  };

  constructor(type: GLenum) {
    this[$internal] = {
      type,
      source: undefined,
    };
  }
}

class DeGLProgram implements WebGLProgram {
  readonly [$internal]: {
    vert: DeGLShader | undefined;
    frag: DeGLShader | undefined;
    wgpuShaderModule: GPUShaderModule | undefined;
    wgpuPipeline: GPURenderPipeline | undefined;
  };

  constructor() {
    this[$internal] = {
      vert: undefined,
      frag: undefined,
      wgpuShaderModule: undefined,
      wgpuPipeline: undefined,
    };
  }
}

export class DeGLContext {
  #device: GPUDevice;
  #format: GPUTextureFormat;
  #canvas: HTMLCanvasElement;
  #canvasContext: GPUCanvasContext;

  // GL state
  #program: DeGLProgram | undefined;

  constructor(device: GPUDevice, canvas: HTMLCanvasElement) {
    this.#device = device;
    this.#format = navigator.gpu.getPreferredCanvasFormat();
    this.#canvas = canvas;
    const canvasCtx = canvas.getContext('webgpu');
    if (!canvasCtx) {
      throw new Error('Failed to get WebGPU context');
    }
    canvasCtx.configure({
      device: this.#device,
      format: this.#format,
      alphaMode: 'premultiplied',
    });
    this.#canvasContext = canvasCtx;
  }

  createShader(type: GLenum): WebGLShader | null {
    return new DeGLShader(type);
  }

  shaderSource(shader: DeGLShader, source: string): void {
    shader[$internal].source = source;
  }

  compileShader(_shader: DeGLShader): void {
    // NO-OP: Deferring compilation until the program is linked
  }

  createProgram(): WebGLProgram {
    return new DeGLProgram();
  }

  attachShader(program: DeGLProgram, shader: DeGLShader): void {
    const $shader = shader[$internal];

    if ($shader.type === WebGLRenderingContext.VERTEX_SHADER) {
      program[$internal].vert = shader;
    } else if ($shader.type === WebGLRenderingContext.FRAGMENT_SHADER) {
      program[$internal].frag = shader;
    }
  }

  getAttribLocation(program: DeGLProgram, name: string): GLint {
    // TODO: Implement attribute location retrieval
    return 0;
  }

  createBuffer(): WebGLBuffer {
    // TODO: Implement buffer creation
    // return new DeGLBuffer();
    return {};
  }

  bindBuffer(target: GLenum, buffer: WebGLBuffer | null): void {
    // TODO: Implement buffer binding
  }

  bufferData(target: GLenum, size: GLsizeiptr, usage: GLenum): void {
    // TODO: Implement buffer data
  }

  enableVertexAttribArray(index: GLuint): void {
    // TODO: Implement vertex attribute array enabling
  }

  vertexAttribPointer(
    index: GLuint,
    size: GLint,
    type: GLenum,
    normalized: GLboolean,
    stride: GLsizei,
    offset: GLintptr,
  ): void {
    // TODO: Implement vertex attribute pointer setup
  }

  clearColor(r: GLclampf, g: GLclampf, b: GLclampf, a: GLclampf): void {
    // TODO: Implement clear color setup
  }

  clear(mask: GLbitfield): void {
    // TODO: Implement clear setup
  }

  linkProgram(program: DeGLProgram): void {
    const $program = program[$internal];
    const { vert, frag } = $program;

    if (!vert || !frag) {
      throw new Error(
        'Vertex and fragment shaders must be attached before linking',
      );
    }

    // const vertAst = shaderkit.parse(vert[$internal].source ?? '');
    // const fragAst = shaderkit.parse(frag[$internal].source ?? '');
    // TODO: Actually parse the shaders once the patch to shaderkit is merged
    const vertAst: shaderkit.Program = { type: 'Program', body: [] };
    const fragAst: shaderkit.Program = { type: 'Program', body: [] };

    const wgsl = generate(vertAst, fragAst);

    $program.wgpuShaderModule = this.#device.createShaderModule({
      label: 'DeGL Shader Module',
      code: wgsl,
    });

    $program.wgpuPipeline = this.#device.createRenderPipeline({
      label: 'DeGL Render Pipeline',
      layout: 'auto',
      vertex: {
        module: $program.wgpuShaderModule,
        buffers: [
          // TODO: Infer this based on what the shader expects
          {
            arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT,
            attributes: [
              {
                format: 'float32x2',
                offset: 0,
                shaderLocation: 0,
              },
            ],
          },
        ],
      },
      fragment: {
        module: $program.wgpuShaderModule,
        targets: [
          {
            format: this.#format,
          },
        ],
      },
    });
  }

  useProgram(program: DeGLProgram): void {
    this.#program = program;
  }

  drawArrays(mode: GLenum, first: GLint, count: GLsizei): void {
    if (!this.#program) {
      throw new Error('No program bound');
    }

    const $program = this.#program[$internal];

    // TODO: Remove mock and respect actual APIs
    const vertexBuffer = this.#device.createBuffer({
      label: 'DeGL Vertex Buffer',
      size: 6 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    const f32View = new Float32Array(vertexBuffer.getMappedRange());
    // new Float32Array([-1, -1, 1, -1, 0, 1]),
    f32View[0] = -1;
    f32View[1] = -1;
    f32View[2] = 1;
    f32View[3] = -1;
    f32View[4] = 0;
    f32View[5] = 1;
    vertexBuffer.unmap();

    const encoder = this.#device.createCommandEncoder({
      label: 'DeGL Command Encoder',
    });
    const renderPass = encoder.beginRenderPass({
      label: 'DeGL Render Pass',
      colorAttachments: [
        {
          view: this.#canvasContext.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: [0.0, 0.0, 0.0, 1.0],
        },
      ],
    });

    renderPass.setPipeline($program.wgpuPipeline!);
    renderPass.setVertexBuffer(0, vertexBuffer);
    renderPass.draw(count, 1, first, 0);
    renderPass.end();

    this.#device.queue.submit([encoder.finish()]);
  }
}

// Inheriting from WebGLRenderingContext
Object.setPrototypeOf(DeGLContext.prototype, WebGLRenderingContext.prototype);
