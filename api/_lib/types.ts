/**
 * Shared request/response shapes for the /api/ai/* handlers.
 *
 * Deliberately duplicated from `@tileflow/geometry` rather than imported.
 * These handlers need no geometry at runtime — the client sends figures the
 * engine already computed, and applies whatever comes back — so keeping the
 * workspace package out of the function bundle avoids a TypeScript-resolution
 * failure mode in the Vercel builder (the package's `main` points at raw `.ts`
 * source). The boundary is total: no type import either, so it cannot drift
 * into a value import later.
 *
 * This file is types only. It emits nothing.
 */

export type MeasurementSystem = 'metric' | 'imperial';

/** Present and true when a response is canned because the daily budget is spent. */
export interface DemoFlagged {
  demoMode?: true;
}

// ─── The grounding payload ────────────────────────────────────────────────────

/**
 * Everything a model is allowed to know about the current layout — and, by
 * Constitution I, every number it is allowed to state.
 *
 * All lengths are millimetres and all areas square millimetres, matching the
 * store's internal units. `client/src/api/ai.ts` owns the single mapping from
 * store state to this shape, so the four features cannot drift in what they
 * report.
 */
export interface LayoutStatsDTO {
  system: MeasurementSystem;

  room: {
    /** Bounding-box width when an outline is drawn. */
    widthMm: number;
    heightMm: number;
    /** True floor area — cut-outs already excluded. */
    areaMm2: number;
    perimeterMm: number;
    wallCount: number;
    /** Cut-outs (islands, columns, tubs) that are not tiled. */
    holeCount: number;
    /**
     * The wall the layout is squared to, by its label in the wall table
     * ("W3"), or null. A label, not an index: this shape is what a model
     * reads, and a model told "index 2" names it to the user as "wall 2" —
     * which on screen is W2, a different wall.
     */
    referenceWall: string | null;
    /**
     * What a fixed layout is set out from when it is a feature (011), described
     * for people: "the edge 1.60 m long of cut-out 1 (1.60 × 0.80 m), full tiles
     * starting at that edge". Null = the room centre, or the reference wall.
     */
    anchor: string | null;
    /** False when the room is still a plain W × H rectangle. */
    isDrawn: boolean;
  };

  tile: {
    widthMm: number;
    heightMm: number;
    groutMm: number;
    /** The `PatternType` value, e.g. `offset-1/2` — not the UI's display label. */
    pattern: string;
    /** The `AlignmentMode` value, e.g. `center-tile`. */
    alignment: string;
  };

  layout: {
    fullTileCount: number;
    cutTileCount: number;
    totalTiles: number;
    wastePercentage: number;
    /** Area of the smallest cut piece; 0 when nothing was cut. */
    smallestCutPieceMm2: number;
    roomAreaMm2: number;
    /** Tiles to buy, including the 10% buffer — what StatsPanel shows. */
    orderQuantity: number;
  };

  /**
   * The figures above as the user sees them on screen, in their units —
   * formatted by the same helpers as the sidebar and the stats card, so a
   * model that quotes one quotes exactly what is displayed (Constitution I).
   * The raw fields are for code; these are for saying.
   */
  display: {
    /** "12 ft 0 in × 10 ft 0 in" / "3.66 m × 3.05 m" — the bounding box when drawn. */
    roomSize: string;
    /** "120.0 ft²" / "11.15 m²" — the stats card's Area. */
    area: string;
    /** "12 in × 24 in" / "30 cm × 60 cm" */
    tileSize: string;
    /** "1/8 in" / "3 mm" */
    grout: string;
    /** The stats card's hero figures and counts. */
    orderQuantity: string;
    waste: string;
    fullTiles: string;
    cutTiles: string;
    totalTiles: string;
  };
}

// ─── 002 · room-from-image ────────────────────────────────────────────────────

/** Image formats the route accepts. The client re-encodes to JPEG before sending. */
export type RoomImageMimeType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/heic'
  | 'image/heif';

