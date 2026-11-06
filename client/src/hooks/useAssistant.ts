/**
 * The layout assistant's conversation loop (003 T6).
 *
 *   user message ─▶ route ─▶ calls? ─▶ run against the whitelist ─▶ results ─▶ route ─▶ …
 *
 * capped at four trips per message (AC-3.5), chained with the interaction id so
 * no earlier message is ever resent (AC-1.2), and abortable so an unmounted
 * panel stops talking to the network.
 *
 * The loop itself is `runConversation`, a plain function with its effects
 * injected; `useAssistant` is the React shell around it. That split is what
 * lets the round-trip cap be proven with a stub that never stops asking.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AssistantCallDTO,
  AssistantRequestDTO,
  AssistantResponseDTO,
  LayoutStatsDTO,
} from '@api/_lib/types';
import { ai, AiError, statsDto } from '../api/ai';
import { runToolCall, type ToolOutcome } from '../ai/tools';
import { useTileFlowStore } from '../store/tileFlowStore';

/**
 * Same figure as `ASSISTANT_MAX_ROUND_TRIPS` in `api/_lib/schemas.ts`. Not
 * imported: the client takes only types from `@api`. The server refuses a
 * fifth trip on its own, so the two caps back each other up rather than one
 * trusting the other.
 */
export const MAX_ROUND_TRIPS = 4;

/**
 * Longest one trip may take in the browser. The route gives up on the model at
 * 30 s and the platform at 60 s, but a request that never comes back must not
 * leave the panel spinning (Constitution IV), so the client has its own limit.
 */
const TRIP_TIMEOUT_MS = 45_000;

/** Longest the loop waits for the worker before reporting stats as provisional. */
const SETTLE_TIMEOUT_MS = 4000;

// ─── Waiting for the engine ───────────────────────────────────────────────────

/**
 * Everything the layout worker recomputes from — compared the way
 * `useLayoutWorker` compares it (JSON in single-room mode, the plan in plan
 * mode), so "inputs unchanged" here means "no recompute is coming" there.
 */
function layoutInputs(): string {
  const s = useTileFlowStore.getState();
  return s.plan
    ? JSON.stringify(s.plan)
    : JSON.stringify({ room: s.room, tileConfig: s.tileConfig, optimizationConfig: s.optimizationConfig, alignment: s.alignment });
}

/**
 * Resolve once the engine has caught up with the changes since `before`.
 *
 * Changes reach the canvas through the existing worker subscription, debounced
 * 150 ms (AC-5.4) — so straight after a tool runs, the store still holds the
 * old layout and `isComputing` may not even be set yet. Waiting for a *new*
 * layout and an idle worker is what makes `read_layout_stats` and the next
 * snapshot describe the layout the user is about to see, not the one they had.
 *
 * Resolves `false` on timeout rather than hanging: a worker that never answers
 * must not wedge the conversation (Constitution IV).
 */
