import tgpu from 'typegpu';
import * as d from 'typegpu/data';
import { describe, expect, it } from 'vitest';
import { layoutUint8, remapUint8_3to4 } from '../src/webgl/remap.ts';

describe('remapUint8_3to4', () => {
  it('should work', async () => {
    const root = await tgpu.init();

    const buffer3 = root
      .createBuffer(
        d.disarrayOf(
          d.uint8,
          12 /* has to be a multiple of 4, normally would be 9 */,
        ),
        [
          // uint8x3
          1, 2, 3,
          // uint8x3
          4, 5, 6,
          // uint8x3
          7, 8, 9,
        ],
      )
      .$usage('vertex')
      .$addFlags(GPUBufferUsage.STORAGE);

    const storageBuffer3 = root
      .createBuffer(d.arrayOf(d.u32, 3), root.unwrap(buffer3))
      .$usage('storage');

    const storageBuffer4 = root
      .createBuffer(d.arrayOf(d.u32, 3))
      .$usage('storage');

    const buffer4 = root.createBuffer(
      d.disarrayOf(d.uint8, 4 * 3),
      root.unwrap(storageBuffer4),
    );

    const bindGroup = root.createBindGroup(layoutUint8, {
      input: storageBuffer3,
      output: storageBuffer4,
    });

    const pipeline = root['~unstable']
      .withCompute(remapUint8_3to4)
      .createPipeline()
      // ---
      .with(layoutUint8, bindGroup);

    pipeline.dispatchWorkgroups(3);

    const result = await buffer4.read();
    expect(result).toStrictEqual([
      // uint8x4
      1, 2, 3, 0,
      // uint8x4
      4, 5, 6, 0,
      // uint8x4
      7, 8, 9, 0,
    ]);
  });
});
