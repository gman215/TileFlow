/**
 * Layout Web Worker — runs inside Vite's worker pipeline.
 *
 * Import paths resolve through Vite aliases, so we can use
 * the geometry package directly.
 */

/// <reference lib="webworker" />

import {
  type WorkerRequest,
  type WorkerResponse,
  computeLayout,
  optimize,
} from '@tileflow/geometry';

declare const self: DedicatedWorkerGlobalScope;
const ctx = self;

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const start = performance.now();

  try {
    switch (request.type) {
      case 'compute-layout': {
        const result = computeLayout(
          request.room,
          request.tileConfig,
          0,
          0,
          request.optimizationConfig.weights
        );
        const elapsed = performance.now() - start;

        const response: WorkerResponse = {
          type: 'layout-result',
          result,
          requestId: request.requestId,
          computeTimeMs: elapsed,
        };
        ctx.postMessage(response);
        break;
      }

      case 'optimize': {
        const { bestLayout, candidatesEvaluated } = optimize(
          request.room,
          request.tileConfig,
          request.optimizationConfig
        );
        const elapsed = performance.now() - start;

        const response: WorkerResponse = {
          type: 'optimize-result',
          result: bestLayout,
          requestId: request.requestId,
          computeTimeMs: elapsed,
          candidatesEvaluated,
        };
        ctx.postMessage(response);
        break;
      }
    }
  } catch (err) {
    console.error('Worker error:', err);
  }
});
