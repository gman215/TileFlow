/**
 * Client access layer for /api/ai/*.
 *
 * Mirrors the structure of `client/src/api/client.ts`. Two rules apply here that
 * do not apply to the rest of the client:
 *
 * 1. **Type-only imports from `@api`.** The DTOs are shared so the two sides
 *    cannot drift, but `api/` is server code holding the key-bearing modules.
 *    Type imports are erased at compile time; a value import would bundle
 *    `@google/genai` and the key-reading path into the browser. Note that
 *    `@api/*` is a `tsconfig` path only — it is deliberately absent from Vite's
 *    `resolve.alias`, so a value import fails loudly at build instead of
 *    silently succeeding.
 *
 * 2. **`statsDto()` is the single mapping from store state to what a model
 *    sees.** All four features send this shape, so they cannot disagree about
 *    what the layout is.
 */

import type { AiHealthDTO, LayoutStatsDTO, MeasurementSystem } from '@api/_lib/types';
import { rectShape, summarizeShape } from '@tileflow/geometry';
import { useTileFlowStore } from '../store/tileFlowStore';

const BASE = '/api/ai';

/**
 * The order buffer shown on the stats card. Exported so the figure the user
 * reads and the figure a model is told are the same number — if these drifted,
 * the installation brief would quote a different order quantity than the UI.
 */
export const ORDER_BUFFER = 1.1;

// ─── Errors ───────────────────────────────────────────────────────────────────

/** The server's stable `code`, so callers can tell "retry" from "never works". */
export type AiErrorCode =
  | 'bad_request' | 'too_large' | 'rate_limited'
  | 'upstream' | 'config' | 'internal' | 'network';

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** True when waiting and trying again could plausibly work. */
export function isRetryable(err: unknown): boolean {
  return err instanceof AiError && ['rate_limited', 'upstream', 'network'].includes(err.code);
}

async function toAiError(res: Response): Promise<AiError> {
  const retryAfter = Number(res.headers.get('Retry-After'));
  let code: AiErrorCode = 'internal';
  let message = res.statusText || 'Request failed';
  try {
    const body = await res.json();
    if (typeof body?.code === 'string') code = body.code as AiErrorCode;
    if (typeof body?.error === 'string') message = body.error;
  } catch {
    // Non-JSON error body — keep the status text.
  }
  return new AiError(code, message, res.status, Number.isFinite(retryAfter) ? retryAfter : undefined);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch (err) {
    // An aborted request is the caller unmounting, not a failure to report.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new AiError('network', 'Could not reach the server.');
  }
  if (!res.ok) throw await toAiError(res);
  return res.json() as Promise<T>;
}

// ─── Streaming ────────────────────────────────────────────────────────────────

/**
 * Read a streaming text route chunk by chunk. Used by 004's brief.
 *
 * Cancels the reader on abort so closing the panel stops the stream rather than
 * leaving it draining in the background.
 */
export async function* streamText(
  path: string,
  body: unknown,
  signal?: AbortSignal
): AsyncGenerator<string> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new AiError('network', 'Could not reach the server.');
  }

  if (!res.ok) throw await toAiError(res);
  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) yield text;
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────
//
// Feature routes are added by the spec that owns each:
//   002-photo-to-room     roomFromImage()
//   003-layout-assistant  assistant()
//   004-installation-brief brief()   — uses streamText()
//   005-cost-estimator    estimate()

export const ai = {
  health: (signal?: AbortSignal) => request<AiHealthDTO>('/health', { method: 'GET', signal }),
};

// ─── Store → DTO ──────────────────────────────────────────────────────────────

/**
 * Everything a model is allowed to know about the current layout.
 *
 * Returns null when there is no computed layout: without one there are no
 * figures to ground on, and Constitution I says a model may not supply them.
 */
export function statsDto(): LayoutStatsDTO | null {
  const { room, tileConfig, alignment, layout, system } = useTileFlowStore.getState();
  if (!layout) return null;

  const summary = summarizeShape(room.shape ?? rectShape(room.width, room.height));
  const totalTiles = layout.fullTileCount + layout.cutTileCount;

  return {
    system: system as MeasurementSystem,
    room: {
      widthMm: room.width,
      heightMm: room.height,
      // The engine's own figure — cut-outs already excluded.
      areaMm2: layout.roomArea,
      perimeterMm: summary.perimeter,
      wallCount: summary.wallCount,
      holeCount: summary.holeCount,
      referenceWall: room.shape?.referenceWall ?? null,
      isDrawn: Boolean(room.shape),
    },
    tile: {
      widthMm: tileConfig.width,
      heightMm: tileConfig.height,
      groutMm: tileConfig.grout,
      pattern: tileConfig.pattern,
      alignment,
    },
    layout: {
      fullTileCount: layout.fullTileCount,
      cutTileCount: layout.cutTileCount,
      totalTiles,
      wastePercentage: layout.wastePercentage,
      smallestCutPieceMm2: layout.smallestCutPiece,
      roomAreaMm2: layout.roomArea,
      orderQuantity: Math.ceil(totalTiles * ORDER_BUFFER),
    },
  };
}
