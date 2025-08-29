import { TgpuRoot } from 'typegpu';
import { ByeGLBuffer, VertexBufferSegment } from './buffer.ts';
import { primitiveMap } from './constants.ts';
import type { ExtensionMap } from './extensions/types.ts';
import { Remapper } from './remap.ts';
import { $internal } from './types.ts';
import { ByeGLUniformLocation, UniformBufferCache } from './uniform.ts';
import type {
  AttributeInfo,
  UniformInfo,
  WgslGenerator,
} from './wgsl/wgsl-generator.ts';

const gl = WebGL2RenderingContext;

class ByeGLShader implements WebGLShader {
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

class ByeGLProgramInternals {
  vert: ByeGLShader | undefined;
  frag: ByeGLShader | undefined;
  attributes: AttributeInfo[] | undefined;
  uniforms: UniformInfo[] | undefined;
  wgpuShaderModule: GPUShaderModule | undefined;

  constructor() {}
}

class ByeGLProgram implements WebGLProgram {
  readonly [$internal]: ByeGLProgramInternals;

  constructor() {
    this[$internal] = new ByeGLProgramInternals();
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

const shaderPrecisionFormatCatalog: Record<GLenum, WebGLShaderPrecisionFormat> =
  {
    [gl.HIGH_FLOAT]: Object.setPrototypeOf(
      {
        rangeMin: 127,
        rangeMax: 127,
        precision: 23,
      },
      WebGLShaderPrecisionFormat.prototype,
    ),
    [gl.MEDIUM_FLOAT]: Object.setPrototypeOf(
      {
        rangeMin: 127,
        rangeMax: 127,
        precision: 23,
      },
      WebGLShaderPrecisionFormat.prototype,
    ),
    [gl.LOW_FLOAT]: Object.setPrototypeOf(
      {
        rangeMin: 127,
        rangeMax: 127,
        precision: 23,
      },
      WebGLShaderPrecisionFormat.prototype,
    ),
    [gl.HIGH_INT]: Object.setPrototypeOf(
      {
        rangeMin: 31,
        rangeMax: 30,
        precision: 0,
      },
      WebGLShaderPrecisionFormat.prototype,
    ),
    [gl.MEDIUM_INT]: Object.setPrototypeOf(
      {
        rangeMin: 31,
        rangeMax: 30,
        precision: 0,
      },
      WebGLShaderPrecisionFormat.prototype,
    ),
    [gl.LOW_INT]: Object.setPrototypeOf(
      {
        rangeMin: 31,
        rangeMax: 30,
        precision: 0,
      },
      WebGLShaderPrecisionFormat.prototype,
    ),
  };

export class ByeGLContext {
  readonly [$internal]: { device: GPUDevice; glVersion: 1 | 2 };

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

  #program: ByeGLProgram | undefined;

  /**
   * Set using gl.enableVertexAttribArray and gl.disableVertexAttribArray.
   */
  #enabledVertexAttribArrays = new Set<number>();

  /**
   * The currently bound buffers. Set using gl.bindBuffer.
   */
  #boundBufferMap: Map<GLenum, ByeGLBuffer> = new Map();

  #vertexBufferSegments: VertexBufferSegment[] = [];
  #uniformBufferCache: UniformBufferCache;

  /**
   * The initial value for each capability with the exception of GL_DITHER is `false`.
   *
   * @see {@link https://registry.khronos.org/OpenGL-Refpages/es2.0/xhtml/glEnable.xml}
   */
  #enabledCapabilities: Set<GLenum> = new Set([gl.DITHER]);

  #parameters = new Map<GLenum, any>([
    [gl.DEPTH_FUNC, gl.LESS],
    [gl.CULL_FACE_MODE, gl.BACK],
    [gl.COLOR_WRITEMASK, [true, true, true, true]],
    [gl.COLOR_CLEAR_VALUE, new Float32Array([0, 0, 0, 0])],
    [gl.DEPTH_CLEAR_VALUE, 1],
    [gl.STENCIL_CLEAR_VALUE, 0],
    [gl.FRONT_FACE, gl.CCW],
    [gl.GENERATE_MIPMAP_HINT, gl.DONT_CARE],
    [gl.POLYGON_OFFSET_FILL, false],
  ]);

