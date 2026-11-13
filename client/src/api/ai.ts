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

import type {
  AiHealthDTO,
  BriefFormattedDTO,
  BriefRequestDTO,
  EstimateDTO,
  EstimatePricesDTO,
  EstimateRequestDTO,
  AssistantRequestDTO,
  AssistantResponseDTO,
  LayoutStatsDTO,
  MeasurementSystem,
  RoomFromImageDTO,
  RoomFromImageRequestDTO,
} from '@api/_lib/types';
import { rectShape, summarizeShape, tileFaceArea, type PatternType } from '@tileflow/geometry';
// The sidebar's own label tables, so the brief says what the buttons say.
import { PATTERNS } from '../components/Controls/TilePanel';
import { ALIGNMENTS } from '../components/Controls/OptimizationPanel';
import { useTileFlowStore } from '../store/tileFlowStore';
import {
  formatArea,
  formatSmallArea,
  formatWaste,
  formatWithUnit,
  groutDisplay,
  roomDisplay,
  tileDisplay,
} from '../utils/measurements';

const BASE = '/api/ai';

// The order figure lives in `utils/order.ts` (pure, shared with the plan
// helpers); re-exported here where the AI code and older callers look for it.
export { ORDER_BUFFER, orderQuantity, layoutOrder } from '../utils/order';
import { layoutOrder } from '../utils/order';

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
  signal?: AbortSignal,
  /** Sees the response once headers arrive — e.g. a demo-mode flag — before any text. */
  onResponse?: (res: Response) => void
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
  onResponse?.(res);
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

/**
 * The layout anchor for people and models (011): which cut-out, by number and
 * size so an installer can tell it is "the tub", and which part of it — in the
 * user's units, formatted by the sidebar's helpers. Null when the layout is set
 * out from the room or its reference wall.
 *
 * `islandsBefore` — free-standing islands listed ahead of the drawn cut-outs
 * in a plan room's layout; defaults to the active room's (the set-out sheet
 * passes each room's own).
 */
export function describeAnchor(
  room: ReturnType<typeof useTileFlowStore.getState>['room'],
  sys: MeasurementSystem,
  islandsBefore?: number
): string | null {
  const a = room.shape?.anchor ?? room.anchor;
  if (!a) return null;
  const d = roomDisplay(sys);
  const len = (mm: number) => formatWithUnit(mm, d);
  if (a.kind === 'point') return 'a marked point on the floor';
  const st = useTileFlowStore.getState();
  // In a plan, the layout room lists free-standing islands before drawn cut-outs.
  const pr = st.plan && st.activeRoomId ? st.plan.rooms.find((r) => r.id === st.activeRoomId) : undefined;
  const islands =
    islandsBefore ?? (pr && st.activeRoomId ? (st.derived?.rooms.get(st.activeRoomId)?.holes.length ?? 0) - pr.holes.length : 0);
  const hole = room.shape?.holes[a.hole];
  if (!hole) return null;
  const xs = hole.vertices.map((v) => v.x), ys = hole.vertices.map((v) => v.y);
  const name = `cut-out ${a.hole - islands + 1} (${len(Math.max(...xs) - Math.min(...xs))} × ${len(Math.max(...ys) - Math.min(...ys))})`;
  if (a.kind === 'hole-centre') return `the centre of ${name}`;
  const p = hole.vertices[a.edge], q = hole.vertices[(a.edge + 1) % hole.vertices.length];
  const edge = `the edge ${len(Math.hypot(q.x - p.x, q.y - p.y))} long of ${name}`;
  return a.fullTilesFromEdge ? `${edge}, full tiles starting at that edge` : `the midpoint of ${edge}`;
}

/**
 * 004 — every figure the installation brief may state, as display strings in
 * the user's units (AC-1.1, AC-1.3).
 *
 * A pure function of the snapshot rather than a second read of the store: the
 * brief is formatted from exactly the `LayoutStatsDTO` sent with it, so the two
 * cannot describe different layouts. Figures the stats card also shows are
 * taken from the snapshot's `display` block, which the card's own helpers
 * produced — identical to the screen by construction, not by care (AC-1.5).
 */
export function formatForBrief(stats: LayoutStatsDTO): BriefFormattedDTO {
  const { system, room, tile, layout, display } = stats;
  return {
    roomArea: display.area,
    perimeter: formatWithUnit(room.perimeterMm, roomDisplay(system)),
    tileSize: display.tileSize,
    grout: display.grout,
    smallestCut: formatSmallArea(layout.smallestCutPieceMm2, system),
    waste: display.waste,
    orderQuantity: display.orderQuantity,
    fullCount: display.fullTiles,
    cutCount: display.cutTiles,
    totalCount: display.totalTiles,
    wallCount: String(room.wallCount),
    holeCount: String(room.holeCount),
    // Fall back to the raw value rather than throwing: a pattern added to the
    // engine before its label exists should still produce a brief.
    pattern: PATTERNS.find((p) => p.value === tile.pattern)?.label ?? tile.pattern,
    alignment: ALIGNMENTS.find((a) => a.value === tile.alignment)?.label ?? tile.alignment,
    referenceWall: room.referenceWall,
    anchor: room.anchor,
  };
}

/**
 * 004 — a smallest cut under a third of a tile: thin, fragile to cut and
 * obvious on the finished floor. Decided here from engine figures, never by
 * the model (AC-2.3). No cuts at all, or a zero-area "cut", is not a sliver.
 */
