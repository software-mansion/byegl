import { MockWGSLGenerator } from '../common/mock-wgsl-generator.ts';
import { ShaderkitWGSLGenerator } from '../common/shaderkit-wgsl-generator.ts';
import { DeGLContext } from './degl-context.ts';

export async function enable() {
  const originalGetContext = HTMLCanvasElement.prototype.getContext as any;

  // Doing everything asynchronous here, since WebGL is mostly synchronous.
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('No GPU adapter found');
  }
  const device = await adapter.requestDevice();
  if (!device) {
    throw new Error('No GPU device found');
  }

  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    ...args: unknown[]
  ) {
    if (contextId === 'webgl') {
      const wgslGen = new ShaderkitWGSLGenerator();
      // const wgslGen = new MockWGSLGenerator();
      return new DeGLContext(device, this, wgslGen);
    }

    return originalGetContext!.call(this, contextId, ...args);
  };

  return () => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  };
}
