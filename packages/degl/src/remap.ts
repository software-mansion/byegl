import tgpu, { TgpuComputePipeline, TgpuRoot } from 'typegpu';
import * as d from 'typegpu/data';

const layout = tgpu.bindGroupLayout({
  input: { storage: d.arrayOf(d.u32) },
  output: { storage: d.arrayOf(d.u32), access: 'mutable' },
});

/**
 * Remaps 8x3 to 8x4. Expects a thread to handle a single u32 (8x4) element of the output.
 */
const remap8x3to8x4Shader = tgpu['~unstable'].computeFn({
  workgroupSize: [1],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  // At which offset should we start reading the input array (in bytes).
  const inByteOffset = gid.x * 3;
  const u32Start = d.u32(inByteOffset / 4);
  const u32Offset = d.u32(inByteOffset % 4);

  const highU32 = layout.$.input[u32Start];

  let r = d.u32(0);
  let g = d.u32(0);
  let b = d.u32(0);

  let lowU32 = d.u32(0);
  if (u32Start + 1 < layout.$.input.length) {
    lowU32 = layout.$.input[u32Start + 1];
  }

  if (u32Offset === 0) {
    r = highU32 & 0xff;
    g = (highU32 >> 8) & 0xff;
    b = (highU32 >> 16) & 0xff;
  } else if (u32Offset === 1) {
    r = (highU32 >> 8) & 0xff;
    g = (highU32 >> 16) & 0xff;
    b = (highU32 >> 24) & 0xff;
  } else if (u32Offset === 2) {
    r = (highU32 >> 16) & 0xff;
    g = (highU32 >> 24) & 0xff;
    b = lowU32 & 0xff;
  } else if (u32Offset === 3) {
    r = (highU32 >> 24) & 0xff;
    g = lowU32 & 0xff;
    b = (lowU32 >> 8) & 0xff;
  }

  layout.$.output[gid.x] = r | (g << 8) | (b << 16);
});

export class Remapper {
  #pipeline8x3to8x4Cache: TgpuComputePipeline | undefined;

  constructor(readonly root: TgpuRoot) {}

  get #pipeline8x3to8x4() {
    if (!this.#pipeline8x3to8x4Cache) {
      this.#pipeline8x3to8x4Cache = this.root['~unstable']
        .withCompute(remap8x3to8x4Shader)
        .createPipeline();
    }
    return this.#pipeline8x3to8x4Cache;
  }

  remap8x3to8x4(input: GPUBuffer, output: GPUBuffer): void {
    const elements = input.size / 3; // 3 bytes per element (e.g. unorm8x3)

    const bindGroup = this.root.createBindGroup(layout, {
      input,
      output,
    });

    this.#pipeline8x3to8x4.with(layout, bindGroup).dispatchWorkgroups(elements);
  }
}
