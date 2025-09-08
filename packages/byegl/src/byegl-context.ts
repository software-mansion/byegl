import { TgpuRoot } from 'typegpu';
import { ByeGLBuffer, VertexBufferSegment } from './buffer.ts';
import {
  blendEquationMap,
  blendFactorMap,
  depthFuncCatalog,
  elementSizeCatalog,
  normalizedVertexFormatCatalog,
  primitiveMap,
  shaderPrecisionFormatCatalog,
  unnormalizedVertexFormatCatalog,
} from './constants.ts';
import { NotImplementedYetError } from './errors.ts';
import type { ExtensionMap } from './extensions/types.ts';
import { ByeGLFramebuffer } from './framebuffer.ts';
import { ByeGLProgram, ByeGLShader } from './program.ts';
import { Remapper } from './remap.ts';
import { ByeGLTexture } from './texture.ts';
import { $internal } from './types.ts';
import {
  ByeGLUniformLocation,
  extractAccessPath,
  UniformBufferCache,
} from './uniform.ts';
import type { UniformInfo, WgslGenerator } from './wgsl/wgsl-generator.ts';
import { roundUp } from './math-utils.ts';
import { alignmentOf, AnyData, AnyWgslData, sizeOf } from 'typegpu/data';

const gl = WebGL2RenderingContext;

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
  /**
   * Set when getting the context, e.g. .getContext('webgl', { antialias: false, depth: false })
   * TODO: Accept attributes from the .getContext call
   */
  #attributes: WebGLContextAttributes = {
    alpha: true,
    antialias: true,
    depth: true,
    failIfMajorPerformanceCaveat: false,
    powerPreference: 'default',
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    stencil: false,
    desynchronized: false,
  };

  #lastError: GLenum = 0;

  #program: ByeGLProgram | undefined;

  /**
   * Set using gl.enableVertexAttribArray and gl.disableVertexAttribArray.
   */
  #enabledVertexAttribArrays = new Set<number>();

  /**
   * The currently bound buffers. Set using gl.bindBuffer.
   */
  #boundBufferMap: Map<GLenum, ByeGLBuffer> = new Map();

  /**
   * The active texture unit. Set using gl.activeTexture.
   */
  #activeTextureUnit: GLenum = gl.TEXTURE0;

  /**
   * The set of currently bound textures. Set using gl.activeTexture and gl.bindTexture.
   */
  #boundTexturesMap: Map<number, Map<GLenum, ByeGLTexture>> = new Map();

  #vertexBufferSegments: VertexBufferSegment[] = [];
  #uniformBufferCache: UniformBufferCache;

  /**
   * The initial value for each capability with the exception of GL_DITHER is `false`.
   *
   * @see {@link https://registry.khronos.org/OpenGL-Refpages/es2.0/xhtml/glEnable.xml}
   */
  #enabledCapabilities: Set<GLenum> = new Set([gl.DITHER]);

  #bitsToClear: GLbitfield = 0;

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
    [gl.BLEND_EQUATION, gl.FUNC_ADD],
    [gl.BLEND_EQUATION_RGB, gl.FUNC_ADD],
    [gl.BLEND_EQUATION_ALPHA, gl.FUNC_ADD],
    [gl.BLEND_SRC_RGB, gl.ONE],
    [gl.BLEND_DST_RGB, gl.ZERO],
    [gl.BLEND_SRC_ALPHA, gl.ONE],
    [gl.BLEND_DST_ALPHA, gl.ZERO],
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

  get drawingBufferWidth() {
    return this.#canvas.width;
  }

  get drawingBufferHeight() {
    return this.#canvas.height;
  }

  get drawingBufferColorSpace() {
    // TODO: Implement color space retrieval
    return 'srgb';
  }

  get unpackColorSpace() {
    // TODO: Allow changing to the `display-p3` color space
    return 'srgb';
  }

  set unpackColorSpace(value: string) {
    // TODO: Implement color space change
  }

  activeTexture(texture: GLenum): void {
    this.#activeTextureUnit = texture;
  }

  attachShader(program: ByeGLProgram, shader: ByeGLShader): void {
    const $shader = shader[$internal];

    if ($shader.type === gl.VERTEX_SHADER) {
      program[$internal].vert = shader;
    } else if ($shader.type === gl.FRAGMENT_SHADER) {
      program[$internal].frag = shader;
    }
  }

  /**
   * Called before gl.linkProgram, which means we can store these indices and
   * tell the WGSL generator to use them instead of generating them automatically.
   */
  bindAttribLocation(program: ByeGLProgram, index: GLuint, name: string): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.bindAttribLocation');
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

  bindFramebuffer(target: GLenum, framebuffer: WebGLFramebuffer | null): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.bindFramebuffer');
  }

  bindRenderbuffer(
    target: GLenum,
    renderbuffer: WebGLRenderbuffer | null,
  ): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.bindRenderbuffer');
  }

  bindTexture(target: GLenum, texture: ByeGLTexture | null): void {
    let textureMap = this.#boundTexturesMap.get(this.#activeTextureUnit);
    if (!textureMap) {
      textureMap = new Map();
      this.#boundTexturesMap.set(this.#activeTextureUnit, textureMap);
    }

    if (!texture) {
      textureMap.delete(target);
    } else {
      textureMap.set(target, texture);
    }
  }

  blendColor(r: number, g: number, b: number, a: number): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.blendColor');
  }

  blendEquation(mode: GLenum): void {
    this.#parameters.set(gl.BLEND_EQUATION, mode);
    this.#parameters.set(gl.BLEND_EQUATION_RGB, mode);
    this.#parameters.set(gl.BLEND_EQUATION_ALPHA, mode);
  }

  blendEquationSeparate(modeRGB: GLenum, modeAlpha: GLenum): void {
    this.#parameters.set(gl.BLEND_EQUATION, modeRGB);
    this.#parameters.set(gl.BLEND_EQUATION_RGB, modeRGB);
    this.#parameters.set(gl.BLEND_EQUATION_ALPHA, modeAlpha);
  }

  blendFunc(src: GLenum, dst: GLenum): void {
    this.#parameters.set(gl.BLEND_SRC_RGB, src);
    this.#parameters.set(gl.BLEND_DST_RGB, dst);
    this.#parameters.set(gl.BLEND_SRC_ALPHA, src);
    this.#parameters.set(gl.BLEND_DST_ALPHA, dst);
  }

  blendFuncSeparate(
    srcRGB: GLenum,
    dstRGB: GLenum,
    srcAlpha: GLenum,
    dstAlpha: GLenum,
  ): void {
    this.#parameters.set(gl.BLEND_SRC_RGB, srcRGB);
    this.#parameters.set(gl.BLEND_DST_RGB, dstRGB);
    this.#parameters.set(gl.BLEND_SRC_ALPHA, srcAlpha);
    this.#parameters.set(gl.BLEND_DST_ALPHA, dstAlpha);
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

  bufferSubData(target: GLenum, offset: GLintptr): void;
  bufferSubData(
    target: GLenum,
    offset: GLintptr,
    data: BufferSource,
    srcOffset: GLuint,
    length?: number | undefined,
  ): void;
  bufferSubData(
    target: GLenum,
    offset: GLintptr,
    data?: BufferSource | undefined,
    srcOffset?: GLuint | undefined,
    length: number = 0,
  ): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.bufferSubData');
  }

  checkFramebufferStatus(target: GLenum): GLenum {
    // TODO: Implement
    throw new NotImplementedYetError('gl.checkFramebufferStatus');
  }

  /**
   * In most cases, drawing comes immediately after clearing, so
   * we just note that we SHOULD clear in the drawArrays or drawElements
   * methods.
   *
   * Other methods that use the render target should perform clearing
   * manually if the flag has been enabled (like when reading the pixels directly).
   */
  clear(mask: GLbitfield): void {
    this.#bitsToClear = mask;
  }

  clearColor(r: GLclampf, g: GLclampf, b: GLclampf, a: GLclampf): void {
    this.#parameters.set(gl.COLOR_CLEAR_VALUE, new Float32Array([r, g, b, a]));
  }

  clearDepth(depth: GLclampf): void {
    this.#parameters.set(gl.DEPTH_CLEAR_VALUE, depth);
  }

  clearStencil(stencil: GLint): void {
    this.#parameters.set(gl.STENCIL_CLEAR_VALUE, stencil);
  }

  colorMask(
    red: GLboolean,
    green: GLboolean,
    blue: GLboolean,
    alpha: GLboolean,
  ): void {
    this.#parameters.set(gl.COLOR_WRITEMASK, [red, green, blue, alpha]);
  }

  compileShader(_shader: ByeGLShader): void {
    // NO-OP: Deferring compilation until the program is linked
  }

  compressedTexImage2D(
    target: GLenum,
    level: GLint,
    internalformat: GLenum,
    width: GLsizei,
    height: GLsizei,
    border: GLint,
    data: ArrayBufferView | null,
  ): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.compressedTexImage2D');
  }

  compressedTexSubImage2D(
    target: GLenum,
    level: GLint,
    xoffset: GLint,
    yoffset: GLint,
    width: GLsizei,
    height: GLsizei,
    format: GLenum,
    data: ArrayBufferView | null,
  ): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.compressedTexSubImage2D');
  }

  copyTexImage2D(
    target: GLenum,
    level: GLint,
    internalformat: GLenum,
    x: GLint,
    y: GLint,
    width: GLsizei,
    height: GLsizei,
    border: GLint,
  ): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.copyTexImage2D');
  }

  copyTexSubImage2D(
    target: GLenum,
    level: GLint,
    xoffset: GLint,
    yoffset: GLint,
    x: GLint,
    y: GLint,
    width: GLsizei,
    height: GLsizei,
  ): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.copyTexSubImage2D');
  }

  createBuffer(): WebGLBuffer {
    return new ByeGLBuffer(this.#root, this.#remapper);
  }

  createFramebuffer(): WebGLFramebuffer {
    return new ByeGLFramebuffer(this.#root);
  }

  createProgram(): WebGLProgram {
    return new ByeGLProgram();
  }

  createRenderbuffer(): WebGLRenderbuffer {
    // TODO: Implement
    throw new NotImplementedYetError('gl.createRenderbuffer');
  }

  createShader(type: GLenum): WebGLShader | null {
    return new ByeGLShader(type);
  }

  createTexture(): WebGLTexture {
    return new ByeGLTexture(this.#root);
  }

  cullFace(mode: GLenum): void {
    this.#parameters.set(gl.CULL_FACE_MODE, mode);
  }

  deleteBuffer(buffer: ByeGLBuffer | null): void {
    if (buffer) {
      buffer[$internal].destroy();
    }
  }

  deleteFramebuffer(framebuffer: ByeGLFramebuffer | null): void {
    if (framebuffer) {
      framebuffer[$internal].destroy();
    }
  }

  deleteProgram(program: ByeGLProgram | null): void {
    // Nothing to delete
    // TODO: Verify the behavior of deleting a program that is currently in use
  }

  deleteRenderbuffer(renderbuffer: WebGLRenderbuffer | null): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.deleteRenderbuffer');
  }

  deleteShader(shader: WebGLShader | null): void {
    // Nothing to delete
    // TODO: Verify the behavior of deleting a shader that is bound to a used program
  }

  deleteTexture(texture: ByeGLTexture | null): void {
    if (texture) {
      texture[$internal].destroy();
    }
  }

  depthFunc(func: GLenum): void {
    // TODO: Do something with this value
    this.#parameters.set(gl.DEPTH_FUNC, func);
  }

  depthMask(flag: GLboolean): void {
    // TODO: Do something with this value
    this.#parameters.set(gl.DEPTH_WRITEMASK, flag);
  }

  depthRange(zNear: GLfloat, zFar: GLfloat): void {
    // TODO: Do something with this value
    this.#parameters.set(gl.DEPTH_RANGE, [zNear, zFar]);
  }

  detachShader(program: WebGLProgram, shader: WebGLShader): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.detachShader');
  }

  disable(cap: GLenum): void {
    this.#enabledCapabilities.delete(cap);
  }

  disableVertexAttribArray(index: GLuint): void {
    this.#enabledVertexAttribArrays.delete(index);
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

  enable(cap: GLenum): void {
    this.#enabledCapabilities.add(cap);
  }

  enableVertexAttribArray(index: GLuint): void {
    this.#enabledVertexAttribArrays.add(index);
  }

  finish(): void {
    // TODO: Not sure how to block until everything is finished synchronously
    throw new NotImplementedYetError('gl.finish');
  }

  flush(): void {
    // TODO: Not sure how to block until everything is flushed synchronously
    throw new NotImplementedYetError('gl.flush');
  }

  framebufferRenderbuffer(
    target: GLenum,
    attachment: GLenum,
    renderbuffer: WebGLRenderbuffer,
  ): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.framebufferRenderbuffer');
  }

  framebufferTexture2D(
    target: GLenum,
    attachment: GLenum,
    textarget: GLenum,
    texture: WebGLTexture,
    level: GLint,
  ): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.framebufferTexture2D');
  }

  frontFace(mode: GLenum): void {
    this.#parameters.set(gl.FRONT_FACE, mode);
  }

  generateMipmap(target: GLenum): void {
    // TODO: Implement
  }

  getActiveAttrib(
    program: WebGLProgram,
    index: GLuint,
  ): WebGLActiveInfo | null {
    // TODO: Implement
    throw new NotImplementedYetError('gl.getActiveAttrib');
  }

  getActiveUniform(
    program_: ByeGLProgram,
    index: GLuint,
  ): WebGLActiveInfo | null {
    const program = program_[$internal];
    const uniform = program.compiled?.uniforms[index];
    if (!uniform) {
      this.#lastError = gl.INVALID_VALUE;
      return null;
    }

    return null;
  }

  getAttachedShaders(program: WebGLProgram): WebGLShader[] | null {
    // TODO: Implement
    throw new NotImplementedYetError('gl.getAttachedShaders');
  }

  getAttribLocation(program: ByeGLProgram, name: string): GLint {
    const compiled = program[$internal].compiled;
    if (compiled === undefined) {
      throw new Error('Program not linked');
    }
    return compiled.attributes.find((a) => a.id === name)?.location ?? -1;
  }

  getBufferParameter(target: GLenum, pname: GLenum): GLint {
    // TODO: Implement
    throw new NotImplementedYetError('gl.getBufferParameter');
  }

  getContextAttributes(): WebGLContextAttributes {
    return this.#attributes;
  }

  getError(): GLenum {
    const error = this.#lastError;
    // The error is reset after it's read
    this.#lastError = 0;
    return error;
  }

  getExtension<T extends keyof ExtensionMap>(name: T): ExtensionMap[T] | null {
    // TODO: Implement extensions. Not supporting any extension for now.
    return null;
  }

  getFramebufferAttachmentParameter(
    target: GLenum,
    attachment: GLenum,
    pname: GLenum,
  ): GLint {
    // TODO: Implement
    throw new NotImplementedYetError('gl.getFramebufferAttachmentParameter');
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
      gl.MAX_UNIFORM_BLOCK_SIZE	GLint64*/
      case gl.MAX_UNIFORM_BUFFER_BINDINGS:
        return limits.maxUniformBuffersPerShaderStage;
      /*gl.MAX_VARYING_COMPONENTS	GLint
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

  getProgramInfoLog(program: ByeGLProgram): string {
    return program[$internal].infoLog;
  }

  getProgramParameter(program: ByeGLProgram, pname: GLenum): any {
    if (pname === gl.DELETE_STATUS) {
      // TODO: Maybe implement deleting programs?
      return false;
    }
    if (pname === gl.LINK_STATUS) {
      return !!program[$internal].compiled;
    }
    if (pname === gl.VALIDATE_STATUS) {
      // TODO: Implement validation?
      return true;
    }
    if (pname === gl.ATTACHED_SHADERS) {
      return (
        (program[$internal].vert ? 1 : 0) + (program[$internal].frag ? 1 : 0)
      );
    }
    if (pname === gl.ACTIVE_ATTRIBUTES) {
      return program[$internal].compiled?.attributes.length ?? 0;
    }
    if (pname === gl.ACTIVE_UNIFORMS) {
      return program[$internal].compiled?.uniforms.length ?? 0;
    }
    throw new NotImplementedYetError(`gl.getProgramParameter (pname=${pname})`);
  }

  getRenderbufferParameter(target: GLenum, pname: GLenum): any {
    // TODO: Implement
    throw new NotImplementedYetError('gl.getRenderbufferParameter');
  }

  getShaderInfoLog(_shader: ByeGLShader): string {
    // In byegl, shaders themselves don't get compiled (programs do), so we never have any logs.
    return '';
  }

  getShaderParameter(shader: ByeGLShader, pname: GLenum): any {
    if (pname === gl.DELETE_STATUS) {
      return shader[$internal].destroyed;
    }
    if (pname === gl.COMPILE_STATUS) {
      // Always successfull, since there's nothing to compile
      return true;
    }
    if (pname === gl.SHADER_TYPE) {
      return shader[$internal].type;
    }
    // Didn't recognize the pname
    throw new NotImplementedYetError(`gl.getShaderParameter (pname=${pname})`);
  }

  getShaderPrecisionFormat(
    shadertype: GLenum,
    precisiontype: GLint,
  ): WebGLShaderPrecisionFormat | null {
    return shaderPrecisionFormatCatalog[precisiontype] ?? null;
  }

  getShaderSource(shader: ByeGLShader): string | null {
    return shader[$internal].source;
  }

  getSupportedExtensions(): string[] {
    // TODO: Implement
    return [];
  }

  getTexParameter(target: GLenum, pname: GLenum): any {
    // TODO: Implement
    throw new NotImplementedYetError('gl.getTexParameter');
  }

  getUniform(program: WebGLProgram, location: WebGLUniformLocation): any {
    // TODO: Implement
    throw new NotImplementedYetError('gl.getUniform');
  }

  getUniformLocation(
    program: ByeGLProgram,
    name: string,
  ): WebGLUniformLocation | null {
    const compiled = program[$internal].compiled;
    if (compiled === undefined) {
      this.#lastError = gl.INVALID_OPERATION;
      return null;
    }
    const path = extractAccessPath(name);
    // Silently fail, gotta love WebGL error handling
    if (path === undefined || path.length === 0) return null;

    const info = compiled.uniforms.find((u) => u.id === path[0]);
    // Silently fail, gotta love WebGL error handling
    if (info === undefined) return null;

    let byteOffset = 0;
    let dataType = info.type;
    for (let i = 1; i < path.length; i++) {
      const node = path[i];

      if (typeof node === 'number' && dataType.type === 'array') {
        dataType = dataType.elementType as AnyWgslData;
        byteOffset += roundUp(sizeOf(dataType), alignmentOf(dataType)) * node;
      } else if (dataType.type === 'struct') {
        const propTypes = dataType.propTypes as Record<string, AnyWgslData>;
        for (const [propKey, propType] of Object.entries(propTypes)) {
          // Aligning to the start of the prop
          byteOffset = roundUp(byteOffset, alignmentOf(propType));

          if (propKey === node) {
            dataType = propType;
            break;
          }

          byteOffset += sizeOf(propType);
        }
      }
    }

    return new ByeGLUniformLocation(info.location, byteOffset, dataType);
  }

  getVertexAttrib(index: GLuint, pname: GLenum): any {
    // TODO: Implement
    throw new NotImplementedYetError('gl.getVertexAttrib');
  }

  getVertexAttribOffset(index: GLuint, pname: GLenum): GLintptr {
    // TODO: Implement
    throw new NotImplementedYetError('gl.getVertexAttribOffset');
  }

  hint(target: GLenum, mode: GLenum): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.hint');
  }

  isBuffer(buffer: ByeGLBuffer): boolean {
    return buffer instanceof ByeGLBuffer;
  }

  isContextLost(): boolean {
    // TODO: Implement detection of context loss
    return false;
  }

  isEnabled(cap: GLenum): boolean {
    return this.#enabledCapabilities.has(cap);
  }

  isFramebuffer(framebuffer: WebGLFramebuffer): boolean {
    // TODO: Implement
    throw new NotImplementedYetError('gl.isFramebuffer');
  }

  isProgram(program: ByeGLProgram): boolean {
    return program instanceof ByeGLProgram;
  }

  isShader(shader: ByeGLShader): boolean {
    return shader instanceof ByeGLShader;
  }

  isTexture(texture: ByeGLTexture): boolean {
    return texture instanceof ByeGLTexture;
  }

  lineWidth(width: GLfloat): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.lineWidth');
  }

  linkProgram(program: ByeGLProgram): void {
    const $program = program[$internal];
    const { vert, frag } = $program;

    if (!vert || !frag) {
      throw new Error(
        'Vertex and fragment shaders must be attached before linking',
      );
    }

    try {
      const result = this.#wgslGen.generate(
        vert[$internal].source ?? '',
        frag[$internal].source ?? '',
      );

      $program.compiled = result;
      const module = this.#root.device.createShaderModule({
        label: 'ByeGL Shader Module',
        code: result.wgsl,
      });
      $program.wgpuShaderModule = module;
    } catch (error) {
      $program.infoLog =
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error);
    }
  }

  makeXRCompatible(): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.makeXRCompatible');
  }

  pixelStorei(pname: GLenum, param: GLint): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.pixelStorei');
  }

  polygonOffset(factor: GLfloat, units: GLfloat): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.polygonOffset');
  }

  readPixels(
    x: GLint,
    y: GLint,
    width: GLsizei,
    height: GLsizei,
    format: GLenum,
    type: GLenum,
    pixels: ArrayBufferView,
  ): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.readPixels');
  }

  renderbufferStorage(
    target: GLenum,
    internalformat: GLenum,
    width: GLsizei,
    height: GLsizei,
  ): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.renderbufferStorage');
  }

  sampleCoverage(value: GLclampf, invert: GLboolean): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.sampleCoverage');
  }

  scissor(x: GLint, y: GLint, width: GLsizei, height: GLsizei): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.scissor');
  }

  shaderSource(shader: ByeGLShader, source: string): void {
    shader[$internal].source = source;
  }

  stencilFunc(func: GLenum, ref: GLint, mask: GLuint): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.stencilFunc');
  }

  stencilFuncSeparate(
    face: GLenum,
    func: GLenum,
    ref: GLint,
    mask: GLuint,
  ): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.stencilFuncSeparate');
  }

  stencilMask(mask: GLuint): void {
    this.#parameters.set(gl.STENCIL_WRITEMASK, mask);
    this.#parameters.set(gl.STENCIL_BACK_WRITEMASK, mask);
  }

  stencilMaskSeparate(face: GLenum, mask: GLuint): void {
    if (face === gl.FRONT) {
      this.#parameters.set(gl.STENCIL_WRITEMASK, mask);
    } else if (face === gl.BACK) {
      this.#parameters.set(gl.STENCIL_BACK_WRITEMASK, mask);
    } else if (face === gl.FRONT_AND_BACK) {
      this.#parameters.set(gl.STENCIL_WRITEMASK, mask);
      this.#parameters.set(gl.STENCIL_BACK_WRITEMASK, mask);
    } else {
      throw new Error('Invalid face');
    }
  }

  stencilOp(opFail: GLenum, opZFail: GLenum, opZPass: GLenum): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.stencilOp');
  }

  stencilOpSeparate(
    face: GLenum,
    opFail: GLenum,
    opZFail: GLenum,
    opZPass: GLenum,
  ): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.stencilOpSeparate');
  }

  // biome-ignore format: Easier to read
  texImage2D(target: GLenum, level: GLint, internalformat: GLint, width: GLsizei, height: GLsizei, border: GLint, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void;
  // biome-ignore format: Easier to read
  texImage2D(target: GLenum, level: GLint, internalformat: GLint, format: GLenum, type: GLenum, source: TexImageSource): void;
  // biome-ignore format: Easier to read
  texImage2D(target: GLenum, level: GLint, internalformat: GLint, ...rest: [width: GLsizei, height: GLsizei, border: GLint, format: GLenum, type: GLenum, pixels: ArrayBufferView | null] | [format: GLenum, type: GLenum, source: TexImageSource]): void {
    let width = 0;
    let height = 0;
    let format: number = gl.RGBA;
    // TODO: Not sure what to do with 'internalformat' just yet.

    const textureMap = this.#boundTexturesMap.get(this.#activeTextureUnit);
    const texture = textureMap?.get(target)?.[$internal];
    if (!texture) {
      // TODO: Generate a WebGL appropriate error
      return;
    }

    if (rest.length === 6) {
      const [width_, height_, border, format_, type, pixels] = rest;
      width = width_;
      height = height_;
      format = format_;

      const size = [width, height] as const;
      texture.size = size;

      if (pixels) {
        // For now, assume RGBA/UNSIGNED_BYTE format
        // TODO: Handle different format/type combinations
        if (format === gl.RGBA && type === gl.UNSIGNED_BYTE) {
          this.#root.device.queue.writeTexture(
            { texture: texture.gpuTexture },
            pixels as ArrayBufferView<ArrayBuffer>,
            { bytesPerRow: width * 4, rowsPerImage: height },
            { width, height }
          );
        } else {
          throw new NotImplementedYetError(`gl.texImage2D with format=${format}, type=${type}`);
        }
      }
    } else {
      const [_format, type, source] = rest;
      format = _format;
      if ('width' in source) {
        width = source.width;
        height = source.height;
      } else {
        width = source.displayWidth;
        height = source.displayHeight;
      }
      // TODO: Do something with 'type'
      const size = [width, height] as const;
      texture.size = size;
      this.#root.device.queue.copyExternalImageToTexture({ source }, {
        texture: texture.gpuTexture,
      }, size);
    }

    // TODO: Implement mip-mapping
  }

  // biome-ignore format: Easier to read
  texImage3D(target: GLenum, level: GLint, internalformat: GLenum, width: GLsizei, height: GLsizei, depth: GLsizei, border: GLint, format: GLenum, type: GLenum, srcData: ArrayBufferView): void;
  // biome-ignore format: Easier to read
  texImage3D(target: GLenum, level: GLint, internalformat: GLenum, width: GLsizei, height: GLsizei, depth: GLsizei, border: GLint, format: GLenum, type: GLenum, srcData: ArrayBufferView, srcOffset: number): void;
  // biome-ignore format: Easier to read
  texImage3D(target: GLenum, level: GLint, internalformat: GLenum, width: GLsizei, height: GLsizei, depth: GLsizei, border: GLint, format: GLenum, type: GLenum, source: TexImageSource): void;
  // biome-ignore format: Easier to read
  texImage3D(target: GLenum, level: GLint, internalformat: GLenum, width: GLsizei, height: GLsizei, depth: GLsizei, border: GLint, format: GLenum, type: GLenum, offset: GLintptr): void;

  texImage3D(
    target: GLenum,
    level: GLint,
    internalformat: GLenum,
    width: GLsizei,
    height: GLsizei,
    depth: GLsizei,
    border: GLint,
    format: GLenum,
    type: GLenum,
    srcData: ArrayBufferView | TexImageSource | GLintptr,
  ): void {
    if (border !== 0) {
      // According to the docs, border must be 0.
      throw new Error('Border must be 0');
    }
    const textureMap = this.#boundTexturesMap.get(this.#activeTextureUnit);
    const texture = textureMap?.get(target)?.[$internal];
    if (!texture) {
      // TODO: Generate a WebGL appropriate error message
      return;
    }

    // TODO: Fill the texture with data.
    return;
  }

  texParameterf(target: GLenum, pname: GLenum, param: GLfloat): void {
    const textureMap = this.#boundTexturesMap.get(this.#activeTextureUnit);
    const texture = textureMap?.get(target)?.[$internal];
    if (!texture) {
      throw new Error(`No texture bound to target ${target}`);
    }
    texture.setParameter(pname, param);
  }

  texParameteri(target: GLenum, pname: GLenum, param: GLint): void {
    const textureMap = this.#boundTexturesMap.get(this.#activeTextureUnit);
    const texture = textureMap?.get(target)?.[$internal];
    if (!texture) {
      throw new Error(`No texture bound to target ${target}`);
    }
    texture.setParameter(pname, param);
  }

  texSubImage2D(
    target: GLenum,
    level: GLint,
    xoffset: GLint,
    yoffset: GLint,
    width: GLsizei,
    height: GLsizei,
    format: GLenum,
    type: GLenum,
    pixels: ArrayBufferView | null,
  ): void {
    // TODO: Implement
    throw new NotImplementedYetError('gl.texSubImage2D');
  }

  #getUniformInfo(
    location: ByeGLUniformLocation | null,
  ): UniformInfo | undefined {
    const compiled = this.#program?.[$internal].compiled;
    if (!location || !compiled) {
      return undefined;
    }
    const idx = location[$internal].bindingIdx;
    return compiled.uniforms.find((u) => u.location === idx);
  }

  uniform1f(location: ByeGLUniformLocation | null, value: GLfloat) {
    const uniform = this.#getUniformInfo(location);
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, value);
    }
  }

  uniform1fv(
    location: ByeGLUniformLocation | null,
    value: Iterable<GLfloat> | Float32List,
  ) {
    const uniform = this.#getUniformInfo(location);
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, value);
    }
  }

  uniform1i(location: ByeGLUniformLocation | null, value: GLint) {
    const uniform = this.#getUniformInfo(location);
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, value);
    }
  }

  uniform1iv(
    location: ByeGLUniformLocation | null,
    value: Iterable<GLint> | Int32List,
  ) {
    const uniform = this.#getUniformInfo(location);
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, value);
    }
  }

  uniform2f(location: ByeGLUniformLocation | null, v0: GLfloat, v1: GLfloat) {
    const uniform = this.#getUniformInfo(location);
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, [v0, v1]);
    }
  }

  uniform2fv(
    location: ByeGLUniformLocation | null,
    value: Iterable<GLfloat> | Float32List,
  ) {
    const uniform = this.#getUniformInfo(location);
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, value);
    }
  }

  uniform2i(location: ByeGLUniformLocation | null, v0: GLint, v1: GLint) {
    const uniform = this.#getUniformInfo(location);
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, [v0, v1]);
    }
  }

  uniform2iv(
    location: ByeGLUniformLocation | null,
    value: Iterable<GLint> | Int32List,
  ) {
    const uniform = this.#getUniformInfo(location);
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, value);
    }
  }

  uniform3f(
    location: ByeGLUniformLocation | null,
    v0: GLfloat,
    v1: GLfloat,
    v2: GLfloat,
  ) {
    const uniform = this.#getUniformInfo(location);
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, [v0, v1, v2]);
    }
  }

  uniform3fv(
    location: ByeGLUniformLocation | null,
    value: Iterable<GLfloat> | Float32List,
  ) {
    const uniform = this.#getUniformInfo(location);
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, value);
    }
  }

  uniform3i(
    location: ByeGLUniformLocation | null,
    v0: GLint,
    v1: GLint,
    v2: GLint,
  ) {
    const uniform = this.#getUniformInfo(location);
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, [v0, v1, v2]);
    }
  }

  uniform3iv(
    location: ByeGLUniformLocation | null,
    value: Iterable<GLint> | Int32List,
  ) {
    const uniform = this.#getUniformInfo(location);
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, value);
    }
  }

  uniform4f(
    location: ByeGLUniformLocation | null,
    v0: GLfloat,
    v1: GLfloat,
    v2: GLfloat,
    v3: GLfloat,
  ) {
    const uniform = this.#getUniformInfo(location);
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, [v0, v1, v2, v3]);
    }
  }

  uniform4fv(
    location: ByeGLUniformLocation | null,
    value: Iterable<GLfloat> | Float32List,
  ) {
    const uniform = this.#getUniformInfo(location);
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, value);
    }
  }

  uniform4i(
    location: ByeGLUniformLocation | null,
    v0: GLint,
    v1: GLint,
    v2: GLint,
    v3: GLint,
  ) {
    const uniform = this.#getUniformInfo(location);
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, [v0, v1, v2, v3]);
    }
  }

  uniform4iv(
    location: ByeGLUniformLocation | null,
    value: Iterable<GLint> | Int32List,
  ) {
    const uniform = this.#getUniformInfo(location);
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, value);
    }
  }

  uniformMatrix2fv(
    location: ByeGLUniformLocation | null,
    transpose: GLboolean,
    value: Iterable<GLfloat> | Float32List,
  ): void {
    const uniform = this.#getUniformInfo(location);
    // TODO: Handle transposing
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, value);
    }
  }

  uniformMatrix3fv(
    location: ByeGLUniformLocation | null,
    transpose: GLboolean,
    value: Iterable<GLfloat> | Float32List,
  ): void {
    const uniform = this.#getUniformInfo(location);
    // TODO: Handle transposing
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, value);
    }
  }

  uniformMatrix4fv(
    location: ByeGLUniformLocation | null,
    transpose: GLboolean,
    value: Iterable<GLfloat> | Float32List,
  ): void {
    const uniform = this.#getUniformInfo(location);
    // TODO: Handle transposing
    if (uniform) {
      this.#uniformBufferCache.updateUniform(uniform, value);
    }
  }

  useProgram(program: ByeGLProgram): void {
    this.#program = program;
  }

  validateProgram(_program: ByeGLProgram): void {
    // All validation happens during linking anyway, so it's a no-op
  }

  // TODO: Implement the following
  /*
   * vertexAttrib1f(index, v0)
   * vertexAttrib2f(index, v0, v1)
   * vertexAttrib3f(index, v0, v1, v2)
   * vertexAttrib4f(index, v0, v1, v2, v3)

   * vertexAttrib1fv(index, value)
   * vertexAttrib2fv(index, value)
   * vertexAttrib3fv(index, value)
   * vertexAttrib4fv(index, value)
   */

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

  viewport(x: number, y: number, width: number, height: number): void {
    // TODO: Change which part of the target texture we're drawing to
  }

  #getTextureForUniform(uniform: UniformInfo): ByeGLTexture {
    const compiled = this.#program?.[$internal]!.compiled!;

    if (uniform.type.type === 'sampler') {
      return this.#getTextureForUniform(
        compiled.samplerToTextureMap.get(uniform)!,
      );
    }

    const textureUnit =
      gl.TEXTURE0 + (this.#uniformBufferCache.getValue(uniform) as number);

    const textureMap = this.#boundTexturesMap.get(textureUnit);
    // TODO: Always getting the TEXTURE_2D binding, but make it depend on the texture type
    const texture = textureMap?.get(gl.TEXTURE_2D);

    if (!texture) {
      throw new Error(`Texture not found for unit ${textureUnit}`);
    }

    return texture;
  }

  #createRenderPass(encoder: GPUCommandEncoder, mode: GLenum) {
    const program = this.#program?.[$internal]!;
    const compiled = program.compiled!;
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
      const glDepthFunc = this.#parameters.get(gl.DEPTH_FUNC);
      depthStencil = {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare:
          depthFuncCatalog[glDepthFunc as keyof typeof depthFuncCatalog],
      };
    }

    const colorMask = this.#parameters.get(gl.COLOR_WRITEMASK);
    const cullFaceMode = this.#parameters.get(gl.CULL_FACE_MODE);
    const topology = primitiveMap[mode as keyof typeof primitiveMap];

    if (!topology) {
      throw new Error(`Unsupported primitive topology: ${mode}`);
    }

    const layout =
      compiled.uniforms.length > 0
        ? this.#root.device.createBindGroupLayout({
            label: 'ByeGL Bind Group Layout',
            entries: compiled.uniforms.map((uniform) => {
              if (uniform.type.type === 'sampler') {
                return {
                  binding: uniform.location,
                  visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX,
                  sampler: {
                    type: 'filtering',
                  },
                } satisfies GPUBindGroupLayoutEntry;
              }

              if (uniform.type.type.startsWith('texture_')) {
                return {
                  binding: uniform.location,
                  visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX,
                  texture: {
                    sampleType: 'float',
                  },
                } satisfies GPUBindGroupLayoutEntry;
              }

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

    let blend: GPUBlendState | undefined;
    if (this.#enabledCapabilities.has(gl.BLEND)) {
      const srcRgbFac = this.#parameters.get(gl.BLEND_SRC_RGB);
      const dstRgbFac = this.#parameters.get(gl.BLEND_DST_RGB);
      const rgbFn = this.#parameters.get(gl.BLEND_EQUATION_RGB);
      const srcAlphaFac = this.#parameters.get(gl.BLEND_SRC_ALPHA);
      const dstAlphaFac = this.#parameters.get(gl.BLEND_DST_ALPHA);
      const alphaFn = this.#parameters.get(gl.BLEND_EQUATION_ALPHA);

      blend = {
        color: {
          srcFactor: blendFactorMap[srcRgbFac as keyof typeof blendFactorMap],
          dstFactor: blendFactorMap[dstRgbFac as keyof typeof blendFactorMap],
          operation: blendEquationMap[rgbFn as keyof typeof blendEquationMap],
        },
        alpha: {
          srcFactor: blendFactorMap[srcAlphaFac as keyof typeof blendFactorMap],
          dstFactor: blendFactorMap[dstAlphaFac as keyof typeof blendFactorMap],
          operation: blendEquationMap[alphaFn as keyof typeof blendEquationMap],
        },
      };
    }

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
            blend,
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

    const clearColorValue: Float32Array = this.#parameters.get(
      gl.COLOR_CLEAR_VALUE,
    );
    const clearDepthValue: number = this.#parameters.get(gl.DEPTH_CLEAR_VALUE);
    const clearStencilValue: number = this.#parameters.get(
      gl.STENCIL_CLEAR_VALUE,
    );

    const renderPass = encoder.beginRenderPass({
      label: 'ByeGL Render Pass',
      colorAttachments: [
        {
          view: currentTexture.createView(),
          loadOp: this.#bitsToClear & gl.COLOR_BUFFER_BIT ? 'clear' : 'load',
          storeOp: 'store',
          clearValue: clearColorValue,
        },
      ],
      depthStencilAttachment: depthTextureView
        ? {
            view: depthTextureView!,
            depthLoadOp:
              this.#bitsToClear & gl.DEPTH_BUFFER_BIT ? 'clear' : 'load',
            depthStoreOp: 'store',
            depthClearValue: clearDepthValue,
            stencilClearValue: clearStencilValue,
            // TODO: Implement stencils
            // stencilLoadOp:
            //   this.#bitsToClear & gl.STENCIL_BUFFER_BIT ? 'clear' : 'load',
            // stencilStoreOp: 'store',
          }
        : undefined,
    });

    // Resetting the mask
    this.#bitsToClear = 0;

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
          entries: compiled.uniforms.map((uniform) => {
            if (uniform.type.type.startsWith('texture_')) {
              const texture = this.#getTextureForUniform(uniform)[$internal];

              return {
                binding: uniform.location,
                resource: texture.gpuTextureView,
              } satisfies GPUBindGroupEntry;
            }

            if (uniform.type.type === 'sampler') {
              const texture = this.#getTextureForUniform(uniform)[$internal];

              return {
                binding: uniform.location,
                resource: texture.gpuSampler,
              } satisfies GPUBindGroupEntry;
            }

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
}

// Inheriting from WebGLRenderingContext
Object.setPrototypeOf(ByeGLContext.prototype, WebGL2RenderingContext.prototype);
