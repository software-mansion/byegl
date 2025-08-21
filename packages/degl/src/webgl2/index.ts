export function enable() {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    ...args: unknown[]
  ) {
    if (contextId === 'webgl2') {
      // TODO: Return WebGPU-based WebGL2 implementation
      console.warn('Intercepting WebGL2 context is not supported yet.');
    }

    return originalGetContext!.call(this, contextId, ...args);
  } as any;

  return () => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  };
}
