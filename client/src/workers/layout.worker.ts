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
  computeAlignmentOffset,
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
          request.offset?.x ?? 0,
          request.offset?.y ?? 0,
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
        const alignment = request.alignment ?? 'optimize';

        let result;
        let candidatesEvaluated;

        if (alignment === 'optimize') {
          const optimized = optimize(
            request.room,
            request.tileConfig,
            request.optimizationConfig
          );
          result = optimized.bestLayout;
          candidatesEvaluated = optimized.candidatesEvaluated;
        } else {
          // Fixed alignment — position the grid deterministically, no search.
          const { offsetX, offsetY } = computeAlignmentOffset(
            request.room,
            request.tileConfig,
            alignment
          );
          result = computeLayout(
            request.room,
            request.tileConfig,
            offsetX,
            offsetY,
            request.optimizationConfig.weights
          );
          candidatesEvaluated = 1;
        }

        const elapsed = performance.now() - start;

        const response: WorkerResponse = {
          type: 'optimize-result',
          result,
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
