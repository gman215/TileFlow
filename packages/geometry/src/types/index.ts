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
  /**
   * What a fixed layout (Centre a tile / Centre a joint) is set out from, when
   * it is a feature rather than the room: a cut-out's centre, one edge of a
   * cut-out (the tub front), or a point. Absent = the room centre, or the
   * reference wall's midpoint. Referenced by index so it follows its cut-out
   * when that moves (011 R3).
   */
  anchor?: LayoutAnchor;
}

export type LayoutAnchor =
  | { kind: 'hole-centre'; hole: number }
  | {
      kind: 'hole-edge';
      hole: number;
      /** Edge of that cut-out: vertex `edge` → `edge + 1` */
      edge: number;
      /** A grout joint along the edge, so the first full row starts there */
      fullTilesFromEdge?: boolean;
    }
  | { kind: 'point'; at: Vec2 };

export interface Room {
  /**
   * Internal dimensions always stored in mm. With a `shape` present these are
   * its bounding box, so view fitting and pattern coverage keep working.
   */
  width: number;
  height: number;
  /** When present, the true floor outline; otherwise the room is the rectangle */
  shape?: RoomShape;
  /**
   * A point anchor on a plain rectangle (011). Kept here rather than on a
   * `shape`, because giving a rectangle a shape would make it a drawn outline
   * (locked width/height). With a shape, the anchor lives on the shape.
   */
  anchor?: Extract<LayoutAnchor, { kind: 'point' }>;
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

// ─── Floor plan (008) ─────────────────────────────────────────────────────────

/**
 * What a layer does in the wall. Exactly one layer is the `core` — the
 * structure (studs) — which is what "stud face" dimensions are taken from.
 */
export type LayerFunction = 'finish' | 'substrate' | 'core' | 'sheathing' | 'air';

export interface WallLayer {
  /** "Drywall ½″", "2×4 stud", "Cement board ½″" */
  material: string;
  /** mm */
  thickness: number;
  function: LayerFunction;
}

export interface WallAssembly {
  id: string;
  name: string;
  /** Left → right relative to the wall's a→b direction. Exactly one `core`. */
  layers: WallLayer[];
  /** Core framing, used by 009. Absent for a non-framed core (masonry). */
  framing?: { studWidth: number; studDepth: number };
}

/**
 * Which plane of the wall the drawn line is. Left/right are as seen on screen
 * walking from a to b, so a wall drawn left-to-right has its left side up.
 */
export type LocationLine =
  | 'centerline'
  | 'core-center'
  | 'finish-left'
  | 'finish-right'
  | 'core-left'
  | 'core-right';

/** A wall junction, in plan space (mm, y down) */
export interface PlanNode {
  id: string;
  position: Vec2;
}

export interface PlanWall {
  id: string;
  /** Node ids */
  a: string;
  b: string;
  assemblyId: string;
  locationLine: LocationLine;
  /** Swap left/right without moving the location line */
  flipped?: boolean;
  /** Framing overrides for this wall; unset fields follow `Plan.framingDefaults` (009) */
  framing?: Partial<WallFraming>;
}

export interface PlanRoom {
  id: string;
  name: string;
  /** Placement point — the room is the enclosed region containing it */
  seed: Vec2;
  /** Hand-drawn cut-outs (islands, tubs), plan space */
  holes: Polygon[];
  /** Movement joint left under the baseboard, mm */
  expansionGap: number;
  /**
   * Square the layout to this wall. A wall id rather than an edge index: the
   * derived boundary's edge order changes whenever a wall is edited.
   */
  referenceWallId?: string;
  /**
   * What a fixed layout is set out from (011), in plan space; a cut-out anchor
   * indexes `holes` above. Ignored while the room is in a pattern group, which
   * shares one frame across its rooms.
   */
  anchor?: LayoutAnchor;
  tileConfig: TileConfig;
  alignment: AlignmentMode;
  weights: OptimizationWeights;
  /** When set, the group's tile settings apply instead of the room's own */
  groupId?: string;
}

/**
 * Rooms that share one tile and one plan-space pattern origin, so grout lines
 * run straight from one into the next.
 */
export interface PatternGroup {
  id: string;
  roomIds: string[];
  tileConfig: TileConfig;
  alignment: AlignmentMode;
  weights: OptimizationWeights;
  /** Square the whole group to this wall (a wall id in the plan) */
  referenceWallId?: string;
}

export interface Plan {
  /** 2 since 009 added framing; `upgradePlan` brings a v1 plan up */
  version: 2;
  nodes: PlanNode[];
  walls: PlanWall[];
  assemblies: WallAssembly[];
  rooms: PlanRoom[];
  groups: PatternGroup[];
  // ── 009: framing ──
  framingDefaults: WallFraming;
  openings: Opening[];
  junctions: JunctionChoice[];
  headerRules: HeaderRule[];
}

// ─── Wall framing (009) ───────────────────────────────────────────────────────

export interface WallFraming {
  /** Bottom of bottom plate to top of top plate, mm */
  framedHeight: number;
  /** Stud spacing on centre, mm */
  spacing: number;
  /** Which end the layout is measured from */
  layoutFrom: 'a' | 'b';
  topPlates: 1 | 2;
  /**
   * Bearing walls get sized headers. Unset on a wall, it defaults from the
   * build-up: anything with sheathing (an exterior wall) is taken as bearing.
   */
  loadBearing?: boolean;
}

export type OpeningKind = 'door' | 'window' | 'cased-opening';

export interface Opening {
  id: string;
  wallId: string;
  kind: OpeningKind;
  /** mm from wall end a to the opening's centre, along the location line */
  center: number;
  roughWidth: number;
  /** Door: floor to underside of header. Window: floor to top of the rough opening */
  roughHeight: number;
  /** Window only: floor to the bottom of the rough opening */
  sillHeight?: number;
  /**
   * Doors and cased openings: where the floors on either side stop.
   * `centerline` (default): each room's tile runs to the middle of the wall.
   * `through`: the room on `side` runs through to the far face; the other
   * stops at its own face. `room-side`: the room on `side` stops at its face
   * and the other runs through.
   */
  floorTransition?: 'centerline' | 'through' | 'room-side';
  side?: 'left' | 'right';
}

export interface JunctionChoice {
  nodeId: string;
  /** The wall whose plates run through (its collinear partner, if any, too) */
  throughWallId?: string;
  corner?: 'three-stud' | 'california';
  partition?: 'post' | 'ladder';
}

export interface HeaderRule {
  loadBearing: boolean;
  /** Longest header (rough opening + both jacks) this rule covers, mm */
  maxSpan: number;
  /** "2×6", "2×4 flat" */
  member: string;
  plies: number;
  /** Vertical depth, mm — what the cripples above start from */
  depth: number;
}

export type MemberKind =
  | 'stud'
  | 'king'
  | 'jack'
  | 'cripple'
  | 'header'
  | 'sill'
  | 'bottom-plate'
  | 'top-plate'
  | 'block'
  | 'corner'
  | 'partition';

export interface FramingMember {
  kind: MemberKind;
  /** Elevation rectangle, wall-local mm: x along the plate from its start, y up from the floor */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Cut length of the piece */
  length: number;
  /** Header only: what it is ("2×8 ×2") */
  label?: string;
}

export interface FramingIssue {
  kind: 'opening-overlap' | 'opening-outside' | 'needs-engineered-header';
  openingId?: string;
  message: string;
}

export interface FramedWall {
  wallId: string;
  /** Where the plate starts, mm along the location line from end a (may be < 0) */
  plateStart: number;
  plateLength: number;
  /** The framing actually used, after defaults */
  framing: Required<WallFraming>;
  studLength: number;
  members: FramingMember[];
  issues: FramingIssue[];
}

export type RoomStatus = 'ok' | 'not-enclosed' | 'redundant';

/** A room's floor as the walls make it. Derived, never stored. */
export interface DerivedRoom {
  roomId: string;
  status: RoomStatus;
  /** Room-side finish faces — the clear room */
  finishBoundary?: Polygon;
  /** Stud faces — the framed room */
  coreBoundary?: Polygon;
  /** finishBoundary inset by the expansion gap — what is tiled */
  tileBoundary?: Polygon;
  /** Free-standing walls inside the room + hand-drawn holes, at tile level */
  holes: Polygon[];
  /** Which wall each tile-boundary edge came from, or null */
  edgeWalls: (string | null)[];
  /** A comfortable point inside the floor, for the room's label */
  labelPoint?: Vec2;
}

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

/**
 * A request that failed. Without this the main thread has no way to tell a
 * slow layout from a dead one, and the "computing" state never clears.
 */
export interface WorkerErrorResponse {
  type: 'error';
  requestId: string;
  message: string;
}

/** One room of a pattern group, already in layout coordinates */
export interface GroupMemberInput {
  roomId: string;
  room: Room;
  /** Plan-space position of the room's (0, 0) */
  origin: Vec2;
}

/**
 * Lay a pattern group out as one floor (008, R11). With `offset` the search
 * is skipped — the drag fast path, as `LayoutRequest.offset` is for one room.
 */
export interface OptimizeGroupRequest {
  type: 'optimize-group';
  members: GroupMemberInput[];
  tileConfig: TileConfig;
  optimizationConfig: OptimizationConfig;
  alignment: AlignmentMode;
  /** The group's plan-space pattern frame */
  frame: { origin: Vec2; angle: number };
  offset?: { x: number; y: number };
  requestId: string;
}

export interface GroupResultResponse {
  type: 'group-result';
  results: { roomId: string; result: LayoutResult }[];
  offset: { x: number; y: number };
  requestId: string;
  computeTimeMs: number;
  candidatesEvaluated: number;
}

export type WorkerRequest = LayoutRequest | OptimizeRequest | OptimizeGroupRequest;
export type WorkerResponse =
  | LayoutResponse
  | OptimizeResponse
  | GroupResultResponse
  | WorkerErrorResponse;
