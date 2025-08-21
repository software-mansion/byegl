import type { WgslGenerator } from '../common/wgsl-generator.ts';

const $internal = Symbol('degl internals');

class DeGLBufferInternal {
  readonly device: GPUDevice;
  dirty = true;

  #byteLength: number | undefined;
  #gpuBuffer: GPUBuffer | undefined;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  get byteLength(): number | undefined {
    return this.#byteLength;
  }

  set byteLength(value: number) {
    if (value !== this.#byteLength) {
      this.#byteLength = value;
      this.dirty = true;
    }
  }

  get gpuBuffer(): GPUBuffer {
    if (!this.dirty) {
      return this.#gpuBuffer!;
    }

    // Cleaning up old buffer, if it exists
    this.#gpuBuffer?.destroy();

    this.#gpuBuffer = this.device.createBuffer({
      size: this.#byteLength!,
      usage:
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.VERTEX,
    });

    return this.#gpuBuffer;
  }
}

class DeGLBuffer {
  readonly [$internal]: DeGLBufferInternal;

  constructor(device: GPUDevice) {
    this[$internal] = new DeGLBufferInternal(device);
  }
}

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
    attributeLocationMap: Map<string, number> | undefined;
    wgpuShaderModule: GPUShaderModule | undefined;
    pipelineHash: string;
    /**
     * If true, we should recreate the pipeline instead of
     * reusing the cached object
     */
    dirty: boolean;
    wgpuPipeline: GPURenderPipeline | undefined;
  };

  constructor() {
    this[$internal] = {
      vert: undefined,
      attributeLocationMap: undefined,
      frag: undefined,
      wgpuShaderModule: undefined,
      pipelineHash: '',
      dirty: true,
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

  //
  // GL state
  //

  #program: DeGLProgram | undefined;
  /**
   * Set using gl.enableVertexAttribArray and gl.disableVertexAttribArray.
   */
  #enabledVertexAttribArrays = new Set<number>();
  /**
   * The currently bound buffer. Set using gl.bindBuffer.
   */
  #boundBufferMap: Map<GLenum, DeGLBuffer | null> = new Map();

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
    const $program = program[$internal];
    if ($program.attributeLocationMap === undefined) {
      throw new Error('Program not linked');
    }
    return $program.attributeLocationMap.get(name) ?? -1;
  }

  createBuffer(): WebGLBuffer {
    return new DeGLBuffer(this.#device);
  }

  bindBuffer(target: GLenum, buffer: DeGLBuffer | null): void {
    if (buffer) {
      this.#boundBufferMap.set(target, buffer);
    } else {
      this.#boundBufferMap.delete(target);
    }
  }

  bufferData(
    target: GLenum,
    dataOrSize: AllowSharedBufferSource | GLsizeiptr | null,
    usage: GLenum,
  ): void {
    const buffer = this.#boundBufferMap.get(target);
    if (!buffer) {
      throw new Error(`Buffer not bound to ${target}`);
    }
    const $buffer = buffer[$internal];

    if (typeof dataOrSize === 'number') {
      // Initializing the buffer with a certain size
      $buffer.byteLength = dataOrSize;
    } else if (dataOrSize === null) {
      // Keeping the previous size, so nothing to do here
    } else {
      // Updating the buffer to match the size of the new buffer
      $buffer.byteLength = dataOrSize.byteLength;
    }

    if (typeof dataOrSize === 'number' || dataOrSize === null) {
      if (!$buffer.dirty) {
        // If the buffer won't be recreated, wipe the buffer to
        // replicate WebGL behavior
        this.#device.queue.writeBuffer(
          $buffer.gpuBuffer,
          0,
          new Uint8Array($buffer.byteLength ?? 0),
        );
      }
    } else {
      this.#device.queue.writeBuffer($buffer.gpuBuffer, 0, dataOrSize);
    }
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
