import React, {
  useMemo,
  useCallback,
  useRef,
  useState,
  useEffect,
} from 'react';
import { Stage, Layer, Rect, Line, Group, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useTileFlowStore } from '../../store/tileFlowStore';
import type {
  AlignmentMode,
  PatternType,
  PlacedTile,
  Polygon,
  Vec2,
} from '@tileflow/geometry';
import {
  formatDisplayFromMM,
  parseDisplayToMM,
  roomDisplay,
} from '../../utils/measurements';
import { snapPoint, snapGridMM } from '../../utils/snapping';
import RoomShapeLayer, { ProposalGhost } from './RoomShapeLayer';
import DrawLayer from './DrawLayer';
import PlanLayer from './PlanLayer';
import { planBounds } from '../../store/planHelpers';
import type { PlanTool } from '../../store/tileFlowStore';

const FULL_TILE_COLOR = '#8FB3D9';
const CUT_TILE_COLOR = '#E0A074';
const GROUT_COLOR = '#3A3A36';
const ROOM_BORDER_COLOR = 'rgba(255,255,255,0.32)';
const ROOM_FILL_COLOR = '#26241F';
const BG_COLOR = '#1B1A18';
const HANDLE_COLOR = '#D6D3CC';
const EDIT_COLOR = '#F59E0B';
const DIM_LABEL_COLOR = 'rgba(255,255,255,0.55)';

// Shared translucent-dark surface for the floating toolbar pills + chips.
const PILL_STYLE: React.CSSProperties = {
  background: 'rgba(36,35,33,.86)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,.08)',
};

const PATTERN_LABELS: Record<PatternType, string> = {
  grid: 'Grid',
  'offset-1/2': '½ Offset',
  'offset-1/3': '⅓ Offset',
  herringbone: 'Herringbone',
  'diagonal-45': '45° Diagonal',
};

const ALIGNMENTS: { value: AlignmentMode; label: string; title: string }[] = [
  { value: 'optimize', label: 'Auto', title: 'Optimize offset to minimize waste' },
  { value: 'center-tile', label: 'Center tile', title: 'Center a full tile on the room' },
  { value: 'center-grout', label: 'Center joint', title: 'Run a grout joint through the room center' },
];

const PLAN_TOOLS: { value: PlanTool; label: string; title: string }[] = [
  { value: 'select', label: 'Select', title: 'Pick a room or wall; drag corners and walls' },
  { value: 'wall', label: 'Wall', title: 'Draw walls — click corners, type lengths' },
  { value: 'room', label: 'Room', title: 'Click inside closed walls to place a room' },
];

/** Inactive rooms' tiles are drawn faded so the active one reads first. */
const INACTIVE_ROOM_OPACITY = 0.45;

/** How close (on screen) a click must be to a wall to land on it. */
const SPAN_SNAP_PX = 12;

const MIN_SCALE = 0.01;
const MAX_SCALE = 5;
const FIT_PADDING = 80;

interface View {
  x: number;
  y: number;
  scale: number;
}

/**
 * Convert a polygon's vertices to a flat array for Konva <Line>.
 */
function polyToFlatPoints(poly: Polygon): number[] {
  const pts: number[] = [];
  for (const v of poly.vertices) {
    pts.push(v.x, v.y);
  }
  return pts;
}

/**
 * Render a single tile. A tile is usually one polygon, but an odd outline can
 * cut one into several disjoint pieces — a narrow doorway does exactly that —
 * so every piece is drawn, and they drag together as one tile.
 */
