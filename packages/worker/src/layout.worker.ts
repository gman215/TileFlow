/**
 * TileFlow Layout Web Worker
 *
 * Runs the geometry engine off the main thread.
 * Receives WorkerRequest messages, computes layouts, and posts
 * WorkerResponse messages back.
 */

import {
  WorkerRequest,
  WorkerResponse,
  computeLayout,
  optimize,
} from '@tileflow/geometry';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const start = performance.now();

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
});

// Signal that worker is ready
ctx.postMessage({ type: 'ready' });
