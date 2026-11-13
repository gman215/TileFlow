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
import HintBar, { useHint } from './HintBar';
import ToolIcon from './ToolIcon';
import WallLengthEditor from './WallLengthEditor';
import AnchorLayer from './AnchorLayer';
import CutLabels from './CutLabels';
import { anchorAtClick } from './anchorPick';
import { sameTarget, type RectEdge, type WallPreview, type WallTarget } from './wallEdit';
import { regionAt } from '@tileflow/geometry';
import { planBounds } from '../../store/planHelpers';
import type { PlanTool } from '../../store/tileFlowStore';

const FULL_TILE_COLOR = '#8FB3D9';
const CUT_TILE_COLOR = '#E0A074';
/** The checkerboard's second colour: the same two meanings, a darker tone (013) */
const FULL_TILE_DARK = '#4E7299';
const CUT_TILE_DARK = '#B0703F';
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
  'offset-1/4': '¼ Offset',
  basketweave: 'Basketweave',
  checkerboard: 'Checkerboard',
  hexagon: 'Hexagon',
};





/** Inactive rooms' tiles are drawn faded so the active one reads first. */
const INACTIVE_ROOM_OPACITY = 0.45;

/** How close (on screen) a click must be to a wall to land on it. */
const SPAN_SNAP_PX = 12;

const MIN_SCALE = 0.01;
const MAX_SCALE = 5;
/**
 * Room left around the fitted view for the chrome (010 R7): the toolbar and
 * instruction line above, the stats card below, so Fit never hides an edge.
 */