const TileShape = React.memo(
  ({
    tile,
    scale,
    editMode,
    offset,
    onDragEnd,
  }: {
    tile: PlacedTile;
    scale: number;
    editMode: boolean;
    offset?: { dx: number; dy: number };
    onDragEnd?: (tileId: number, dx: number, dy: number) => void;
  }) => {
    const pieces = useMemo(() => {
      const polys = tile.pieces?.length ? tile.pieces : [tile.clipped];
      return polys.map(polyToFlatPoints);
    }, [tile.pieces, tile.clipped]);

    const color = tile.isFull ? FULL_TILE_COLOR : CUT_TILE_COLOR;
    const dx = offset?.dx ?? 0;
    const dy = offset?.dy ?? 0;

    const handleDragEnd = useCallback(
      (e: KonvaEventObject<DragEvent>) => {
        if (onDragEnd) {
          onDragEnd(tile.id, e.target.x(), e.target.y());
        }
      },
      [onDragEnd, tile.id]
    );

    return (
      <Group
        x={dx}
        y={dy}
        listening={editMode}
        draggable={editMode}
        onDragEnd={handleDragEnd}
      >
        {pieces.map((points, i) => (
          <Line
            key={i}
            points={points}
            closed
            fill={color}
            stroke={editMode ? EDIT_COLOR : GROUT_COLOR}
            strokeWidth={Math.max(0.5, (editMode ? 2 : 1) / scale)}
            perfectDrawEnabled={false}
            shadowColor={editMode ? EDIT_COLOR : undefined}
            shadowBlur={editMode ? 4 / scale : 0}
            shadowEnabled={editMode}
          />
        ))}
      </Group>
    );
  }
);

TileShape.displayName = 'TileShape';

/**
 * Main canvas component — renders room boundary and all tiles.
 * Supports pan (drag), pointer-centered wheel zoom, and room
 * resizing via edge handles.
 */
