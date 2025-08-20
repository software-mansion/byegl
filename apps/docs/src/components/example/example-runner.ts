import * as glOnWgpu from 'webgl-on-webgpu';
import type { ExampleContent } from '../../examples/index.ts';

export function getCurrentExampleFromUrl(): string | undefined {
  const url = new URL(window.location.href);
  const key = url.hash.replace(/^#/, '');

  if (key.length === 0) {
    return undefined;
  }

  return key;
}

export function runExample(example: ExampleContent) {
  console.log('Running example: ', example.meta.name);

  const groundTruthCanvas = document.getElementById(
    'ground-truth-canvas',
  ) as HTMLCanvasElement;

  const canvas = document.getElementById('canvas') as HTMLCanvasElement;

  example.execute(groundTruthCanvas);

  try {
    glOnWgpu.enable();
    example.execute(canvas);
  } finally {
    glOnWgpu.disable();
  }
}