const FIT_PAD = { top: 124, bottom: 150, side: 40 };

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

    const dark = tile.variant === 1;
    const color = tile.isFull ? (dark ? FULL_TILE_DARK : FULL_TILE_COLOR) : dark ? CUT_TILE_DARK : CUT_TILE_COLOR;
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
  const undoShape = useTileFlowStore((s) => s.undoShape);
  const redoShape = useTileFlowStore((s) => s.redoShape);
  const canUndo = useTileFlowStore((s) => s.shapePast.length > 0);
  const canRedo = useTileFlowStore((s) => s.shapeFuture.length > 0);
  const convertToPlan = useTileFlowStore((s) => s.convertToPlan);
  const startDraw = useTileFlowStore((s) => s.startDraw);
  const addRoomRect = useTileFlowStore((s) => s.addRoomRect);
  const setHelpOpen = useTileFlowStore((s) => s.setHelpOpen);
  const clearPlanNotice = useTileFlowStore((s) => s.clearPlanNotice);

  const roomUnit = roomDisplay(system);
  const drawing = draft !== null;
  const shapeEditing = !plan && !drawing && !editMode && Boolean(room.shape);
  const planEditing = Boolean(plan) && planTool === 'select' && !drawing && !editMode;

  // ─── Wall length on the wall (011 R2) ─────────────────────────────
  const selectedWall = useTileFlowStore((s) => s.selectedWall);
  const [wallTarget, setWallTarget] = useState<WallTarget | null>(null);
  // ─── Anchor tool (011 R3) ─────────────────────────────────────────
  const anchorPicking = useTileFlowStore((s) => s.anchorPicking);
  const setAnchorPicking = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      useTileFlowStore.getState().setAnchorPicking(typeof v === 'function' ? v(useTileFlowStore.getState().anchorPicking) : v),
    []
  );
  useEffect(() => { if (drawing || editMode) setAnchorPicking(false); }, [drawing, editMode, setAnchorPicking]);
  const [wallPreview, setWallPreview] = useState<WallPreview | null>(null);
  // Closing an outline wall's field also clears its selection: a wall click
  // toggles selection, so a still-selected wall would need two clicks to reopen.
  // A plan wall stays selected — its panel in the sidebar is still useful.
  const closeWallEditor = useCallback(() => {
    setWallTarget((t) => {
      if (t?.kind === 'outline') useTileFlowStore.getState().setSelectedWall(null);
      return null;
    });
    setWallPreview(null);
  }, []);
  const openRectEdge = (edge: RectEdge) => { if (!drawing && !editMode) setWallTarget({ kind: 'rect', edge }); };
  // A click on a wall opens its field (`onWallPicked` below). Selection made by
  // code — the assistant or the sidebar squaring to a wall — must not pop one
  // up; clearing the selection, or a different wall becoming selected, closes it.
  useEffect(() => {
    setWallTarget((t) => (t?.kind === 'outline' && (!shapeEditing || selectedWall !== t.index) ? null : t));
  }, [selectedWall, shapeEditing]);
  useEffect(() => {
    if (planEditing && selectedWallId) setWallTarget((t) => (sameTarget(t, { kind: 'plan', wallId: selectedWallId }) ? t : { kind: 'plan', wallId: selectedWallId }));
    else setWallTarget((t) => (t?.kind === 'plan' ? null : t));
  }, [selectedWallId, planEditing]);
  // Drawing, tile editing, or switching between a rectangle, an outline and a plan closes it.
  useEffect(() => { if (drawing || editMode) closeWallEditor(); }, [drawing, editMode, closeWallEditor]);
  useEffect(() => { setWallTarget((t) => (t?.kind === 'rect' && (room.shape || plan) ? null : t)); }, [room.shape, plan]);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<any>(null);

  // ─── Responsive container sizing ────────────────────────────────────
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Measured in the browser (011 T1): the labelled toolbar fits between the side
  // pills down to ~1050 px of canvas; icon-only, it fits down to ~800 px (~900 px
  // in a plan, which has more tools). Below that it drops to its own row.
  const compactToolbar = size.width > 0 && size.width < 1060;
  const stackToolbar = size.width > 0 && size.width < (plan ? 900 : 800);

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
      const availW = Math.max(100, w - 2 * FIT_PAD.side);
      const availH = Math.max(100, h - FIT_PAD.top - FIT_PAD.bottom);
      const scale = Math.min(availW / bounds.w, availH / bounds.h, 1);
      return {
        scale,
        x: (w - bounds.w * scale) / 2 - bounds.x * scale,
        y: FIT_PAD.top + (availH - bounds.h * scale) / 2 - bounds.y * scale,
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

  // Converting to a plan (or undoing back out of one), opening an example or a
  // saved project all change what the view should frame; refit on those, not
  // on every edit.
  const viewEpoch = useTileFlowStore((s) => s.viewEpoch);
  const fitKey = `${Boolean(plan)}:${viewEpoch}`;
  const fitKeyRef = useRef(fitKey);
  useEffect(() => {
    if (fitKeyRef.current !== fitKey) {
      fitKeyRef.current = fitKey;
      fitToScreen();
    }
  }, [fitKey, fitToScreen]);

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

  const baseCursor = drawing || anchorPicking || (plan && planTool === 'room') ? 'crosshair' : editMode ? 'default' : 'grab';

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
    const roomTool = plan && planTool === 'room';
    if (!drawing && !roomTool) return;
    const pos = stageRef.current?.getRelativePointerPosition();
    if (pos) setPointerMM({ x: pos.x, y: pos.y });
  }, [drawing, plan, planTool]);

  // ─── Room tool: a rectangle of walls in one gesture (010 R3) ─────────
  // Drag from corner to corner, or click one corner then the other. A plain
  // click inside closed walls that have no room makes that space a room.
  const [rectStart, setRectStart] = useState<Vec2 | null>(null);
  const rectDownAt = useRef<{ x: number; y: number } | null>(null);

  const snapCorner = useCallback(
    (raw: Vec2) =>
      snapPoint(raw, {
        anchor: null,
        vertices: plan ? plan.nodes.map((n) => n.position) : [],
        gridMM,
        freeAngle: true,
        scale,
      }).point,
    [plan, gridMM, scale]
  );
  const rectEnd = useMemo(
    () => (rectStart && pointerMM ? snapCorner(pointerMM) : null),
    [rectStart, pointerMM, snapCorner]
  );

  useEffect(() => {
    if (!(plan && planTool === 'room')) setRectStart(null);
  }, [plan, planTool]);

  const finishRect = useCallback(
    (end: Vec2) => {
      if (!rectStart) return;
      addRoomRect(rectStart, end, SPAN_SNAP_PX / scale);
      setRectStart(null);
    },
    [rectStart, addRoomRect, scale]
  );

  const handleRectDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (!(plan && planTool === 'room') || drawing || e.evt.button !== 0) return;
      const pos = stageRef.current?.getRelativePointerPosition();
      if (!pos) return;
      rectDownAt.current = { x: e.evt.clientX, y: e.evt.clientY };
      if (rectStart) finishRect(snapCorner(pos));
      else setRectStart(snapCorner(pos));
    },
    [plan, planTool, drawing, rectStart, finishRect, snapCorner]
  );

  const handleRectUp = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const down = rectDownAt.current;
      rectDownAt.current = null;
      if (!(plan && planTool === 'room') || !down || !rectStart) return;
      const moved = Math.hypot(e.evt.clientX - down.x, e.evt.clientY - down.y);
      const pos = stageRef.current?.getRelativePointerPosition();
      if (!pos) return;
      if (moved > 8) {
        finishRect(snapCorner(pos));
      } else if (regionAt(plan, pos)) {
        // A click, not a drag, inside closed walls: make that space a room.
        setRectStart(null);
        placeRoom({ x: pos.x, y: pos.y });
      } else if (derived && plan.rooms.some((r) => derived.rooms.get(r.id)?.status === 'not-enclosed')) {
        // A room has lost its walls: a click shows where they are open.
        setRectStart(null);
        placeRoom({ x: pos.x, y: pos.y });
      }
      // Otherwise a click on open floor: the first corner is set; the next click finishes.
    },
    [plan, derived, planTool, rectStart, finishRect, snapCorner, placeRoom]
  );

  // A drag that ends outside the canvas still finishes the room: the stage
  // never sees that mouseup, so listen on the window while a drag is live.
  useEffect(() => {
    if (!rectStart) return;
    const onUp = (evt: MouseEvent) => {
      const stage = stageRef.current;
      const down = rectDownAt.current;
      if (!stage || !down || stage.container().contains(evt.target as Node)) return;
      rectDownAt.current = null;
      if (Math.hypot(evt.clientX - down.x, evt.clientY - down.y) <= 8) return;
      stage.setPointersPositions(evt);
      const pos = stage.getRelativePointerPosition();
      if (pos) finishRect(snapCorner(pos));
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [rectStart, finishRect, snapCorner]);

  // ─── Keyboard shortcuts (010 R5) ─────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoShape();
        else undoShape();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        redoShape();
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === '?') {
        setHelpOpen(true);
        return;
      }
      if (key === 'escape' && !drawing) {
        setAnchorPicking(false);
        setRectStart(null);
        selectWall(null);
        useTileFlowStore.getState().selectNode(null);
        return;
      }
      if (drawing) return; // the drawing keys (Enter, Esc, Backspace) are handled above
      const actions: Record<string, (() => void) | undefined> = {
        v: () => (plan ? setPlanTool('select') : cancelDraft()),
        r: plan ? () => setPlanTool('room') : undefined,
        w: plan ? () => setPlanTool('wall') : undefined,
        c: () => (!plan || activeRoomId ? startDraw('hole') : undefined),
        d: plan ? undefined : () => startDraw('boundary'),
        a: () => { cancelDraft(); if (plan) setPlanTool('select'); setAnchorPicking((v) => !v); },
        f: fitToScreen,
        e: toggleEditMode,
        '[': () => useTileFlowStore.getState().toggleSidebar(),
      };
      const run = actions[key];
      if (run) {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plan, drawing, activeRoomId, undoShape, redoShape, setHelpOpen, selectWall, setPlanTool, cancelDraft, startDraw, fitToScreen, toggleEditMode]);

  const handleStageClick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (drawing) {
        placePoint();
        return;
      }
      if (anchorPicking) {
        const st = useTileFlowStore.getState();
        // Clicks arrive in plan space in a plan; anchors resolve in the active
        // room's layout coordinates, which start at its origin.
        const o = (st.plan && st.activeRoomId && st.roomOrigins[st.activeRoomId]) || { x: 0, y: 0 };
        const raw = stageRef.current?.getRelativePointerPosition();
        const p = raw ? { x: raw.x - o.x, y: raw.y - o.y } : null;
        const anchor = p ? anchorAtClick(st.room, p, scale) : null;
        if (anchor) {
          useTileFlowStore.getState().setLayoutAnchor(anchor);
          setAnchorPicking(false);
        }
        return;
      }
      if (e.target === stageRef.current) setWallTarget((t) => (t?.kind === 'rect' ? null : t));
      if (!plan) return;
      // A click on empty canvas (not a wall or handle) clears the wall selection.
      if (planTool === 'select' && e.target === stageRef.current) {
        selectWall(null);
        useTileFlowStore.getState().selectNode(null);
      }
    },
    [drawing, placePoint, plan, planTool, selectWall, anchorPicking, scale]
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

  const hint = useHint(rectStart !== null, anchorPicking);
  const tools: { id: string; label: string; title: string; key: string; icon: string; active: boolean; onClick: () => void }[] = plan
    ? [
        { id: 'select', label: 'Select', title: 'Select and move walls, corners, doors', key: 'V', icon: 'select', active: planTool === 'select' && !draft, onClick: () => setPlanTool('select') },
        { id: 'room', label: 'Room', title: 'Drag a rectangle to add a room', key: 'R', icon: 'room', active: planTool === 'room', onClick: () => setPlanTool('room') },
        { id: 'wall', label: 'Wall', title: 'Draw walls corner by corner', key: 'W', icon: 'wall', active: draft?.kind === 'walls', onClick: () => setPlanTool('wall') },
        { id: 'cutout', label: 'Cut-out', title: 'Mark an area of the active room that is not tiled', key: 'C', icon: 'cutout', active: draft?.kind === 'hole', onClick: () => startDraw('hole') },
        { id: 'anchor', label: 'Anchor', title: "Set the active room's layout out from a cut-out, its edge, or a spot", key: 'A', icon: 'anchor', active: anchorPicking, onClick: () => { setPlanTool('select'); setAnchorPicking((v) => !v); } },
      ]
    : [
        { id: 'select', label: 'Select', title: 'Resize the room, drag corners', key: 'V', icon: 'select', active: !draft && !anchorPicking, onClick: () => { setAnchorPicking(false); cancelDraft(); } },
        { id: 'draw', label: 'Draw shape', title: 'Draw the floor outline corner by corner (L-shapes, bays)', key: 'D', icon: 'draw', active: draft?.kind === 'boundary', onClick: () => startDraw('boundary') },
        { id: 'cutout', label: 'Cut-out', title: 'Mark an island, tub or column that is not tiled', key: 'C', icon: 'cutout', active: draft?.kind === 'hole', onClick: () => startDraw('hole') },
        { id: 'anchor', label: 'Anchor', title: 'Set the layout out from a feature: a cut-out, its edge, or a spot', key: 'A', icon: 'anchor', active: anchorPicking, onClick: () => { cancelDraft(); setAnchorPicking((v) => !v); } },
      ];

  const navigateWall = (t: WallTarget) => {
    if (t.kind === 'outline') useTileFlowStore.getState().setSelectedWall(t.index);
    if (t.kind === 'plan') selectWall(t.wallId);
    setWallTarget(t);
  };

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* ── Left: what the colours mean, and the pattern in use ───── */}
      <div
        className="absolute top-3 left-3 z-10 flex items-center gap-3 rounded-full px-3 py-1.5 text-white shadow-lg"
        style={PILL_STYLE}
      >
        <span className="text-[12px] font-medium text-white/90 select-none">{PATTERN_LABELS[pattern]}</span>
        <span className="h-4 w-px bg-white/15" />
        <span className="flex items-center gap-1.5 text-[11px] text-white/80">
          <span className="w-3 h-3 rounded-sm" style={{ background: FULL_TILE_COLOR }} />
          Full
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-white/80">
          <span className="w-3 h-3 rounded-sm" style={{ background: CUT_TILE_COLOR }} />
          Cut
        </span>
        {pattern === 'checkerboard' && (
          <span className="flex items-center gap-1.5 text-[11px] text-white/80" title="The checkerboard's second colour">
            <span className="flex">
              <span className="w-1.5 h-3 rounded-l-sm" style={{ background: FULL_TILE_DARK }} />
              <span className="w-1.5 h-3 rounded-r-sm" style={{ background: CUT_TILE_DARK }} />
            </span>
            Dark
          </span>
        )}
        {isComputing && <span className="text-[11px] text-white/60 animate-pulse select-none">computing…</span>}
      </div>

      {/* ── Centre: the tools, undo/redo (010 R5) ───────────────────── */}
      {/* Below ~1100 px of canvas — easy to reach now the sidebar resizes (011) —
          the labelled toolbar no longer fits between the side pills, so tools
          go icon-only; names stay in the tooltip and aria-label. */}
      <div
        className={`absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5 rounded-full px-1.5 py-1 text-white shadow-lg ${stackToolbar ? 'top-[52px]' : 'top-3'}`}
        style={PILL_STYLE}
        role="toolbar"
        aria-label="Tools"
      >
        {tools.map((t) => (
          <button
            key={t.id}
            onClick={t.onClick}
            title={`${t.label} — ${t.title} (${t.key})`}
            aria-label={t.label}
            aria-pressed={t.active}
            className={`flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-[12px] font-medium rounded-full transition-colors ${
              t.active ? 'bg-white text-ink' : 'text-white/75 hover:text-white hover:bg-white/10'
            }`}
          >
            <ToolIcon name={t.icon} />
            {!compactToolbar && t.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-white/15" />
        <button
          onClick={undoShape}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          className="rounded-full p-1.5 text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-30"
        >
          <ToolIcon name="undo" />
        </button>
        <button
          onClick={redoShape}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          className="rounded-full p-1.5 text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-30"
        >
          <ToolIcon name="redo" />
        </button>
        {plan ? (
          <>
            <span className="mx-1 h-4 w-px bg-white/15" />
            {(['clear', 'centerline'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setDimensionMode(m)}
                title={
                  m === 'clear'
                    ? 'Dimensions inside the room, drywall to drywall — what you tile'
                    : 'Dimensions along the middle of each wall'
                }
                className={`px-2 py-1 text-[11px] font-medium rounded-full transition-colors ${
                  dimensionMode === m ? 'bg-white/90 text-ink' : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}
              >
                {m === 'clear' ? 'Inside' : 'Centre'}
              </button>
            ))}
          </>
        ) : (
          <>
            <span className="mx-1 h-4 w-px bg-white/15" />
            <button
              onClick={convertToPlan}
              title="Make floor plan — walls with real thickness, several rooms, doors (no shortcut)"
              aria-label="Make floor plan"
              className="flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-[12px] font-medium rounded-full text-amber-300 hover:bg-white/10"
            >
              <ToolIcon name="plan" />
              {!compactToolbar && 'Make floor plan'}
            </button>
          </>
        )}
      </div>

      {/* ── Right: view ─────────────────────────────────────────────── */}
      <div
        className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-full px-1.5 py-1 text-white shadow-lg"
        style={PILL_STYLE}
      >
        <button
          onClick={() => zoomButtons(1 / 1.25)}
          title="Zoom out (scroll down)"
          aria-label="Zoom out"
          className="w-7 h-7 text-sm rounded-full text-white/80 hover:bg-white/10 transition-colors"
        >
          −
        </button>
        <span className="w-12 text-center text-[11px] text-white/70 font-mono select-none">
          {Math.round(scale * 100 * 10) / 10}%
        </span>
        <button
          onClick={() => zoomButtons(1.25)}
          title="Zoom in (scroll up)"
          aria-label="Zoom in"
          className="w-7 h-7 text-sm rounded-full text-white/80 hover:bg-white/10 transition-colors"
        >
          +
        </button>
        <button
          onClick={fitToScreen}
          title="Fit to screen (F)"
          className="px-2.5 h-7 text-[12px] font-medium rounded-full text-white/80 hover:bg-white/10 transition-colors"
        >
          Fit
        </button>
        <span className="h-4 w-px bg-white/15" />
        <button
          onClick={toggleEditMode}
          title="Nudge individual tiles by dragging them (E)"
          className={`px-2.5 h-7 text-[12px] font-medium rounded-full transition-colors ${
            editMode ? 'bg-amber-400 text-ink' : 'text-white/80 hover:bg-white/10'
          }`}
        >
          ✎ Edit tiles
        </button>
      </div>

      {/* ── Under the toolbar: length entry while drawing, and the instruction line ── */}
      <div className={`pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2 ${stackToolbar ? 'top-[92px]' : 'top-[54px]'}`}>
        {draft && (
          <div
            className="pointer-events-auto flex items-center gap-2 rounded-full px-3 py-1.5 text-white shadow-lg"
            style={PILL_STYLE}
          >
            <label className="flex items-center gap-1.5 text-[12px] text-white/70">
              Length
              <input
                ref={lengthInputRef}
                value={lengthText}
                onChange={(e) => setLengthText(e.target.value)}
                placeholder={roomUnit.unit === 'feet' ? '12 ft 6 in' : '4.2'}
                aria-label="Length of the next wall"
                className="w-28 rounded-md bg-white/10 px-2 py-1 text-[12px] font-mono text-white
                           placeholder-white/30 outline-none focus:bg-white/15"
              />
            </label>
            <span className="text-[11px] text-white/45">
              {lockedLengthMM != null ? 'locked — click to place' : 'optional'}
            </span>
          </div>
        )}
        <HintBar text={hint} />
      </div>

      {/* Notices (refused edits, open walls) and edit-mode reset */}
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
      {editMode && Object.keys(manualOffsets).length > 0 && (
        <button
          onClick={clearManualOffsets}
          className="absolute top-[54px] right-3 z-10 px-2.5 py-1 text-[11px] font-medium rounded-full shadow-lg bg-red-500/85 text-white hover:bg-red-500 transition-colors"
        >
          Reset tile positions
        </button>
      )}

      <Stage
        ref={stageRef}
        width={size.width || 1}
        height={size.height || 1}
        x={effectiveView.x}
        y={effectiveView.y}
        scaleX={scale}
        scaleY={scale}
        draggable={!editMode && !drawing && !(plan && planTool === 'room')}
        onDragStart={(e) => { if (e.target === stageRef.current) closeWallEditor(); }}
        onDragEnd={handleStageDragEnd}
        onWheel={handleWheel}
        onMouseDown={handleRectDown}
        onMouseUp={handleRectUp}
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
              <CutLabels scale={scale} />
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
          <CutLabels scale={scale} />

          {/* An outline proposed from an image — above everything, never hittable */}
          {shapeProposal && <ProposalGhost shape={shapeProposal.shape} scale={scale} />}

          {/* Outline, wall dimensions, cut-outs and corner handles */}
          {room.shape ? (
            <RoomShapeLayer
              shape={room.shape}
              scale={scale}
              interactive={shapeEditing && !anchorPicking}
              onWallPicked={(index) => setWallTarget({ kind: 'outline', index })}
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

              {/* Top and left edges: not resize handles, but clickable for a length (011 R2) */}
              <Line
                points={[0, 0, room.width, 0]}
                stroke="transparent"
                hitStrokeWidth={14 / scale}
                listening={!drawing}
                onClick={() => openRectEdge('top')}
                onTap={() => openRectEdge('top')}
              />
              <Line
                points={[0, 0, 0, room.height]}
                stroke="transparent"
                hitStrokeWidth={14 / scale}
                listening={!drawing}
                onClick={() => openRectEdge('left')}
                onTap={() => openRectEdge('left')}
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
                onClick={() => openRectEdge('right')}
                onTap={() => openRectEdge('right')}
                onDragStart={closeWallEditor}
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
                onClick={() => openRectEdge('bottom')}
                onTap={() => openRectEdge('bottom')}
                onDragStart={closeWallEditor}
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

          {/* The room rectangle being drawn */}
          {rectStart && rectEnd && (
            <Group listening={false}>
              <Rect
                x={Math.min(rectStart.x, rectEnd.x)}
                y={Math.min(rectStart.y, rectEnd.y)}
                width={Math.abs(rectEnd.x - rectStart.x)}
                height={Math.abs(rectEnd.y - rectStart.y)}
                stroke={EDIT_COLOR}
                strokeWidth={2.5 / scale}
                dash={[10 / scale, 6 / scale]}
                fill="rgba(245,158,11,0.08)"
              />
              <Text
                x={Math.min(rectStart.x, rectEnd.x)}
                y={Math.min(rectStart.y, rectEnd.y) - 22 / scale}
                text={`${formatDisplayFromMM(Math.abs(rectEnd.x - rectStart.x), roomUnit.unit, roomUnit.imperialFormat)} × ${formatDisplayFromMM(
                  Math.abs(rectEnd.y - rectStart.y),
                  roomUnit.unit,
                  roomUnit.imperialFormat
                )}`}
                fontSize={14 / scale}
                fill={EDIT_COLOR}
              />
            </Group>
          )}

          {/* The layout anchor, if one is set (011) — in a plan, on the active room */}
          {(() => {
            const o = plan && activeRoomId ? roomOrigins[activeRoomId] : null;
            if (plan && !o) return null;
            return (
              <Group x={o?.x ?? 0} y={o?.y ?? 0}>
                <AnchorLayer scale={scale} interactive={!drawing && !editMode && !anchorPicking} />
              </Group>
            );
          })()}

          {/* A wall length being typed: the result as a dashed ghost, the walls that move in bold */}
          {wallPreview && (
            <Group listening={false}>
              {wallPreview.lines.map((pts, i) => (
                <Line
                  key={`wp-${i}`}
                  points={pts.flatMap((p) => [p.x, p.y])}
                  closed={wallTarget?.kind !== 'plan'}
                  stroke="#F59E0B"
                  strokeWidth={2 / scale}
                  dash={[8 / scale, 6 / scale]}
                  perfectDrawEnabled={false}
                />
              ))}
              {wallPreview.absorbing.map(([a, b], i) => (
                <Line key={`wa-${i}`} points={[a.x, a.y, b.x, b.y]} stroke="#F59E0B" strokeWidth={5 / scale} opacity={0.75} perfectDrawEnabled={false} />
              ))}
            </Group>
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
      {wallTarget && (
        <WallLengthEditor
          target={wallTarget}
          scale={scale}
          view={{ x: effectiveView.x, y: effectiveView.y }}
          bounds={size}
          onPreview={setWallPreview}
          onNavigate={navigateWall}
          onClose={closeWallEditor}
        />
      )}
    </div>
  );
}
