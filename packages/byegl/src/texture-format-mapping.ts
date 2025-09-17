const gl = WebGL2RenderingContext;

export interface TextureFormatInfo {
  webgpuFormat: GPUTextureFormat;
  bytesPerPixel: number;
}

export function getTextureFormat(
  format: GLenum,
  type: GLenum,
  internalFormat?: GLenum,
): TextureFormatInfo {
  if (internalFormat) {
    return getFormatFromInternal(internalFormat);
  }

  switch (format) {
    case gl.RGBA:
      switch (type) {
        case gl.UNSIGNED_BYTE:
        case gl.UNSIGNED_SHORT_4_4_4_4:
        case gl.UNSIGNED_SHORT_5_5_5_1:
          return { webgpuFormat: 'rgba8unorm', bytesPerPixel: 4 };
        case gl.FLOAT:
          return { webgpuFormat: 'rgba32float', bytesPerPixel: 16 };
        case gl.HALF_FLOAT:
          return { webgpuFormat: 'rgba16float', bytesPerPixel: 8 };
      }
      break;

    case gl.RGB:
      switch (type) {
        case gl.UNSIGNED_BYTE:
        case gl.UNSIGNED_SHORT_5_6_5:
          return { webgpuFormat: 'rgba8unorm', bytesPerPixel: 4 };
        case gl.FLOAT:
          return { webgpuFormat: 'rgba32float', bytesPerPixel: 16 };
        case gl.HALF_FLOAT:
          return { webgpuFormat: 'rgba16float', bytesPerPixel: 8 };
      }
      break;

    case gl.RED:
      switch (type) {
        case gl.UNSIGNED_BYTE:
          return { webgpuFormat: 'r8unorm', bytesPerPixel: 1 };
        case gl.FLOAT:
          return { webgpuFormat: 'r32float', bytesPerPixel: 4 };
        case gl.HALF_FLOAT:
          return { webgpuFormat: 'r16float', bytesPerPixel: 2 };
      }
      break;

    case gl.RG:
      switch (type) {
        case gl.UNSIGNED_BYTE:
          return { webgpuFormat: 'rg8unorm', bytesPerPixel: 2 };
        case gl.FLOAT:
          return { webgpuFormat: 'rg32float', bytesPerPixel: 8 };
        case gl.HALF_FLOAT:
          return { webgpuFormat: 'rg16float', bytesPerPixel: 4 };
      }
      break;

    case gl.DEPTH_COMPONENT:
      switch (type) {
        case gl.UNSIGNED_SHORT:
          return { webgpuFormat: 'depth16unorm', bytesPerPixel: 2 };
        case gl.UNSIGNED_INT:
          return { webgpuFormat: 'depth24plus', bytesPerPixel: 4 };
        case gl.FLOAT:
          return { webgpuFormat: 'depth32float', bytesPerPixel: 4 };
      }
      break;

    case gl.DEPTH_STENCIL:
      switch (type) {
        case gl.UNSIGNED_INT_24_8:
          return { webgpuFormat: 'depth24plus-stencil8', bytesPerPixel: 4 };
      }
      break;

    case gl.ALPHA:
    case gl.LUMINANCE:
      switch (type) {
        case gl.UNSIGNED_BYTE:
          return { webgpuFormat: 'r8unorm', bytesPerPixel: 1 };
      }
      break;

    case gl.LUMINANCE_ALPHA:
      switch (type) {
        case gl.UNSIGNED_BYTE:
          return { webgpuFormat: 'rg8unorm', bytesPerPixel: 2 };
      }
      break;
  }

  console.warn(
    `Unknown texture format/type combination: format=${format} (0x${format.toString(16)}), type=${type} (0x${type.toString(16)}), falling back to rgba8unorm`,
  );
  return { webgpuFormat: 'rgba8unorm', bytesPerPixel: 4 };
}

