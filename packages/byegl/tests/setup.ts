// Vitest setup file for Node.js tests
// This mocks WebGL2RenderingContext which is not available in Node.js

import GL from 'webgl-constants';

// Create WebGL constants without GL_ prefix
const WebGLConstants: Record<string, number> = {};
for (const [key, value] of Object.entries(GL)) {
  if (key.startsWith('GL_')) {
    WebGLConstants[key.substring(3)] = value;
  }
}

// Set up global mocks
globalThis.WebGL2RenderingContext =
  WebGLConstants as unknown as typeof globalThis.WebGL2RenderingContext;
globalThis.WebGL2RenderingContext.prototype =
  WebGLConstants as unknown as globalThis.WebGL2RenderingContext;
globalThis.WebGLRenderingContext =
  WebGLConstants as unknown as typeof globalThis.WebGLRenderingContext;
globalThis.WebGLRenderingContext.prototype =
  WebGLConstants as unknown as typeof globalThis.WebGLRenderingContext.prototype;
globalThis.WebGLShaderPrecisionFormat =
  {} as typeof globalThis.WebGLShaderPrecisionFormat;
globalThis.WebGLShaderPrecisionFormat.prototype =
  {} as typeof globalThis.WebGLShaderPrecisionFormat.prototype;
