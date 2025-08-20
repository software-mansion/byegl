import { FakeWebGLContext } from './fake-webgl-context';

const stepsToRestore: (() => unknown)[] = [];

export function enable() {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  stepsToRestore.push(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    ...args: unknown[]
  ) {
    if (contextId === 'webgl') {
      console.log('WebGL context intercepted:', contextId);
      // TODO: Return WebGPU-based WebGL implementation
      return new FakeWebGLContext();
    }

    return originalGetContext!.call(this, contextId, ...args);
  } as any;
}

export function disable() {
  for (const step of stepsToRestore) {
    step();
  }
}
