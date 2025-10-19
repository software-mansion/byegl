import * as byegl from 'byegl';
import { isDeepEqual } from 'remeda';
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

function recreateCanvas(id: string): HTMLCanvasElement {
  const existingCanvas = document.querySelector<HTMLCanvasElement>(`#${id}`);
  const parentElement = existingCanvas?.parentElement;
  if (existingCanvas && parentElement) {
    const newCanvas = document.createElement('canvas');
    newCanvas.width = 1024;
    newCanvas.height = 1024;
    newCanvas.id = id;
    newCanvas.className = existingCanvas.className;
    parentElement.replaceChild(newCanvas, existingCanvas);
    return newCanvas;
  }
  throw new Error(`Canvas with id ${id} not found`);
}

export async function runExample(example: ExampleContent) {
  prevCleanup?.();
  prevCleanup = undefined;
  prevGroundTruthCleanup?.();
  prevGroundTruthCleanup = undefined;

  console.log('Running example: ', example.meta.name);

  const traceLog = document.querySelector<HTMLTextAreaElement>('#trace-log');
  if (!traceLog) {
    throw new Error('#trace-log element not found');
  }

  // Recreate canvases to ensure clean WebGL state
  const groundTruthCanvas = recreateCanvas('ground-truth-canvas');
  const canvas = recreateCanvas('canvas');

  // Cleaning the trace log
  traceLog.textContent = '';

  const groundTruthTrace: unknown[] = [];
  const trace: unknown[] = [];

  if (!example.meta.usesHooks) {
    // Only run ground-truth if the example does not use byegl hooks
    prevGroundTruthCleanup = await (await example.execute())({
      canvas: groundTruthCanvas,
      trace(...values) {
        groundTruthTrace.push(...values);
      },
    });
  }

  const disable = await byegl.enable();
  try {
    prevCleanup = await (await example.execute())({
      canvas,
      trace(...values) {
        trace.push(...values);
      },
    });
  } finally {
    disable();
  }

  // Compare both traces and display discrepancies
  if (groundTruthTrace.length > 0) {
    if (groundTruthTrace.length !== trace.length) {
      traceLog.textContent += `Trace lengths differ: ground truth ${groundTruthTrace.length}, byegl ${trace.length}\n`;
    } else {
      for (let i = 0; i < trace.length; i++) {
        if (!isDeepEqual(groundTruthTrace[i], trace[i])) {
          traceLog.textContent += `Discrepancy at index ${i}:
webgl: ${JSON.stringify(groundTruthTrace[i])}
byegl: ${JSON.stringify(trace[i])}\n`;
          break;
        }
      }
    }
  }
}
