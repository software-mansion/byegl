import { TgpuRoot } from 'typegpu';
import type { WgslGenerator } from '../common/wgsl-generator.ts';
import { layout, remap8x3to8x4 } from './remap.ts';
import { $internal } from './types.ts';
import { DeGLUniformLocation } from './uniform.ts';

const gl = WebGLRenderingContext;

type RemappedVertexFormat = 'unorm8x3';

interface VertexBufferSegment {
  buffer: DeGLBufferInternal;
  /**
   * Where from the original buffer does the data for this segment start.
   */
  offset: number;
  stride: number;
  format: GPUVertexFormat | RemappedVertexFormat;
  remappedStride: number;
  remappedFormat: GPUVertexFormat;
  /**
   * The numeric location associated with this attribute, which will correspond with a
   * <a href="https://gpuweb.github.io/gpuweb/wgsl/#input-output-locations">"@location" attribute</a>
   * declared in the {@link GPURenderPipelineDescriptor#vertex}.{@link GPUProgrammableStage#module | module}.
   */
  shaderLocation: GPUIndex32;
}

/**
 * The internal state of degl buffers
 */
class DeGLBufferInternal {
  readonly #root: TgpuRoot;

  #byteLength: number | undefined;
  #gpuBuffer: GPUBuffer | undefined;
  gpuBufferDirty = true;

  /**
   * Since this buffer can be bound to a vertex attribute using a format
   * that is not natively supported by WebGPU (e.g. unorm8x3), we allocate a
   * secondary buffer that holds the data remapped to match the expected format.
   *
   * This one remaps an 8x3 buffer into an 8x4 buffer.
   */
  #variant8x3to8x4: GPUBuffer | undefined;
  variant8x3to8x4Dirty = true;

  constructor(root: TgpuRoot) {
    this.#root = root;
  }

  get byteLength(): number | undefined {
    return this.#byteLength;
  }

  set byteLength(value: number) {
    if (value !== this.#byteLength) {
      this.#byteLength = value;
      this.gpuBufferDirty = true;
      this.variant8x3to8x4Dirty = true;
    }
  }

  get gpuBuffer(): GPUBuffer {
    if (!this.gpuBufferDirty) {
      return this.#gpuBuffer!;
    }
    this.gpuBufferDirty = false;

    // Cleaning up old buffer, if it exists
    this.#gpuBuffer?.destroy();

    this.#gpuBuffer = this.#root.device.createBuffer({
      label: 'DeGL Vertex Buffer',
      size: this.#byteLength!,
      usage:
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.VERTEX |
        GPUBufferUsage.STORAGE,
    });

    return this.#gpuBuffer;
  }

  get variant8x3to8x4(): GPUBuffer {
    const elements = Math.floor(this.#byteLength! / 3);

    if (this.variant8x3to8x4Dirty) {
      // Recreate the variant buffer
      this.variant8x3to8x4Dirty = false;
      // Cleaning up old buffer, if it exists
      this.#variant8x3to8x4?.destroy();
      this.#variant8x3to8x4 = this.#root.device.createBuffer({
        label: 'DeGL Vertex Buffer (8x3 -> 8x4)',
        size: elements * 4,
        usage:
          GPUBufferUsage.COPY_DST |
          GPUBufferUsage.COPY_SRC |
          GPUBufferUsage.VERTEX |
          GPUBufferUsage.STORAGE,
      });
    }

    const gpuBuffer = this.gpuBuffer;

    const bindGroup = this.#root.createBindGroup(layout, {
      input: gpuBuffer,
      output: this.#variant8x3to8x4!,
    });

    // Remapping in a compute shader
    const pipeline = this.#root['~unstable']
      .withCompute(remap8x3to8x4)
      .createPipeline()
      // ---
      .with(layout, bindGroup);

    pipeline.dispatchWorkgroups(elements);

    return this.#variant8x3to8x4!;
  }

  destroy() {
    this.#gpuBuffer?.destroy();
    this.#variant8x3to8x4?.destroy();
  }
}

class DeGLBuffer {
  readonly [$internal]: DeGLBufferInternal;

  constructor(root: TgpuRoot) {
    this[$internal] = new DeGLBufferInternal(root);
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
  uniformLocationMap: Map<string, number> | undefined;
  wgpuShaderModule: GPUShaderModule | undefined;
  wgpuPipeline: GPURenderPipeline | undefined;

  constructor() {}
}

class DeGLProgram implements WebGLProgram {
  readonly [$internal]: DeGlProgramInternals;

