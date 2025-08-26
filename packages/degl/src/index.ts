import tgpu from 'typegpu';
import { DeGLBuffer } from './buffer.ts';
import { DeGLContext } from './degl-context.ts';
import { $internal } from './types.ts';
import { MockWGSLGenerator } from './wgsl/mock-wgsl-generator.ts';
import { ShaderkitWGSLGenerator } from './wgsl/shaderkit-wgsl-generator.ts';

export async function enable() {
  const originalGetContext = HTMLCanvasElement.prototype.getContext as any;

  // Doing everything asynchronous here, since WebGL is mostly synchronous.
  const root = await tgpu.init();

  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    ...args: unknown[]
  ) {
    if (contextId === 'webgl') {
      const wgslGen = new ShaderkitWGSLGenerator();
      // const wgslGen = new MockWGSLGenerator();
      return new DeGLContext(root, this, wgslGen);
    }

    return originalGetContext!.call(this, contextId, ...args);
  };

  return () => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  };
}

export function getDevice(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): GPUDevice {
  if (!(gl instanceof DeGLContext)) {
    throw new Error('Cannot use DeGL hooks on a vanilla WebGPU context');
  }

  return gl[$internal].device;
}

export function importWebGPUBuffer(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  wgpuBuffer: GPUBuffer,
): WebGLBuffer {
  if (!(gl instanceof DeGLContext)) {
    throw new Error('Cannot use DeGL hooks on a vanilla WebGPU context');
  }

  const glBuffer = gl.createBuffer() as DeGLBuffer;
  glBuffer[$internal].importExistingWebGPUBuffer(wgpuBuffer);
  return glBuffer;
}

export function getWebGPUBuffer(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  glBuffer: WebGLBuffer,
): GPUBuffer {
  if (!(gl instanceof DeGLContext)) {
    throw new Error('Cannot use DeGL hooks on a vanilla WebGPU context');
  }

  return (glBuffer as DeGLBuffer)[$internal].gpuBuffer;
}
