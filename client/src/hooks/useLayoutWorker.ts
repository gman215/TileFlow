import { useEffect, useRef, useCallback } from 'react';
import type {
  WorkerRequest,
  WorkerResponse,
  Room,
  TileConfig,
  OptimizationConfig,
  AlignmentMode,
  Plan,
  DerivedFloors,
  LayoutResult,
} from '@tileflow/geometry';
import { toLayoutRoom, groupFrame } from '@tileflow/geometry';
import { useTileFlowStore } from '../store/tileFlowStore';
import { settingsOf } from '../store/planHelpers';

let requestCounter = 0;

/** The single-room pipeline's key; plan jobs are keyed by room or group id. */
const SINGLE = 'single';
const keyOf = (requestId: string) => requestId.slice(0, requestId.lastIndexOf('::'));

/**
 * One unit of layout work in a plan: a room on its own, or a pattern group.
 * `fingerprint` is everything that affects the result, so an edit dispatches
 * only the jobs whose inputs actually changed (008 AC-7.5).
 */
interface PlanJob {
  key: string;
  fingerprint: string;
  roomIds: string[];
  build: (requestId: string, fast: boolean) => WorkerRequest;
}

function planJobs(
  plan: Plan,
  derived: DerivedFloors,
  base: OptimizationConfig,
  roomLayouts: Record<string, LayoutResult>
): { jobs: PlanJob[]; idle: string[] } {
  const jobs: PlanJob[] = [];
  const idle: string[] = [];
  const grouped = new Set<string>();

  for (const g of plan.groups) {
    const members = g.roomIds
      .map((id) => {
        const room = plan.rooms.find((r) => r.id === id);
        const d = derived.rooms.get(id);
        const lr = room && d ? toLayoutRoom(d, room) : null;
        return lr ? { roomId: id, room: lr.room, origin: lr.origin } : null;
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
    g.roomIds.forEach((id) => grouped.add(id));
    g.roomIds.filter((id) => !members.some((m) => m.roomId === id)).forEach((id) => idle.push(id));
    const frame = groupFrame(plan, g, derived.rooms);
    if (members.length === 0 || !frame) continue;

    const optimizationConfig = { ...base, weights: g.weights };
    const inputs = { members, tileConfig: g.tileConfig, optimizationConfig, alignment: g.alignment, frame };
    jobs.push({
      key: `group:${g.id}`,
      fingerprint: JSON.stringify(inputs),
      roomIds: members.map((m) => m.roomId),
      build: (requestId, fast) => {
        const prev = roomLayouts[members[0].roomId];
        return {
          type: 'optimize-group',
          ...inputs,
          offset: fast && prev ? { x: prev.offsetX, y: prev.offsetY } : undefined,
          requestId,
        };
      },
    });
  }

  for (const room of plan.rooms) {
    if (grouped.has(room.id)) continue;
    const d = derived.rooms.get(room.id);
    const lr = d ? toLayoutRoom(d, room) : null;
    if (!lr) {
      idle.push(room.id);
      continue;
    }
    const s = settingsOf(plan, room);
    const optimizationConfig = { ...base, weights: s.weights };
    jobs.push({
      key: room.id,
      fingerprint: JSON.stringify([lr.room, s]),
      roomIds: [room.id],
      build: (requestId, fast) => {
        const prev = roomLayouts[room.id];
        return fast && prev
          ? {
              type: 'compute-layout',
              room: lr.room,
              tileConfig: s.tileConfig,
              optimizationConfig,
              offset: { x: prev.offsetX, y: prev.offsetY },
              requestId,
            }
          : {
              type: 'optimize',
              room: lr.room,
              tileConfig: s.tileConfig,
              optimizationConfig,
              alignment: s.alignment,
              requestId,
            };
      },
    });
  }

  return { jobs, idle };
}

/**
 * Hook that manages the layout Web Worker lifecycle.
 *
 * Automatically dispatches optimization requests when
 * room/tile/optimization config changes, with debouncing.
 */
export function useLayoutWorker() {
  const workerRef = useRef<Worker | null>(null);
  /** Latest request per job key; anything older is stale and dropped */
  const latestRequestIdRef = useRef<Map<string, string>>(new Map());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>();
  /** Plan mode: the inputs each job was last dispatched with */
  const fingerprintsRef = useRef<Map<string, string>>(new Map());

  const setLayout = useTileFlowStore((s) => s.setLayout);
  const setRoomLayouts = useTileFlowStore((s) => s.setRoomLayouts);
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
      const key = keyOf(response.requestId);
      if (latestRequestIdRef.current.get(key) !== response.requestId) return;
      latestRequestIdRef.current.delete(key);
      const settled = latestRequestIdRef.current.size === 0;

      if (response.type === 'error') {
        console.error('Layout worker failed:', response.message);
        // Forget the inputs so the next edit retries this job.
        fingerprintsRef.current.delete(key);
        if (settled) setIsComputing(false);
      } else if (response.type === 'group-result') {
        setRoomLayouts(
          Object.fromEntries(response.results.map((r) => [r.roomId, r.result])),
          response.computeTimeMs
        );
        if (!settled) setIsComputing(true);
      } else if (key === SINGLE) {
        setLayout(response.result, response.computeTimeMs);
      } else {
        setRoomLayouts({ [key]: response.result }, response.computeTimeMs);
        if (!settled) setIsComputing(true);
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
  }, [setLayout, setRoomLayouts, setIsComputing]);

  // Dispatch a computation request
  const dispatch = useCallback(
    (
      room: Room,
      tileConfig: TileConfig,
      optimizationConfig: OptimizationConfig,
      alignment: AlignmentMode
    ) => {
      if (!workerRef.current) return;

      const requestId = `${SINGLE}::${++requestCounter}`;
      latestRequestIdRef.current.set(SINGLE, requestId);
      setIsComputing(true);

      // While a corner is being dragged, keep the last offset and just re-clip
      // — the full search runs again the moment the drag ends.
      const { interacting, layout } = useTileFlowStore.getState();
      const request: WorkerRequest =
        interacting && layout
          ? {
              type: 'compute-layout',
              room,
              tileConfig,
              optimizationConfig,
              offset: { x: layout.offsetX, y: layout.offsetY },
              requestId,
            }
          : {
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

  /** Plan mode: dispatch every job whose inputs changed since last time. */
  const dispatchPlan = useCallback(() => {
    const worker = workerRef.current;
    const { plan, derived, interacting, optimizationConfig, roomLayouts } =
      useTileFlowStore.getState();
    if (!worker || !plan || !derived) return;

    const { jobs, idle } = planJobs(plan, derived, optimizationConfig, roomLayouts);
    const live = new Set(jobs.map((j) => j.key));

    // Rooms with nothing to tile (not enclosed, redundant) lose their layout.
    const cleared = Object.fromEntries(
      idle.filter((id) => id in roomLayouts).map((id) => [id, null])
    );
    if (Object.keys(cleared).length > 0) setRoomLayouts(cleared, 0);
    for (const key of [...fingerprintsRef.current.keys()]) {
      if (!live.has(key)) fingerprintsRef.current.delete(key);
    }

    let sent = 0;
    for (const job of jobs) {
      // Mid-drag results are provisional, so they never count as "done": the
      // fingerprint is only kept for a full search.
      const fp = `${job.fingerprint}|${interacting}`;
      if (fingerprintsRef.current.get(job.key) === fp) continue;
      fingerprintsRef.current.set(job.key, fp);
      const requestId = `${job.key}::${++requestCounter}`;
      latestRequestIdRef.current.set(job.key, requestId);
      worker.postMessage(job.build(requestId, interacting));
      sent++;
    }
    if (sent > 0) setIsComputing(true);
  }, [setIsComputing, setRoomLayouts]);

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

  // Drop any dispatch still queued when the hook goes away.
  useEffect(
    () => () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    },
    []
  );

  // Auto-recompute when store values change. `interacting` is included so
  // that letting go of a corner re-runs the full search.
  useEffect(() => {
    const unsub = useTileFlowStore.subscribe(
      (state) => ({
        room: state.room,
        tileConfig: state.tileConfig,
        optimizationConfig: state.optimizationConfig,
        alignment: state.alignment,
        interacting: state.interacting,
      }),
      ({ room, tileConfig, optimizationConfig, alignment, interacting }) => {
        // In a plan the per-room pipeline below owns the worker.
        if (useTileFlowStore.getState().plan) return;
        debouncedDispatch(
          room,
          tileConfig,
          optimizationConfig,
          alignment,
          interacting ? 40 : 150
        );
      },
      { equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) }
    );

    return unsub;
  }, [debouncedDispatch]);

  // Plan mode: re-dispatch changed rooms whenever the plan or its derivation
  // changes. Same debounce as the single-room path.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useTileFlowStore.subscribe(
      (state) => ({ plan: state.plan, derived: state.derived, interacting: state.interacting }),
      ({ plan, interacting }) => {
        if (!plan) {
          fingerprintsRef.current.clear();
          return;
        }
        if (timer) clearTimeout(timer);
        timer = setTimeout(dispatchPlan, interacting ? 40 : 150);
      },
      { equalityFn: (a, b) => a.plan === b.plan && a.derived === b.derived && a.interacting === b.interacting }
    );
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [dispatchPlan]);

  // Trigger initial computation
  useEffect(() => {
    const { room, tileConfig, optimizationConfig, alignment } =
      useTileFlowStore.getState();
    dispatch(room, tileConfig, optimizationConfig, alignment);
  }, [dispatch]);

  return { dispatch, debouncedDispatch };
}
