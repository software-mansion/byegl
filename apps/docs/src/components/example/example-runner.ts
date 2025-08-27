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

export async function runExample(example: ExampleContent) {
  prevCleanup?.();
  prevCleanup = undefined;
  prevGroundTruthCleanup?.();
  prevGroundTruthCleanup = undefined;

  console.log('Running example: ', example.meta.name);

  const groundTruthCanvas = document.querySelector<HTMLCanvasElement>(
    '#ground-truth-canvas',
  );
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  const traceLog = document.querySelector<HTMLTextAreaElement>('#trace-log');
  if (!groundTruthCanvas || !canvas || !traceLog) {
    throw new Error('Malformed UI');
  }

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
