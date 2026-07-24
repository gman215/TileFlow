// ─── Primitives ───────────────────────────────────────────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Polygon {
  vertices: Vec2[];
}

// ─── Units ────────────────────────────────────────────────────────────────────

export type Unit = 'mm' | 'cm' | 'm' | 'inches' | 'feet';

export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = 304.8;
export const MM_PER_CM = 10;
export const MM_PER_M = 1000;

const UNIT_TO_MM: Record<Unit, number> = {
  mm: 1,
  cm: MM_PER_CM,
  m: MM_PER_M,
  inches: MM_PER_INCH,
  feet: MM_PER_FOOT,
};

export function toMM(value: number, unit: Unit): number {
  return value * UNIT_TO_MM[unit];
}

export function fromMM(value: number, unit: Unit): number {
  return value / UNIT_TO_MM[unit];
}

/** Human-readable label for a unit */
export const UNIT_LABELS: Record<Unit, string> = {
  mm: 'mm',
  cm: 'cm',
  m: 'm',
  inches: 'in',
  feet: 'ft',
};

/** Available units grouped by system */
export const METRIC_UNITS: Unit[] = ['mm', 'cm', 'm'];
export const IMPERIAL_UNITS: Unit[] = ['inches', 'feet'];
export const ALL_UNITS: Unit[] = [...METRIC_UNITS, ...IMPERIAL_UNITS];

// ─── Room ─────────────────────────────────────────────────────────────────────

/**
 * A drawn floor outline.
 *
 * `boundary` is the outer wall line; `holes` are cut-outs that are not tiled
 * (kitchen island, column, tub, closet). Both are in mm, in the same
 * coordinate space as the room's bounding box — that is, normalised so the
 * bounding box starts at (0, 0), which is where the room rectangle has always
 * lived.
 */
export interface RoomShape {
  /** Outer outline, implicitly closed */
  boundary: Polygon;
  /** Cut-outs, each implicitly closed */
  holes: Polygon[];
  /** Index of the wall (boundary edge i → i+1) the layout is squared to */
  referenceWall?: number;
}

export interface Room {
  /**
   * Internal dimensions always stored in mm. With a `shape` present these are
   * its bounding box, so view fitting and pattern coverage keep working.
   */
  width: number;
  height: number;
  /** When present, the true floor outline; otherwise the room is the rectangle */
  shape?: RoomShape;
}

// ─── Tile Configuration ───────────────────────────────────────────────────────

export type PatternType =
  | 'grid'
  | 'offset-1/2'
  | 'offset-1/3'
  | 'herringbone'
  | 'diagonal-45';

export interface TileConfig {
  /** Tile width in mm */
  width: number;
  /** Tile height in mm */
  height: number;
  /** Grout gap in mm */
  grout: number;
  pattern: PatternType;
}

/**
 * How the tile grid is positioned within the room.
 * - `optimize`: search for the offset that minimizes waste / maximizes cuts
 * - `center-tile`: a full tile is centered on the room center
 * - `center-grout`: a grout joint runs through the room center
 */
export type AlignmentMode = 'optimize' | 'center-tile' | 'center-grout';

// ─── Obstacle (future-ready) ──────────────────────────────────────────────────

export type ObstacleShape = 'circle' | 'square' | 'rect' | 'polygon';

export interface Obstacle {
  id: string;
  type: 'drain' | 'door' | 'window' | 'niche';
  shape: ObstacleShape;
  position: Vec2;
  /** For circle: radius; for square: side; for rect: width,height */
  dimensions: Record<string, number>;
  /** Future: polygon boundary for arbitrary shapes */
  boundary?: Polygon;
}

// ─── Placed Tile ──────────────────────────────────────────────────────────────

export interface PlacedTile {
  /** Index in tile array */
  id: number;
  /** Original unclipped polygon (4 vertices for rect) */
  original: Polygon;
  /** Clipped polygon (may have <4 or >4 vertices after clipping) */
  clipped: Polygon;
  /**
   * Every piece the tile was cut into. A concave outline can split one tile
   * into two disjoint pieces (a narrow doorway does exactly that), so this is
   * the full truth; `clipped` is the largest piece.
   */
  pieces: Polygon[];
  /** Area of the clipped portion in mm² */
  clippedArea: number;
  /** Area of the original tile in mm² */
  originalArea: number;
  /** Whether the tile is fully inside the room */
  isFull: boolean;
  /** Whether the tile was completely outside (should be discarded) */
  isOutside: boolean;
  /** The ratio clippedArea / originalArea */
  coverageRatio: number;
}

// ─── Layout Result ────────────────────────────────────────────────────────────

export interface LayoutResult {
  tiles: PlacedTile[];
  fullTileCount: number;
  cutTileCount: number;
  totalTileArea: number;
  roomArea: number;
  wastePercentage: number;
  smallestCutPiece: number;
  optimizationScore: number;
  offsetX: number;
  offsetY: number;
}

// ─── Optimization ─────────────────────────────────────────────────────────────

export interface OptimizationWeights {
  /** Weight for minimum cut area (higher = prefer larger cuts) */
  alpha: number;
  /** Weight for waste percentage (higher = penalize waste more) */
  beta: number;
}

export interface OptimizationConfig {
  weights: OptimizationWeights;
  /** Phase 1 sampling step as fraction of tile unit (e.g. 0.5) */
  coarseStep: number;
  /** Phase 2 refinement step as fraction of tile unit (e.g. 0.1) */
  fineStep: number;
  /** Radius around best coarse candidate to refine (in fraction of tile) */
  refineRadius: number;
}

export const DEFAULT_OPTIMIZATION_CONFIG: OptimizationConfig = {
  weights: { alpha: 0.7, beta: 0.3 },
  coarseStep: 0.5,
  fineStep: 0.1,
  refineRadius: 0.5,
};

// ─── Worker Messages ──────────────────────────────────────────────────────────

export interface LayoutRequest {
  type: 'compute-layout';
  room: Room;
  tileConfig: TileConfig;
  optimizationConfig: OptimizationConfig;
  /**
   * Reuse this offset instead of searching. Used while a corner is being
   * dragged: one layout is a few tens of ms, a full search is hundreds, and
   * the search re-runs the moment the drag ends anyway.
   */
  offset?: { x: number; y: number };
  requestId: string;
}

export interface LayoutResponse {
  type: 'layout-result';
  result: LayoutResult;
  requestId: string;
  computeTimeMs: number;
}

export interface OptimizeRequest {
  type: 'optimize';
  room: Room;
  tileConfig: TileConfig;
  optimizationConfig: OptimizationConfig;
  /** When omitted or 'optimize', the offset is searched; otherwise it's fixed */
  alignment?: AlignmentMode;
  requestId: string;
}

export interface OptimizeResponse {
  type: 'optimize-result';
  result: LayoutResult;
  requestId: string;
  computeTimeMs: number;
  candidatesEvaluated: number;
}

export type WorkerRequest = LayoutRequest | OptimizeRequest;
export type WorkerResponse = LayoutResponse | OptimizeResponse;
