import tgpu from 'typegpu';
import * as d from 'typegpu/data';

export const layoutUint8 = tgpu.bindGroupLayout({
  input: { storage: d.arrayOf(d.u32) },
  output: { storage: d.arrayOf(d.u32), access: 'mutable' },
});

/**
 * Remaps uint8x3 to uint8x4. Expects a thread to handle a single u32 (uint8x4) element
 * of the output.
 */
export const remapUint8_3to4 = tgpu['~unstable'].computeFn({
  workgroupSize: [1],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  // At which offset should we start reading the input array (in bytes).
  const inByteOffset = gid.x * 3;
  const u32Start = d.u32(inByteOffset / 4);
  const u32Offset = d.u32(inByteOffset % 4);

  const highU32 = layoutUint8.$.input[u32Start];

  let r = 0;
  let g = 0;
  let b = 0;

  let lowU32 = 0;
  if (u32Start + 1 < layoutUint8.$.input.length) {
    lowU32 = layoutUint8.$.input[u32Start + 1];
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

  layoutUint8.$.output[gid.x] = r | (g << 8) | (b << 16);
});
