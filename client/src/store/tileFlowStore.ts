import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  Room,
  RoomShape,
  TileConfig,
  PatternType,
  OptimizationConfig,
  LayoutResult,
  AlignmentMode,
  Polygon,
  Vec2,
  Plan,
  DerivedFloors,
  LocationLine,
  WallAssembly,
  Opening,
  OpeningKind,
  WallFraming,
  JunctionChoice,
  LayoutAnchor,
} from '@tileflow/geometry';
import {
  DEFAULT_OPTIMIZATION_CONFIG,
  normalizeShape,
  rectShape,
  setWallLength,
  moveVertex,
  deleteVertex,
  toMM,
  deriveFloors,
  toLayoutRoom,
  planFromRoom,
  regionAt,
  addWallChain,
  moveNode,
  moveWallParallel,
  deleteWall,
  setAssembly,
  setLocationLine,
  flipWall,
  setPlanWallLength,
  setClearLength,
  validatePlan,
  newId,
  presetAssembly,
  cloneAssembly,
  isValidAssembly,
  pointInPolygon,
  upgradePlan,
  openingProblem,
  enclosedRegions,
  emptyPlan,
  wallLength,
  MM_PER_INCH,
  anchorAfterHoleDeleted,
  anchorAfterHoleVertexDeleted,
} from '@tileflow/geometry';
import type { MeasurementSystem } from '../utils/measurements';
import { buildTemplate, type TemplateId } from './templates';
import {
  roomById,
  settingsOf,
  patchSettings,
  joinGroup as joinGroupIn,
  leaveGroup as leaveGroupIn,
  deleteRoom as deleteRoomIn,
  nextRoomName,
  openEnds,
  type SettingsPatch,
} from './planHelpers';

// ─── State Shape ──────────────────────────────────────────────────────────────

/**
 * An outline being drawn: `kind` says whether it becomes the room, a cut-out,
 * or (in a floor plan) a chain of walls.
 */
export interface ShapeDraft {
  kind: 'boundary' | 'hole' | 'walls';
  points: Vec2[];
}

/**
 * What `undoAiChange` puts back. Tile settings, alignment and weights have no
 * history of their own — only outline edits do — so the assistant takes one
 * snapshot per turn instead of growing a general undo system for a chat panel
 * (003 AC-5.2).
 *
 * `plan` is carried because in plan mode the tile setters write into the plan
 * (`patchActive`), and the top-level fields are only a view of its active room:
 * restoring the view alone would be overwritten by the next plan commit.
 */
// ─── Sidebar (011) ────────────────────────────────────────────────────────────

export const SIDEBAR_DEFAULT_WIDTH = 312;
export const SIDEBAR_MIN_WIDTH = 260;
export const SIDEBAR_MAX_WIDTH = 560;
/** The canvas never gets narrower than this, whatever the sidebar asks for. */
export const CANVAS_MIN_WIDTH = 480;
const RESIZER_WIDTH = 6;
const SIDEBAR_WIDTH_KEY = 'tileflow.sidebarWidth';
const SIDEBAR_HIDDEN_KEY = 'tileflow.sidebarHidden';
const CUT_LABELS_KEY = 'tileflow.cutLabels';

/** 260–560 px, and never so wide the canvas drops below 480 px (011 AC-1.1). */
export function clampSidebarWidth(px: number): number {
  const viewport = typeof window === 'undefined' ? Infinity : window.innerWidth;
  // The resizer handle takes a few pixels of its own; leave them out of the canvas's share.
  const max = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, viewport - CANVAS_MIN_WIDTH - RESIZER_WIDTH));
  return Math.round(Math.min(max, Math.max(SIDEBAR_MIN_WIDTH, Number.isFinite(px) ? px : SIDEBAR_DEFAULT_WIDTH)));
}

/** A per-browser number. Storage can be unavailable (private mode), so never required. */
function readPref(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* preference only */
  }
}

/** The prices the estimator lets the user set (005). */
export type EstimatePriceKey = 'tile' | 'adhesive' | 'grout' | 'labour';

export interface AiSnapshot {
  room: Room;
  tileConfig: TileConfig;
  alignment: AlignmentMode;
  optimizationConfig: OptimizationConfig;
  plan: Plan | null;
}

/** What undo restores: the single room, or the whole plan when there is one. */
export interface HistoryEntry {
  room: Room;
  plan: Plan | null;
}

export type PlanTool = 'select' | 'wall' | 'room';

/**
 * An outline read from an image and offered for review (002-photo-to-room).
 *
 * It is deliberately NOT the room: it lives beside `room` until the user
 * accepts it, so a bad reading changes nothing and needs no undo.
 */
export interface ShapeProposal {
  shape: RoomShape;
  /** 0..1, as the model reported it. Below 0.4 the panel warns about scale. */
  confidence: number;
  /** The model's account of what it read and how it scaled it. */
  notes: string;
  /** True when this is canned demo content rather than a reading. */
  demoMode?: boolean;
}

/** Ring 0 is the room outline; 1.. are the cut-outs, in order. */
export type RingIndex = number;

export interface TileFlowState {
  // Room — all dimensions stored and set in mm
  room: Room;
  /** Display measurement system (metric / imperial) shared across the app */
  system: MeasurementSystem;
  setSystem: (s: MeasurementSystem) => void;
  setRoomWidthMM: (wMM: number) => void;
  setRoomHeightMM: (hMM: number) => void;
  /** 011 — what a fixed layout is set out from, when it is a feature (see LayoutAnchor) */
  setLayoutAnchor: (anchor: LayoutAnchor | null) => void;
  /** 011 — with an edge anchor: a joint along the edge so full tiles start there */
  setFullTilesFromEdge: (on: boolean) => void;
  /** 011 — said once when an edit clears the anchor ("…removed with cut-out 2") */
  anchorNotice: string | null;
  setAnchorNotice: (text: string | null) => void;
  /** 011 — the Anchor tool is waiting for a click on the canvas */
  anchorPicking: boolean;
  setAnchorPicking: (on: boolean) => void;
  /** 011 — resize a plain rectangle as one undoable step (the inline wall field) */
  resizeRoomRect: (wMM: number, hMM: number) => void;

  // ── Drawn room outline ────────────────────────────────────────────────
  /** In-progress outline, or null when not drawing */
  draft: ShapeDraft | null;
  /** Wall the layout is squared to, and the one highlighted in the table */
  selectedWall: number | null;
  /**
   * True while a corner is actively being dragged. The layout worker uses it
   * to skip the offset search and just re-clip, so reshaping stays live.
   */
  interacting: boolean;
  setInteracting: (v: boolean) => void;
  /** Start a corner drag: one undo entry for the whole gesture */
  beginVertexDrag: () => void;
  endVertexDrag: () => void;
  startDraw: (kind: ShapeDraft['kind']) => void;
  addDraftPoint: (pt: Vec2) => void;
  removeLastDraftPoint: () => void;
  cancelDraft: () => void;
  /** Close the outline and adopt it; returns false when it is not usable */
  commitDraft: () => boolean;
  setRoomShape: (shape: RoomShape | undefined) => void;
  /** An outline proposed from an image, pending the user's decision */
  shapeProposal: ShapeProposal | null;
  setShapeProposal: (proposal: ShapeProposal | null) => void;
  /** Adopt the proposal through the normal outline path, then clear it */
  applyShapeProposal: () => void;
  moveShapeVertex: (ring: RingIndex, index: number, to: Vec2) => void;
  setShapeWallLength: (wallIndex: number, lengthMM: number) => void;
  deleteShapeVertex: (ring: RingIndex, index: number) => void;
  deleteHole: (holeIndex: number) => void;
  setSelectedWall: (index: number | null) => void;
  setReferenceWall: (index: number | null) => void;
  /** Drop the outline and go back to a plain W × H rectangle */
  resetToRect: () => void;
  /** Outline undo stacks — kept in state so the buttons can reflect them */
  shapePast: HistoryEntry[];
  shapeFuture: HistoryEntry[];
  undoShape: () => void;
  redoShape: () => void;

