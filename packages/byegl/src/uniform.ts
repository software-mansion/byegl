import { TgpuRoot } from 'typegpu';
import { $internal } from './types.ts';

export class UniformBufferCache {
  #buffers: Map<number, GPUBuffer> = new Map();
  #root: TgpuRoot;

  constructor(root: TgpuRoot) {
    this.#root = root;
  }

  getBuffer(location: number): GPUBuffer | undefined {
    return this.#buffers.get(location);
  }

  updateUniform(location: BiGLUniformLocation, value: ArrayBuffer) {
    const cached = this.#buffers.get(location[$internal]);
    if (cached && cached.size === value.byteLength) {
      this.#root.device.queue.writeBuffer(cached, 0, value);
      return cached;
    }

    // Destroying cached buffer if it exists
    cached?.destroy();

    const buffer = this.#root.device.createBuffer({
      label: 'BiGL Uniform Buffer',
      size: value.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    this.#buffers.set(location[$internal], buffer);
    // Filling out the buffer with data
    const mappedBuffer = new Uint8Array(buffer.getMappedRange());
    const inView = new Uint8Array(value);
    for (let i = 0; i < value.byteLength; i++) {
      mappedBuffer[i] = inView[i];
    }
    buffer.unmap();
    return buffer;
  }
}

// WebGLUniformLocation
export class BiGLUniformLocation {
  readonly [$internal]: number;

  constructor(idx: number) {
    this[$internal] = idx;
  }
}