export default function TileCanvas() {
  const room = useTileFlowStore((s) => s.room);
  const shapeProposal = useTileFlowStore((s) => s.shapeProposal);
  const layout = useTileFlowStore((s) => s.layout);
  const isComputing = useTileFlowStore((s) => s.isComputing);
  const setRoomWidthMM = useTileFlowStore((s) => s.setRoomWidthMM);
  const setRoomHeightMM = useTileFlowStore((s) => s.setRoomHeightMM);
  const system = useTileFlowStore((s) => s.system);
  const pattern = useTileFlowStore((s) => s.tileConfig.pattern);
  const alignment = useTileFlowStore((s) => s.alignment);
  const setAlignment = useTileFlowStore((s) => s.setAlignment);
  const editMode = useTileFlowStore((s) => s.editMode);
  const toggleEditMode = useTileFlowStore((s) => s.toggleEditMode);
  const manualOffsets = useTileFlowStore((s) => s.manualOffsets);
  const setManualOffset = useTileFlowStore((s) => s.setManualOffset);
  const clearManualOffsets = useTileFlowStore((s) => s.clearManualOffsets);

  // Room outline drawing
  const draft = useTileFlowStore((s) => s.draft);
  const addDraftPoint = useTileFlowStore((s) => s.addDraftPoint);
  const removeLastDraftPoint = useTileFlowStore((s) => s.removeLastDraftPoint);
  const cancelDraft = useTileFlowStore((s) => s.cancelDraft);
  const commitDraft = useTileFlowStore((s) => s.commitDraft);

  // Floor plan
  const plan = useTileFlowStore((s) => s.plan);
  const derived = useTileFlowStore((s) => s.derived);
  const planTool = useTileFlowStore((s) => s.planTool);
  const setPlanTool = useTileFlowStore((s) => s.setPlanTool);
  const activeRoomId = useTileFlowStore((s) => s.activeRoomId);
  const setActiveRoom = useTileFlowStore((s) => s.setActiveRoom);
  const roomLayouts = useTileFlowStore((s) => s.roomLayouts);
  const roomOrigins = useTileFlowStore((s) => s.roomOrigins);
  const placeRoom = useTileFlowStore((s) => s.placeRoom);
  const addWalls = useTileFlowStore((s) => s.addWalls);
  const selectWall = useTileFlowStore((s) => s.selectWall);
  const selectedWallId = useTileFlowStore((s) => s.selectedWallId);
  const deletePlanWall = useTileFlowStore((s) => s.deletePlanWall);
  const dimensionMode = useTileFlowStore((s) => s.dimensionMode);
  const setDimensionMode = useTileFlowStore((s) => s.setDimensionMode);
  const planNotice = useTileFlowStore((s) => s.planNotice);
  const clearPlanNotice = useTileFlowStore((s) => s.clearPlanNotice);

  const roomUnit = roomDisplay(system);
  const drawing = draft !== null;
  const drawingWalls = draft?.kind === 'walls';
  const shapeEditing = !plan && !drawing && !editMode && Boolean(room.shape);
  const planEditing = Boolean(plan) && planTool === 'select' && !drawing && !editMode;

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<any>(null);

  // ─── Responsive container sizing ────────────────────────────────────
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ─── View transform (pan + zoom) ────────────────────────────────────
  const [view, setView] = useState<View | null>(null);

  // What "Fit" frames: the whole plan (walls included), or the one room.
  const bounds = useMemo(() => {
    const b = plan ? planBounds(plan) : null;
    if (b) {
      const pad = 300;
      return { x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + 2 * pad, h: b.maxY - b.minY + 2 * pad };
    }
    return { x: 0, y: 0, w: room.width, h: room.height };
  }, [plan, room.width, room.height]);

  const computeFitView = useCallback(
    (w: number, h: number): View => {
      const scale = Math.min(
        (w - FIT_PADDING) / bounds.w,
        (h - FIT_PADDING) / bounds.h,
        1
      );
      return {
        scale,
        x: (w - bounds.w * scale) / 2 - bounds.x * scale,
        y: (h - bounds.h * scale) / 2 - bounds.y * scale,
      };
    },
    [bounds]
  );

  const fitToScreen = useCallback(() => {
    if (size.width > 0 && size.height > 0) {
      setView(computeFitView(size.width, size.height));
    }
  }, [size.width, size.height, computeFitView]);

  // Fit once when the container size first becomes known.
  const hasFitRef = useRef(false);
  useEffect(() => {
    if (!hasFitRef.current && size.width > 0 && size.height > 0) {
      hasFitRef.current = true;
      fitToScreen();
    }
  }, [size.width, size.height, fitToScreen]);

  // Converting to a plan (or undoing back out of one) changes what the view
  // should frame; refit once on that transition rather than on every edit.
  const hadPlanRef = useRef(Boolean(plan));
  useEffect(() => {
    if (hadPlanRef.current !== Boolean(plan)) {
      hadPlanRef.current = Boolean(plan);
      fitToScreen();
    }
  }, [plan, fitToScreen]);

  const effectiveView: View =
    view ?? computeFitView(size.width || 800, size.height || 600);
  const scale = effectiveView.scale;

  const zoomAtPoint = useCallback(
    (point: { x: number; y: number }, factor: number) => {
      setView((prev) => {
        const v =
          prev ?? computeFitView(size.width || 800, size.height || 600);
        const newScale = Math.max(
          MIN_SCALE,
          Math.min(MAX_SCALE, v.scale * factor)
        );
        const ratio = newScale / v.scale;
        return {
          scale: newScale,
          x: point.x - (point.x - v.x) * ratio,
          y: point.y - (point.y - v.y) * ratio,
        };
      });
    },
    [computeFitView, size.width, size.height]
  );

  // Wheel zoom centered on the cursor
  const handleWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;
      zoomAtPoint(pointer, e.evt.deltaY > 0 ? 1 / 1.08 : 1.08);
    },
    [zoomAtPoint]
  );

  const zoomButtons = useCallback(
    (factor: number) => {
      zoomAtPoint({ x: size.width / 2, y: size.height / 2 }, factor);
    },
    [zoomAtPoint, size.width, size.height]
  );

  // Pan: the stage itself is draggable (children drags don't pan).
  const handleStageDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      const stage = stageRef.current;
      if (e.target !== stage) return;
      setView((prev) => ({
        ...(prev ?? effectiveView),
        x: stage.x(),
        y: stage.y(),
      }));
    },
    [effectiveView]
  );

  // ─── Cursor feedback ────────────────────────────────────────────────
  const setCursor = useCallback((cursor: string) => {
    const container = stageRef.current?.container();
    if (container) container.style.cursor = cursor;
  }, []);

  const baseCursor = drawing ? 'crosshair' : editMode ? 'default' : 'grab';

  useEffect(() => {
    setCursor(baseCursor);
  }, [baseCursor, setCursor]);

  // ─── Drawing the room outline ───────────────────────────────────────
  const [pointerMM, setPointerMM] = useState<Vec2 | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [lengthText, setLengthText] = useState('');
  const lengthInputRef = useRef<HTMLInputElement>(null);

  const gridMM = snapGridMM(system);

  /** A typed wall length, in mm, or null when the box is empty/unparseable. */
  const lockedLengthMM = useMemo(() => {
    if (!lengthText.trim()) return null;
    const mm = parseDisplayToMM(lengthText, roomUnit.unit, roomUnit.imperialFormat);
    return mm !== null && mm > 0 ? mm : null;
  }, [lengthText, roomUnit.unit, roomUnit.imperialFormat]);

  /** Where the next corner would land, with snapping applied. */
  const snap = useMemo(() => {
    if (!draft || !pointerMM) return null;
    const anchor = draft.points[draft.points.length - 1] ?? null;
    if (draft.kind !== 'walls' || !plan) {
      return snapPoint(pointerMM, {
        anchor,
        vertices: draft.points,
        gridMM,
        freeAngle: shiftHeld,
        scale,
        lockedLengthMM,
      });
    }

    // Walls: existing corners join, and a wall's span takes a T-junction.
    const nodePositions = plan.nodes.map((n) => n.position);
    const base = snapPoint(pointerMM, {
      anchor,
      vertices: [...draft.points, ...nodePositions],
      gridMM,
      freeAngle: shiftHeld,
      scale,
      lockedLengthMM,
    });
    const first = draft.points[0];
    const closesRing =
      base.kind === 'corner' &&
      draft.points.length >= 3 &&
      Math.hypot(base.point.x - first.x, base.point.y - first.y) < 1e-6;
    if (base.kind === 'corner' || lockedLengthMM != null) return { ...base, closesRing };

    const threshold = SPAN_SNAP_PX / scale;
    const byId = new Map(plan.nodes.map((n) => [n.id, n.position]));
    for (const w of plan.walls) {
      const a = byId.get(w.a);
      const b = byId.get(w.b);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-9) continue;
      const t = ((pointerMM.x - a.x) * dx + (pointerMM.y - a.y) * dy) / len2;
      if (t <= 0 || t >= 1) continue;
      const onWall = { x: a.x + t * dx, y: a.y + t * dy };
      if (Math.hypot(onWall.x - pointerMM.x, onWall.y - pointerMM.y) > threshold) continue;

      // Keep the 90°/45° direction if there is one: land where that ray meets
      // the wall, so a square partition stays square.
      let point = onWall;
      if (anchor && base.kind === 'angle') {
        const rx = base.point.x - anchor.x;
        const ry = base.point.y - anchor.y;
        const denom = rx * dy - ry * dx;
        if (Math.abs(denom) > 1e-9) {
          const s2 = ((a.x - anchor.x) * dy - (a.y - anchor.y) * dx) / denom;
          const hit = { x: anchor.x + rx * s2, y: anchor.y + ry * s2 };
          const th = ((hit.x - a.x) * dx + (hit.y - a.y) * dy) / len2;
          if (s2 > 0 && th > 0 && th < 1) point = hit;
        }
      }
      point = { x: Math.round(point.x * 1e6) / 1e6, y: Math.round(point.y * 1e6) / 1e6 };
      return {
        point,
        kind: 'corner' as const,
        closesRing: false,
        lengthMM: anchor ? Math.hypot(point.x - anchor.x, point.y - anchor.y) : 0,
      };
    }
    return { ...base, closesRing: false };
  }, [draft, plan, pointerMM, gridMM, shiftHeld, scale, lockedLengthMM]);

  const focusLengthInput = useCallback(() => {
    // Konva swallows focus on click; keep typing going to the length box.
    window.requestAnimationFrame(() => lengthInputRef.current?.focus());
  }, []);

  const placePoint = useCallback(() => {
    if (!snap || !draft) return;
    if (snap.closesRing && draft.kind === 'walls') {
      // Clicking the chain's first corner closes it; the tool stays live.
      addWalls(draft.points, true, 0);
      useTileFlowStore.setState({ draft: { kind: 'walls', points: [] } });
      setLengthText('');
      return;
    }
    if (snap.closesRing) {
      commitDraft();
      setLengthText('');
      return;
    }
    addDraftPoint(snap.point);
    setLengthText('');
    focusLengthInput();
  }, [snap, draft, addWalls, commitDraft, addDraftPoint, focusLengthInput]);

  const handleStagePointerMove = useCallback(() => {
    if (!drawing) return;
    const pos = stageRef.current?.getRelativePointerPosition();
    if (pos) setPointerMM({ x: pos.x, y: pos.y });
  }, [drawing]);

  const handleStageClick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (drawing) {
        placePoint();
        return;
      }
      if (!plan) return;
      const pos = stageRef.current?.getRelativePointerPosition();
      if (planTool === 'room' && pos) {
        placeRoom({ x: pos.x, y: pos.y });
        return;
      }
      // A click on empty canvas (not a wall or handle) clears the wall selection.
      if (planTool === 'select' && e.target === stageRef.current) {
        selectWall(null);
        useTileFlowStore.getState().selectNode(null);
      }
    },
    [drawing, placePoint, plan, planTool, placeRoom, selectWall]
  );

  // Delete removes the selected wall (not while typing in a field).
  useEffect(() => {
    if (!plan || !selectedWallId || drawing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deletePlanWall(selectedWallId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [plan, selectedWallId, drawing, deletePlanWall]);

  // Keyboard while drawing: Esc cancels, Enter closes, Backspace steps back.
  useEffect(() => {
    if (!drawing) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(true);

      if (e.key === 'Escape') {
        e.preventDefault();
        // Esc ends a wall chain, keeping what was drawn; anything else cancels.
        if (draft?.kind === 'walls') commitDraft();
        else cancelDraft();
        setLengthText('');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (lockedLengthMM != null && snap) {
          placePoint();
        } else {
          commitDraft();
          setLengthText('');
        }
      } else if (e.key === 'Backspace' && !lengthText) {
        e.preventDefault();
        removeLastDraftPoint();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    drawing,
    cancelDraft,
    commitDraft,
    removeLastDraftPoint,
    placePoint,
    lockedLengthMM,
    lengthText,
    snap,
    draft?.kind,
  ]);

  // Give the length box focus as soon as drawing starts.
  useEffect(() => {
    if (drawing) focusLengthInput();
    else {
      setPointerMM(null);
      setLengthText('');
    }
  }, [drawing, focusLengthInput]);

  // ─── Room resize handles ────────────────────────────────────────────
  const handleRightEdgeDrag = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      const newWidthMM = Math.max(100, e.target.x());
      e.target.y(0);
      setRoomWidthMM(newWidthMM);
    },
    [setRoomWidthMM]
  );

  const handleBottomEdgeDrag = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      const newHeightMM = Math.max(100, e.target.y());
      e.target.x(0);
      setRoomHeightMM(newHeightMM);
    },
    [setRoomHeightMM]
  );

  // Handle tile drag end
  const handleTileDragEnd = useCallback(
    (tileId: number, dx: number, dy: number) => {
      setManualOffset(tileId, dx, dy);
    },
    [setManualOffset]
  );

  // Memoize tile rendering
  const tileElements = useMemo(() => {
    if (!layout) return null;
    return layout.tiles.map((tile) => (
      <TileShape
        key={tile.id}
        tile={tile}
        scale={scale}
        editMode={editMode}
        offset={manualOffsets[tile.id]}
        onDragEnd={handleTileDragEnd}
      />
    ));
  }, [layout, scale, editMode, manualOffsets, handleTileDragEnd]);

  // Every room's tiles, each shifted to where its room sits in the plan.
  const planTileElements = useMemo(() => {
    if (!plan) return null;
    return plan.rooms.map((r) => {
      const layout = roomLayouts[r.id];
      const origin = roomOrigins[r.id];
      const status = derived?.rooms.get(r.id)?.status;
      if (!layout || !origin || status !== 'ok') return null;
      const active = r.id === activeRoomId;
      return (
        <Group
          key={r.id}
          x={origin.x}
          y={origin.y}
          opacity={active ? 1 : INACTIVE_ROOM_OPACITY}
          listening={active && editMode}
        >
          {layout.tiles.map((tile) => (
            <TileShape
              key={tile.id}
              tile={tile}
              scale={scale}
              editMode={active && editMode}
              offset={active ? manualOffsets[tile.id] : undefined}
              onDragEnd={handleTileDragEnd}
            />
          ))}
        </Group>
      );
    });
  }, [plan, derived, roomLayouts, roomOrigins, activeRoomId, scale, editMode, manualOffsets, handleTileDragEnd]);

  const gripLength = Math.min(60 / scale, room.height / 3);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* ── Toolbar: left pill — pattern + alignment ───────────────── */}
      <div
        className="absolute top-3 left-3 z-10 flex items-center gap-1 rounded-full px-1.5 py-1 text-white shadow-lg"
        style={PILL_STYLE}
      >
        <span className="px-2.5 text-[12px] font-medium text-white/90 select-none">
          {PATTERN_LABELS[pattern]}
        </span>
        <span className="h-4 w-px bg-white/15" />
        {ALIGNMENTS.map(({ value, label, title }) => (
          <button
            key={value}
            onClick={() => setAlignment(value)}
            title={title}
            className={`px-2.5 py-1 text-[12px] font-medium rounded-full transition-colors ${
              alignment === value
                ? 'bg-white text-ink'
                : 'text-white/70 hover:text-white hover:bg-white/10'
            }`}
          >
            {label}
          </button>
        ))}
        {isComputing && (
          <span className="px-2 text-[11px] text-white/60 animate-pulse select-none">
            computing…
          </span>
        )}
      </div>

      {/* ── Toolbar: right pill — zoom + fit + edit toggle ─────────── */}
      <div
        className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-full px-1.5 py-1 text-white shadow-lg"
        style={PILL_STYLE}
      >
        <button
          onClick={() => zoomButtons(1 / 1.25)}
          title="Zoom out"
          className="w-7 h-7 text-sm rounded-full text-white/80 hover:bg-white/10 transition-colors"
        >
          −
        </button>
        <span className="w-12 text-center text-[11px] text-white/70 font-mono select-none">
          {Math.round(scale * 100 * 10) / 10}%
        </span>
        <button
          onClick={() => zoomButtons(1.25)}
          title="Zoom in"
          className="w-7 h-7 text-sm rounded-full text-white/80 hover:bg-white/10 transition-colors"
        >
          +
        </button>
        <button
          onClick={fitToScreen}
          title="Fit room to screen"
          className="px-2.5 h-7 text-[12px] font-medium rounded-full text-white/80 hover:bg-white/10 transition-colors"
        >
          Fit
        </button>
        <span className="h-4 w-px bg-white/15" />
        <button
          onClick={toggleEditMode}
          title="Drag individual tiles to fine-tune"
          className={`px-2.5 h-7 text-[12px] font-medium rounded-full transition-colors ${
            editMode
              ? 'bg-amber-400 text-ink'
              : 'text-white/80 hover:bg-white/10'
          }`}
        >
          ✎ Edit tiles
        </button>
      </div>

      {/* ── Toolbar: plan tools + dimension mode (floor plans only) ─── */}
      {plan && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-full px-1.5 py-1 text-white shadow-lg"
          style={PILL_STYLE}
        >
          {PLAN_TOOLS.map(({ value, label, title }) => (
            <button
              key={value}
              onClick={() => setPlanTool(value)}
              title={title}
              className={`px-2.5 py-1 text-[12px] font-medium rounded-full transition-colors ${
                planTool === value ? 'bg-white text-ink' : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
            >
              {label}
            </button>
          ))}
          <span className="h-4 w-px bg-white/15" />
          {(['clear', 'centerline'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setDimensionMode(m)}
              title={m === 'clear' ? 'Dimensions finish face to finish face' : 'Dimensions on wall centrelines'}
              className={`px-2.5 py-1 text-[12px] font-medium rounded-full transition-colors ${
                dimensionMode === m ? 'bg-white text-ink' : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
            >
              {m === 'clear' ? 'Clear' : 'Centreline'}
            </button>
          ))}
        </div>
      )}

      {plan && planNotice && (
        <button
          onClick={clearPlanNotice}
          className="absolute bottom-3 right-3 z-10 rounded-full px-3 py-1.5 text-[12px] text-red-300 shadow-lg"
          style={PILL_STYLE}
          title="Dismiss"
        >
          {planNotice} ×
        </button>
      )}

      {plan && planTool === 'room' && !planNotice && (
        <div
          className="absolute bottom-3 right-3 z-10 rounded-full px-3 py-1.5 text-[12px] text-white/70 shadow-lg"
          style={PILL_STYLE}
        >
          Click inside closed walls to place a room
        </div>
      )}

      {/* Edit-mode helper + reset (only while editing) */}
      {editMode && (
        <div className="absolute top-[60px] right-3 z-10 flex items-center gap-2">
          <span
            className="px-2.5 py-1 text-[11px] rounded-full text-amber-300 shadow-lg"
            style={PILL_STYLE}
          >
            Drag individual tiles to fine-tune
          </span>
          {Object.keys(manualOffsets).length > 0 && (
            <button
              onClick={clearManualOffsets}
              className="px-2.5 py-1 text-[11px] font-medium rounded-full shadow-lg bg-red-500/85 text-white hover:bg-red-500 transition-colors"
            >
              Reset positions
            </button>
          )}
        </div>
      )}

      {/* Draw-mode HUD — length entry + what the keys do */}
      {draft && (
        <div
          className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2"
          style={{ top: plan ? 56 : 14 }}
        >
          {/* The HUD floats over the canvas; only the length box takes clicks. */}
          <div
            className="pointer-events-auto flex items-center gap-2 rounded-full px-3 py-1.5 text-white shadow-lg"
            style={PILL_STYLE}
          >
            <span className="text-[12px] font-medium text-amber-300">
              {draft.kind === 'boundary' ? 'Drawing room' : draft.kind === 'walls' ? 'Drawing walls' : 'Drawing cut-out'}
            </span>
            <span className="h-4 w-px bg-white/15" />
            <label className="flex items-center gap-1.5 text-[12px] text-white/70">
              Wall length
              <input
                ref={lengthInputRef}
                value={lengthText}
                onChange={(e) => setLengthText(e.target.value)}
                placeholder={roomUnit.unit === 'feet' ? '12 ft 6 in' : '4.2'}
                className="w-28 rounded-md bg-white/10 px-2 py-1 text-[12px] font-mono text-white
                           placeholder-white/30 outline-none focus:bg-white/15"
              />
            </label>
            <span className="text-[11px] text-white/45">
              {lockedLengthMM != null ? 'locked — click to place' : 'type to lock'}
            </span>
          </div>

          <div
            className="rounded-full px-3 py-1 text-[11px] text-white/60 shadow-lg"
            style={PILL_STYLE}
          >
            {drawingWalls
              ? 'Click corners · snaps to walls & corners · Shift = free angle · Backspace undoes · Enter/Esc ends the chain · click the start to close'
              : 'Click corners · Shift = free angle · Backspace undoes · Enter closes · Esc cancels'}
          </div>
        </div>
      )}

      {/* Legend chip — top-left, below the toolbar pill */}
      <div
        className="absolute top-[60px] left-3 z-10 flex items-center gap-3 rounded-full px-3 py-1.5 text-white shadow-lg"
        style={PILL_STYLE}
      >
        <span className="flex items-center gap-1.5 text-[11px] text-white/80">
          <span
            className="w-3 h-3 rounded-sm"
            style={{ background: FULL_TILE_COLOR }}
          />
          Full tile
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-white/80">
          <span
            className="w-3 h-3 rounded-sm"
            style={{ background: CUT_TILE_COLOR }}
          />
          Cut tile
        </span>
      </div>

      <Stage
        ref={stageRef}
        width={size.width || 1}
        height={size.height || 1}
        x={effectiveView.x}
        y={effectiveView.y}
        scaleX={scale}
        scaleY={scale}
        draggable={!editMode && !drawing}
        onDragEnd={handleStageDragEnd}
        onWheel={handleWheel}
        onMouseMove={handleStagePointerMove}
        onClick={handleStageClick}
        onTap={handleStageClick}
        onMouseEnter={() => setCursor(baseCursor)}
        style={{ background: BG_COLOR }}
      >
        <Layer>
          {plan && derived ? (
            <>
              {/* Room floors — clicking one makes it the active room */}
              {plan.rooms.map((r) => {
                const d = derived.rooms.get(r.id);
                if (!d?.finishBoundary || d.status === 'not-enclosed') return null;
                return (
                  <Line
                    key={`floor-${r.id}`}
                    points={polyToFlatPoints(d.finishBoundary)}
                    closed
                    fill={ROOM_FILL_COLOR}
                    stroke={r.id === activeRoomId ? 'rgba(255,255,255,0.5)' : undefined}
                    strokeWidth={2 / scale}
                    listening={planEditing}
                    onClick={() => setActiveRoom(r.id)}
                    onTap={() => setActiveRoom(r.id)}
                    perfectDrawEnabled={false}
                  />
                );
              })}
              {planTileElements}
              <PlanLayer scale={scale} interactive={planEditing} />
            </>
          ) : (
          <>
          {/* Floor — the drawn outline, or the plain rectangle */}
          {room.shape ? (
            <Line
              points={polyToFlatPoints(room.shape.boundary)}
              closed
              fill={ROOM_FILL_COLOR}
              listening={false}
              perfectDrawEnabled={false}
            />
          ) : (
            <Rect
              x={0}
              y={0}
              width={room.width}
              height={room.height}
              fill={ROOM_FILL_COLOR}
              stroke={ROOM_BORDER_COLOR}
              strokeWidth={2 / scale}
            />
          )}

          {/* Tiles */}
          {tileElements}

          {/* An outline proposed from an image — above everything, never hittable */}
          {shapeProposal && <ProposalGhost shape={shapeProposal.shape} scale={scale} />}

          {/* Outline, wall dimensions, cut-outs and corner handles */}
          {room.shape ? (
            <RoomShapeLayer
              shape={room.shape}
              scale={scale}
              interactive={shapeEditing}
            />
          ) : (
            <>
              {/* Room border overlay */}
              <Rect
                x={0}
                y={0}
                width={room.width}
                height={room.height}
                fill="transparent"
                stroke={ROOM_BORDER_COLOR}
                strokeWidth={2 / scale}
                listening={false}
              />

              {/* Resize grip indicators (visual only) */}
              <Rect
                x={room.width - 2 / scale}
                y={room.height / 2 - gripLength / 2}
                width={5 / scale}
                height={gripLength}
                cornerRadius={3 / scale}
                fill={HANDLE_COLOR}
                listening={false}
              />
              <Rect
                x={room.width / 2 - gripLength / 2}
                y={room.height - 2 / scale}
                width={gripLength}
                height={5 / scale}
                cornerRadius={3 / scale}
                fill={HANDLE_COLOR}
                listening={false}
              />

              {/* Resize handle — right edge */}
              <Rect
                x={room.width}
                y={0}
                width={12 / scale}
                height={room.height}
                offsetX={6 / scale}
                fill="transparent"
                draggable={!drawing}
                onDragMove={handleRightEdgeDrag}
                onMouseEnter={() => setCursor('ew-resize')}
                onMouseLeave={() => setCursor(baseCursor)}
                hitStrokeWidth={20 / scale}
              />

              {/* Resize handle — bottom edge */}
              <Rect
                x={0}
                y={room.height}
                width={room.width}
                height={12 / scale}
                offsetY={6 / scale}
                fill="transparent"
                draggable={!drawing}
                onDragMove={handleBottomEdgeDrag}
                onMouseEnter={() => setCursor('ns-resize')}
                onMouseLeave={() => setCursor(baseCursor)}
                hitStrokeWidth={20 / scale}
              />

              {/* Dimension labels */}
              <Text
                x={0}
                y={-24 / scale}
                width={room.width}
                text={formatDisplayFromMM(
                  room.width,
                  roomUnit.unit,
                  roomUnit.imperialFormat
                )}
                fontSize={14 / scale}
                fill={DIM_LABEL_COLOR}
                align="center"
                listening={false}
              />
              <Text
                x={-24 / scale}
                y={room.height / 2}
                text={formatDisplayFromMM(
                  room.height,
                  roomUnit.unit,
                  roomUnit.imperialFormat
                )}
                fontSize={14 / scale}
                fill={DIM_LABEL_COLOR}
                rotation={-90}
                listening={false}
              />
            </>
          )}

          </>
          )}

          {/* The outline being drawn */}
          {draft && (
            <DrawLayer
              draft={draft}
              cursor={snap?.point ?? null}
              willClose={snap?.closesRing ?? false}
              scale={scale}
              display={roomUnit}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
}
