import tgpu from 'typegpu';
import { ByeGLBuffer } from './buffer.ts';
import { ByeGLContext } from './byegl-context.ts';
import { ByeGLProgram } from './program.ts';
import { $internal } from './types.ts';
import { ShaderkitWGSLGenerator } from './wgsl/shaderkit-wgsl-generator.ts';
import { addContext } from './globals.ts';

export type { ByeGLContext } from './byegl-context.ts';

let polyfillEnabled = false;
export async function enable() {
  if (polyfillEnabled) {
    // No-op if already enabled.
    return () => {};
  }
  polyfillEnabled = true;

  const originalGetContext = HTMLCanvasElement.prototype.getContext as any;

  // Doing everything asynchronous here, since WebGL is mostly synchronous.
  const root = await tgpu.init();

  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    ...args: unknown[]
  ) {
    if (contextId === 'webgl' || contextId === 'webgl2' || contextId === 'experimental-webgl') {
      const wgslGen = new ShaderkitWGSLGenerator();
      const ctx = new ByeGLContext(contextId === 'webgl2' ? 2 : 1, root, this, wgslGen);
      addContext(ctx);
      return ctx;
    }

    return originalGetContext!.call(this, contextId, ...args);
  };

  return () => {
    polyfillEnabled = false;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  };
}

export interface ByeGLCreateContextOptions {
  readonly canvas: HTMLCanvasElement;
  readonly version: 1 | 2;
}

/**
 * Creates a new ByeGL context from a canvas element.
 * If you'd like this to happen automatically when the canvas is created,
 * you can use the `enable` function instead.
 *
 * @example
 * ```ts
 * // instead of: const gl = canvas.getContext('webgl2');
 * const gl = await byegl.createContext({ canvas, version: 2 });
 * ```
 */
export async function createContext(options: ByeGLCreateContextOptions): Promise<ByeGLContext> {
  // Doing everything asynchronous here, since WebGL is mostly synchronous.
  const root = await tgpu.init();

  const wgslGen = new ShaderkitWGSLGenerator();
  const ctx = new ByeGLContext(options.version, root, options.canvas, wgslGen);
  addContext(ctx);
  return ctx;
}

export function isIntercepted(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  return gl instanceof ByeGLContext;
}

export function getDevice(gl: WebGLRenderingContext | WebGL2RenderingContext): GPUDevice {
  if (!(gl instanceof ByeGLContext)) {
    throw new Error('Cannot use byegl hooks on a vanilla WebGPU context');
  }

  return gl[$internal].device;
}

export function importWebGPUBuffer(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  wgpuBuffer: GPUBuffer,
): WebGLBuffer {
  if (!(gl instanceof ByeGLContext)) {
    throw new Error('Cannot use byegl hooks on a vanilla WebGL context');
  }

  const glBuffer = gl.createBuffer() as ByeGLBuffer;
  glBuffer[$internal].importExistingWebGPUBuffer(wgpuBuffer);
  return glBuffer;
}

/**
 * Returns the WebGPU buffer associated with the given WebGL buffer.
 * Since byegl might reallocate the buffer if the size of the data changes,
 * call this function each time you need access. Don't store it off in a variable.
 *
 * @param gl The WebGL (actually byegl) context.
 * @param glBuffer
 * @returns The WebGPU buffer associated with `glBuffer`.
 */
export function getWebGPUBuffer(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  glBuffer: WebGLBuffer,
): GPUBuffer {
  if (!(gl instanceof ByeGLContext)) {
    throw new Error('Cannot use byegl hooks on a vanilla WebGL context');
  }

  return (glBuffer as ByeGLBuffer)[$internal].gpuBuffer;
}

export function getWGSLSource(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  glProgram: WebGLProgram,
): string | undefined {
  if (!(gl instanceof ByeGLContext)) {
    throw new Error('Cannot use byegl hooks on a vanilla WebGL context');
  }

  return (glProgram as ByeGLProgram)[$internal].compiled?.wgsl;
}
