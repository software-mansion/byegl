import { TgpuRoot } from 'typegpu';
import { Remapper } from './remap.ts';
import { $internal } from './types.ts';

type RemappedVertexFormat = 'unorm8x3';

export interface VertexBufferSegment {
  buffer: DeGLBufferInternal;
  /**
   * Where from the original buffer does the data for this segment start.
   */
  offset: number;
  stride: number;
  format: GPUVertexFormat | RemappedVertexFormat;
  remappedStride: number;
  remappedFormat: GPUVertexFormat;
  /**
   * The numeric location associated with this attribute, which will correspond with a
   * <a href="https://gpuweb.github.io/gpuweb/wgsl/#input-output-locations">"@location" attribute</a>
   * declared in the {@link GPURenderPipelineDescriptor#vertex}.{@link GPUProgrammableStage#module | module}.
   */
  shaderLocation: GPUIndex32;
}

/**
 * The internal state of degl buffers
 */
export class DeGLBufferInternal {
  readonly #root: TgpuRoot;
  readonly #remapper: Remapper;

  #byteLength: number | undefined;
  #gpuBuffer: GPUBuffer | undefined;
  gpuBufferDirty = true;

  /**
   * Since this buffer can be bound to a vertex attribute using a format
   * that is not natively supported by WebGPU (e.g. unorm8x3), we allocate a
   * secondary buffer that holds the data remapped to match the expected format.
   *
   * This one remaps an 8x3 buffer into an 8x4 buffer.
   */
  #variant8x3to8x4: GPUBuffer | undefined;
  variant8x3to8x4Dirty = true;

  /**
   * If true, this buffer was bound as an index buffer at least once.
   */
  #boundAsIndexBuffer = false;

  /**
   * If true, this buffer was imported from an existing WebGPU buffer.
   */
  #imported = false;

  constructor(root: TgpuRoot, remapper: Remapper) {
    this.#root = root;
    this.#remapper = remapper;
  }

  get byteLength(): number | undefined {
    return this.#byteLength;
  }

  set byteLength(value: number) {
    if (value !== this.#byteLength) {
      this.#byteLength = value;
      this.gpuBufferDirty = true;
      this.variant8x3to8x4Dirty = true;
    }
  }

  set boundAsIndexBuffer(value: boolean) {
    if (this.#boundAsIndexBuffer) {
      return;
    }
    this.#boundAsIndexBuffer = value;
    this.gpuBufferDirty = true;
    this.variant8x3to8x4Dirty = true;
  }

  importExistingWebGPUBuffer(buffer: GPUBuffer) {
    if (this.#gpuBuffer === buffer) {
      return;
    }

    this.#imported = true;

    // Cleaning up old buffer, if it exists
    this.#gpuBuffer?.destroy();

    this.#gpuBuffer = buffer;
    this.byteLength = buffer.size;
    this.gpuBufferDirty = false;
    this.#boundAsIndexBuffer =
      buffer.usage & GPUBufferUsage.INDEX ? true : false;

    this.variant8x3to8x4Dirty = true;
  }

  get gpuBuffer(): GPUBuffer {
    if (!this.gpuBufferDirty) {
      return this.#gpuBuffer!;
    }
    this.gpuBufferDirty = false;

    if (this.#imported) {
      console.warn('Had to recreate imported buffer');
    } else {
      // Cleaning up old buffer, if it exists
      this.#gpuBuffer?.destroy();
    }

    this.#gpuBuffer = this.#root.device.createBuffer({
      label: 'DeGL Vertex Buffer',
      size: this.#byteLength!,
      usage:
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.VERTEX |
        GPUBufferUsage.STORAGE |
        (this.#boundAsIndexBuffer ? GPUBufferUsage.INDEX : 0),
    });

    return this.#gpuBuffer;
  }

  get variant8x3to8x4(): GPUBuffer {
    if (this.variant8x3to8x4Dirty) {
      const elements = Math.floor(this.#byteLength! / 3);
      // Recreate the variant buffer
      this.variant8x3to8x4Dirty = false;
      // Cleaning up old buffer, if it exists
      this.#variant8x3to8x4?.destroy();
      this.#variant8x3to8x4 = this.#root.device.createBuffer({
        label: 'DeGL Vertex Buffer (8x3 -> 8x4)',
        size: elements * 4,
        usage:
          GPUBufferUsage.COPY_DST |
          GPUBufferUsage.COPY_SRC |
          GPUBufferUsage.VERTEX |
          GPUBufferUsage.STORAGE,
      });
    }

    this.#remapper.remap8x3to8x4(this.gpuBuffer, this.#variant8x3to8x4!);
    return this.#variant8x3to8x4!;
  }

  destroy() {
    this.#gpuBuffer?.destroy();
    this.#variant8x3to8x4?.destroy();
  }
}

export class DeGLBuffer {
  readonly [$internal]: DeGLBufferInternal;

  constructor(root: TgpuRoot, remapper: Remapper) {
    this[$internal] = new DeGLBufferInternal(root, remapper);
  }
}
