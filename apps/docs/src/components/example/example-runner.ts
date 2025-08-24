import * as degl from 'degl';
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
  prevGroundTruthCleanup?.();

  console.log('Running example: ', example.meta.name);

  const groundTruthCanvas = document.getElementById(
    'ground-truth-canvas',
  ) as HTMLCanvasElement;

  const canvas = document.getElementById('canvas') as HTMLCanvasElement;

  prevGroundTruthCleanup = await example.execute(groundTruthCanvas);

  const disable = await degl.enable();
  try {
    prevCleanup = await example.execute(canvas);
  } finally {
    disable();
  }
}
