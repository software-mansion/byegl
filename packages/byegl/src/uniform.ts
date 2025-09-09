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
  #values: Map<string, UniformValue> = new Map();
  #root: TgpuRoot;

  constructor(root: TgpuRoot) {
    this.#root = root;
  }

  getValue(name: string): UniformValue {
    if (!this.#values.has(name)) {
      // Returning appropriate '0' value
      // TODO: Return more appropriate value based on data type
      return 0;
    }
    return this.#values.get(name)!;
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
    glLocation: ByeGLUniformLocation,
    value: UniformValue | Iterable<number>,
  ) {
    const location = glLocation[$internal];
    this.#values.set(location.name, value as UniformValue);

    const dataType = location.dataType;

    if (dataType.type.startsWith('texture_')) {
      // No need to create a buffer for texture uniforms
      // We just need the value to get updated, so that
      // we can match up which texture to bind to
      // which uniform.
      return;
    }

    let serialized: ArrayBuffer;
    if (dataType.type === 'bool') {
      // Booleans are actually not host-shareable, so we use
      // u32 to pass `0` or `1`.
      serialized = new Uint32Array([value ? 1 : 0]).buffer;
    } else if (dataType.type === 'u32') {
      serialized = new Uint32Array([value as number]).buffer;
    } else if (dataType.type === 'i32') {
      serialized = new Int32Array([value as number]).buffer;
    } else if (dataType.type === 'f32') {
      serialized = new Float32Array([value as number]).buffer;
    } else if (
      dataType.type === 'vec2f' ||
      dataType.type === 'vec3f' ||
      dataType.type === 'vec4f'
    ) {
      // Making sure it's definitely a Float32Array, as a basic array could have been passed in
      const f32Array = new Float32Array([...(value as Float32Array)]);
      serialized = f32Array.buffer;
      this.#values.set(location.name, f32Array);
    } else if (
      dataType.type === 'vec2i' ||
      dataType.type === 'vec3i' ||
      dataType.type === 'vec4i'
    ) {
      // Making sure it's definitely a Int32Array, as a basic array could have been passed in
      const i32Array = new Int32Array([...(value as Int32Array)]);
      serialized = i32Array.buffer;
      this.#values.set(location.name, i32Array);
    } else if (
      dataType.type === 'vec2u' ||
      dataType.type === 'vec3u' ||
      dataType.type === 'vec4u'
    ) {
      // Making sure it's definitely a Uint32Array, as a basic array could have been passed in
      const u32Array = new Uint32Array([...(value as Uint32Array)]);
      serialized = u32Array.buffer;
      this.#values.set(location.name, u32Array);
    } else if (
      dataType.type === 'vec2<bool>' ||
      dataType.type === 'vec3<bool>' ||
      dataType.type === 'vec4<bool>'
    ) {
      // Booleans are actually not host-shareable, so we use
      // u32 to pass `0` or `1`.
      serialized = new Uint32Array(
        [...(value as boolean[])].map((v) => (v ? 1 : 0)),
      ).buffer;
    } else if (
      dataType.type === 'mat2x2f' ||
      dataType.type === 'mat3x3f' ||
      dataType.type === 'mat4x4f'
    ) {
      // Making sure it's definitely a Float32Array, as a basic array could have been passed in
      const f32Array = new Float32Array([...(value as Float32Array)]);
      serialized = f32Array.buffer;
      this.#values.set(location.name, f32Array);
    } else {
      throw new Error(`Cannot serialize ${dataType.type} yet.`);
    }

    const cached = this.#buffers.get(location.baseInfo.location);
    if (cached) {
      this.#root.device.queue.writeBuffer(
        cached,
        location.byteOffset,
        serialized,
      );
      return cached;
    }

    const buffer = this.#root.device.createBuffer({
      label: 'ByeGL Uniform Buffer',
      size: sizeOf(location.baseInfo.type as AnyWgslData),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    this.#buffers.set(location.baseInfo.location, buffer);
    // Filling out the buffer with data
    const mappedBuffer = new Uint8Array(buffer.getMappedRange());
    const inView = new Uint8Array(serialized);
    for (let i = 0; i < serialized.byteLength; i++) {
      mappedBuffer[i + location.byteOffset] = inView[i];
    }
    buffer.unmap();
    return buffer;
  }
}

export interface UniformLocation {
  name: string;
  byteOffset: number;
  /**
   * Amount of "elements" in the uniform location
   */
  size: number;
  baseInfo: UniformInfo;
  dataType: ByeglData;
}

// WebGLUniformLocation
export class ByeGLUniformLocation {
  readonly [$internal]: UniformLocation;

  constructor(data: UniformLocation) {
    this[$internal] = data;
  }
}
