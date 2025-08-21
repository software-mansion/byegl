import type { WgslGenerator } from '../common/wgsl-generator.ts';

const $internal = Symbol('degl internals');

class DeGLShader implements WebGLShader {
  readonly [$internal]: {
    hash: string;
    type: GLenum;
    source: string | undefined;
  };

  constructor(hash: string, type: GLenum) {
    this[$internal] = {
      hash,
      type,
      source: undefined,
    };
  }
}

class DeGLProgram implements WebGLProgram {
  readonly [$internal]: {
    vert: DeGLShader | undefined;
    frag: DeGLShader | undefined;
    attributeLocationMap: Map<string, number> | undefined;
    wgpuShaderModule: GPUShaderModule | undefined;
    /**
     * A string built up when creating the pipeline, used to compare whether we should recreate the pipeline
     */
    pipelineHash: string;
    wgpuPipeline: GPURenderPipeline | undefined;
  };

  constructor() {
    this[$internal] = {
      vert: undefined,
      attributeLocationMap: undefined,
      frag: undefined,
      wgpuShaderModule: undefined,
      pipelineHash: '',
      wgpuPipeline: undefined,
    };
  }
}

interface VertexAttribPointer {
  /**
   * A GLint specifying the number of components per vertex attribute. Must be 1, 2, 3, or 4.
   */
  size: GLint;

  /**
   * A GLenum specifying the data type of each component in the array. Possible values:
   *
   * - gl.BYTE: signed 8-bit integer, with values in [-128, 127]
   * - gl.SHORT: signed 16-bit integer, with values in [-32768, 32767]
   * - gl.UNSIGNED_BYTE: unsigned 8-bit integer, with values in [0, 255]
   * - gl.UNSIGNED_SHORT: unsigned 16-bit integer, with values in [0,65535]
   * - gl.FLOAT: 32-bit IEEE floating point number
   *
   * When using a WebGL 2 context, the following values are available additionally:
   *
   * - gl.HALF_FLOAT: 16-bit IEEE floating point number
   * - gl.INT: 32-bit signed binary integer
   * - gl.UNSIGNED_INT: 32-bit unsigned binary integer
   * - gl.INT_2_10_10_10_REV: 32-bit signed integer with values in [-512, 511]
   * - gl.UNSIGNED_INT_2_10_10_10_REV: 32-bit unsigned integer with values in [0, 1023]
   */
  type: GLenum;

  /**
   * A GLboolean specifying whether integer data values should be normalized into a certain range when being cast to a float.
   * For types gl.BYTE and gl.SHORT, normalizes the values to [-1, 1] if true.
   * For types gl.UNSIGNED_BYTE and gl.UNSIGNED_SHORT, normalizes the values to [0, 1] if true.
   * For types gl.FLOAT and gl.HALF_FLOAT, this parameter has no effect.
   */
  normalized: GLboolean;

  /**
   * A GLsizei specifying the offset in bytes between the beginning of consecutive vertex attributes.
   * Cannot be negative or larger than 255. If stride is 0, the attribute is assumed to be tightly packed,
   * that is, the attributes are not interleaved but each attribute is in a separate block, and the next
   * vertex' attribute follows immediately after the current vertex.
   */
  stride: GLsizei;

  /**
   * A GLintptr specifying an offset in bytes of the first component in the vertex attribute array.
   * Must be a multiple of the byte length of type.
   */
  offset: GLintptr;
}

export class DeGLContext {
  #device: GPUDevice;
  #format: GPUTextureFormat;
  #wgslGen: WgslGenerator;
  #canvasContext: GPUCanvasContext;

  // GL state
  #program: DeGLProgram | undefined;
  /**
   * Set using gl.enableVertexAttribArray and gl.disableVertexAttribArray.
   */
  #enabledVertexAttribArrays = new Set<number>();

  constructor(
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    wgslGen: WgslGenerator,
  ) {
    this.#device = device;
    this.#format = navigator.gpu.getPreferredCanvasFormat();
    this.#wgslGen = wgslGen;
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

  #prevUniqueId = -1;

  /**
   * Returns a unique id
   */
  #uniqueId() {
    return ++this.#prevUniqueId;
  }

  createShader(type: GLenum): WebGLShader | null {
    return new DeGLShader(`${this.#uniqueId()}`, type);
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
    const $program = program[$internal];
    if ($program.attributeLocationMap === undefined) {
      throw new Error('Program not linked');
    }
    return $program.attributeLocationMap.get(name) ?? -1;
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
    this.#enabledVertexAttribArrays.add(index);
  }

  disableVertexAttribArray(index: GLuint): void {
    this.#enabledVertexAttribArrays.delete(index);
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

    const result = this.#wgslGen.generate(
      vert[$internal].source ?? '',
      frag[$internal].source ?? '',
    );

    $program.attributeLocationMap = result.attributeLocationMap;

    const module = this.#device.createShaderModule({
      label: 'DeGL Shader Module',
      code: result.wgsl,
    });
    $program.wgpuShaderModule = module;
  }

  useProgram(program: DeGLProgram): void {
    this.#program = program;
  }

  #createOrReusePipeline(): GPURenderPipeline {
    const $program = this.#program![$internal];

    // TODO: Compute the hash
    // TODO: Recreate only when the hash changes

    $program.wgpuPipeline = this.#device.createRenderPipeline({
      label: 'DeGL Render Pipeline',
      layout: 'auto',
      vertex: {
        module: $program.wgpuShaderModule!,
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
        module: $program.wgpuShaderModule!,
        targets: [
          {
            format: this.#format,
          },
        ],
      },
    });

    return $program.wgpuPipeline;
  }

  drawArrays(mode: GLenum, first: GLint, count: GLsizei): void {
    if (!this.#program) {
      throw new Error('No program bound');
    }

    const pipeline = this.#createOrReusePipeline();

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

    renderPass.setPipeline(pipeline);
    renderPass.setVertexBuffer(0, vertexBuffer);
    renderPass.draw(count, 1, first, 0);
    renderPass.end();

    this.#device.queue.submit([encoder.finish()]);
  }
}

// Inheriting from WebGLRenderingContext
Object.setPrototypeOf(DeGLContext.prototype, WebGLRenderingContext.prototype);