/** Request body for `POST /api/ai/room-from-image`. */
export interface RoomFromImageRequestDTO {
  /** Bare base64 — no `data:` URI prefix. */
  imageBase64: string;
  mimeType: RoomImageMimeType;
  /** Only affects how `notes` is phrased; coordinates are always millimetres. */
  system: MeasurementSystem;
  /** Optional user hint, ≤300 characters ("the long wall is 14 ft"). */
  note?: string;
}

/** A point in room space. Millimetres, origin top-left, x right, y down. */
export interface PointDTO {
  x: number;
  y: number;
}

/**
 * `POST /api/ai/room-from-image`. Geometry only — the model proposes an
 * outline, and every figure derived from it (area, perimeter, tile count) comes
 * from the engine once the user applies it (Constitution I).
 *
 * `api/_lib/schemas.ts` holds the Zod mirror that produces this shape, and
 * proves at compile time that the two agree.
 */
export interface RoomFromImageDTO extends DemoFlagged {
  /** Outline, clockwise, ≥3 and ≤60 points. */
  boundary: PointDTO[];
  /** Untiled cut-outs — islands, columns, stair openings. */
  holes: PointDTO[][];
  /** 0..1. Exactly 0 means "this is not a floor plan"; no proposal is offered. */
  confidence: number;
  /** What the model read, and which labels or assumptions produced the scale. */
  notes: string;
  /** The units printed on the drawing, not the units of this response. */
  detectedSystem: 'metric' | 'imperial' | 'unknown';
}

// ─── 005 · cost estimator ─────────────────────────────────────────────────────

/** Which user price a line is costed with; `other` keeps the model's placeholder. */
export type EstimateCategory = 'tile' | 'adhesive' | 'grout' | 'labour' | 'other';

/**
 * Unit prices the user typed. Session-only, never persisted (AC-3.4). `null`
 * means "no price given": the model supplies a placeholder and says so.
 * Adhesive and grout are per kg (metric) or per lb (imperial); tile is per tile
 * or per ft² / m² as `tileUnit` says; labour is per hour.
 */
export interface EstimatePricesDTO {
  tile: number | null;
  tileUnit: 'tile' | 'area';
  adhesive: number | null;
  grout: number | null;
  labour: number | null;
}

/** `POST /api/ai/estimate`. */
export interface EstimateRequestDTO {
  stats: LayoutStatsDTO;
  /** Display strings for the model to read: area, perimeter, tile, grout, pattern… */
  formatted: BriefFormattedDTO;
  /**
   * The two engine quantities the model must echo, as plain numbers in the
   * user's units — they are overridden client-side whatever comes back (AC-1.1,
   * AC-1.2), but a model that sees the right number usually returns it.
   */
  engine: { orderQuantity: number; roomArea: number; areaUnit: 'ft²' | 'm²' };
  prices: EstimatePricesDTO;
  /** A display symbol only. Nothing is ever converted (AC-2.4). */
  currency: string;
  system: MeasurementSystem;
}

/** One line as the model returns it. There is no subtotal: the client computes it (AC-2.1). */
export interface EstimateLineDTO {
  item: string;
  category: EstimateCategory;
  quantity: number;
  unit: string;
  unitCost: number;
  /** The coverage rate or rule used. An empty basis drops the line client-side (AC-1.5). */
  basis: string;
  source: 'engine' | 'estimated';
}

/** `POST /api/ai/estimate` response. Deliberately no `total` (AC-2.3). */
export interface EstimateDTO extends DemoFlagged {
  lineItems: EstimateLineDTO[];
  assumptions: string[];
  confidence: number;
  notes: string;
}

// ─── 004 · installation brief ─────────────────────────────────────────────────

/**
 * Every figure the brief may state, already formatted in the user's units —
 * the model is handed "8.4%", never 8.4237 and a unit flag, so it has nothing
 * to convert and no reason to compute (Constitution I, 004 AC-1.3).
 *
 * Built by `formatForBrief()` from the same `LayoutStatsDTO` sent alongside it.
 * Strings shared with the stats card come from its `display` block, so they
 * are identical to what is on screen by construction (AC-1.5).
 */
