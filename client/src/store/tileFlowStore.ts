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
} from '@tileflow/geometry';
import {
  DEFAULT_OPTIMIZATION_CONFIG,
  normalizeShape,
  rectShape,
  setWallLength,
  moveVertex,
  deleteVertex,
} from '@tileflow/geometry';
import type { MeasurementSystem } from '../utils/measurements';

// ─── State Shape ──────────────────────────────────────────────────────────────

/** An outline being drawn: `kind` says whether it becomes the room or a cut-out. */
export interface ShapeDraft {
  kind: 'boundary' | 'hole';
  points: Vec2[];
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
  moveShapeVertex: (ring: RingIndex, index: number, to: Vec2) => void;
  setShapeWallLength: (wallIndex: number, lengthMM: number) => void;
  deleteShapeVertex: (ring: RingIndex, index: number) => void;
  deleteHole: (holeIndex: number) => void;
  setSelectedWall: (index: number | null) => void;
  setReferenceWall: (index: number | null) => void;
  /** Drop the outline and go back to a plain W × H rectangle */
  resetToRect: () => void;
  /** Outline undo stacks — kept in state so the buttons can reflect them */
  shapePast: Room[];
  shapeFuture: Room[];
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

  // Project persistence
  projectId: string | null;
  projectName: string;
  setProjectId: (id: string | null) => void;
  setProjectName: (name: string) => void;
}

// ─── Default Values ───────────────────────────────────────────────────────────

const DEFAULT_ROOM: Room = {
  width: 3000, // 3m in mm
  height: 2400, // 2.4m in mm
};

const DEFAULT_TILE: TileConfig = {
  width: 300,
  height: 300,
  grout: 3,
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

// ─── Store ────────────────────────────────────────────────────────────────────

export const useTileFlowStore = create<TileFlowState>()(
  subscribeWithSelector((set, get) => {
    /** Snapshot the room before an outline edit, and drop the redo trail. */
    const pushHistory = (room: Room) =>
      set((s) => ({
        shapePast: [...s.shapePast.slice(-(HISTORY_LIMIT - 1)), room],
        shapeFuture: [],
      }));

    return {
    // Room
    room: DEFAULT_ROOM,
    system: 'metric' as MeasurementSystem,

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

    startDraw: (kind) => set({ draft: { kind, points: [] }, editMode: false }),

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

    cancelDraft: () => set({ draft: null }),

    commitDraft: () => {
      const { draft, room } = get();
      if (!draft || draft.points.length < 3) return false;

      const ring: Polygon = { vertices: draft.points.map((p) => ({ ...p })) };
      if (polygonAreaOf(ring) < MIN_SHAPE_AREA_MM2) return false;

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

      set({ room: roomFromShape(next) });
    },

    deleteHole: (holeIndex) => {
      const { room } = get();
      const current = shapeOf(room);
      pushHistory(room);
      set({
        room: roomFromShape({
          ...current,
          holes: current.holes.filter((_, i) => i !== holeIndex),
        }),
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

    undoShape: () =>
      set((s) => {
        if (s.shapePast.length === 0) return {};
        return {
          room: s.shapePast[s.shapePast.length - 1],
          shapePast: s.shapePast.slice(0, -1),
          shapeFuture: [s.room, ...s.shapeFuture].slice(0, HISTORY_LIMIT),
          draft: null,
        };
      }),

    redoShape: () =>
      set((s) => {
        if (s.shapeFuture.length === 0) return {};
        return {
          room: s.shapeFuture[0],
          shapeFuture: s.shapeFuture.slice(1),
          shapePast: [...s.shapePast, s.room].slice(-HISTORY_LIMIT),
          draft: null,
        };
      }),

    // Tile config
    tileConfig: DEFAULT_TILE,

    setTileSizeMM: (wMM: number, hMM: number) =>
      set({
        tileConfig: { ...get().tileConfig, width: wMM, height: hMM },
      }),

    setGroutMM: (gMM: number) =>
      set({
        tileConfig: { ...get().tileConfig, grout: gMM },
      }),

    setPattern: (p: PatternType) =>
      set({ tileConfig: { ...get().tileConfig, pattern: p } }),

    setTileOrientation: (orientation: 'horizontal' | 'vertical') => {
      const { width, height } = get().tileConfig;
      const landscape = width >= height;
      const wantLandscape = orientation === 'horizontal';
      if (landscape !== wantLandscape) {
        set({
          tileConfig: { ...get().tileConfig, width: height, height: width },
        });
      }
    },

    // Alignment
    alignment: 'optimize' as AlignmentMode,
    setAlignment: (a: AlignmentMode) => set({ alignment: a }),

    // Optimization
    optimizationConfig: { ...DEFAULT_OPTIMIZATION_CONFIG },

    setAlpha: (a: number) =>
      set({
        optimizationConfig: {
          ...get().optimizationConfig,
          weights: { ...get().optimizationConfig.weights, alpha: a },
        },
      }),

    setBeta: (b: number) =>
      set({
        optimizationConfig: {
          ...get().optimizationConfig,
          weights: { ...get().optimizationConfig.weights, beta: b },
        },
      }),

    // Layout
    layout: null,
    isComputing: false,
    computeTimeMs: 0,

    setLayout: (layout: LayoutResult, timeMs: number) =>
      set({ layout, isComputing: false, computeTimeMs: timeMs }),

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

    // Project
    projectId: null,
    projectName: 'Untitled Project',
    setProjectId: (id) => set({ projectId: id }),
    setProjectName: (name) => set({ projectName: name }),
    };
  })
);