export function waitForLayout(before: string, signal?: AbortSignal, timeoutMs = SETTLE_TIMEOUT_MS): Promise<boolean> {
  if (layoutInputs() === before) return Promise.resolve(true);

  const start = useTileFlowStore.getState();
  const startLayout = start.layout;
  const startRoomLayouts = start.roomLayouts;

  return new Promise((resolve, reject) => {
    const done = (value: boolean | Error) => {
      unsub();
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (value instanceof Error) reject(value);
      else resolve(value);
    };
    const check = () => {
      const s = useTileFlowStore.getState();
      const fresh = s.layout !== startLayout || s.roomLayouts !== startRoomLayouts;
      if (fresh && !s.isComputing) done(true);
    };
    const onAbort = () => done(new DOMException('Aborted', 'AbortError'));

    const unsub = useTileFlowStore.subscribe(check);
    const timer = setTimeout(() => done(false), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

// ─── The loop ─────────────────────────────────────────────────────────────────

export interface ConversationDeps {
  post: (body: AssistantRequestDTO, signal?: AbortSignal) => Promise<AssistantResponseDTO>;
  execute: (call: AssistantCallDTO) => ToolOutcome;
  /** The current snapshot, or null while there is no computed layout. */
  snapshot: () => LayoutStatsDTO | null;
  /** Fingerprint of the engine's inputs, and a wait for it to catch up. */
  inputs: () => string;
  settle: (before: string, signal?: AbortSignal) => Promise<boolean>;
  /**
   * Record the state "Undo AI change" restores. Returns a rollback that puts
   * the previous snapshot back, for a turn that turns out to change nothing.
   */
  capture: () => () => void;
}

export interface ConversationResult {
  reply: string;
  /** Every call run for this message, in order, across all trips. */
  outcomes: ToolOutcome[];
  trips: number;
  /** True when the cap stopped the loop with calls still requested. */
  capped: boolean;
  /** Calls requested on the last trip that were *not* run because of the cap. */
  skipped: AssistantCallDTO[];
  /** Calls to tools that do not exist: dropped server-side, or rejected here. */
  unsupported: number;
  /** Chain the next message with this; undefined starts a new conversation. */
  interactionId?: string;
  demoMode: boolean;
}

/** Thrown with whatever was applied before the failure, so it can still be shown. */
export class ConversationError extends Error {
  constructor(readonly cause: unknown, readonly outcomes: ToolOutcome[]) {
    super(cause instanceof Error ? cause.message : 'The assistant request failed.');
    this.name = 'ConversationError';
  }
}

const READ_ONLY = new Set(['read_layout_stats']);

/**
 * Run one batch: changes first, then — once the engine has caught up — reads.
 * Order within the results matches the order the model asked in, so each
 * result lines up with its call id regardless of when it ran.
 */
async function runBatch(calls: AssistantCallDTO[], deps: ConversationDeps, signal?: AbortSignal) {
  const before = deps.inputs();
  const out = new Map<AssistantCallDTO, ToolOutcome>();

  for (const c of calls) if (!READ_ONLY.has(c.name)) out.set(c, deps.execute(c));
  const settled = await deps.settle(before, signal);
  for (const c of calls) {
    if (!READ_ONLY.has(c.name)) continue;
    const o = deps.execute(c);
    // Said, not hidden: the model should not quote figures as final when the
    // engine had not finished with them (Constitution I).
    out.set(c, settled ? o : { ...o, result: { ...o.result, recomputing: true } });
  }
  return calls.map((c) => out.get(c)!);
}

export async function runConversation(
  message: string,
  previousInteractionId: string | undefined,
  deps: ConversationDeps,
  signal?: AbortSignal
): Promise<ConversationResult> {
  const outcomes: ToolOutcome[] = [];
  let unsupported = 0;
  /** Set once this turn has replaced the snapshot; undone if nothing applied. */
  let rollback: (() => void) | null = null;
  // Only a turn that actually changed something may own the undo. A turn whose
  // calls were all rejected must not replace the previous turn's snapshot —
  // "Undo AI change" would then restore the state *after* that turn.
  const releaseIfUnchanged = () => {
    if (rollback && !outcomes.some((o) => o.applied && !READ_ONLY.has(o.name))) rollback();
  };

  const snapshot = () => {
    const s = deps.snapshot();
    // No layout means no figures, and the route will not accept a request
    // without them — a model may not supply its own (Constitution I).
    if (!s) throw new AiError('bad_request', 'The layout is still being computed. Try again in a moment.');
    return s;
  };

  try {
    let res = await deps.post({ message, snapshot: snapshot(), previousInteractionId }, signal);
    let trip = 1;
    unsupported += res.unsupportedCalls ?? 0;

    while (res.calls.length > 0 && trip < MAX_ROUND_TRIPS && !res.demoMode) {
      // Once per message, before the first batch that can change anything:
      // "Undo AI change" then reverts the whole turn, however many trips it
      // took. Per trip, undo would only peel off the last one.
      if (!rollback && res.calls.some((c) => !READ_ONLY.has(c.name))) {
        rollback = deps.capture();
      }
      const batch = await runBatch(res.calls, deps, signal);
      outcomes.push(...batch);
      unsupported += batch.filter((o) => o.result.reason === 'unknown_tool').length;

      trip += 1;
      res = await deps.post(
        {
          results: batch.map((o) => ({ callId: o.callId, name: o.name, result: o.result })),
          snapshot: snapshot(),
          previousInteractionId: res.interactionId,
          roundTrip: trip,
        },
        signal
      );
      unsupported += res.unsupportedCalls ?? 0;
    }

    // Calls on the final permitted trip are left unrun: their results could
    // never be reported back, so the model could neither confirm nor correct
    // them, and the transcript would show changes nobody checked.
    const capped = res.calls.length > 0 && !res.demoMode;
    releaseIfUnchanged();
    return {
      reply: res.reply,
      outcomes,
      trips: trip,
      capped,
      skipped: capped ? res.calls : [],
      unsupported,
      // Demo mode has no interaction to continue; an empty id means start over.
      interactionId: res.interactionId || undefined,
      demoMode: Boolean(res.demoMode),
    };
  } catch (err) {
    releaseIfUnchanged();
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ConversationError(err, outcomes);
  }
}

// ─── The hook ─────────────────────────────────────────────────────────────────

export interface AssistantTurn {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /** Assistant turns only: what the calls did, for the chips (AC-5.1, AC-5.3). */
  outcomes?: ToolOutcome[];
  capped?: boolean;
  skipped?: number;
  unsupported?: number;
  demoMode?: boolean;
  /** Set when the request failed; `outcomes` still lists anything applied first. */
  error?: unknown;
}

const LIVE_DEPS: ConversationDeps = {
  // The caller's signal still aborts (unmount); the timeout is added to it. A
  // timeout surfaces as a network failure from `api/ai.ts`, which is how the
  // panel already explains "the server did not answer".
  post: (body, signal) => {
    const timeout = AbortSignal.timeout(TRIP_TIMEOUT_MS);
    return ai.assistant(body, signal ? AbortSignal.any([signal, timeout]) : timeout);
  },
  execute: runToolCall,
  snapshot: statsDto,
  inputs: layoutInputs,
  settle: waitForLayout,
  capture: () => {
    const previous = useTileFlowStore.getState().aiSnapshot;
    useTileFlowStore.getState().captureAiSnapshot();
    return () => useTileFlowStore.setState({ aiSnapshot: previous });
  },
};

/**
 * Conversation state lives here, in memory only: a reload starts a new
 * conversation (AC-1.3), and the panel says so.
 */
export function useAssistant() {
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const interactionRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(0);

  // Stop any in-flight trip when the panel goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(async (raw: string) => {
    const message = raw.trim();
    if (!message || abortRef.current) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setTurns((t) => [...t, { id: nextId.current++, role: 'user', text: message }]);

    try {
      const r = await runConversation(message, interactionRef.current, LIVE_DEPS, controller.signal);
      interactionRef.current = r.interactionId;
      setTurns((t) => [
        ...t,
        {
          id: nextId.current++,
          role: 'assistant',
          text: r.reply,
          outcomes: r.outcomes,
          capped: r.capped,
          skipped: r.skipped.length,
          unsupported: r.unsupported,
          demoMode: r.demoMode,
        },
      ]);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const outcomes = err instanceof ConversationError ? err.outcomes : [];
      const cause = err instanceof ConversationError ? err.cause : err;
      setTurns((t) => [
        ...t,
        { id: nextId.current++, role: 'assistant', text: '', outcomes, error: cause },
      ]);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }, []);

  /** Forget the conversation; the next message starts a new one. */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    interactionRef.current = undefined;
    setTurns([]);
    setBusy(false);
  }, []);

  return { turns, busy, send, reset };
}
