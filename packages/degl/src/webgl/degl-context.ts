import type { WgslGenerator } from '../common/wgsl-generator.ts';

const $internal = Symbol('degl internals');

interface VertexBufferSegment {
  buffer: DeGLBufferInternal;
  arrayStride: number;
  /**
   * Where from the original buffer does the data for this segment start
   */
  dataOffset: number;
  attribute: GPUVertexAttribute;
}

/**
 * The internal state of degl buffers
 */
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
    this.dirty = false;

    // Cleaning up old buffer, if it exists
    this.#gpuBuffer?.destroy();

    this.#gpuBuffer = this.device.createBuffer({
      label: 'DeGL Vertex Buffer',
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

class DeGlProgramInternals {
  vert: DeGLShader | undefined;
  frag: DeGLShader | undefined;
  attributeLocationMap: Map<string, number> | undefined;
  wgpuShaderModule: GPUShaderModule | undefined;
  /**
   * If true, we should recreate the pipeline instead of
   * reusing the cached object
   */
  dirty = true;
  wgpuPipeline: GPURenderPipeline | undefined;

  constructor() {}
}

class DeGLProgram implements WebGLProgram {
  readonly [$internal]: DeGlProgramInternals;

  constructor() {
    this[$internal] = new DeGlProgramInternals();
  }
}

const typeAndSizeToVertexFormat: Record<
  number,
  Record<number, GPUVertexFormat>
> = {
  [WebGLRenderingContext.FLOAT]: {
    2: 'float32x2',
    3: 'float32x3',
    4: 'float32x4',
  },
};

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
   * The currently bound buffers. Set using gl.bindBuffer.
   */
  #boundBufferMap: Map<GLenum, DeGLBuffer> = new Map();

  #vertexBufferSegments: VertexBufferSegment[] = [];

  get #enabledVertexBufferSegments(): VertexBufferSegment[] {
    return this.#vertexBufferSegments.filter((segment) =>
      this.#enabledVertexAttribArrays.has(segment.attribute.shaderLocation),
    );
  }

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

  #setAttribute(
    newAttrib: GPUVertexAttribute,
    arrayStride: number,
    dataOffset: number,
  ) {
    const currentlyBoundBuffer = this.#boundBufferMap.get(
      WebGLRenderingContext.ARRAY_BUFFER,
    )?.[$internal];

    if (!currentlyBoundBuffer) {
      throw new Error('No buffer bound to ARRAY_BUFFER');
    }

    let segment: VertexBufferSegment | undefined =
      this.#vertexBufferSegments.find(
        (seg) => seg.attribute.shaderLocation === newAttrib.shaderLocation,
      );

    if (!segment) {
      segment = {
        buffer: currentlyBoundBuffer,
        arrayStride,
        dataOffset: 0,
        attribute: newAttrib,
      };
      this.#vertexBufferSegments.push(segment);
    }

    if (
      segment.arrayStride !== arrayStride ||
      segment.dataOffset !== dataOffset ||
      segment.attribute.format !== newAttrib.format ||
      segment.attribute.offset !== newAttrib.offset
    ) {
      segment.arrayStride = arrayStride;
      segment.dataOffset = dataOffset;
      segment.attribute = newAttrib;
    }
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

  /**
   * My best guess right now is that this function associates a buffer with a specific
   * attribute location, globally (meaning if we change programs, it sticks).
   * TODO: Verify this in an example
   */
  vertexAttribPointer(
    index: GLuint,
    size: GLint,
    type: GLenum,
    normalized: GLboolean,
    stride: GLsizei,
    offset: GLintptr,
  ): void {
    // TODO: Pick based on the type
    const bytesPerElement = Float32Array.BYTES_PER_ELEMENT;

    this.#setAttribute(
      {
        shaderLocation: index,
        // TODO: Adapt format based on type and size
        format: typeAndSizeToVertexFormat[type][size] ?? 'float32x2',
        // The global offset handles the local offset as well
        offset: 0,
      },
      // If the stride is 0, WebGL uses the size as the stride
      stride === 0 ? size * bytesPerElement : stride,
      offset,
    );
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
    const program = this.#program![$internal];
    const boundArrayBuffer = this.#boundBufferMap.get(
      WebGLRenderingContext.ARRAY_BUFFER,
    )?.[$internal];

    const vertexLayout = this.#enabledVertexBufferSegments.map(
      (segment): GPUVertexBufferLayout => ({
        arrayStride: segment.arrayStride,
        attributes: [segment.attribute],
        stepMode: 'vertex',
      }),
    );

    program.wgpuPipeline = this.#device.createRenderPipeline({
      label: 'DeGL Render Pipeline',
      layout: 'auto',
      vertex: {
        module: program.wgpuShaderModule!,
        buffers: vertexLayout,
      },
      fragment: {
        module: program.wgpuShaderModule!,
        targets: [
          {
            format: this.#format,
          },
        ],
      },
    });

    return program.wgpuPipeline;
  }

  drawArrays(mode: GLenum, first: GLint, count: GLsizei): void {
    if (!this.#program) {
      throw new Error('No program bound');
    }

    const pipeline = this.#createOrReusePipeline();

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

    // Vertex buffers
    let vertexBufferIdx = 0;
    for (const segment of this.#enabledVertexBufferSegments) {
      renderPass.setVertexBuffer(
        vertexBufferIdx++,
        segment.buffer.gpuBuffer,
        segment.dataOffset,
      );
    }

    renderPass.draw(count, 1, first, 0);
    renderPass.end();

    this.#device.queue.submit([encoder.finish()]);
  }
}

// Inheriting from WebGLRenderingContext
Object.setPrototypeOf(DeGLContext.prototype, WebGLRenderingContext.prototype);