  get #enabledVertexBufferSegments(): VertexBufferSegment[] {
    return this.#vertexBufferSegments.filter((segment) =>
      this.#enabledVertexAttribArrays.has(segment.shaderLocation),
    );
  }

  constructor(
    glVersion: 1 | 2,
    root: TgpuRoot,
    canvas: HTMLCanvasElement,
    wgslGen: WgslGenerator,
  ) {
    this[$internal] = { device: root.device, glVersion };
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
    return new ByeGLShader(type);
  }

  shaderSource(shader: ByeGLShader, source: string): void {
    shader[$internal].source = source;
  }

  compileShader(_shader: ByeGLShader): void {
    // NO-OP: Deferring compilation until the program is linked
  }

  getShaderPrecisionFormat(
    shadertype: GLenum,
    precisiontype: GLint,
  ): WebGLShaderPrecisionFormat | null {
    return shaderPrecisionFormatCatalog[precisiontype] ?? null;
  }

  colorMask(
    red: GLboolean,
    green: GLboolean,
    blue: GLboolean,
    alpha: GLboolean,
  ): void {
    this.#parameters.set(gl.COLOR_WRITEMASK, [red, green, blue, alpha]);
  }

  frontFace(mode: GLenum): void {
    this.#parameters.set(gl.FRONT_FACE, mode);
  }

  getShaderInfoLog(shader: WebGLShader): string | null {
    // TODO: Implement
    return null;
  }

  getProgramInfoLog(program: WebGLProgram): string | null {
    // TODO: Implement
    return null;
  }

  getParameter(pname: GLenum): any {
    const limits = this.#root.device.limits;

    if (this.#parameters.has(pname)) {
      const value = this.#parameters.get(pname);

      if (value instanceof Float32Array) {
        return new Float32Array(value);
      }
      // Freezing just in case the user decides to modify the value
      return Object.freeze(value);
    }

    switch (pname) {
      case gl.ACTIVE_TEXTURE:
        // TODO: Implement
        return gl.TEXTURE0;
      case gl.ALIASED_LINE_WIDTH_RANGE:
        // TODO: Implement
        return new Float32Array([1, 1]);
      case gl.ALIASED_POINT_SIZE_RANGE:
        // TODO: Implement
        return new Float32Array([1, 1]);
      case gl.ALPHA_BITS:
        // TODO: Return 16 is the canvas was configured with a
        // texture format that supports higher precision
        // (e.g. rgba16float)
        return 8;
      case gl.ARRAY_BUFFER_BINDING:
        return this.#boundBufferMap.get(gl.ARRAY_BUFFER) ?? null;
      case gl.BLEND:
        return this.#enabledCapabilities.has(gl.BLEND);
      case gl.BLEND_COLOR:
        // TODO: Implement
        return new Float32Array([0, 0, 0, 0]);
      case gl.BLEND_DST_ALPHA:
      case gl.BLEND_DST_RGB:
        // TODO: Implement
        return gl.ZERO;
      case gl.BLEND_EQUATION:
      case gl.BLEND_EQUATION_ALPHA:
      case gl.BLEND_EQUATION_RGB:
        // TODO: Implement
        return gl.FUNC_ADD;
      case gl.BLEND_SRC_ALPHA:
      case gl.BLEND_SRC_RGB:
        // TODO: Implement
        return gl.ONE;
      case gl.BLUE_BITS:
        // TODO: Return 16 is the canvas was configured with a
        // texture format that supports higher precision
        // (e.g. rgba16float)
        return 8;
      case gl.COMPRESSED_TEXTURE_FORMATS:
        // TODO: Implement
        return new Uint32Array([]);
      case gl.CURRENT_PROGRAM:
        return this.#program ?? null;
      case gl.DEPTH_BITS:
        // TODO: If this can be set, allow it to be changed
        return 24;
      case gl.DEPTH_CLEAR_VALUE:
        // TODO: If this can be set, allow it to be changed
        return 1;
      case gl.DEPTH_FUNC:
        // TODO: If this can be set, allow it to be changed
        return;
      case gl.DEPTH_RANGE:
        // TODO: If this can be set, allow it to be changed
        return new Float32Array([-1, 1]);
      case gl.CULL_FACE:
      case gl.DEPTH_TEST:
      case gl.DITHER:
        return this.#enabledCapabilities.has(pname);
      case gl.ELEMENT_ARRAY_BUFFER_BINDING:
        return this.#boundBufferMap.get(gl.ELEMENT_ARRAY_BUFFER) ?? null;
      case gl.FRAMEBUFFER_BINDING:
        // TODO: Implement
        return null;
      case gl.GREEN_BITS:
        // TODO: Return 16 is the canvas was configured with a
        // texture format that supports higher precision
        // (e.g. rgba16float)
        return 8;
      case gl.IMPLEMENTATION_COLOR_READ_FORMAT:
        // TODO: Respect this values when implementing gl.readPixels
        return gl.RGBA;
      case gl.IMPLEMENTATION_COLOR_READ_TYPE:
        // TODO: Respect this values when implementing gl.readPixels
        return gl.UNSIGNED_BYTE;
      case gl.LINE_WIDTH:
        // TODO: Maybe simulate thick line widths? Not a priority though
        return 1.0;
      case gl.MAX_TEXTURE_IMAGE_UNITS:
      case gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS:
        return limits.maxSampledTexturesPerShaderStage;
      case gl.MAX_TEXTURE_SIZE:
        return limits.maxTextureDimension2D;
      case gl.MAX_CUBE_MAP_TEXTURE_SIZE:
        return limits.maxTextureDimension2D;
      case gl.MAX_VERTEX_ATTRIBS:
        return limits.maxVertexAttributes;
      case gl.MAX_VERTEX_UNIFORM_VECTORS:
      case gl.MAX_FRAGMENT_UNIFORM_VECTORS:
        // Assuming the biggest vector was chosen (4-elements)
        // and using every uniforms buffer binding
        return (
          (limits.maxUniformBufferBindingSize / 4) *
          limits.maxUniformBuffersPerShaderStage
        );
      case gl.MAX_VARYING_VECTORS:
        return limits.maxInterStageShaderVariables;
      case gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS:
        return limits.maxSampledTexturesPerShaderStage * 2;
      case gl.MAX_RENDERBUFFER_SIZE:
        return limits.maxTextureDimension2D;
      case gl.MAX_VIEWPORT_DIMS:
        return [limits.maxTextureDimension2D, limits.maxTextureDimension2D];
      case gl.PACK_ALIGNMENT:
        // TODO: Relevant when implementing gl.readPixels
        return 4;
      case gl.POLYGON_OFFSET_FACTOR:
        // TODO: Relevant when implementing gl.polygonOffset
        return 0;
      case gl.POLYGON_OFFSET_UNITS:
        // TODO: Relevant when implementing gl.polygonOffset
        return 0;
      case gl.RED_BITS:
        // TODO: Return 16 is the canvas was configured with a
        // texture format that supports higher precision
        // (e.g. rgba16float)
        return 8;
      case gl.RENDERBUFFER_BINDING:
        // TODO: Implement
        return null;
      case gl.RENDERER:
        return 'byegl';
      case gl.SAMPLE_BUFFERS:
        // TODO: 0 for now, but investigate more closely when implementing multisampling
        return 0;
      case gl.SAMPLE_COVERAGE_INVERT:
        // TODO: Relevant when implementing gl.sampleCoverage
        return 0;
      case gl.SAMPLE_COVERAGE_VALUE:
        // TODO: Relevant when implementing gl.sampleCoverage
        return 0;
      case gl.SAMPLES:
        // TODO: Relevant when implementing gl.sampleCoverage
        return 0;
      case gl.SCISSOR_BOX:
        // TODO: Relevant when implementing gl.scissor
        return new Int32Array([0, 0, 0, 0]);
      case gl.SCISSOR_TEST:
        // TODO: Relevant when implementing gl.scissor
        return false;
      case gl.SHADING_LANGUAGE_VERSION:
        return this[$internal].glVersion === 2
          ? 'WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0)'
          : 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0)';
      /*
      TODO:
      gl.STENCIL_BACK_FAIL	GLenum
      gl.STENCIL_BACK_FUNC	GLenum
      gl.STENCIL_BACK_PASS_DEPTH_FAIL	GLenum
      gl.STENCIL_BACK_PASS_DEPTH_PASS	GLenum
      gl.STENCIL_BACK_REF	GLint
      gl.STENCIL_BACK_VALUE_MASK	GLuint
      gl.STENCIL_BACK_WRITEMASK	GLuint
      gl.STENCIL_BITS	GLint
      gl.STENCIL_CLEAR_VALUE	GLint
      gl.STENCIL_FAIL	GLenum
      gl.STENCIL_FUNC	GLenum
      gl.STENCIL_PASS_DEPTH_FAIL	GLenum
      gl.STENCIL_PASS_DEPTH_PASS	GLenum
      gl.STENCIL_REF	GLint
      gl.STENCIL_TEST	GLboolean
      gl.STENCIL_VALUE_MASK	GLuint
      gl.STENCIL_WRITEMASK	GLuint
      gl.SUBPIXEL_BITS	GLint
      gl.TEXTURE_BINDING_2D	WebGLTexture or null
      gl.TEXTURE_BINDING_CUBE_MAP	WebGLTexture or null
      gl.UNPACK_ALIGNMENT	GLint
      gl.UNPACK_COLORSPACE_CONVERSION_WEBGL	GLenum
      gl.UNPACK_FLIP_Y_WEBGL	GLboolean
      gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL	GLboolean
      gl.VENDOR	string*/
      case gl.VERSION:
        return this[$internal].glVersion === 2
          ? 'WebGL 2.0 (OpenGL ES 3.0)'
          : 'WebGL 1.0 (OpenGL ES 2.0)';
      case gl.VIEWPORT:
        // TODO: Adjust based on the passed in viewport
        return new Int32Array([0, 0, this.#canvas.width, this.#canvas.height]);
      /*
      TODO: WebGL2 parameters
      gl.COPY_READ_BUFFER_BINDING	WebGLBuffer or null	See bindBuffer.
      gl.COPY_WRITE_BUFFER_BINDING	WebGLBuffer or null	See bindBuffer.
      gl.DRAW_BUFFERi	GLenum	gl.BACK, gl.NONE or gl.COLOR_ATTACHMENT{0-15}. See also drawBuffers.
      gl.DRAW_FRAMEBUFFER_BINDING	WebGLFramebuffer or null	null corresponds to a binding to the default framebuffer. See also bindFramebuffer.
      gl.FRAGMENT_SHADER_DERIVATIVE_HINT	GLenum	gl.FASTEST, gl.NICEST or gl.DONT_CARE. See also hint.
      gl.MAX_3D_TEXTURE_SIZE	GLint
      gl.MAX_ARRAY_TEXTURE_LAYERS	GLint
      gl.MAX_CLIENT_WAIT_TIMEOUT_WEBGL	GLint64
      gl.MAX_COLOR_ATTACHMENTS	GLint
      gl.MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS	GLint64
      gl.MAX_COMBINED_UNIFORM_BLOCKS	GLint
      gl.MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS	GLint64
      gl.MAX_DRAW_BUFFERS	GLint
      gl.MAX_ELEMENT_INDEX	GLint64
      gl.MAX_ELEMENTS_INDICES	GLint
      gl.MAX_ELEMENTS_VERTICES	GLint
      gl.MAX_FRAGMENT_INPUT_COMPONENTS	GLint
      gl.MAX_FRAGMENT_UNIFORM_BLOCKS	GLint
      gl.MAX_FRAGMENT_UNIFORM_COMPONENTS	GLint
      gl.MAX_PROGRAM_TEXEL_OFFSET	GLint*/
      case gl.MAX_SAMPLES:
        return 4;
      /*gl.MAX_SERVER_WAIT_TIMEOUT	GLint64
      gl.MAX_TEXTURE_LOD_BIAS	GLfloat
      gl.MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS	GLint
      gl.MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS	GLint
      gl.MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS	GLint
      gl.MAX_UNIFORM_BLOCK_SIZE	GLint64
      gl.MAX_UNIFORM_BUFFER_BINDINGS	GLint
      gl.MAX_VARYING_COMPONENTS	GLint
      gl.MAX_VERTEX_OUTPUT_COMPONENTS	GLint
      gl.MAX_VERTEX_UNIFORM_BLOCKS	GLint
      gl.MAX_VERTEX_UNIFORM_COMPONENTS	GLint
      gl.MIN_PROGRAM_TEXEL_OFFSET	GLint
      gl.PACK_ROW_LENGTH	GLint	See pixelStorei.
      gl.PACK_SKIP_PIXELS	GLint	See pixelStorei.
      gl.PACK_SKIP_ROWS	GLint	See pixelStorei.
      gl.PIXEL_PACK_BUFFER_BINDING	WebGLBuffer or null	See bindBuffer.
      gl.PIXEL_UNPACK_BUFFER_BINDING	WebGLBuffer or null	See bindBuffer.
      gl.RASTERIZER_DISCARD	GLboolean
      gl.READ_BUFFER	GLenum
      gl.READ_FRAMEBUFFER_BINDING	WebGLFramebuffer or null	null corresponds to a binding to the default framebuffer. See also bindFramebuffer.
      gl.SAMPLE_ALPHA_TO_COVERAGE	GLboolean
      gl.SAMPLE_COVERAGE	GLboolean
      gl.SAMPLER_BINDING	WebGLSampler or null	See bindSampler.
      gl.TEXTURE_BINDING_2D_ARRAY	WebGLTexture or null	See bindTexture.
      gl.TEXTURE_BINDING_3D	WebGLTexture or null	See bindTexture.
      gl.TRANSFORM_FEEDBACK_ACTIVE	GLboolean
      gl.TRANSFORM_FEEDBACK_BINDING	WebGLTransformFeedback or null	See bindTransformFeedback.
      gl.TRANSFORM_FEEDBACK_BUFFER_BINDING	WebGLBuffer or null	See bindBuffer.
      gl.TRANSFORM_FEEDBACK_PAUSED	GLboolean
      gl.UNIFORM_BUFFER_BINDING	WebGLBuffer or null	See bindBuffer.
      gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT	GLint	See pixelStorei.
      gl.UNPACK_IMAGE_HEIGHT	GLint	See pixelStorei.
      gl.UNPACK_ROW_LENGTH	GLint	See pixelStorei.
      gl.UNPACK_SKIP_IMAGES	GLint	See pixelStorei.
      gl.UNPACK_SKIP_PIXELS	GLint	See pixelStorei.
      gl.UNPACK_SKIP_ROWS	GLint	See pixelStorei.
      gl.VERTEX_ARRAY_BINDING	WebGLVertexArrayObject or null	See bindVertexArray.
      */
      default:
        throw new Error(`Unsupported parameter: ${pname}`);
    }
  }

  getExtension<T extends keyof ExtensionMap>(name: T): ExtensionMap[T] | null {
    // TODO: Implement extensions. Not supporting any extension for now.
    return null;
  }

  createProgram(): WebGLProgram {
    return new ByeGLProgram();
  }

  attachShader(program: ByeGLProgram, shader: ByeGLShader): void {
    const $shader = shader[$internal];

    if ($shader.type === gl.VERTEX_SHADER) {
      program[$internal].vert = shader;
    } else if ($shader.type === gl.FRAGMENT_SHADER) {
      program[$internal].frag = shader;
    }
  }

  getAttribLocation(program: ByeGLProgram, name: string): GLint {
    const $program = program[$internal];
    if ($program.attributes === undefined) {
      throw new Error('Program not linked');
    }
    return $program.attributes.find((a) => a.id === name)?.location ?? -1;
  }

  getUniformLocation(
    program_: ByeGLProgram,
    name: string,
  ): WebGLUniformLocation | null {
    const program = program_[$internal];
    if (program.uniforms === undefined) {
      throw new Error('Program not linked');
    }
    const idx = program.uniforms.find((u) => u.id === name)?.location;
    return idx !== undefined ? new ByeGLUniformLocation(idx) : null;
  }

  createBuffer(): WebGLBuffer {
    return new ByeGLBuffer(this.#root, this.#remapper);
  }

  deleteBuffer(buffer: ByeGLBuffer | null): void {
    if (buffer) {
      buffer[$internal].destroy();
    }
  }

  bindBuffer(target: GLenum, buffer: ByeGLBuffer | null): void {
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
    this.#parameters.set(gl.COLOR_CLEAR_VALUE, new Float32Array([r, g, b, a]));
  }

  cullFace(mode: GLenum): void {
    this.#parameters.set(gl.CULL_FACE_MODE, mode);
  }

  clear(mask: GLbitfield): void {
    // TODO: Implement clear setup
  }

  linkProgram(program: ByeGLProgram): void {
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

    $program.attributes = result.attributes;
    $program.uniforms = result.uniforms;

    const module = this.#root.device.createShaderModule({
      label: 'ByeGL Shader Module',
      code: result.wgsl,
    });
    $program.wgpuShaderModule = module;
  }

  useProgram(program: ByeGLProgram): void {
    this.#program = program;
  }

  viewport(x: number, y: number, width: number, height: number): void {
    // TODO: Change which part of the target texture we're drawing to
  }

  uniform1f(location: ByeGLUniformLocation | null, value: GLfloat) {
    const program = this.#program?.[$internal];
    if (!location || !program) {
      // Apparently, a `null` location is a no-op in WebGL
      return;
    }
    const idx = location[$internal];
    const uniform = program.uniforms?.find((u) => u.location === idx);
    if (uniform) {
      this.#uniformBufferCache.updateUniform(
        uniform,
        new Float32Array([value]).buffer,
      );
    }
  }

  uniform3fv(
    location: ByeGLUniformLocation | null,
    value: Iterable<GLfloat> | Float32List,
  ) {
    const program = this.#program?.[$internal];
    if (!location || !program) {
      // Apparently, a `null` location is a no-op in WebGL
      return;
    }
    const idx = location[$internal];
    const uniform = program.uniforms?.find((u) => u.location === idx);

    if (uniform) {
      this.#uniformBufferCache.updateUniform(
        uniform,
        new Float32Array([...value]).buffer,
      );
    }
  }

  uniform4fv(
    location: ByeGLUniformLocation | null,
    value: Iterable<GLfloat> | Float32List,
  ) {
    const program = this.#program?.[$internal];
    if (!location || !program) {
      // Apparently, a `null` location is a no-op in WebGL
      return;
    }
    const data = new Float32Array([...value]);
    const idx = location[$internal];
    const uniform = program.uniforms?.find((u) => u.location === idx);
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, data.buffer);
    }
  }

  uniformMatrix4fv(
    location: ByeGLUniformLocation | null,
    transpose: GLboolean,
    value: Iterable<GLfloat> | Float32List,
  ): void {
    const program = this.#program?.[$internal];
    if (!location || !program) {
      // Apparently, a `null` location is a no-op in WebGL
      return;
    }
    const data = new Float32Array([...value]);
    const idx = location[$internal];
    const uniform = program.uniforms?.find((u) => u.location === idx);
    // TODO: Handle transposing
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, data.buffer);
    }
  }

  #createRenderPass(encoder: GPUCommandEncoder, mode: GLenum) {
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

    const colorMask = this.#parameters.get(gl.COLOR_WRITEMASK);
    const cullFaceMode = this.#parameters.get(gl.CULL_FACE_MODE);
    const topology = primitiveMap[mode as keyof typeof primitiveMap];

    if (!topology) {
      throw new Error(`Unsupported primitive topology: ${mode}`);
    }

    const layout =
      (program.uniforms?.length ?? 0) > 0
        ? this.#root.device.createBindGroupLayout({
            label: 'ByeGL Bind Group Layout',
            entries: program.uniforms!.values().map((uniform) => {
              return {
                binding: uniform.location,
                visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX,
                buffer: {
                  type: 'uniform',
                },
              } satisfies GPUBindGroupLayoutEntry;
            }),
          })
        : undefined;

    const pipeline = this.#root.device.createRenderPipeline({
      label: 'ByeGL Render Pipeline',
      layout: this.#root.device.createPipelineLayout({
        bindGroupLayouts: layout ? [layout] : [],
      }),
      vertex: {
        module: program.wgpuShaderModule!,
        buffers: vertexLayout,
      },
      fragment: {
        module: program.wgpuShaderModule!,
        targets: [
          {
            format: this.#format,
            writeMask:
              (colorMask[0] ? GPUColorWrite.RED : 0) |
              (colorMask[1] ? GPUColorWrite.GREEN : 0) |
              (colorMask[2] ? GPUColorWrite.BLUE : 0) |
              (colorMask[3] ? GPUColorWrite.ALPHA : 0),
          },
        ],
      },
      depthStencil,
      primitive: {
        topology,
        cullMode: this.#enabledCapabilities.has(gl.CULL_FACE)
          ? cullFaceMode === gl.BACK
            ? 'back'
            : 'front'
          : 'none',
      },
    });

    const clearColorValue = this.#parameters.get(gl.COLOR_CLEAR_VALUE);
    const clearDepthValue = this.#parameters.get(gl.DEPTH_CLEAR_VALUE);
    const clearStencilValue = this.#parameters.get(gl.STENCIL_CLEAR_VALUE);
    const renderPass = encoder.beginRenderPass({
      label: 'ByeGL Render Pass',
      colorAttachments: [
        {
          view: currentTexture.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: clearColorValue,
        },
      ],
      depthStencilAttachment: depthTextureView
        ? {
            view: depthTextureView!,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            depthClearValue: clearDepthValue,
            stencilClearValue: clearStencilValue,
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
    const group = layout
      ? this.#root.device.createBindGroup({
          layout,
          entries: program.uniforms!.values().map((uniform) => {
            const buffer = this.#uniformBufferCache.getBuffer(uniform);

            return {
              binding: uniform.location,
              resource: {
                buffer,
              },
            } satisfies GPUBindGroupEntry;
          }),
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
      label: 'ByeGL Command Encoder',
    });
    const renderPass = this.#createRenderPass(encoder, mode);
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
      label: 'ByeGL Command Encoder',
    });

    const renderPass = this.#createRenderPass(encoder, mode);

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
Object.setPrototypeOf(ByeGLContext.prototype, WebGL2RenderingContext.prototype);
