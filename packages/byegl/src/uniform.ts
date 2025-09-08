import type { TgpuRoot } from 'typegpu';
import { type AnyWgslData, sizeOf } from 'typegpu/data';
import { $internal } from './types.ts';
import type { ByeglData, UniformInfo } from './wgsl/wgsl-generator.ts';

export type UniformValue =
  | number
  | boolean
  | Float32Array
  | Uint32Array
  | Int32Array
  | boolean[];

export class UniformBufferCache {
  #buffers: Map<number, GPUBuffer> = new Map();
  #values: Map<number, UniformValue> = new Map();
  #root: TgpuRoot;

  constructor(root: TgpuRoot) {
    this.#root = root;
  }

  getValue(uniform: UniformInfo): UniformValue {
    if (!this.#values.has(uniform.location)) {
      // Returning appropriate '0' value
      // TODO: Return more appropriate value based on data type
      return 0;
    }
    return this.#values.get(uniform.location)!;
  }

  getBuffer(uniform: UniformInfo): GPUBuffer {
    let cached = this.#buffers.get(uniform.location);
    if (!cached) {
      cached = this.#root.device.createBuffer({
        label: 'ByeGL Uniform Buffer',
        size: sizeOf(uniform.type as AnyWgslData),
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.#buffers.set(uniform.location, cached);
    }

    return cached;
  }

  updateUniform(
    uniform: UniformLocation,
    value: UniformValue | Iterable<number>,
  ) {
    this.#values.set(uniform.bindingIdx, value as UniformValue);

    if (uniform.dataType.type.startsWith('texture_')) {
      // No need to create a buffer for texture uniforms
      // We just need the value to get updated, so that
      // we can match up which texture to bind to
      // which uniform.
      return;
    }

    let serialized: ArrayBuffer;
    if (uniform.dataType.type === 'bool') {
      // Booleans are actually not host-shareable, so we use
      // u32 to pass `0` or `1`.
      serialized = new Uint32Array([value ? 1 : 0]).buffer;
    } else if (uniform.dataType.type === 'u32') {
      serialized = new Uint32Array([value as number]).buffer;
    } else if (uniform.dataType.type === 'i32') {
      serialized = new Int32Array([value as number]).buffer;
    } else if (uniform.dataType.type === 'f32') {
      serialized = new Float32Array([value as number]).buffer;
    } else if (
      uniform.dataType.type === 'vec2f' ||
      uniform.dataType.type === 'vec3f' ||
      uniform.dataType.type === 'vec4f'
    ) {
      // Making sure it's definitely a Float32Array, as a basic array could have been passed in
      const f32Array = new Float32Array([...(value as Float32Array)]);
      serialized = f32Array.buffer;
      this.#values.set(uniform.bindingIdx, f32Array);
    } else if (
      uniform.dataType.type === 'vec2i' ||
      uniform.dataType.type === 'vec3i' ||
      uniform.dataType.type === 'vec4i'
    ) {
      // Making sure it's definitely a Int32Array, as a basic array could have been passed in
      const i32Array = new Int32Array([...(value as Int32Array)]);
      serialized = i32Array.buffer;
      this.#values.set(uniform.bindingIdx, i32Array);
    } else if (
      uniform.dataType.type === 'vec2u' ||
      uniform.dataType.type === 'vec3u' ||
      uniform.dataType.type === 'vec4u'
    ) {
      // Making sure it's definitely a Uint32Array, as a basic array could have been passed in
      const u32Array = new Uint32Array([...(value as Uint32Array)]);
      serialized = u32Array.buffer;
      this.#values.set(uniform.bindingIdx, u32Array);
    } else if (
      uniform.dataType.type === 'vec2<bool>' ||
      uniform.dataType.type === 'vec3<bool>' ||
      uniform.dataType.type === 'vec4<bool>'
    ) {
      // Booleans are actually not host-shareable, so we use
      // u32 to pass `0` or `1`.
      serialized = new Uint32Array(
        [...(value as boolean[])].map((v) => (v ? 1 : 0)),
      ).buffer;
    } else if (
      uniform.dataType.type === 'mat2x2f' ||
      uniform.dataType.type === 'mat3x3f' ||
      uniform.dataType.type === 'mat4x4f'
    ) {
      // Making sure it's definitely a Float32Array, as a basic array could have been passed in
      const f32Array = new Float32Array([...(value as Float32Array)]);
      serialized = f32Array.buffer;
      this.#values.set(uniform.bindingIdx, f32Array);
    } else {
      throw new Error(`Cannot serialize ${uniform.dataType.type} yet.`);
    }

    const cached = this.#buffers.get(uniform.bindingIdx);
    if (cached && cached.size === serialized.byteLength) {
      this.#root.device.queue.writeBuffer(cached, 0, serialized);
      return cached;
    }

    // Destroying cached buffer if it exists
    cached?.destroy();

    const buffer = this.#root.device.createBuffer({
      label: 'ByeGL Uniform Buffer',
      size: serialized.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    this.#buffers.set(uniform.bindingIdx, buffer);
    // Filling out the buffer with data
    const mappedBuffer = new Uint8Array(buffer.getMappedRange());
    const inView = new Uint8Array(serialized);
    for (let i = 0; i < serialized.byteLength; i++) {
      mappedBuffer[i] = inView[i];
    }
    buffer.unmap();
    return buffer;
  }
}

export interface UniformLocation {
  bindingIdx: number;
  byteOffset: number;
  dataType: ByeglData;
}

// WebGLUniformLocation
export class ByeGLUniformLocation {
  readonly [$internal]: UniformLocation;

  constructor(bindingIdx: number, byteOffset: number, dataType: ByeglData) {
    this[$internal] = { bindingIdx, byteOffset, dataType };
  }
}

/**
 * Extracts parts from a uniform location query
 *
 * @example
 * extractAccessPath('uniformName[0].subUniform');
 * // Output: ['uniformName', 0, 'subUniform']
 *
 * @param query
 */
export function extractAccessPath(
  query: string,
): (string | number)[] | undefined {
  // Splits on any dot or bracket
  const parts = query.split(/[\.\[\]]+/);
  const result: (string | number)[] = [];

  for (const part of parts) {
    if (part !== '') {
      const num = Number.parseInt(part, 10);
      result.push(isNaN(num) ? part : num);
    }
  }

  return result.length > 0 ? result : undefined;
}