export interface BriefFormattedDTO {
  /** "96.0 ft²" — the stats card's Area. */
  roomArea: string;
  /** "40 ft 0 in" / "12.20 m" */
  perimeter: string;
  /** "12 in × 24 in" */
  tileSize: string;
  /** "1/8 in" */
  grout: string;
  /**
   * "58 in²" / "37 cm²" — small-area units, not ft²/m²: the figure matters most
   * when it is a sliver, and a sliver in ft² to one decimal reads "0.0 ft²".
   */
  smallestCut: string;
  /** "8.4%" */
  waste: string;
  /** "143" — includes the 10% buffer, as the stats card's Order to buy. */
  orderQuantity: string;
  fullCount: string;
  cutCount: string;
  totalCount: string;
  wallCount: string;
  holeCount: string;
  /** The sidebar's label: "Herringbone", "½ Offset" — not the enum value. */
  pattern: string;
  /** The sidebar's label: "Least waste", "Centre a tile", "Centre a joint". */
  alignment: string;
  /** The wall table's label, "W3", or null when squared to the room. */
  referenceWall: string | null;
  /** The layout anchor, described for an installer (011), or null. */
  anchor: string | null;
}

/**
 * `POST /api/ai/brief`. Numbers in, prose out: everything the model may state
 * is in `formatted`, and whether to warn about slivers is decided here, by the
 * client, from the engine's figures — the model chooses how to say it, never
 * whether it is true (AC-2.3).
 */
export interface BriefRequestDTO {
  stats: LayoutStatsDTO;
  formatted: BriefFormattedDTO;
  /** True when the smallest cut is under a third of a tile. */
  sliverRisk: boolean;
  /** A third of a tile, formatted like `smallestCut` — the threshold the warning is measured against. */
  sliverThreshold: string;
  system: MeasurementSystem;
}

// ─── 003 · assistant ──────────────────────────────────────────────────────────

/**
 * What the client reports back after executing one call. `result` is whatever
 * the client tool returned — read back from the store after the call (AC-4.5).
 * Opaque to the server: it is serialised for the model and never interpreted.
 */
export interface AssistantToolResultDTO {
  callId: string;
  name: string;
  result: Record<string, unknown>;
}

/** A user turn. Starts a conversation, or continues one with `previousInteractionId`. */
export interface AssistantMessageRequestDTO {
  message: string;
  snapshot: LayoutStatsDTO;
  previousInteractionId?: string;
}

/**
 * Results of the calls the previous response asked for. Always chained, so
 * `previousInteractionId` is required. `roundTrip` is the number of this trip
 * (2..4): the route holds no state, so it is told where in the loop it is and
 * refuses past the cap — a backstop behind the client's own cap, not instead.
 */
export interface AssistantResultsRequestDTO {
  results: AssistantToolResultDTO[];
  snapshot: LayoutStatsDTO;
  previousInteractionId: string;
  roundTrip: number;
}

export type AssistantRequestDTO = AssistantMessageRequestDTO | AssistantResultsRequestDTO;

/** A call the model requested, already filtered to declared tool names server-side. */
export interface AssistantCallDTO {
  id: string;
  name: string;
  /** Unvalidated. The client Zod-checks it before the store is touched (AC-3.3). */
  arguments: unknown;
}

/** `POST /api/ai/assistant`. The server never applies `calls`; the client does (AC-3.1). */
export interface AssistantResponseDTO extends DemoFlagged {
  /** ≤ 1200 characters. May be empty when the model only asked for calls. */
  reply: string;
  calls: AssistantCallDTO[];
  /**
   * Chain the next request with this. Empty in demo mode: there is no stored
   * interaction to continue, so the client must start fresh.
   */
  interactionId: string;
  /** 1..4 — which trip of the current user message this response answers. */
  roundTrip: number;
  /**
   * How many calls named a tool we never declared, dropped server-side. Only a
   * count — the names are model-chosen strings and stay in the server log — so
   * the transcript can say an unsupported action was requested (AC-6.2).
   */
  unsupportedCalls?: number;
}

// ─── Health ───────────────────────────────────────────────────────────────────

/**
 * `GET /api/ai/health`. Reports whether a key is present, never any part of it.
 * Lets the UI disable AI entry points with an explanation instead of failing on
 * click.
 */
export interface AiHealthDTO {
  configured: boolean;
  demoMode: boolean;
  models: {
    fast: string;
    vision: string;
  };
}