export function sliverRisk(stats: LayoutStatsDTO): boolean {
  const tileAreaMm2 = tileFaceArea({ width: stats.tile.widthMm, height: stats.tile.heightMm, pattern: stats.tile.pattern as PatternType });
  const smallest = stats.layout.smallestCutPieceMm2;
  return stats.layout.cutTileCount > 0 && smallest > 0 && smallest < tileAreaMm2 / 3;
}

/**
 * The whole brief request for the layout on screen, or null when there is
 * none to describe (AC-4.1) — the button is disabled in that case anyway.
 */
export function buildBriefRequest(): BriefRequestDTO | null {
  const stats = statsDto();
  if (!stats) return null;
  return {
    stats,
    formatted: formatForBrief(stats),
    sliverRisk: sliverRisk(stats),
    sliverThreshold: formatSmallArea(tileFaceArea({ width: stats.tile.widthMm, height: stats.tile.heightMm, pattern: stats.tile.pattern as PatternType }) / 3, stats.system),
    system: stats.system,
  };
}

/**
 * 005 — the estimate request for the layout on screen, or null without one.
 *
 * `engine` carries the two quantities the engine owns as plain numbers in the
 * user's units. The area uses exactly the stats card's rounding (`formatArea`),
 * so the area a line is echoed and overridden with is the area the user reads.
 */
export function buildEstimateRequest(prices: EstimatePricesDTO, currency: string): EstimateRequestDTO | null {
  const stats = statsDto();
  if (!stats) return null;
  const imperial = stats.system === 'imperial';
  return {
    stats,
    formatted: formatForBrief(stats),
    engine: {
      orderQuantity: stats.layout.orderQuantity,
      roomArea: Number(formatArea(stats.layout.roomAreaMm2, stats.system).split(' ')[0]),
      areaUnit: imperial ? 'ft²' : 'm²',
    },
    prices,
    currency,
    system: stats.system,
  };
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

  /**
   * 002 — read a floor plan or sketch into a proposed outline.
   *
   * Returns geometry and nothing else: the caller stores it as a *proposal*,
   * and every figure shown about it comes from the engine (Constitution I).
   *
   * Pass a signal — the panel aborts on unmount, and an aborted request
   * rethrows `AbortError` rather than an `AiError`, so the caller can tell
   * "we stopped this" from "this failed" (AC-5.2).
   */
  /**
   * 004 — stream an installation brief for `body`, chunk by chunk (AC-3.2).
   *
   * Aborting cancels the reader, so text stops at once and the server stops
   * spending tokens (AC-3.3); the iteration then simply ends — the caller tells
   * "we stopped this" from "this finished" by its own signal. A connection that
   * dies mid-brief throws from the iteration instead, with the text so far
   * already yielded (AC-3.4). `onDemo` fires before the first chunk when the
   * server sent its canned brief (AC-4.6).
   */
  brief: (body: BriefRequestDTO, signal?: AbortSignal, onDemo?: () => void): AsyncIterable<string> =>
    streamText('/brief', body, signal, (res) => {
      if (res.headers.get('X-Demo-Mode') === 'true') onDemo?.();
    }),

  /**
   * 005 — quantities and unit rates for the layout; never a total. The caller
   * re-validates the shape and does all the arithmetic (`client/src/ai/estimate.ts`).
   */
  estimate: (body: EstimateRequestDTO, signal?: AbortSignal) =>
    request<EstimateDTO>('/estimate', { method: 'POST', body: JSON.stringify(body), signal }),

  roomFromImage: (body: RoomFromImageRequestDTO, signal?: AbortSignal) =>
    request<RoomFromImageDTO>('/room-from-image', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),

  /**
   * 003 — one trip of the layout assistant: a user message, or the results of
   * the calls the previous trip asked for. The response's `calls` are requests,
   * not changes; nothing is applied until `client/src/ai/tools.ts` runs them.
   */
  assistant: (body: AssistantRequestDTO, signal?: AbortSignal) =>
    request<AssistantResponseDTO>('/assistant', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),
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
  // Per colour for a checkerboard, so the brief quotes the card's figure.
  const orderQty = layoutOrder(layout);
  const sys = system as MeasurementSystem;
  const room_ = roomDisplay(sys);
  const tile_ = tileDisplay(sys);

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
      // The wall table's label, never the raw index — see the DTO.
      referenceWall: room.shape?.referenceWall != null ? `W${room.shape.referenceWall + 1}` : null,
      anchor: describeAnchor(room, sys),
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
      orderQuantity: orderQty,
    },
    // Formatted exactly as the sidebar and stats card format them, by the same
    // helpers — the strings a model is allowed to say out loud.
    display: {
      roomSize: `${formatWithUnit(room.width, room_)} × ${formatWithUnit(room.height, room_)}`,
      area: formatArea(layout.roomArea, sys),
      tileSize: `${formatWithUnit(tileConfig.width, tile_)} × ${formatWithUnit(tileConfig.height, tile_)}`,
      grout: formatWithUnit(tileConfig.grout, groutDisplay(sys)),
      orderQuantity: String(orderQty),
      waste: formatWaste(layout.wastePercentage),
      fullTiles: String(layout.fullTileCount),
      cutTiles: String(layout.cutTileCount),
      totalTiles: String(totalTiles),
    },
  };
}
