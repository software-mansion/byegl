import * as byegl from 'byegl';
import type { ExampleContent } from '../../examples/index.ts';

export function getCurrentExampleFromUrl(): string | undefined {
  const url = new URL(window.location.href);
  const key = url.hash.replace(/^#/, '');

  if (key.length === 0) {
    return undefined;
  }

  return key;
}

let prevCleanup: (() => void) | undefined;
let prevGroundTruthCleanup: (() => void) | undefined;

export async function runExample(example: ExampleContent) {
  prevCleanup?.();
  prevCleanup = undefined;
  prevGroundTruthCleanup?.();
  prevGroundTruthCleanup = undefined;

  console.log('Running example: ', example.meta.name);

  const groundTruthCanvas = document.getElementById(
    'ground-truth-canvas',
  ) as HTMLCanvasElement;

  const canvas = document.getElementById('canvas') as HTMLCanvasElement;

  if (!example.meta.usesHooks) {
    // Only run ground-truth if the example does not use byegl hooks
    prevGroundTruthCleanup = await (await example.execute())({
      canvas: groundTruthCanvas,
    });
  }

  const disable = await byegl.enable();
  try {
    prevCleanup = await (await example.execute())({ canvas });
  } finally {
    disable();
  }
}
