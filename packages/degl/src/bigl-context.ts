import { TgpuRoot } from 'typegpu';
import { BiGLBuffer, VertexBufferSegment } from './buffer.ts';
import { Remapper } from './remap.ts';
import { $internal } from './types.ts';
import { BiGLUniformLocation, UniformBufferCache } from './uniform.ts';
import type { WgslGenerator } from './wgsl/wgsl-generator.ts';

const gl = WebGLRenderingContext;

class BiGLShader implements WebGLShader {
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
  vert: BiGLShader | undefined;
  frag: BiGLShader | undefined;
  attributeLocationMap: Map<string, number> | undefined;
  uniformLocationMap: Map<string, number> | undefined;
  wgpuShaderModule: GPUShaderModule | undefined;

  constructor() {}
}

class BiGLProgram implements WebGLProgram {
  readonly [$internal]: DeGlProgramInternals;

  constructor() {
    this[$internal] = new DeGlProgramInternals();
  }
}

const elementSizeCatalog: Record<GLenum, number> = {
  [gl.UNSIGNED_BYTE]: 1,
  [gl.UNSIGNED_SHORT]: 2,
  [gl.UNSIGNED_INT]: 4,
  [gl.FLOAT]: 4,
};

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

export class BiGLContext {
  readonly [$internal]: { device: GPUDevice };

  #root: TgpuRoot;
  #remapper: Remapper;
  #format: GPUTextureFormat;
  #wgslGen: WgslGenerator;
  #canvas: HTMLCanvasElement;
  #canvasContext: GPUCanvasContext;
  #depthTexture: GPUTexture | undefined;

  //
  // GL state
  //

  #program: BiGLProgram | undefined;

  /**
   * Set using gl.enableVertexAttribArray and gl.disableVertexAttribArray.
   */
  #enabledVertexAttribArrays = new Set<number>();

  /**
   * The currently bound buffers. Set using gl.bindBuffer.
   */
  #boundBufferMap: Map<GLenum, BiGLBuffer> = new Map();

  #vertexBufferSegments: VertexBufferSegment[] = [];
  #uniformBufferCache: UniformBufferCache;
  #clearColor: [number, number, number, number] = [0, 0, 0, 0];

  /**
   * The initial value for each capability with the exception of GL_DITHER is `false`.
   *
   * @see {@link https://registry.khronos.org/OpenGL-Refpages/es2.0/xhtml/glEnable.xml}
   */
  #enabledCapabilities: Set<GLenum> = new Set([gl.DITHER]);

  #cullFaceMode: GLenum = gl.BACK;

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
    this[$internal] = { device: root.device };
    this.#root = root;
    this.#remapper = new Remapper(root);
    this.#uniformBufferCache = new UniformBufferCache(root);
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

  enable(cap: GLenum): void {
    this.#enabledCapabilities.add(cap);
  }

  disable(cap: GLenum): void {
    this.#enabledCapabilities.delete(cap);
  }

  isEnabled(cap: GLenum): boolean {
    return this.#enabledCapabilities.has(cap);
  }

  createShader(type: GLenum): WebGLShader | null {
    return new BiGLShader(type);
  }

  shaderSource(shader: BiGLShader, source: string): void {
    shader[$internal].source = source;
  }

  compileShader(_shader: BiGLShader): void {
    // NO-OP: Deferring compilation until the program is linked
  }

  createProgram(): WebGLProgram {
    return new BiGLProgram();
  }

  attachShader(program: BiGLProgram, shader: BiGLShader): void {
    const $shader = shader[$internal];

    if ($shader.type === gl.VERTEX_SHADER) {
      program[$internal].vert = shader;
    } else if ($shader.type === gl.FRAGMENT_SHADER) {
      program[$internal].frag = shader;
    }
  }

  getAttribLocation(program: BiGLProgram, name: string): GLint {
    const $program = program[$internal];
    if ($program.attributeLocationMap === undefined) {
      throw new Error('Program not linked');
    }
    return $program.attributeLocationMap.get(name) ?? -1;
  }

  getUniformLocation(
    program_: BiGLProgram,
    name: string,
  ): WebGLUniformLocation | null {
    const program = program_[$internal];
    if (program.uniformLocationMap === undefined) {
      throw new Error('Program not linked');
    }
    const idx = program.uniformLocationMap.get(name);
    return idx !== undefined ? new BiGLUniformLocation(idx) : null;
  }

