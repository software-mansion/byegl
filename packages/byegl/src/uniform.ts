import { TgpuRoot } from 'typegpu';
import { $internal } from './types.ts';
import { UniformInfo } from './wgsl/wgsl-generator.ts';
import { sizeOf } from 'typegpu/data';

export class UniformBufferCache {
  #buffers: Map<number, GPUBuffer> = new Map();
  #root: TgpuRoot;

  constructor(root: TgpuRoot) {
    this.#root = root;
  }

  getBuffer(uniform: UniformInfo): GPUBuffer {
    let cached = this.#buffers.get(uniform.location);
    if (!cached) {
      cached = this.#root.device.createBuffer({
        label: 'ByeGL Uniform Buffer',
        size: sizeOf(uniform.type),
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.#buffers.set(uniform.location, cached);
    }

    return cached;
  }

  updateUniform(uniform: UniformInfo, value: ArrayBuffer) {
    const cached = this.#buffers.get(uniform.location);
    if (cached && cached.size === value.byteLength) {
      this.#root.device.queue.writeBuffer(cached, 0, value);
      return cached;
    }

    // Destroying cached buffer if it exists
    cached?.destroy();

    const buffer = this.#root.device.createBuffer({
      label: 'ByeGL Uniform Buffer',
      size: value.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    this.#buffers.set(uniform.location, buffer);
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
export class ByeGLUniformLocation {
  readonly [$internal]: number;

  constructor(idx: number) {
    this[$internal] = idx;
  }
}