  // Tile config — all dimensions stored and set in mm
  tileConfig: TileConfig;
  /** Set both tile dimensions at once (presets, swap) */
  setTileSizeMM: (wMM: number, hMM: number) => void;
  setGroutMM: (gMM: number) => void;
  setPattern: (p: PatternType) => void;
  /** Lay tiles landscape (long side horizontal) or portrait (long side vertical) */
  setTileOrientation: (orientation: 'horizontal' | 'vertical') => void;

  // Grid alignment within the room
  alignment: AlignmentMode;
  setAlignment: (a: AlignmentMode) => void;

  // Optimization
  optimizationConfig: OptimizationConfig;
  setAlpha: (a: number) => void;
  setBeta: (b: number) => void;

  /**
   * 003 — the state before the layout assistant's latest change, or null.
   * One level only: enough for "put that back", which is what the panel offers.
   */
  aiSnapshot: AiSnapshot | null;

  /**
   * 005 — the user's unit prices for the cost estimator, kept per measurement
   * system so a price typed per ft² is never silently read as per m².
   * Session-only: deliberately absent from the project payload built in
   * `useProjectActions.ts`, so prices never reach the database (AC-3.4).
   * `undefined` means "not typed" — the placeholder default applies.
   */
  estimatePrices: Record<MeasurementSystem, Partial<Record<EstimatePriceKey, number>>>;
  /** Whether the tile price is per tile or per unit of floor area (AC-3.1). */
  estimateTileUnit: 'tile' | 'area';
  /** A display symbol only — nothing is ever converted (AC-2.4, AC-3.5). */
  estimateCurrency: string;
  /** Set one price for the current system; null clears it back to the placeholder. */
  setEstimatePrice: (key: EstimatePriceKey, value: number | null) => void;
  setEstimateTileUnit: (unit: 'tile' | 'area') => void;
  setEstimateCurrency: (symbol: string) => void;
  /**
   * 012 — pieces per box, keyed by `productKey(tile)`. A product fact, not an
   * edit, so outline undo/redo leaves it alone (AC-3.4); saved with the project.
   */
  boxSizes: Record<string, number>;
  setBoxSize: (key: string, pieces: number | null) => void;
  /** 011 — sidebar width in px (clamped; persisted per browser) and whether it is hidden */
  sidebarWidth: number;
  sidebarHidden: boolean;
  setSidebarWidth: (px: number) => void;
  toggleSidebar: () => void;
  /** 012 AC-1.6 — each cut piece's letter on the canvas (per browser; off by default) */
  showCutLabels: boolean;
  setShowCutLabels: (on: boolean) => void;
  /**
   * 012 AC-2.5 — the last brief that finished, and the layout object it was
   * written for. The sheet prints it only while `layout` is still that object.
   */
  lastBrief: { text: string; layout: LayoutResult } | null;
  setLastBrief: (brief: { text: string; layout: LayoutResult } | null) => void;
  /** Record the current state; called before the assistant applies a turn's calls */
  captureAiSnapshot: () => void;
  /** Restore the recorded state and clear it */
  undoAiChange: () => void;

  // Layout result (from worker)
  layout: LayoutResult | null;
  isComputing: boolean;
  computeTimeMs: number;
  setLayout: (layout: LayoutResult, timeMs: number) => void;
  setIsComputing: (v: boolean) => void;

  // Manual tile editing (drag-and-drop)
  editMode: boolean;
  toggleEditMode: () => void;
  manualOffsets: Record<number, { dx: number; dy: number }>;
  setManualOffset: (tileId: number, dx: number, dy: number) => void;
  clearManualOffsets: () => void;

  // ── Floor plan (008) ──────────────────────────────────────────────────
  /** null = the single-room app, exactly as before plan mode existed */
  plan: Plan | null;
  /** Rooms, wall mass and seeds derived from `plan`; never persisted */
  derived: DerivedFloors | null;
  activeRoomId: string | null;
  planTool: PlanTool;
  selectedWallId: string | null;
  /** Assembly and location line new walls are drawn with */
  wallStyle: { assemblyId: string; locationLine: LocationLine };
  dimensionMode: 'clear' | 'centerline';
  /** One line shown over the canvas when an edit is refused or needs saying */
  planNotice: string | null;
  /** Open wall ends to highlight after a room could not be placed */
  openEndHighlights: Vec2[];
  /** Last layout per room id */
  roomLayouts: Record<string, LayoutResult>;
  // ── Framing (009) ──
  selectedNodeId: string | null;
  selectNode: (id: string | null) => void;
  /** Wall shown in the framing elevation, or null when it is closed */
  elevationWallId: string | null;
  setElevationWall: (id: string | null) => void;
  /** Add a door or window centred on a wall, at standard rough-opening sizes */
  addOpening: (wallId: string, kind: OpeningKind) => boolean;
  /** Change an opening; refused (with a notice) if it would not fit */
  updateOpening: (id: string, patch: Partial<Opening>, opts?: { quiet?: boolean }) => boolean;
  deleteOpening: (id: string) => void;
  /** Override framing on one wall; `undefined` fields go back to the defaults */
  setWallFraming: (wallId: string, patch: Partial<WallFraming>) => void;
  setFramingDefaults: (patch: Partial<WallFraming>) => void;
  setJunction: (nodeId: string, patch: Partial<Omit<JunctionChoice, 'nodeId'>>) => void;
  /** Plan-space shift of each room's layout coordinates */
  roomOrigins: Record<string, Vec2>;

