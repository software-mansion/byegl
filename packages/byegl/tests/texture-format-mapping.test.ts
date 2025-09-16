import { describe, expect, it } from 'vitest';
import {
  convertRGBToRGBA,
  getTextureFormat,
  getWebGLFormat,
} from '../src/texture-format-mapping.ts';

const gl = WebGL2RenderingContext;

describe('texture format mapping', () => {
  describe('getTextureFormat', () => {
    it('should map RGBA + UNSIGNED_BYTE to rgba8unorm', () => {
      const result = getTextureFormat(gl.RGBA, gl.UNSIGNED_BYTE);
      expect(result).toEqual({
        webgpuFormat: 'rgba8unorm',
        bytesPerPixel: 4,
      });
    });

    it('should map RGB + UNSIGNED_BYTE to rgba8unorm (padded)', () => {
      const result = getTextureFormat(gl.RGB, gl.UNSIGNED_BYTE);
      expect(result).toEqual({
        webgpuFormat: 'rgba8unorm',
        bytesPerPixel: 4,
      });
    });

    it('should map RED + UNSIGNED_BYTE to r8unorm', () => {
      const result = getTextureFormat(gl.RED, gl.UNSIGNED_BYTE);
      expect(result).toEqual({
        webgpuFormat: 'r8unorm',
        bytesPerPixel: 1,
      });
    });

    it('should map RG + UNSIGNED_BYTE to rg8unorm', () => {
      const result = getTextureFormat(gl.RG, gl.UNSIGNED_BYTE);
      expect(result).toEqual({
        webgpuFormat: 'rg8unorm',
        bytesPerPixel: 2,
      });
    });

    it('should map RGBA + FLOAT to rgba32float', () => {
      const result = getTextureFormat(gl.RGBA, gl.FLOAT);
      expect(result).toEqual({
        webgpuFormat: 'rgba32float',
        bytesPerPixel: 16,
      });
    });

    it('should map RGBA + HALF_FLOAT to rgba16float', () => {
      const result = getTextureFormat(gl.RGBA, gl.HALF_FLOAT);
      expect(result).toEqual({
        webgpuFormat: 'rgba16float',
        bytesPerPixel: 8,
      });
    });

    it('should handle internal format RGBA8', () => {
      const result = getTextureFormat(gl.RGBA, gl.UNSIGNED_BYTE, gl.RGBA8);
      expect(result).toEqual({
        webgpuFormat: 'rgba8unorm',
        bytesPerPixel: 4,
      });
    });

    it('should handle internal format RGBA16F', () => {
      const result = getTextureFormat(gl.RGBA, gl.HALF_FLOAT, gl.RGBA16F);
      expect(result).toEqual({
        webgpuFormat: 'rgba16float',
        bytesPerPixel: 8,
      });
    });

    it('should handle internal format RGBA32F', () => {
      const result = getTextureFormat(gl.RGBA, gl.FLOAT, gl.RGBA32F);
      expect(result).toEqual({
        webgpuFormat: 'rgba32float',
        bytesPerPixel: 16,
      });
    });

    it('should handle sRGB formats', () => {
      const result = getTextureFormat(
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        gl.SRGB8_ALPHA8,
      );
      expect(result).toEqual({
        webgpuFormat: 'rgba8unorm-srgb',
        bytesPerPixel: 4,
      });
    });

    it('should handle depth formats', () => {
      const result = getTextureFormat(gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT);
      expect(result).toEqual({
        webgpuFormat: 'depth16unorm',
        bytesPerPixel: 2,
      });
    });

    it('should handle depth-stencil formats', () => {
      const result = getTextureFormat(gl.DEPTH_STENCIL, gl.UNSIGNED_INT_24_8);
      expect(result).toEqual({
        webgpuFormat: 'depth24plus-stencil8',
        bytesPerPixel: 4,
      });
    });

    it('should prioritize internal format over format/type', () => {
      const result = getTextureFormat(
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        gl.SRGB8_ALPHA8,
      );
      expect(result.webgpuFormat).toBe('rgba8unorm-srgb');
    });

    it('should handle alpha-only format', () => {
      const result = getTextureFormat(gl.ALPHA, gl.UNSIGNED_BYTE);
      expect(result).toEqual({
        webgpuFormat: 'r8unorm',
        bytesPerPixel: 1,
      });
    });

    it('should handle luminance format', () => {
      const result = getTextureFormat(gl.LUMINANCE, gl.UNSIGNED_BYTE);
      expect(result).toEqual({
        webgpuFormat: 'r8unorm',
        bytesPerPixel: 1,
      });
    });

    it('should handle luminance-alpha format', () => {
      const result = getTextureFormat(gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE);
      expect(result).toEqual({
        webgpuFormat: 'rg8unorm',
        bytesPerPixel: 2,
      });
    });

    it('should fallback to rgba8unorm for unsupported format combinations', () => {
      const result = getTextureFormat(gl.RGBA, 0x9999); // Invalid type
      expect(result).toEqual({
        webgpuFormat: 'rgba8unorm',
        bytesPerPixel: 4,
      });
    });

    it('should fallback to rgba8unorm for unsupported internal formats', () => {
      const result = getTextureFormat(gl.RGBA, gl.UNSIGNED_BYTE, 0x9999); // Invalid internal format
      expect(result).toEqual({
        webgpuFormat: 'rgba8unorm',
        bytesPerPixel: 4,
      });
    });
  });

  describe('convertRGBToRGBA', () => {
    it('should convert RGB data to RGBA with alpha=255', () => {
      const rgbData = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]);
      const result = convertRGBToRGBA(rgbData, 3, 1);

      expect(result).toEqual(
        new Uint8Array([
          255,
          0,
          0,
          255, // Red pixel with full alpha
          0,
          255,
          0,
          255, // Green pixel with full alpha
          0,
          0,
          255,
          255, // Blue pixel with full alpha
        ]),
      );
    });

    it('should handle empty data', () => {
      const rgbData = new Uint8Array([]);
      const result = convertRGBToRGBA(rgbData, 0, 0);

      expect(result).toEqual(new Uint8Array([]));
    });

    it('should convert single RGB pixel', () => {
      const rgbData = new Uint8Array([128, 64, 192]);
      const result = convertRGBToRGBA(rgbData, 1, 1);

      expect(result).toEqual(new Uint8Array([128, 64, 192, 255]));
    });

    it('should handle 2x2 RGB image', () => {
      const rgbData = new Uint8Array([
        255,
        0,
        0, // Top-left: red
        0,
        255,
        0, // Top-right: green
        0,
        0,
        255, // Bottom-left: blue
        255,
        255,
        0, // Bottom-right: yellow
      ]);
      const result = convertRGBToRGBA(rgbData, 2, 2);

      expect(result).toEqual(
        new Uint8Array([
          255,
          0,
          0,
          255, // Top-left: red with alpha
          0,
          255,
          0,
          255, // Top-right: green with alpha
          0,
          0,
          255,
          255, // Bottom-left: blue with alpha
          255,
          255,
          0,
          255, // Bottom-right: yellow with alpha
        ]),
      );
    });
  });

  describe('getWebGLFormat', () => {
    it('should map RGBA8 to RGBA/UNSIGNED_BYTE', () => {
      const result = getWebGLFormat(gl.RGBA8);
      expect(result).toEqual({
        format: gl.RGBA,
        type: gl.UNSIGNED_BYTE,
      });
    });

    it('should map SRGB8_ALPHA8 to RGBA/UNSIGNED_BYTE', () => {
      const result = getWebGLFormat(gl.SRGB8_ALPHA8);
      expect(result).toEqual({
        format: gl.RGBA,
        type: gl.UNSIGNED_BYTE,
      });
    });

    it('should map RGB8 to RGB/UNSIGNED_BYTE', () => {
      const result = getWebGLFormat(gl.RGB8);
      expect(result).toEqual({
        format: gl.RGB,
        type: gl.UNSIGNED_BYTE,
      });
    });

    it('should map RGBA16F to RGBA/HALF_FLOAT', () => {
      const result = getWebGLFormat(gl.RGBA16F);
      expect(result).toEqual({
        format: gl.RGBA,
        type: gl.HALF_FLOAT,
      });
    });

    it('should map RGBA32F to RGBA/FLOAT', () => {
      const result = getWebGLFormat(gl.RGBA32F);
      expect(result).toEqual({
        format: gl.RGBA,
        type: gl.FLOAT,
      });
    });

    it('should map R8 to RED/UNSIGNED_BYTE', () => {
      const result = getWebGLFormat(gl.R8);
      expect(result).toEqual({
        format: gl.RED,
        type: gl.UNSIGNED_BYTE,
      });
    });

    it('should map DEPTH_COMPONENT16 to DEPTH_COMPONENT/UNSIGNED_SHORT', () => {
      const result = getWebGLFormat(gl.DEPTH_COMPONENT16);
      expect(result).toEqual({
        format: gl.DEPTH_COMPONENT,
        type: gl.UNSIGNED_SHORT,
      });
    });

    it('should map DEPTH24_STENCIL8 to DEPTH_STENCIL/UNSIGNED_INT_24_8', () => {
      const result = getWebGLFormat(gl.DEPTH24_STENCIL8);
      expect(result).toEqual({
        format: gl.DEPTH_STENCIL,
        type: gl.UNSIGNED_INT_24_8,
      });
    });

    it('should fallback to RGBA/UNSIGNED_BYTE for unknown formats', () => {
      const result = getWebGLFormat(0x9999); // Invalid format
      expect(result).toEqual({
        format: gl.RGBA,
        type: gl.UNSIGNED_BYTE,
      });
    });
  });

  describe('edge cases and format compatibility', () => {
    it('should handle packed pixel formats', () => {
      const rgba4444 = getTextureFormat(gl.RGBA, gl.UNSIGNED_SHORT_4_4_4_4);
      expect(rgba4444.webgpuFormat).toBe('rgba8unorm');

      const rgba5551 = getTextureFormat(gl.RGBA, gl.UNSIGNED_SHORT_5_5_5_1);
      expect(rgba5551.webgpuFormat).toBe('rgba8unorm');

      const rgb565 = getTextureFormat(gl.RGB, gl.UNSIGNED_SHORT_5_6_5);
      expect(rgb565.webgpuFormat).toBe('rgba8unorm');
    });

    it('should handle float formats', () => {
      const rgbaFloat = getTextureFormat(gl.RGBA, gl.FLOAT);
      expect(rgbaFloat.webgpuFormat).toBe('rgba32float');
      expect(rgbaFloat.bytesPerPixel).toBe(16);

      const rFloat = getTextureFormat(gl.RED, gl.FLOAT);
      expect(rFloat.webgpuFormat).toBe('r32float');
      expect(rFloat.bytesPerPixel).toBe(4);
    });

    it('should handle half-float formats', () => {
      const rgbaHalf = getTextureFormat(gl.RGBA, gl.HALF_FLOAT);
      expect(rgbaHalf.webgpuFormat).toBe('rgba16float');
      expect(rgbaHalf.bytesPerPixel).toBe(8);
    });
  });
});
