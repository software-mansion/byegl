import { test as base, vi } from 'vitest';
import './webgpuGlobals.ts';
import tgpu, { TgpuRoot } from 'typegpu';
import { ByeGLContext } from '../src/byegl-context.ts';
import * as byegl from '../src/index.ts';
import { ShaderkitWGSLGenerator } from '../src/wgsl/shaderkit-wgsl-generator.ts';

const canvasMock = {
  width: 100,
  height: 100,
  getContext: (contextType: string) => {
    if (contextType === 'webgpu') {
      return {
        configure: () => {},
        getCurrentTexture: () => ({
          width: 100,
          height: 100,
          createView: () => ({}),
        }),
      };
    }
    return null;
  },
} as unknown as HTMLCanvasElement;

const adapterMock = {
  features: new Set(['timestamp-query']),
  requestDevice: vi.fn((descriptor) => Promise.resolve(mockDevice)),
  limits: {
    maxStorageBufferBindingSize: 64 * 1024 * 1024,
  },
};

const navigatorMock = {
  gpu: {
    __brand: 'GPU',
    requestAdapter: vi.fn(() => Promise.resolve(adapterMock)),
    getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm'),
  },
  mediaDevices: {
    getUserMedia: vi.fn(() => Promise.resolve()),
  },
};

const mockTexture = {
  createView: vi.fn(() => 'view'),
  destroy: vi.fn(),
};

const mockCommandEncoder = {
  get mock() {
    return mockCommandEncoder;
  },
  beginComputePass: vi.fn(() => mockComputePassEncoder),
  beginRenderPass: vi.fn(() => mockRenderPassEncoder),
  copyBufferToBuffer: vi.fn(),
  copyBufferToTexture: vi.fn(),
  copyTextureToBuffer: vi.fn(),
  copyTextureToTexture: vi.fn(),
  resolveQuerySet: vi.fn(),
  finish: vi.fn(),
};

const mockComputePassEncoder = {
  dispatchWorkgroups: vi.fn(),
  end: vi.fn(),
  setBindGroup: vi.fn(),
  setPipeline: vi.fn(),
};

const mockRenderPassEncoder = {
  draw: vi.fn(),
  drawIndexed: vi.fn(),
  end: vi.fn(),
  setBindGroup: vi.fn(),
  setPipeline: vi.fn(),
  setVertexBuffer: vi.fn(),
  setIndexBuffer: vi.fn(),
};

const mockQuerySet = {
  destroy: vi.fn(),
  get label() {
    return this._label || '<unnamed>';
  },
  set label(value) {
    this._label = value;
  },
  _label: '<unnamed>',
};

const mockComputePipeline = {
  get getBindGroupLayout() {
    return vi.fn(() => 'mockBindGroupLayout');
  },
  label: '<unnamed>',
};

const mockDevice = {
  get mock() {
    return mockDevice;
  },
  features: new Set(['timestamp-query']),
  createBindGroup: vi.fn(
    (_descriptor: GPUBindGroupDescriptor) => 'mockBindGroup',
  ),
  createBindGroupLayout: vi.fn(
    (_descriptor: GPUBindGroupLayoutDescriptor) => 'mockBindGroupLayout',
  ),
  createBuffer: vi.fn(
    ({ size, usage, mappedAtCreation, label }: GPUBufferDescriptor) => {
      const mockBuffer = {
        mapState: mappedAtCreation ? 'mapped' : 'unmapped',
        size,
        usage,
        label: label ?? '<unnamed>',
        getMappedRange: vi.fn(() => new ArrayBuffer(size)),
        unmap: vi.fn(() => {
          mockBuffer.mapState = 'unmapped';
        }),
        mapAsync: vi.fn(() => {
          mockBuffer.mapState = 'mapped';
        }),
        destroy: vi.fn(),
      };

      return mockBuffer;
    },
  ),
  createCommandEncoder: vi.fn(() => mockCommandEncoder),
  createComputePipeline: vi.fn(() => mockComputePipeline),
  createPipelineLayout: vi.fn(() => 'mockPipelineLayout'),
  createQuerySet: vi.fn(({ type, count }: GPUQuerySetDescriptor) => {
    const querySet = Object.create(mockQuerySet);
    querySet.type = type;
    querySet.count = count;
    querySet._label = '<unnamed>';
    return querySet;
  }),
  createRenderPipeline: vi.fn(() => 'mockRenderPipeline'),
  createSampler: vi.fn(() => 'mockSampler'),
  createShaderModule: vi.fn(() => 'mockShaderModule'),
  createTexture: vi.fn(() => mockTexture),
  importExternalTexture: vi.fn(() => 'mockExternalTexture'),
  queue: {
    copyExternalImageToTexture: vi.fn(),
    onSubmittedWorkDone: vi.fn(() => Promise.resolve()),
    submit: vi.fn(),
    writeBuffer: vi.fn(),
    writeTexture: vi.fn(),
  },
  destroy: vi.fn(),
};

const rootMock = {
  device: mockDevice,
} as unknown as TgpuRoot;

export const test = base.extend<{
  _global: undefined;
  commandEncoder: GPUCommandEncoder & { mock: typeof mockCommandEncoder };
  device: GPUDevice & { mock: typeof mockDevice };
  root: TgpuRoot;
  gl: WebGL2RenderingContext;
}>({
  _global: [
    async ({ task }, use) => {
      vi.stubGlobal('navigator', navigatorMock);

      await use(undefined);

      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    },
    { auto: true }, // Always runs
  ],

  commandEncoder: async ({ task }, use) => {
    await use(
      mockCommandEncoder as unknown as GPUCommandEncoder & {
        mock: typeof mockCommandEncoder;
      },
    );
  },

  device: async ({ task }, use) => {
    await use(mockDevice as unknown as GPUDevice & { mock: typeof mockDevice });
  },

  root: async ({ task }, use) => {
    const root = await tgpu.init();
    await use(root as TgpuRoot);
    root.destroy();
  },

  gl: async ({ task }, use) => {
    const gl = new ByeGLContext(
      2,
      rootMock,
      canvasMock,
      new ShaderkitWGSLGenerator(),
    ) as unknown as WebGL2RenderingContext;

    await use(gl);
  },
});

export function toWgsl(
  gl: WebGL2RenderingContext,
  glsl1: string,
  glsl2?: string | undefined,
): { wgsl: string; program: WebGLProgram } {
  const [glslVert, glslFrag] = glsl2 ? [glsl1, glsl2] : ['', glsl1];

  const vert = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vert, glslVert);
  gl.compileShader(vert);

  const frag = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(frag, glslFrag);
  gl.compileShader(frag);

  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  return {
    wgsl: byegl.getWGSLSource(gl, program) ?? gl.getProgramInfoLog(program)!,
    program,
  };
}