  convertToPlan: () => void;
  /** Open a saved plan; false when it is from a newer version of the app */
  loadPlan: (plan: Plan) => boolean;
  setPlanTool: (tool: PlanTool) => void;
  setActiveRoom: (id: string | null) => void;
  selectWall: (id: string | null) => void;
  setWallStyle: (style: Partial<TileFlowState['wallStyle']>) => void;
  setDimensionMode: (m: 'clear' | 'centerline') => void;
  clearPlanNotice: () => void;
  /** Commit a chain of walls drawn on the canvas; newly closed spaces get rooms */
  addWalls: (points: Vec2[], closed: boolean, toleranceMM: number) => boolean;
  /** Draw a rectangular room of walls between two corners (010 R3) */
  addRoomRect: (a: Vec2, b: Vec2, toleranceMM: number) => boolean;
  /** Start a floor plan with nothing drawn, Room tool ready */
  startEmptyPlan: () => void;
  /** Open one of the Start card's examples */
  loadTemplate: (id: TemplateId) => void;
  /** Bumped whenever a whole new project is put on screen, so the view refits */
  viewEpoch: number;
  /** Start card / help overlay */
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  /** Place a room at a point; false (with a notice) when nothing encloses it */
  placeRoom: (point: Vec2) => boolean;
  movePlanNode: (id: string, to: Vec2) => void;
  moveWall: (id: string, delta: Vec2) => void;
  deletePlanWall: (id: string) => void;
  setWallAssembly: (wallId: string, assemblyId: string) => void;
  setWallLocationLine: (wallId: string, line: LocationLine) => void;
  flipPlanWall: (wallId: string) => void;
  /** Retype a wall: on its location line, or as a clear length on one side */
  setPlanWallLengthMM: (wallId: string, mm: number, ref: 'location' | 'left' | 'right') => void;
  /** Replace one of the plan's assemblies (layer edits) */
  updateAssembly: (assembly: WallAssembly) => void;
  /** Copy an assembly under a new name and put the wall on the copy */
  saveAssemblyAs: (wallId: string, name: string) => void;
  renameRoom: (id: string, name: string) => void;
  deletePlanRoom: (id: string) => void;
  setRoomExpansionGap: (id: string, mm: number) => void;
  setRoomReferenceWall: (roomId: string, wallId: string | null) => void;
  /** Continue the active room's pattern into another room */
  continuePattern: (intoRoomId: string) => void;
  leavePatternGroup: (roomId: string) => void;
  /** Worker results: layouts keyed by room id; null clears a room */
  setRoomLayouts: (updates: Record<string, LayoutResult | null>, timeMs: number) => void;

  // Project persistence
  projectId: string | null;
  projectName: string;
  setProjectId: (id: string | null) => void;
  setProjectName: (name: string) => void;
}

// ─── Default Values ───────────────────────────────────────────────────────────

// Defaults are round imperial numbers so the app opens on clean fields
// (10 ft × 8 ft, 12" tile, 1/8" grout) rather than converted metric values.
const DEFAULT_ROOM: Room = {
  width: toMM(10, 'feet'),
  height: toMM(8, 'feet'),
};

const DEFAULT_TILE: TileConfig = {
  width: toMM(12, 'inches'),
  height: toMM(12, 'inches'),
  grout: toMM(1 / 8, 'inches'),
  pattern: 'grid',
};

/** Undo depth for outline edits — plenty for a drawing session, cheap to keep. */
const HISTORY_LIMIT = 50;

/** Smallest outline we accept: below this it is a stray click, not a room. */
const MIN_SHAPE_AREA_MM2 = 10_000; // 100 mm × 100 mm

/** Build a Room from an outline, keeping width/height as its bounding box. */
function roomFromShape(shape: RoomShape): Room {
  const { shape: normalized, width, height } = normalizeShape(shape);
  return { width, height, shape: normalized };
}

/** The room's outline, falling back to the implicit rectangle. */
function shapeOf(room: Room): RoomShape {
  return room.shape ?? rectShape(room.width, room.height);
}

function polygonAreaOf(poly: Polygon): number {
  const v = poly.vertices;
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const j = (i + 1) % v.length;
    sum += v[i].x * v[j].y - v[j].x * v[i].y;
  }
  return Math.abs(sum / 2);
}

/**
 * The single-room fields the existing panels read, as views of the active
 * room. This is the seam that lets TilePanel, OptimizationPanel and StatsPanel
 * work in plan mode without knowing plans exist.
 */
