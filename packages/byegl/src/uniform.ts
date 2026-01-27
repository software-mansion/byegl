import type { TgpuRoot } from 'typegpu';
import type { ByeglData } from './data-types.ts';
import type { ByeGLProgramInternals } from './program.ts';
import { $internal } from './types.ts';
import type { UniformInfo } from './wgsl/wgsl-generator.ts';

export type UniformValue =
  | number
  | boolean
  | Float32Array
  | Uint32Array
  | Int32Array
  | boolean[];

export class UniformBufferCache {
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

  /**
   * Serializes a uniform value to an ArrayBuffer based on its data type.
   */
  #serializeValue(
    dataType: ByeglData,
    value: UniformValue | Iterable<number>,
    name: string,
  ): ArrayBuffer {
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
      this.#values.set(name, f32Array);
    } else if (
      dataType.type === 'vec2i' ||
      dataType.type === 'vec3i' ||
      dataType.type === 'vec4i'
    ) {
      // Making sure it's definitely a Int32Array, as a basic array could have been passed in
      const i32Array = new Int32Array([...(value as Int32Array)]);
      serialized = i32Array.buffer;
      this.#values.set(name, i32Array);
    } else if (
      dataType.type === 'vec2u' ||
      dataType.type === 'vec3u' ||
      dataType.type === 'vec4u'
    ) {
      // Making sure it's definitely a Uint32Array, as a basic array could have been passed in
      const u32Array = new Uint32Array([...(value as Uint32Array)]);
      serialized = u32Array.buffer;
      this.#values.set(name, u32Array);
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
    } else if (dataType.type === 'mat2x2f' || dataType.type === 'mat4x4f') {
      // Making sure it's definitely a Float32Array, as a basic array could have been passed in
      const f32Array = new Float32Array([...(value as Float32Array)]);
      serialized = f32Array.buffer;
      this.#values.set(name, f32Array);
    } else if (dataType.type === 'mat3x3f') {
      // mat3x3f requires padding - each row is 3 values + 1 empty (16 bytes total)
      const inputArray = value as Float32Array;
      const paddedArray = new Float32Array(12); // 3 rows * 4 floats per row

      for (let row = 0; row < 3; row++) {
        paddedArray.set(inputArray.subarray(row * 3, (row + 1) * 3), row * 4);
      }

      serialized = paddedArray.buffer;
      this.#values.set(name, paddedArray);
    } else {
      throw new Error(`Cannot serialize ${dataType.type} yet.`);
    }

    return serialized;
  }

  /**
   * Updates a uniform value in the program's unified uniform buffer.
   *
   * @param program The program whose uniform buffer to update
   * @param glLocation The uniform location
   * @param value The value to set
   */
  updateUniform(
    glLocation: ByeGLUniformLocation,
    value: UniformValue | Iterable<number>,
  ) {
    const location = glLocation[$internal];
    this.#values.set(location.name, value as UniformValue);

    const dataType = location.dataType;

    if (dataType.type.startsWith('texture_')) {
      // No need to write to buffer for texture uniforms.
      // We just need the value to get updated, so that
      // we can match up which texture to bind to
      // which uniform.
      return;
    }

    const programInternal = location.program;
    const buffer = programInternal.gpuUniformBuffer;

    if (!buffer) {
      // Program doesn't have a uniform buffer (no non-texture uniforms)
      return;
    }

    // The location.byteOffset already includes the base offset of the uniform
    // plus any additional offset for struct/array members
    const finalOffset = location.byteOffset;

    // Serialize the value
    const serialized = this.#serializeValue(dataType, value, location.name);

    // Write to the unified buffer
    this.#root.device.queue.writeBuffer(buffer, finalOffset, serialized);
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
  program: ByeGLProgramInternals;
}

// WebGLUniformLocation
export class ByeGLUniformLocation {
  readonly [$internal]: UniformLocation;

  constructor(data: UniformLocation) {
    this[$internal] = data;
  }
}
