import tgpu, { TgpuRoot } from 'typegpu';
import * as d from 'typegpu/data';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Remapper } from '../src/remap.ts';

describe('remap8x3to8x4', () => {
  let root: TgpuRoot;
  let remapper: Remapper;

  beforeAll(async () => {
    root = await tgpu.init();
    remapper = new Remapper(root);
  });

  afterAll(() => {
    root.destroy();
  });

  it('should work', async () => {
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

    const buffer4 = root.createBuffer(d.arrayOf(d.u32, 3)).$usage('storage');

    remapper.remap8x3to8x4(root.unwrap(buffer3), root.unwrap(buffer4));

    // Reinterpreting the buffer as an array of bytes
    const uint8ResultBuffer = root.createBuffer(
      d.disarrayOf(d.uint8, 4 * 3),
      root.unwrap(buffer4),
    );

    const result = await uint8ResultBuffer.read();
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