  createBuffer(): WebGLBuffer {
    return new BiGLBuffer(this.#root, this.#remapper);
  }

  deleteBuffer(buffer: BiGLBuffer | null): void {
    if (buffer) {
      buffer[$internal].destroy();
    }
  }

  bindBuffer(target: GLenum, buffer: BiGLBuffer | null): void {
    if (buffer) {
      if (target === gl.ELEMENT_ARRAY_BUFFER) {
        buffer[$internal].boundAsIndexBuffer = true;
      }
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
      this.#root.device.queue.writeBuffer(
        $buffer.gpuBuffer,
        0,
        dataOrSize as any,
      );
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
    const bytesPerElement = elementSizeCatalog[type];
    if (!bytesPerElement) {
      throw new Error(`Unsupported vertex type: ${type}`);
    }

    let format = (
      normalized
        ? normalizedVertexFormatCatalog
        : unnormalizedVertexFormatCatalog
    )[type][size];

    if (!format) {
      throw new Error(`Unsupported vertex format: ${type} ${size}`);
    }

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
    this.#clearColor = [r, g, b, a];
  }

  cullFace(mode: GLenum): void {
    this.#cullFaceMode = mode;
  }

  clear(mask: GLbitfield): void {
    // TODO: Implement clear setup
  }

  linkProgram(program: BiGLProgram): void {
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
      label: 'BiGL Shader Module',
      code: result.wgsl,
    });
    $program.wgpuShaderModule = module;
  }

  useProgram(program: BiGLProgram): void {
    this.#program = program;
  }

  viewport(x: number, y: number, width: number, height: number): void {
    // TODO: Change which part of the target texture we're drawing to
  }

  uniform1f(location: BiGLUniformLocation | null, value: GLfloat) {
    if (!location) {
      // Apparently, a `null` location is a no-op in WebGL
      return;
    }
    this.#uniformBufferCache.updateUniform(
      location,
      new Float32Array([value]).buffer,
    );
  }

  uniformMatrix4fv(
    location: BiGLUniformLocation | null,
    transpose: GLboolean,
    value: Iterable<GLfloat> | Float32List,
  ): void {
    if (!location) {
      // Apparently, a `null` location is a no-op in WebGL
      return;
    }
    const data = new Float32Array([...value]);

    // TODO: Handle transposing
    this.#uniformBufferCache.updateUniform(location, data.buffer);
  }

  #createRenderPass(encoder: GPUCommandEncoder) {
    const program = this.#program?.[$internal]!;
    const currentTexture = this.#canvasContext.getCurrentTexture();

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

    let depthStencil: GPUDepthStencilState | undefined;
    let depthTextureView: GPUTextureView | undefined;

    if (this.#enabledCapabilities.has(gl.DEPTH_TEST)) {
      if (
        !this.#depthTexture ||
        this.#depthTexture.width !== currentTexture.width ||
        this.#depthTexture.height !== currentTexture.height
      ) {
        this.#depthTexture?.destroy();
        this.#depthTexture = this.#root.device.createTexture({
          size: [currentTexture.width, currentTexture.height],
          format: 'depth24plus',
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
      }
      depthTextureView = this.#depthTexture.createView();
      depthStencil = {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      };
    }

    const pipeline = this.#root.device.createRenderPipeline({
      label: 'BiGL Render Pipeline',
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
      depthStencil,
      primitive: {
        topology: 'triangle-list',
        cullMode: this.#enabledCapabilities.has(gl.CULL_FACE)
          ? this.#cullFaceMode === gl.BACK
            ? 'back'
            : 'front'
          : 'none',
      },
    });

    const renderPass = encoder.beginRenderPass({
      label: 'BiGL Render Pass',
      colorAttachments: [
        {
          view: currentTexture.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: this.#clearColor,
        },
      ],
      depthStencilAttachment: depthTextureView
        ? {
            view: depthTextureView!,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            depthClearValue: 1.0,
          }
        : undefined,
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

    // Uniforms
    const group =
      (program.uniformLocationMap?.size ?? 0) > 0
        ? this.#root.device.createBindGroup({
            // TODO: Create the bind group layout manually
            layout: pipeline.getBindGroupLayout(0),
            entries: program
              .uniformLocationMap!.values()
              .map((location) => {
                const buffer = this.#uniformBufferCache.getBuffer(location);

                if (!buffer) {
                  return undefined;
                }

                return {
                  binding: location,
                  resource: {
                    buffer,
                  },
                } satisfies GPUBindGroupEntry;
              })
              .filter((entry) => entry !== undefined),
          })
        : undefined;

    if (group) {
      renderPass.setBindGroup(0, group);
    }

    return renderPass;
  }

  drawArrays(mode: GLenum, first: GLint, count: GLsizei): void {
    const program = this.#program?.[$internal];
    if (!program) {
      throw new Error('No program bound');
    }

    const encoder = this.#root.device.createCommandEncoder({
      label: 'BiGL Command Encoder',
    });
    const renderPass = this.#createRenderPass(encoder);
    renderPass.draw(count, 1, first, 0);
    renderPass.end();

    this.#root.device.queue.submit([encoder.finish()]);
  }

  drawElements(
    mode: GLenum,
    count: GLsizei,
    type: GLenum,
    offset: GLintptr,
  ): void {
    const program = this.#program?.[$internal];
    if (!program) {
      throw new Error('No program bound');
    }

    const encoder = this.#root.device.createCommandEncoder({
      label: 'BiGL Command Encoder',
    });

    const renderPass = this.#createRenderPass(encoder);

    // Index buffer
    const indexBuffer = this.#boundBufferMap.get(gl.ELEMENT_ARRAY_BUFFER)?.[
      $internal
    ];

    if (!indexBuffer) {
      throw new Error('No index buffer bound');
    }

    const indexFormat =
      type === gl.UNSIGNED_SHORT
        ? 'uint16'
        : type === gl.UNSIGNED_INT
          ? 'uint32'
          : undefined;

    if (!indexFormat) {
      throw new Error(`Unsupported index type: ${type}`);
    }

    renderPass.setIndexBuffer(indexBuffer.gpuBuffer, indexFormat);
    renderPass.drawIndexed(count, 1, offset, 0, 0);
    renderPass.end();

    this.#root.device.queue.submit([encoder.finish()]);
  }
}

// Inheriting from WebGLRenderingContext
Object.setPrototypeOf(BiGLContext.prototype, WebGLRenderingContext.prototype);
