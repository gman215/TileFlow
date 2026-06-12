import { useEffect, useRef, useCallback } from 'react';
import type {
  WorkerRequest,
  WorkerResponse,
  Room,
  TileConfig,
  OptimizationConfig,
  AlignmentMode,
} from '@tileflow/geometry';
import { useTileFlowStore } from '../store/tileFlowStore';

let requestCounter = 0;

/**
 * Hook that manages the layout Web Worker lifecycle.
 *
 * Automatically dispatches optimization requests when
 * room/tile/optimization config changes, with debouncing.
 */
export function useLayoutWorker() {
  const workerRef = useRef<Worker | null>(null);
  const latestRequestIdRef = useRef<string>('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const setLayout = useTileFlowStore((s) => s.setLayout);
  const setIsComputing = useTileFlowStore((s) => s.setIsComputing);

  // Initialize worker
  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/layout.worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;

      // Ignore stale responses
      if (response.requestId !== latestRequestIdRef.current) return;

      if (response.type === 'layout-result' || response.type === 'optimize-result') {
        setLayout(response.result, response.computeTimeMs);
      }
    });

    worker.addEventListener('error', (err) => {
      console.error('Layout worker error:', err);
      setIsComputing(false);
    });

    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [setLayout, setIsComputing]);

  // Dispatch a computation request
  const dispatch = useCallback(
    (
      room: Room,
      tileConfig: TileConfig,
      optimizationConfig: OptimizationConfig,
      alignment: AlignmentMode
    ) => {
      if (!workerRef.current) return;

      const requestId = `req_${++requestCounter}`;
      latestRequestIdRef.current = requestId;
      setIsComputing(true);

      const request: WorkerRequest = {
        type: 'optimize',
        room,
        tileConfig,
        optimizationConfig,
        alignment,
        requestId,
      };

      workerRef.current.postMessage(request);
    },
    [setIsComputing]
  );

  // Debounced dispatch — called when config changes
  const debouncedDispatch = useCallback(
    (
      room: Room,
      tileConfig: TileConfig,
      optimizationConfig: OptimizationConfig,
      alignment: AlignmentMode,
      delay = 100
    ) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        dispatch(room, tileConfig, optimizationConfig, alignment);
      }, delay);
    },
    [dispatch]
  );

  // Auto-recompute when store values change
  useEffect(() => {
    const unsub = useTileFlowStore.subscribe(
      (state) => ({
        room: state.room,
        tileConfig: state.tileConfig,
        optimizationConfig: state.optimizationConfig,
        alignment: state.alignment,
      }),
      ({ room, tileConfig, optimizationConfig, alignment }) => {
        debouncedDispatch(room, tileConfig, optimizationConfig, alignment, 150);
      },
      { equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) }
    );

    return unsub;
  }, [debouncedDispatch]);

  // Trigger initial computation
  useEffect(() => {
    const { room, tileConfig, optimizationConfig, alignment } =
      useTileFlowStore.getState();
    dispatch(room, tileConfig, optimizationConfig, alignment);
  }, [dispatch]);

  return { dispatch, debouncedDispatch };
}