function activeView(
  plan: Plan,
  derived: DerivedFloors,
  activeRoomId: string | null,
  roomLayouts: Record<string, LayoutResult>,
  fallback: { room: Room; tileConfig: TileConfig; alignment: AlignmentMode; optimizationConfig: OptimizationConfig }
) {
  const room = roomById(plan, activeRoomId);
  if (!room) return { layout: null };
  const settings = settingsOf(plan, room);
  const d = derived.rooms.get(room.id);
  const lr = d ? toLayoutRoom(d, room) : null;
  return {
    room: lr?.room ?? fallback.room,
    tileConfig: settings.tileConfig,
    alignment: settings.alignment,
    optimizationConfig: { ...fallback.optimizationConfig, weights: settings.weights },
    layout: roomLayouts[room.id] ?? null,
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useTileFlowStore = create<TileFlowState>()(
  subscribeWithSelector((set, get) => {
    /** Snapshot the room (and plan) before an edit, and drop the redo trail. */
    const pushHistory = (room: Room) =>
      set((s) => ({
        shapePast: [...s.shapePast.slice(-(HISTORY_LIMIT - 1)), { room, plan: s.plan }],
        shapeFuture: [],
      }));

    /**
     * Adopt a new plan: derive its rooms, re-centre room seeds so they follow
     * their walls, and refresh the active-room view. Refuses (returning false,
     * with a notice) a plan the derivation could not make sense of.
     */
    const commitPlan = (next: Plan, opts: { history?: boolean } = {}): boolean => {
      const issues = validatePlan(next);
      if (issues.length > 0) {
        set({ planNotice: issues[0].message });
        return false;
      }
      if (opts.history !== false && !get().interacting) pushHistory(get().room);

      const derived = deriveFloors(next);
      // Placement points stay put unless a wall reaches them — except mid-drag,
      // where one mouse move can carry a wall well past a point, so rooms are
      // kept centred on their floors until the drag ends.
      const dragging = get().interacting;
      const plan: Plan = {
        ...next,
        rooms: next.rooms.map((r) => {
          const d = derived.rooms.get(r.id);
          const seed = dragging && d?.status === 'ok' ? d.labelPoint : derived.seeds.get(r.id);
          return seed ? { ...r, seed } : r;
        }),
      };

      const s = get();
      const activeRoomId =
        s.activeRoomId && plan.rooms.some((r) => r.id === s.activeRoomId)
          ? s.activeRoomId
          : plan.rooms[0]?.id ?? null;
      const roomOrigins: Record<string, Vec2> = {};
      for (const r of plan.rooms) {
        const d = derived.rooms.get(r.id);
        const lr = d && toLayoutRoom(d, r);
        if (lr) roomOrigins[r.id] = lr.origin;
      }
      set({
        plan,
        derived,
        activeRoomId,
        roomOrigins,
        planNotice: null,
        ...activeView(plan, derived, activeRoomId, s.roomLayouts, s),
      });
      return true;
    };

    /**
     * Give every enclosed space that has no room a room of its own (010 R4).
     * Used after walls are added — never after a delete, where a merged space
     * is the user's call (the rooms are flagged redundant instead).
     */
    const withAutoRooms = (plan: Plan): { plan: Plan; added: string[] } => {
      const derived = deriveFloors(plan);
      const taken = (p: Vec2) =>
        plan.rooms.some((r) => {
          const d = derived.rooms.get(r.id);
          return Boolean(d?.finishBoundary && pointInPolygon(p, d.finishBoundary));
        });
      const template = roomById(plan, get().activeRoomId) ?? plan.rooms[plan.rooms.length - 1];
      const s = get();
      const settings = template
        ? settingsOf(plan, template)
        : { tileConfig: s.tileConfig, alignment: s.alignment, weights: s.optimizationConfig.weights };
      let next = plan;
      const added: string[] = [];
      for (const region of enclosedRegions(plan)) {
        if (taken(region.point)) continue;
        // A room whose seed sits in this region (e.g. not enclosed a moment ago) already owns it.
        if (plan.rooms.some((r) => pointInPolygon(r.seed, region.ring))) continue;
        const id = newId('r');
        added.push(id);
        next = {
          ...next,
          rooms: [
            ...next.rooms,
            {
              id,
              name: nextRoomName(next),
              seed: region.point,
              holes: [],
              expansionGap: template?.expansionGap ?? 0,
              ...settings,
              tileConfig: { ...settings.tileConfig },
              weights: { ...settings.weights },
            },
          ],
        };
      }
      return { plan: next, added };
    };

    /** Put an undo entry back: re-derive a plan, or return to the single room. */
    const restore = (entry: HistoryEntry) => {
      if (entry.plan) {
        commitPlan(entry.plan, { history: false });
      } else {
        set({
          plan: null,
          derived: null,
          activeRoomId: null,
          selectedWallId: null,
          roomLayouts: {},
          roomOrigins: {},
          planTool: 'select',
          room: entry.room,
          layout: null,
        });
      }
    };

    /** Settings setters write through to the active room (or its group). */
    const patchActive = (patch: SettingsPatch): boolean => {
      const { plan, activeRoomId } = get();
      if (!plan) return false;
      if (activeRoomId) commitPlan(patchSettings(plan, activeRoomId, patch), { history: false });
      return true;
    };

    return {
    // Room
    room: DEFAULT_ROOM,
    system: 'imperial' as MeasurementSystem,

    setSystem: (s: MeasurementSystem) => set({ system: s }),

    // Width/height only drive the room while it is a plain rectangle; once an
    // outline is drawn they report its bounding box and the outline rules.
    setRoomWidthMM: (wMM: number) => {
      const { room } = get();
      if (room.shape) return;
      set({ room: { ...room, width: wMM } });
    },

    setRoomHeightMM: (hMM: number) => {
      const { room } = get();
      if (room.shape) return;
      set({ room: { ...room, height: hMM } });
    },

    // ── Layout anchor (011 R3) ─────────────────────────────────────────
    anchorNotice: null,
    setAnchorNotice: (text) => set({ anchorNotice: text }),
    anchorPicking: false,
    setAnchorPicking: (on) => set({ anchorPicking: on }),
    setLayoutAnchor: (anchor) => {
      const { room, alignment, plan, activeRoomId, derived, roomOrigins } = get();
      // In a plan, anchors arrive in the active room's layout coordinates (what
      // the canvas tool and marker work in) and are stored in plan space on the
      // plan room: points move by the room's origin, cut-out numbers drop the
      // free-standing islands the layout room lists first.
      if (plan) {
        const pr = plan.rooms.find((r) => r.id === activeRoomId);
        const d = activeRoomId ? derived?.rooms.get(activeRoomId) : undefined;
        if (!pr || !d) return;
        if (pr.groupId && anchor) {
          set({ anchorNotice: 'Rooms in a pattern group share one layout — leave the group to anchor this room on its own.' });
          return;
        }
        const islands = d.holes.length - pr.holes.length;
        const o = (activeRoomId && roomOrigins[activeRoomId]) || { x: 0, y: 0 };
        let planAnchor: LayoutAnchor | undefined;
        if (anchor?.kind === 'point') planAnchor = { kind: 'point', at: { x: anchor.at.x + o.x, y: anchor.at.y + o.y } };
        else if (anchor) {
          if (anchor.hole < islands) {
            set({ anchorNotice: 'That is a free-standing wall, not a cut-out — anchor on a cut-out or a spot on the floor.' });
            return;
          }
          planAnchor = { ...anchor, hole: anchor.hole - islands };
        }
        commitPlan({ ...plan, rooms: plan.rooms.map((r) => (r.id === pr.id ? { ...r, anchor: planAnchor } : r)) });
        set({ anchorNotice: null });
        if (anchor && alignment === 'optimize') {
          get().setAlignment('center-tile');
          set({ anchorNotice: 'Switched to Centre a tile — the anchor sets the layout out from that feature.' });
        }
        return;
      }
      pushHistory(room);
      // A point on a plain rectangle stays on the room, so the rectangle stays a
      // rectangle; anything on a cut-out lives on the outline that holds it.
      if (!room.shape) {
        set({ room: { ...room, anchor: anchor?.kind === 'point' ? anchor : undefined }, anchorNotice: null });
      } else {
        const { anchor: _old, ...rest } = room.shape;
        set({ room: { ...room, shape: anchor ? { ...rest, anchor } : rest }, anchorNotice: null });
      }
      // An anchor only means something to the fixed alignments; on Least waste
      // it would change nothing visible and look broken (AC-3.4).
      if (anchor && alignment === 'optimize') {
        get().setAlignment('center-tile');
        set({ anchorNotice: 'Switched to Centre a tile — the anchor sets the layout out from that feature.' });
      }
    },
    setFullTilesFromEdge: (on) => {
      const { room, plan, activeRoomId } = get();
      if (plan) {
        const pr = plan.rooms.find((r) => r.id === activeRoomId);
        if (pr?.anchor?.kind !== 'hole-edge') return;
        commitPlan({ ...plan, rooms: plan.rooms.map((r) => (r.id === pr.id ? { ...r, anchor: { ...pr.anchor as Extract<LayoutAnchor, { kind: 'hole-edge' }>, fullTilesFromEdge: on } } : r)) });
        return;
      }
      const a = room.shape?.anchor;
      if (!room.shape || a?.kind !== 'hole-edge') return;
      pushHistory(room);
      set({ room: { ...room, shape: { ...room.shape, anchor: { ...a, fullTilesFromEdge: on } } } });
    },

    // Width/height above stay history-free for the sidebar's live nudging; a
    // typed length on the wall is a deliberate edit, so it is one undo step.
    resizeRoomRect: (wMM: number, hMM: number) => {
      const { room } = get();
      if (room.shape) return;
      pushHistory(room);
      set({ room: { ...room, width: wMM, height: hMM } });
    },

    // ── Drawn room outline ────────────────────────────────────────────
    draft: null,
    selectedWall: null,
    interacting: false,
    setInteracting: (v) => set({ interacting: v }),

    beginVertexDrag: () => {
      pushHistory(get().room);
      set({ interacting: true });
    },

    endVertexDrag: () => set({ interacting: false }),

    startDraw: (kind) => set({ draft: { kind, points: [] }, editMode: false, planNotice: null }),

    addDraftPoint: (pt) => {
      const { draft } = get();
      if (!draft) return;
      set({ draft: { ...draft, points: [...draft.points, pt] } });
    },

    removeLastDraftPoint: () => {
      const { draft } = get();
      if (!draft || draft.points.length === 0) return;
      set({ draft: { ...draft, points: draft.points.slice(0, -1) } });
    },

    cancelDraft: () =>
      set((s) => ({
        draft: s.draft?.kind === 'walls' ? { kind: 'walls', points: [] } : null,
      })),

    commitDraft: () => {
      const { draft, room, plan, activeRoomId } = get();
      if (draft?.kind === 'walls') {
        // Enter/Esc end a wall chain without closing it; the tool stays live
        // for the next chain.
        const ok = draft.points.length >= 2 && get().addWalls(draft.points, false, 0);
        if (ok || draft.points.length < 2) set({ draft: { kind: 'walls', points: [] } });
        return ok;
      }
      if (!draft || draft.points.length < 3) return false;

      const ring: Polygon = { vertices: draft.points.map((p) => ({ ...p })) };
      if (polygonAreaOf(ring) < MIN_SHAPE_AREA_MM2) return false;

      // In a plan, a cut-out belongs to the active room, in plan coordinates.
      if (plan && draft.kind === 'hole') {
        if (!activeRoomId) return false;
        const ok = commitPlan({
          ...plan,
          rooms: plan.rooms.map((r) =>
            r.id === activeRoomId ? { ...r, holes: [...r.holes, ring] } : r
          ),
        });
        if (ok) set({ draft: null });
        return ok;
      }

      pushHistory(room);

      if (draft.kind === 'boundary') {
        set({ room: roomFromShape({ boundary: ring, holes: [] }), draft: null });
      } else {
        const current = shapeOf(room);
        set({
          room: roomFromShape({ ...current, holes: [...current.holes, ring] }),
          draft: null,
        });
      }
      return true;
    },

    setRoomShape: (shape) => {
      const { room } = get();
      pushHistory(room);
      set({
        room: shape ? roomFromShape(shape) : { width: room.width, height: room.height },
      });
    },

    shapeProposal: null,

    // Normalised on the way in, so the ghost is drawn in the same coordinate
    // space as the committed room rather than wherever the model's numbers
    // happened to start. Area and perimeter are unaffected by the shift, so the
    // summary the user reads before accepting is the one they get after.
    setShapeProposal: (proposal) =>
      set({
        shapeProposal: proposal
          ? { ...proposal, shape: normalizeShape(proposal.shape).shape }
          : null,
      }),

    // Goes through setRoomShape rather than assigning `room`: that is what
    // buys normalization, one undo entry and a worker recompute, and it is why
    // an applied proposal behaves exactly like a hand-drawn outline (AC-3.4).
    applyShapeProposal: () => {
      const { shapeProposal, setRoomShape } = get();
      if (!shapeProposal) return;
      setRoomShape(shapeProposal.shape);
      set({ shapeProposal: null, selectedWall: null });
    },

    moveShapeVertex: (ring, index, to) => {
      const { room, interacting } = get();
      const current = shapeOf(room);
      // A drag fires this on every mouse-move; beginVertexDrag already took
      // the one snapshot the whole gesture should undo to.
      if (!interacting) pushHistory(room);

      const next: RoomShape =
        ring === 0
          ? { ...current, boundary: moveVertex(current.boundary, index, to) }
          : {
              ...current,
              holes: current.holes.map((h, i) =>
                i === ring - 1 ? moveVertex(h, index, to) : h
              ),
            };

      set({ room: roomFromShape(next) });
    },

    setShapeWallLength: (wallIndex, lengthMM) => {
      const { room } = get();
      const current = shapeOf(room);
      pushHistory(room);
      set({
        room: roomFromShape({
          ...current,
          boundary: setWallLength(current.boundary, wallIndex, lengthMM),
        }),
      });
    },

    deleteShapeVertex: (ring, index) => {
      const { room } = get();
      const current = shapeOf(room);
      pushHistory(room);

      const next: RoomShape =
        ring === 0
          ? { ...current, boundary: deleteVertex(current.boundary, index) }
          : {
              ...current,
              holes: current.holes.map((h, i) =>
                i === ring - 1 ? deleteVertex(h, index) : h
              ),
            };

      // A corner of a cut-out going can take an edge anchor's edge with it.
      if (ring > 0) {
        const { anchor, cleared } = anchorAfterHoleVertexDeleted(
          current.anchor, ring - 1, index, current.holes[ring - 1]?.vertices.length ?? 0
        );
        const { anchor: _a, ...rest } = next;
        set({
          room: roomFromShape(anchor ? { ...rest, anchor } : rest),
          anchorNotice: cleared ? 'Anchor removed — its edge changed.' : get().anchorNotice,
        });
        return;
      }
      set({ room: roomFromShape(next) });
    },

    deleteHole: (holeIndex) => {
      const { room, plan, activeRoomId } = get();
      if (plan) {
        const pr = plan.rooms.find((r) => r.id === activeRoomId);
        const { anchor, cleared } = anchorAfterHoleDeleted(pr?.anchor, holeIndex);
        commitPlan({
          ...plan,
          rooms: plan.rooms.map((r) =>
            r.id === activeRoomId ? { ...r, anchor, holes: r.holes.filter((_, i) => i !== holeIndex) } : r
          ),
        });
        if (cleared) set({ anchorNotice: `Anchor removed with cut-out ${holeIndex + 1}.` });
        return;
      }
      const current = shapeOf(room);
      pushHistory(room);
      const { anchor, cleared } = anchorAfterHoleDeleted(current.anchor, holeIndex);
      const { anchor: _a, ...rest } = current;
      set({
        room: roomFromShape({
          ...rest,
          ...(anchor ? { anchor } : {}),
          holes: current.holes.filter((_, i) => i !== holeIndex),
        }),
        anchorNotice: cleared ? `Anchor removed with cut-out ${holeIndex + 1}.` : get().anchorNotice,
      });
    },

    setSelectedWall: (index) => set({ selectedWall: index }),

    setReferenceWall: (index) => {
      const { room } = get();
      if (!room.shape) return;
      pushHistory(room);
      set({
        room: {
          ...room,
          shape: { ...room.shape, referenceWall: index ?? undefined },
        },
        selectedWall: index,
      });
    },

    resetToRect: () => {
      const { room } = get();
      if (!room.shape) return;
      pushHistory(room);
      set({
        room: { width: room.width, height: room.height },
        draft: null,
        selectedWall: null,
      });
    },

    shapePast: [],
    shapeFuture: [],

    undoShape: () => {
      const s = get();
      if (s.shapePast.length === 0) return;
      const entry = s.shapePast[s.shapePast.length - 1];
      set({
        shapePast: s.shapePast.slice(0, -1),
        shapeFuture: [{ room: s.room, plan: s.plan }, ...s.shapeFuture].slice(0, HISTORY_LIMIT),
        draft: null,
      });
      restore(entry);
    },

    redoShape: () => {
      const s = get();
      if (s.shapeFuture.length === 0) return;
      const entry = s.shapeFuture[0];
      set({
        shapeFuture: s.shapeFuture.slice(1),
        shapePast: [...s.shapePast, { room: s.room, plan: s.plan }].slice(-HISTORY_LIMIT),
        draft: null,
      });
      restore(entry);
    },

    // Tile config
    tileConfig: DEFAULT_TILE,

    setTileSizeMM: (wMM: number, hMM: number) => {
      // A hexagon has one size, across the flats (013 AC-1.4).
      if (get().tileConfig.pattern === 'hexagon') hMM = wMM;
      if (patchActive({ tileConfig: { width: wMM, height: hMM } })) return;
      set({
        tileConfig: { ...get().tileConfig, width: wMM, height: hMM },
      });
    },

    setGroutMM: (gMM: number) => {
      if (patchActive({ tileConfig: { grout: gMM } })) return;
      set({
        tileConfig: { ...get().tileConfig, grout: gMM },
      });
    },

    setPattern: (p: PatternType) => {
      // Choosing hexagon squares the size up: the size across the flats is
      // the tile's one dimension (013 AC-1.4).
      const { width } = get().tileConfig;
      const patch = p === 'hexagon' ? { pattern: p, height: width } : { pattern: p };
      if (patchActive({ tileConfig: patch })) return;
      set({ tileConfig: { ...get().tileConfig, ...patch } });
    },

    setTileOrientation: (orientation: 'horizontal' | 'vertical') => {
      const { width, height } = get().tileConfig;
      const landscape = width >= height;
      const wantLandscape = orientation === 'horizontal';
      if (landscape !== wantLandscape) {
        if (patchActive({ tileConfig: { width: height, height: width } })) return;
        set({
          tileConfig: { ...get().tileConfig, width: height, height: width },
        });
      }
    },

    // Alignment
    alignment: 'optimize' as AlignmentMode,
    setAlignment: (a: AlignmentMode) => {
      if (patchActive({ alignment: a })) return;
      set({ alignment: a });
    },

    // Optimization
    optimizationConfig: { ...DEFAULT_OPTIMIZATION_CONFIG },

    setAlpha: (a: number) => {
      if (patchActive({ weights: { alpha: a } })) return;
      set({
        optimizationConfig: {
          ...get().optimizationConfig,
          weights: { ...get().optimizationConfig.weights, alpha: a },
        },
      });
    },

    setBeta: (b: number) => {
      if (patchActive({ weights: { beta: b } })) return;
      set({
        optimizationConfig: {
          ...get().optimizationConfig,
          weights: { ...get().optimizationConfig.weights, beta: b },
        },
      });
    },

    // Sidebar (011) — a per-browser preference, so localStorage, not the project.
    sidebarWidth: clampSidebarWidth(readPref(SIDEBAR_WIDTH_KEY, SIDEBAR_DEFAULT_WIDTH)),
    sidebarHidden: readPref(SIDEBAR_HIDDEN_KEY, 0) === 1,
    setSidebarWidth: (px) => {
      const width = clampSidebarWidth(px);
      writePref(SIDEBAR_WIDTH_KEY, width);
      set({ sidebarWidth: width });
    },
    showCutLabels: readPref(CUT_LABELS_KEY, 0) === 1,
    setShowCutLabels: (on) => {
      writePref(CUT_LABELS_KEY, on ? 1 : 0);
      set({ showCutLabels: on });
    },
    lastBrief: null,
    setLastBrief: (brief) => set({ lastBrief: brief }),
    toggleSidebar: () => {
      const hidden = !get().sidebarHidden;
      writePref(SIDEBAR_HIDDEN_KEY, hidden ? 1 : 0);
      set({ sidebarHidden: hidden });
    },

    // Cost estimator prices (005) — session only, never persisted
    estimatePrices: { imperial: {}, metric: {} },
    estimateTileUnit: 'area',
    estimateCurrency: '$',
    setEstimatePrice: (key, value) => {
      const { estimatePrices, system } = get();
      const forSystem = { ...estimatePrices[system] };
      if (value === null) delete forSystem[key];
      else forSystem[key] = value;
      set({ estimatePrices: { ...estimatePrices, [system]: forSystem } });
    },
    // A price per ft² is not a price per tile: switching the basis drops a
    // typed tile price rather than carrying the number across.
    setEstimateTileUnit: (unit) => {
      const { estimateTileUnit, estimatePrices } = get();
      if (unit === estimateTileUnit) return;
      const clear = (p: Partial<Record<EstimatePriceKey, number>>) => { const { tile: _drop, ...rest } = p; return rest; };
      set({
        estimateTileUnit: unit,
        estimatePrices: { imperial: clear(estimatePrices.imperial), metric: clear(estimatePrices.metric) },
      });
    },
    setEstimateCurrency: (symbol) => set({ estimateCurrency: symbol }),
    boxSizes: {},
    setBoxSize: (key, pieces) =>
      set((s) => {
        const next = { ...s.boxSizes };
        if (pieces && pieces >= 1) next[key] = Math.round(pieces);
        else delete next[key];
        return { boxSizes: next };
      }),

    // Layout assistant undo (003)
    aiSnapshot: null,

    captureAiSnapshot: () => {
      const { room, tileConfig, alignment, optimizationConfig, plan } = get();
      set({ aiSnapshot: { room, tileConfig, alignment, optimizationConfig, plan } });
    },

    undoAiChange: () => {
      const { aiSnapshot: snap, plan, room } = get();
      if (!snap) return;
      set({ aiSnapshot: null });

      // Converted to or from a floor plan since: the snapshot describes a
      // different kind of state, and applying it would tear one half off.
      if (Boolean(snap.plan) !== Boolean(plan)) return;

      if (snap.plan) {
        // The plan holds every room's settings, so this restores whatever the
        // tools changed; `commitPlan` refreshes the active-room view from it.
        commitPlan(snap.plan, { history: false });
        return;
      }

      // Geometry changes join the outline history, so Ctrl+Z after an AI undo
      // still steps through the room coherently.
      if (JSON.stringify(room) !== JSON.stringify(snap.room)) {
        pushHistory(room);
        set({ draft: null, selectedWall: null });
      }
      set({
        room: snap.room,
        tileConfig: snap.tileConfig,
        alignment: snap.alignment,
        optimizationConfig: snap.optimizationConfig,
      });
    },

    // Layout
    layout: null,
    isComputing: false,
    computeTimeMs: 0,

    // A tile's id is its index in the layout that produced it, so a recompute
    // hands the same ids to entirely different tiles. Nudges from the previous
    // layout have to go with it, or they reappear on unrelated tiles.
    setLayout: (layout: LayoutResult, timeMs: number) =>
      set((s) => ({
        layout,
        isComputing: false,
        computeTimeMs: timeMs,
        manualOffsets:
          Object.keys(s.manualOffsets).length > 0 ? {} : s.manualOffsets,
      })),

    setIsComputing: (v: boolean) => set({ isComputing: v }),

    // Manual tile editing
    editMode: false,
    toggleEditMode: () => set((s) => ({ editMode: !s.editMode })),
    manualOffsets: {},
    setManualOffset: (tileId: number, dx: number, dy: number) =>
      set((s) => ({
        manualOffsets: { ...s.manualOffsets, [tileId]: { dx, dy } },
      })),
    clearManualOffsets: () => set({ manualOffsets: {} }),

    // ── Floor plan ────────────────────────────────────────────────────
    plan: null,
    derived: null,
    activeRoomId: null,
    planTool: 'select',
    selectedWallId: null,
    wallStyle: { assemblyId: 'interior-2x4', locationLine: 'centerline' },
    dimensionMode: 'clear',
    planNotice: null,
    openEndHighlights: [],
    roomLayouts: {},
    roomOrigins: {},

    // One undo step back to the single room. The floor is preserved exactly:
    // the walls go outside the old outline (see planFromRoom).
    convertToPlan: () => {
      const s = get();
      if (s.plan) return;
      const assemblyId = s.system === 'metric' ? 'interior-89' : 'interior-2x4';
      const plan = planFromRoom(
        s.room,
        { tileConfig: s.tileConfig, alignment: s.alignment, weights: s.optimizationConfig.weights },
        assemblyId,
        s.system
      );
      // Every preset is available to the plan, not just the one it started with.
      for (const id of [
        'interior-2x4', 'interior-2x6', 'wet-2x4', 'exterior-2x6',
        'interior-89', 'interior-140', 'wet-89',
      ]) {
        if (!plan.assemblies.some((a) => a.id === id)) plan.assemblies.push(presetAssembly(id)!);
      }
      pushHistory(s.room);
      set({
        activeRoomId: plan.rooms[0].id,
        wallStyle: { assemblyId, locationLine: 'centerline' },
        draft: null,
        editMode: false,
        // Carry the current layout over so the canvas doesn't flash empty;
        // the worker replaces it within one debounce.
        roomLayouts: s.layout ? { [plan.rooms[0].id]: s.layout } : {},
      });
      commitPlan(plan, { history: false });
    },

    loadPlan: (plan) => {
      // A v1 plan (saved before framing existed) is brought up to date here.
      const loaded = upgradePlan(plan, get().system);
      if (!loaded) return false;
      set({
        activeRoomId: loaded.rooms[0]?.id ?? null,
        roomLayouts: {},
        selectedWallId: null,
        draft: null,
        viewEpoch: get().viewEpoch + 1,
      });
      return commitPlan(loaded);
    },

    setPlanTool: (tool) =>
      set({
        planTool: tool,
        draft: tool === 'wall' ? { kind: 'walls', points: [] } : null,
        editMode: false,
        planNotice: null,
        openEndHighlights: [],
      }),

    setActiveRoom: (id) => {
      const { plan, derived, roomLayouts } = get();
      if (!plan || !derived) return;
      set({
        activeRoomId: id,
        manualOffsets: {},
        ...activeView(plan, derived, id, roomLayouts, get()),
      });
    },

    selectWall: (id) => set({ selectedWallId: id, selectedNodeId: id ? null : get().selectedNodeId }),
    setWallStyle: (style) => set({ wallStyle: { ...get().wallStyle, ...style } }),
    setDimensionMode: (m) => set({ dimensionMode: m }),
    clearPlanNotice: () => set({ planNotice: null, openEndHighlights: [] }),

    addWalls: (points, closed, toleranceMM) => {
      const { plan, wallStyle } = get();
      if (!plan || points.length < 2) return false;
      const drawn = addWallChain(plan, points, wallStyle, { closed, tolerance: toleranceMM });
      const { plan: next, added } = withAutoRooms(drawn);
      const ok = commitPlan(next);
      if (ok && added.length > 0) get().setActiveRoom(added[added.length - 1]);
      return ok;
    },

    addRoomRect: (a, b, toleranceMM) => {
      if (Math.abs(b.x - a.x) < 100 || Math.abs(b.y - a.y) < 100) return false;
      const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
      return get().addWalls(corners, true, toleranceMM);
    },

    startEmptyPlan: () => {
      const s = get();
      pushHistory(s.room);
      set({
        activeRoomId: null,
        roomLayouts: {},
        selectedWallId: null,
        selectedNodeId: null,
        draft: null,
        editMode: false,
        planTool: 'room',
        wallStyle: { assemblyId: s.system === 'metric' ? 'interior-89' : 'interior-2x4', locationLine: 'centerline' },
        viewEpoch: s.viewEpoch + 1,
      });
      commitPlan(emptyPlan(s.system), { history: false });
    },

    loadTemplate: (id) => {
      const s = get();
      const result = buildTemplate(id, s.system, {
        tileConfig: s.tileConfig,
        alignment: s.alignment,
        weights: s.optimizationConfig.weights,
      });
      pushHistory(s.room);
      if (result.kind === 'plan') {
        set({
          activeRoomId: result.activeRoomId,
          roomLayouts: {},
          selectedWallId: null,
          selectedNodeId: null,
          planTool: 'select',
          draft: null,
          wallStyle: { assemblyId: s.system === 'metric' ? 'interior-89' : 'interior-2x4', locationLine: 'centerline' },
          viewEpoch: s.viewEpoch + 1,
        });
        commitPlan(result.plan, { history: false });
        return;
      }
      // A single room: leave any plan, then size it (and shape it, for the L).
      set({
        plan: null,
        derived: null,
        activeRoomId: null,
        roomLayouts: {},
        roomOrigins: {},
        selectedWallId: null,
        selectedNodeId: null,
        draft: null,
        planTool: 'select',
        tileConfig: { ...s.tileConfig, ...result.tile },
        room: result.shape
          ? roomFromShape(result.shape)
          : { width: result.width, height: result.height },
        viewEpoch: s.viewEpoch + 1,
      });
    },

    viewEpoch: 0,
    helpOpen: false,
    setHelpOpen: (open) => set({ helpOpen: open }),

    placeRoom: (point) => {
      const { plan, derived, activeRoomId } = get();
      if (!plan || !derived) return false;
      if (!regionAt(plan, point)) {
        set({
          planNotice: "These walls don't close — the open ends are highlighted.",
          openEndHighlights: openEnds(plan),
        });
        return false;
      }
      const taken = plan.rooms.some((r) => {
        const d = derived.rooms.get(r.id);
        return d?.finishBoundary && pointInPolygon(point, d.finishBoundary);
      });
      if (taken) {
        set({ planNotice: 'There is already a room here.', openEndHighlights: [] });
        return false;
      }
      // A new room starts with the active room's tile, like a second room of
      // the same job usually does.
      const template = roomById(plan, activeRoomId) ?? plan.rooms[0];
      const settings = template
        ? settingsOf(plan, template)
        : { tileConfig: get().tileConfig, alignment: get().alignment, weights: get().optimizationConfig.weights };
      const id = newId('r');
      const ok = commitPlan({
        ...plan,
        rooms: [
          ...plan.rooms,
          {
            id,
            name: nextRoomName(plan),
            seed: { ...point },
            holes: [],
            expansionGap: template?.expansionGap ?? 0,
            ...settings,
          },
        ],
      });
      if (ok) {
        set({ openEndHighlights: [] });
        get().setActiveRoom(id);
      }
      return ok;
    },

    movePlanNode: (id, to) => {
      const { plan } = get();
      if (plan) commitPlan(moveNode(plan, id, to));
    },

    moveWall: (id, delta) => {
      const { plan } = get();
      if (plan) commitPlan(moveWallParallel(plan, id, delta));
    },

    deletePlanWall: (id) => {
      const { plan } = get();
      if (!plan) return;
      if (commitPlan(deleteWall(plan, id))) set({ selectedWallId: null });
    },

    setWallAssembly: (wallId, assemblyId) => {
      const { plan } = get();
      if (plan) commitPlan(setAssembly(plan, wallId, assemblyId));
    },

    setWallLocationLine: (wallId, line) => {
      const { plan } = get();
      if (plan) commitPlan(setLocationLine(plan, wallId, line));
    },

    flipPlanWall: (wallId) => {
      const { plan } = get();
      if (plan) commitPlan(flipWall(plan, wallId));
    },

    setPlanWallLengthMM: (wallId, mm, ref) => {
      const { plan } = get();
      if (!plan) return;
      commitPlan(
        ref === 'location' ? setPlanWallLength(plan, wallId, mm) : setClearLength(plan, wallId, ref, mm)
      );
    },

    updateAssembly: (assembly) => {
      const { plan } = get();
      if (!plan || !isValidAssembly(assembly)) {
        set({ planNotice: 'A build-up needs exactly one structural (core) layer.' });
        return;
      }
      commitPlan({
        ...plan,
        assemblies: plan.assemblies.map((a) => (a.id === assembly.id ? cloneAssembly(assembly) : a)),
      });
    },

    saveAssemblyAs: (wallId, name) => {
      const { plan } = get();
      const wall = plan?.walls.find((w) => w.id === wallId);
      const source = wall && plan!.assemblies.find((a) => a.id === wall.assemblyId);
      if (!plan || !wall || !source) return;
      const copy: WallAssembly = { ...cloneAssembly(source), id: newId('a'), name };
      commitPlan({
        ...plan,
        assemblies: [...plan.assemblies, copy],
        walls: plan.walls.map((w) => (w.id === wallId ? { ...w, assemblyId: copy.id } : w)),
      });
    },

    renameRoom: (id, name) => {
      const { plan } = get();
      if (plan) commitPlan({ ...plan, rooms: plan.rooms.map((r) => (r.id === id ? { ...r, name } : r)) }, { history: false });
    },

    deletePlanRoom: (id) => {
      const { plan } = get();
      if (plan) commitPlan(deleteRoomIn(plan, id));
    },

    setRoomExpansionGap: (id, mm) => {
      const { plan } = get();
      const gap = Math.max(0, Math.min(20, mm));
      if (plan) commitPlan({ ...plan, rooms: plan.rooms.map((r) => (r.id === id ? { ...r, expansionGap: gap } : r)) });
    },

    setRoomReferenceWall: (roomId, wallId) => {
      const { plan } = get();
      const room = plan && roomById(plan, roomId);
      if (!plan || !room) return;
      const ref = wallId ?? undefined;
      // A grouped room squares the whole group: one lattice, one reference.
      commitPlan(
        room.groupId
          ? { ...plan, groups: plan.groups.map((g) => (g.id === room.groupId ? { ...g, referenceWallId: ref } : g)) }
          : { ...plan, rooms: plan.rooms.map((r) => (r.id === roomId ? { ...r, referenceWallId: ref } : r)) }
      );
    },

    continuePattern: (intoRoomId) => {
      const { plan, activeRoomId } = get();
      if (plan && activeRoomId) commitPlan(joinGroupIn(plan, activeRoomId, intoRoomId, newId('g')));
    },

    leavePatternGroup: (roomId) => {
      const { plan } = get();
      if (plan) commitPlan(leaveGroupIn(plan, roomId));
    },

    selectedNodeId: null,
    selectNode: (id) => set({ selectedNodeId: id, selectedWallId: id ? null : get().selectedWallId }),
    elevationWallId: null,
    setElevationWall: (id) => set({ elevationWallId: id }),

    addOpening: (wallId, kind) => {
      const { plan, system } = get();
      const wall = plan?.walls.find((w) => w.id === wallId);
      if (!plan || !wall) return false;
      // Standard rough openings: a 36″ door (38″ × 82½″ RO), a 36″ × 48″ window
      // at a 36″ sill; metric 900 × 2100 and 1200 × 1200 at 900.
      const inch = (n: number) => n * MM_PER_INCH;
      const metric = system === 'metric';
      const size =
        kind === 'window'
          ? metric
            ? { roughWidth: 1200, roughHeight: 2100, sillHeight: 900 }
            : { roughWidth: inch(36), roughHeight: inch(84), sillHeight: inch(36) }
          : metric
          ? { roughWidth: 900, roughHeight: 2100 }
          : { roughWidth: inch(38), roughHeight: inch(82.5) };
      const opening: Opening = { id: newId('o'), wallId, kind, center: wallLength(plan, wall) / 2, ...size };
      const next = { ...plan, openings: [...plan.openings, opening] };
      const problem = openingProblem(next, opening);
      if (problem) {
        set({ planNotice: problem.message });
        return false;
      }
      return commitPlan(next);
    },

    updateOpening: (id, patch, opts = {}) => {
      const { plan } = get();
      const current = plan?.openings.find((o) => o.id === id);
      if (!plan || !current) return false;
      const updated = { ...current, ...patch };
      const next = { ...plan, openings: plan.openings.map((o) => (o.id === id ? updated : o)) };
      const problem = openingProblem(next, updated);
      if (problem) {
        // A drag just stops at the limit; a typed value says why it was refused.
        if (!opts.quiet) set({ planNotice: problem.message });
        return false;
      }
      return commitPlan(next);
    },

    deleteOpening: (id) => {
      const { plan } = get();
      if (plan) commitPlan({ ...plan, openings: plan.openings.filter((o) => o.id !== id) });
    },

    setWallFraming: (wallId, patch) => {
      const { plan } = get();
      if (!plan) return;
      commitPlan({
        ...plan,
        walls: plan.walls.map((w) => {
          if (w.id !== wallId) return w;
          const framing = { ...w.framing, ...patch };
          for (const k of Object.keys(framing) as (keyof WallFraming)[]) {
            if (framing[k] === undefined) delete framing[k];
          }
          return { ...w, framing };
        }),
      });
    },

    setFramingDefaults: (patch) => {
      const { plan } = get();
      if (plan) commitPlan({ ...plan, framingDefaults: { ...plan.framingDefaults, ...patch } });
    },

    setJunction: (nodeId, patch) => {
      const { plan } = get();
      if (!plan) return;
      const existing = plan.junctions.find((j) => j.nodeId === nodeId) ?? { nodeId };
      const merged: JunctionChoice = { ...existing, ...patch };
      commitPlan({ ...plan, junctions: [...plan.junctions.filter((j) => j.nodeId !== nodeId), merged] });
    },

    setRoomLayouts: (updates, timeMs) =>
      set((s) => {
        const roomLayouts = { ...s.roomLayouts };
        for (const [id, layout] of Object.entries(updates)) {
          if (layout) roomLayouts[id] = layout;
          else delete roomLayouts[id];
        }
        const active = s.activeRoomId ? roomLayouts[s.activeRoomId] ?? null : null;
        return {
          roomLayouts,
          layout: active,
          isComputing: false,
          computeTimeMs: timeMs,
          // Same rule as setLayout: nudges belong to the layout that made them.
          manualOffsets:
            s.activeRoomId && s.activeRoomId in updates && Object.keys(s.manualOffsets).length > 0
              ? {}
              : s.manualOffsets,
        };
      }),

    // Project
    projectId: null,
    projectName: 'Untitled Project',
    setProjectId: (id) => set({ projectId: id }),
    setProjectName: (name) => set({ projectName: name }),
    };
  })
);
