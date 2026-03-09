import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  Room,
  TileConfig,
  PatternType,
  Unit,
  OptimizationConfig,
  LayoutResult,
} from '@tileflow/geometry';
import { DEFAULT_OPTIMIZATION_CONFIG, toMM } from '@tileflow/geometry';

// ─── State Shape ──────────────────────────────────────────────────────────────

export interface TileFlowState {
  // Room
  room: Room;
  unit: Unit;
  setRoomWidth: (w: number) => void;
  setRoomHeight: (h: number) => void;
  setUnit: (u: Unit) => void;

  // Tile config
  tileConfig: TileConfig;
  setTileWidth: (w: number) => void;
  setTileHeight: (h: number) => void;
  setGrout: (g: number) => void;
  setPattern: (p: PatternType) => void;

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

  // Canvas
  canvasScale: number;
  setCanvasScale: (s: number) => void;
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

// ─── Store ────────────────────────────────────────────────────────────────────

export const useTileFlowStore = create<TileFlowState>()(
  subscribeWithSelector((set, get) => ({
    // Room
    room: DEFAULT_ROOM,
    unit: 'mm' as Unit,

    setRoomWidth: (w: number) => {
      const unit = get().unit;
      set({
        room: { ...get().room, width: toMM(w, unit) },
      });
    },

    setRoomHeight: (h: number) => {
      const unit = get().unit;
      set({
        room: { ...get().room, height: toMM(h, unit) },
      });
    },

    setUnit: (u: Unit) => set({ unit: u }),

    // Tile config
    tileConfig: DEFAULT_TILE,

    setTileWidth: (w: number) => {
      const unit = get().unit;
      set({
        tileConfig: { ...get().tileConfig, width: toMM(w, unit) },
      });
    },

    setTileHeight: (h: number) => {
      const unit = get().unit;
      set({
        tileConfig: { ...get().tileConfig, height: toMM(h, unit) },
      });
    },

    setGrout: (g: number) => {
      const unit = get().unit;
      set({
        tileConfig: { ...get().tileConfig, grout: toMM(g, unit) },
      });
    },

    setPattern: (p: PatternType) =>
      set({ tileConfig: { ...get().tileConfig, pattern: p } }),

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

    // Canvas
    canvasScale: 0.2,
    setCanvasScale: (s) => set({ canvasScale: s }),
  }))
);