function getFormatFromInternal(internalFormat: GLenum): TextureFormatInfo {
  switch (internalFormat) {
    case gl.RGBA8:
    case gl.RGB8:
    case gl.RGBA:
    case gl.RGB:
      return { webgpuFormat: 'rgba8unorm', bytesPerPixel: 4 };
    case gl.RG8:
    case gl.LUMINANCE_ALPHA:
      return { webgpuFormat: 'rg8unorm', bytesPerPixel: 2 };
    case gl.R8:
    case gl.ALPHA:
    case gl.LUMINANCE:
      return { webgpuFormat: 'r8unorm', bytesPerPixel: 1 };

    case gl.RGBA16F:
      return { webgpuFormat: 'rgba16float', bytesPerPixel: 8 };
    case gl.RG16F:
      return { webgpuFormat: 'rg16float', bytesPerPixel: 4 };
    case gl.R16F:
      return { webgpuFormat: 'r16float', bytesPerPixel: 2 };

    case gl.RGBA32F:
      return { webgpuFormat: 'rgba32float', bytesPerPixel: 16 };
    case gl.RG32F:
      return { webgpuFormat: 'rg32float', bytesPerPixel: 8 };
    case gl.R32F:
      return { webgpuFormat: 'r32float', bytesPerPixel: 4 };

    case gl.SRGB8_ALPHA8:
    case gl.SRGB8:
      return { webgpuFormat: 'rgba8unorm-srgb', bytesPerPixel: 4 };

    case gl.DEPTH_COMPONENT16:
      return { webgpuFormat: 'depth16unorm', bytesPerPixel: 2 };
    case gl.DEPTH_COMPONENT24:
      return { webgpuFormat: 'depth24plus', bytesPerPixel: 4 };
    case gl.DEPTH_COMPONENT32F:
      return { webgpuFormat: 'depth32float', bytesPerPixel: 4 };
    case gl.DEPTH24_STENCIL8:
      return { webgpuFormat: 'depth24plus-stencil8', bytesPerPixel: 4 };
    case gl.DEPTH32F_STENCIL8:
      return { webgpuFormat: 'depth32float-stencil8', bytesPerPixel: 5 };

    case gl.RGBA8_SNORM:
      return { webgpuFormat: 'rgba8snorm', bytesPerPixel: 4 };
    case gl.RG8_SNORM:
      return { webgpuFormat: 'rg8snorm', bytesPerPixel: 2 };
    case gl.R8_SNORM:
      return { webgpuFormat: 'r8snorm', bytesPerPixel: 1 };

    case gl.RGBA8UI:
      return { webgpuFormat: 'rgba8uint', bytesPerPixel: 4 };
    case gl.RGBA8I:
      return { webgpuFormat: 'rgba8sint', bytesPerPixel: 4 };
    case gl.RG8UI:
      return { webgpuFormat: 'rg8uint', bytesPerPixel: 2 };
    case gl.RG8I:
      return { webgpuFormat: 'rg8sint', bytesPerPixel: 2 };
    case gl.R8UI:
      return { webgpuFormat: 'r8uint', bytesPerPixel: 1 };
    case gl.R8I:
      return { webgpuFormat: 'r8sint', bytesPerPixel: 1 };

    case gl.RGBA16UI:
      return { webgpuFormat: 'rgba16uint', bytesPerPixel: 8 };
    case gl.RGBA16I:
      return { webgpuFormat: 'rgba16sint', bytesPerPixel: 8 };
    case gl.RG16UI:
      return { webgpuFormat: 'rg16uint', bytesPerPixel: 4 };
    case gl.RG16I:
      return { webgpuFormat: 'rg16sint', bytesPerPixel: 4 };
    case gl.R16UI:
      return { webgpuFormat: 'r16uint', bytesPerPixel: 2 };
    case gl.R16I:
      return { webgpuFormat: 'r16sint', bytesPerPixel: 2 };

    case gl.RGBA32UI:
      return { webgpuFormat: 'rgba32uint', bytesPerPixel: 16 };
    case gl.RGBA32I:
      return { webgpuFormat: 'rgba32sint', bytesPerPixel: 16 };
    case gl.RG32UI:
      return { webgpuFormat: 'rg32uint', bytesPerPixel: 8 };
    case gl.RG32I:
      return { webgpuFormat: 'rg32sint', bytesPerPixel: 8 };
    case gl.R32UI:
      return { webgpuFormat: 'r32uint', bytesPerPixel: 4 };
    case gl.R32I:
      return { webgpuFormat: 'r32sint', bytesPerPixel: 4 };

    case gl.RGB10_A2:
      return { webgpuFormat: 'rgb10a2unorm', bytesPerPixel: 4 };
    case gl.RGB10_A2UI:
      return { webgpuFormat: 'rgb10a2uint', bytesPerPixel: 4 };
    case gl.R11F_G11F_B10F:
      return { webgpuFormat: 'rg11b10ufloat', bytesPerPixel: 4 };
    case gl.RGB9_E5:
      return { webgpuFormat: 'rgba16float', bytesPerPixel: 8 };
  }

  console.warn(
    `Unknown internal format: ${internalFormat} (0x${internalFormat.toString(16)}), falling back to rgba8unorm`,
  );
  return { webgpuFormat: 'rgba8unorm', bytesPerPixel: 4 };
}

export function convertRGBToRGBA(
  rgbData: ArrayBufferView,
  width: number,
  height: number,
): Uint8Array {
  const rgbArray = new Uint8Array(
    rgbData.buffer,
    rgbData.byteOffset,
    rgbData.byteLength,
  );
  const rgbaArray = new Uint8Array(width * height * 4);

  for (let i = 0, j = 0; i < rgbArray.length; i += 3, j += 4) {
    rgbaArray[j] = rgbArray[i];
    rgbaArray[j + 1] = rgbArray[i + 1];
    rgbaArray[j + 2] = rgbArray[i + 2];
    rgbaArray[j + 3] = 255;
  }

  return rgbaArray;
}

export function getWebGLFormat(internalFormat: GLenum): {
  format: GLenum;
  type: GLenum;
} {
  switch (internalFormat) {
    case gl.RGBA8:
    case gl.SRGB8_ALPHA8:
      return { format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    case gl.RGB8:
    case gl.SRGB8:
      return { format: gl.RGB, type: gl.UNSIGNED_BYTE };
    case gl.RG8:
      return { format: gl.RG, type: gl.UNSIGNED_BYTE };
    case gl.R8:
      return { format: gl.RED, type: gl.UNSIGNED_BYTE };
    case gl.RGBA16F:
      return { format: gl.RGBA, type: gl.HALF_FLOAT };
    case gl.RG16F:
      return { format: gl.RG, type: gl.HALF_FLOAT };
    case gl.R16F:
      return { format: gl.RED, type: gl.HALF_FLOAT };
    case gl.RGBA32F:
      return { format: gl.RGBA, type: gl.FLOAT };
    case gl.RG32F:
      return { format: gl.RG, type: gl.FLOAT };
    case gl.R32F:
      return { format: gl.RED, type: gl.FLOAT };
    case gl.DEPTH_COMPONENT16:
      return { format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_SHORT };
    case gl.DEPTH_COMPONENT24:
      return { format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT };
    case gl.DEPTH_COMPONENT32F:
      return { format: gl.DEPTH_COMPONENT, type: gl.FLOAT };
    case gl.DEPTH24_STENCIL8:
      return { format: gl.DEPTH_STENCIL, type: gl.UNSIGNED_INT_24_8 };
    default:
      return { format: gl.RGBA, type: gl.UNSIGNED_BYTE };
  }
}
