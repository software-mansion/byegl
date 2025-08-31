const gl = WebGL2RenderingContext;

export const primitiveMap = {
  [gl.POINTS]: 'point-list',
  [gl.LINES]: 'line-list',
  [gl.LINE_STRIP]: 'line-strip',
  [gl.LINE_LOOP]: undefined, // TODO: Support line loops
  [gl.TRIANGLES]: 'triangle-list',
  [gl.TRIANGLE_STRIP]: 'triangle-strip',
  [gl.TRIANGLE_FAN]: undefined, // TODO: Support triangle fans
} as const;

export const blendEquationMap = {
  [gl.FUNC_ADD]: 'add',
  [gl.FUNC_SUBTRACT]: 'subtract',
  [gl.FUNC_REVERSE_SUBTRACT]: 'reverse-subtract',
  [gl.MIN]: 'min',
  [gl.MAX]: 'max',
} as const;

export const blendFactorMap = {
  [gl.ZERO]: 'zero',
  [gl.ONE]: 'one',
  [gl.SRC_COLOR]: 'src',
  [gl.ONE_MINUS_SRC_COLOR]: 'one-minus-src',
  [gl.DST_COLOR]: 'dst',
  [gl.ONE_MINUS_DST_COLOR]: 'one-minus-dst',
  [gl.SRC_ALPHA]: 'src-alpha',
  [gl.ONE_MINUS_SRC_ALPHA]: 'one-minus-src-alpha',
  [gl.DST_ALPHA]: 'dst-alpha',
  [gl.ONE_MINUS_DST_ALPHA]: 'one-minus-dst-alpha',
  [gl.CONSTANT_COLOR]: 'constant',
  [gl.ONE_MINUS_CONSTANT_COLOR]: 'one-minus-constant',
  [gl.CONSTANT_ALPHA]: 'constant',
  [gl.ONE_MINUS_CONSTANT_ALPHA]: 'one-minus-constant',
} as const;

export const elementSizeCatalog: Record<GLenum, number> = {
  [gl.UNSIGNED_BYTE]: 1,
  [gl.UNSIGNED_SHORT]: 2,
  [gl.UNSIGNED_INT]: 4,
  [gl.FLOAT]: 4,
};

export const normalizedVertexFormatCatalog: Record<
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

export const unnormalizedVertexFormatCatalog: Record<
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

export const shaderPrecisionFormatCatalog: Record<
  GLenum,
  WebGLShaderPrecisionFormat
> = {
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

export const depthFuncCatalog = {
  [gl.NEVER]: 'never',
  [gl.LESS]: 'less',
  [gl.EQUAL]: 'equal',
  [gl.LEQUAL]: 'less-equal',
  [gl.GREATER]: 'greater',
  [gl.NOTEQUAL]: 'not-equal',
  [gl.GEQUAL]: 'greater-equal',
  [gl.ALWAYS]: 'always',
} as const;
