import tgpu from 'typegpu';
import * as d from 'typegpu/data';

export const layoutUint8 = tgpu.bindGroupLayout({
  input: { storage: d.arrayOf(d.u32) },
  output: { storage: d.arrayOf(d.u32) },
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

  const highU32 = layoutUint8.$.input[u32Start];
  const lowU32 = layoutUint8.$.input[u32Start + 1];

  const u32Offset = d.u32(inByteOffset % 4) * 8;

  const r = (highU32 >> (24 - u32Offset)) & 0xff;
  const g =
    ((highU32 >> (16 - u32Offset)) & 0xff) |
    ((lowU32 >> (32 + 16 - u32Offset)) & 0xff);
  const b =
    ((highU32 >> (8 - u32Offset)) & 0xff) |
    ((lowU32 >> (32 + 8 - u32Offset)) & 0xff);

  layoutUint8.$.output[gid.x] = (r << 24) | (g << 16) | (b << 8);
});