  constructor() {
    this[$internal] = new DeGlProgramInternals();
  }
}

const normalizedVertexFormatCatalog: Record<
  number,
  Record<
    number,
    | GPUVertexFormat
    // The following are actually missing from WebGPU right now :(
    // We implement remappings into compatible formats ourselves
    | 'unorm8x3'
  >
> = {
  [gl.UNSIGNED_BYTE]: {
    2: 'unorm8x2',
    3: 'unorm8x3',
    4: 'unorm8x4',
  },
};

const unnormalizedVertexFormatCatalog: Record<
  number,
  Record<number, GPUVertexFormat>
> = {
  [gl.FLOAT]: {
    2: 'float32x2',
    3: 'float32x3',
    4: 'float32x4',
  },
  [gl.UNSIGNED_BYTE]: {
    2: 'uint8x2',
    // 3 is actually missing from WebGPU right now :(
    4: 'uint8x4',
  },
};

const vertexFormatRemappings: Record<
  string,
  (bufferView: ArrayBufferView<ArrayBufferLike>) => {
    newFormat: string;
    buffer: ArrayBuffer;
  }
> = {
  unorm8x3: (input: ArrayBufferView<ArrayBufferLike> | ArrayBufferLike) => {
    if (input.byteLength % 3 !== 0) {
      throw new Error('Invalid buffer size');
    }
    const elementCount = input.byteLength / 3;
    const resultBuffer = new ArrayBuffer(elementCount * 4);
    const resultView = new Uint8Array(resultBuffer);

    const u8View =
      'byteOffset' in input
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : new Uint8Array(input);

    for (let i = 0, j = 0; i < u8View.byteLength; i += 3, j += 4) {
      const r = u8View[i];
      const g = u8View[i + 1];
      const b = u8View[i + 2];
      resultView[j] = r;
      resultView[j + 1] = g;
      resultView[j + 2] = b;
    }

    return { newFormat: 'unorm8x4', buffer: resultBuffer };
  },
};

export class DeGLContext {
  #root: TgpuRoot;
  #format: GPUTextureFormat;
  #wgslGen: WgslGenerator;
  #canvas: HTMLCanvasElement;
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
      this.#enabledVertexAttribArrays.has(segment.shaderLocation),
    );
  }

  constructor(
    root: TgpuRoot,
    canvas: HTMLCanvasElement,
    wgslGen: WgslGenerator,
  ) {
    this.#root = root;
    this.#format = navigator.gpu.getPreferredCanvasFormat();
    this.#wgslGen = wgslGen;
    const canvasCtx = canvas.getContext('webgpu');
    if (!canvasCtx) {
      throw new Error('Failed to get WebGPU context');
    }
    canvasCtx.configure({
      device: this.#root.device,
      format: this.#format,
      alphaMode: 'premultiplied',
    });
    this.#canvas = canvas;
    this.#canvasContext = canvasCtx;
  }

  #setAttribute(newSegment: VertexBufferSegment) {
    let segment: VertexBufferSegment | undefined =
      this.#vertexBufferSegments.find(
        (seg) => seg.shaderLocation === newSegment.shaderLocation,
      );

    if (!segment) {
      segment = newSegment;
      this.#vertexBufferSegments.push(segment);
      return;
    }

    if (
      segment.stride !== newSegment.stride ||
      segment.offset !== newSegment.offset ||
      segment.buffer !== newSegment.buffer ||
      segment.format !== newSegment.format ||
      segment.shaderLocation !== newSegment.shaderLocation
    ) {
      segment.stride = newSegment.stride;
      segment.offset = newSegment.offset;
      segment.buffer = newSegment.buffer;
      segment.format = newSegment.format;
      segment.shaderLocation = newSegment.shaderLocation;
    }
  }

  get canvas() {
    return this.#canvas;
  }

  enable(cap: GLenum) {
    // TODO: Enable capabilities
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

    if ($shader.type === gl.VERTEX_SHADER) {
      program[$internal].vert = shader;
    } else if ($shader.type === gl.FRAGMENT_SHADER) {
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

  getUniformLocation(
    program_: DeGLProgram,
    name: string,
  ): WebGLUniformLocation | null {
    const program = program_[$internal];
    if (program.uniformLocationMap === undefined) {
      throw new Error('Program not linked');
    }
    const idx = program.uniformLocationMap.get(name);
    return idx !== undefined ? new DeGLUniformLocation(idx) : null;
  }

  createBuffer(): WebGLBuffer {
    return new DeGLBuffer(this.#root);
  }

  deleteBuffer(buffer: DeGLBuffer | null): void {
    if (buffer) {
      buffer[$internal].destroy();
    }
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
      if (!$buffer.gpuBufferDirty) {
        // If the buffer won't be recreated, wipe the buffer to
        // replicate WebGL behavior
        this.#root.device.queue.writeBuffer(
          $buffer.gpuBuffer,
          0,
          new Uint8Array($buffer.byteLength ?? 0),
        );
      }
    } else {
      // Maybe the data needs remapping?
      // TODO: We can't actually remap here, since we don't know the format of the data
      //       We have to defer allocating the buffer until the user calls vertexAttribPointer.
      this.#root.device.queue.writeBuffer($buffer.gpuBuffer, 0, dataOrSize);
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

    let format =
      (normalized
        ? normalizedVertexFormatCatalog
        : unnormalizedVertexFormatCatalog)[type][size] ?? 'float32x2';

    let remappedStride = stride === 0 ? size * bytesPerElement : stride;
    let remappedFormat = format;

    if (remappedFormat === 'unorm8x3') {
      remappedFormat = 'unorm8x4';
      remappedStride += bytesPerElement;
    }

    const currentlyBoundBuffer = this.#boundBufferMap.get(gl.ARRAY_BUFFER)?.[
      $internal
    ];

    if (!currentlyBoundBuffer) {
      throw new Error('No buffer bound to ARRAY_BUFFER');
    }

    const segment: VertexBufferSegment = {
      buffer: currentlyBoundBuffer,
      offset: offset,
      stride: stride === 0 ? size * bytesPerElement : stride,
      format,
      remappedStride,
      remappedFormat,
      shaderLocation: index,
    };

    this.#setAttribute(segment);
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
    $program.uniformLocationMap = result.uniformLocationMap;

    const module = this.#root.device.createShaderModule({
      label: 'DeGL Shader Module',
      code: result.wgsl,
    });
    $program.wgpuShaderModule = module;
  }

  useProgram(program: DeGLProgram): void {
    this.#program = program;
  }

  viewport(x: number, y: number, width: number, height: number): void {
    // TODO: Change which part of the target texture we're drawing to
  }

  #createPipeline(): GPURenderPipeline {
    const program = this.#program![$internal];
    const boundArrayBuffer = this.#boundBufferMap.get(gl.ARRAY_BUFFER)?.[
      $internal
    ];

    const vertexLayout = this.#enabledVertexBufferSegments.map(
      (segment): GPUVertexBufferLayout => ({
        arrayStride: segment.remappedStride,
        attributes: [
          {
            format: segment.remappedFormat,
            // The local offset is handled by the global offset of the segment
            offset: 0,
            shaderLocation: segment.shaderLocation,
          },
        ],
        stepMode: 'vertex',
      }),
    );

    program.wgpuPipeline = this.#root.device.createRenderPipeline({
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

  uniformMatrix4fv(
    location: DeGLUniformLocation | null,
    transpose: GLboolean,
    value: Iterable<GLfloat> | Float32List,
  ): void {
    const numbers = [...value];
    if (!location) {
      throw new Error('No location provided');
    }
    const buffer = this.#root.device.createBuffer({
      label: 'DeGL Uniform Matrix4fv Buffer',
      size: numbers.length * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    const data = new Float32Array(buffer.getMappedRange());
    for (let i = 0; i < numbers.length; i++) {
      data[i] = numbers[i];
    }
    buffer.unmap();

    // TODO: Handle transposing
    // TODO: Bind the buffer to the specific location
  }

  drawArrays(mode: GLenum, first: GLint, count: GLsizei): void {
    if (!this.#program) {
      throw new Error('No program bound');
    }

    const pipeline = this.#createPipeline();

    const encoder = this.#root.device.createCommandEncoder({
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
      if (segment.format === 'unorm8x3') {
        renderPass.setVertexBuffer(
          vertexBufferIdx++,
          segment.buffer.variant8x3to8x4,
          segment.offset,
        );
      } else {
        renderPass.setVertexBuffer(
          vertexBufferIdx++,
          segment.buffer.gpuBuffer,
          segment.offset,
        );
      }
    }

    renderPass.draw(count, 1, first, 0);
    renderPass.end();

    this.#root.device.queue.submit([encoder.finish()]);
  }
}

// Inheriting from WebGLRenderingContext
Object.setPrototypeOf(DeGLContext.prototype, WebGLRenderingContext.prototype);
