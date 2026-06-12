import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  Room,
  TileConfig,
  PatternType,
  OptimizationConfig,
  LayoutResult,
  AlignmentMode,
} from '@tileflow/geometry';
import { DEFAULT_OPTIMIZATION_CONFIG } from '@tileflow/geometry';
import type { MeasurementSystem } from '../utils/measurements';

// ─── State Shape ──────────────────────────────────────────────────────────────

export interface TileFlowState {
  // Room — all dimensions stored and set in mm
  room: Room;
  /** Display measurement system (metric / imperial) shared across the app */
  system: MeasurementSystem;
  setSystem: (s: MeasurementSystem) => void;
  setRoomWidthMM: (wMM: number) => void;
  setRoomHeightMM: (hMM: number) => void;

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

// ─── Store ────────────────────────────────────────────────────────────────────

export const useTileFlowStore = create<TileFlowState>()(
  subscribeWithSelector((set, get) => ({
    // Room
    room: DEFAULT_ROOM,
    system: 'metric' as MeasurementSystem,

    setSystem: (s: MeasurementSystem) => set({ system: s }),

    setRoomWidthMM: (wMM: number) =>
      set({ room: { ...get().room, width: wMM } }),

    setRoomHeightMM: (hMM: number) =>
      set({ room: { ...get().room, height: hMM } }),

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
  }))
);
