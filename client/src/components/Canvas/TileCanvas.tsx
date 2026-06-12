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
import type { PlacedTile, Polygon } from '@tileflow/geometry';
import { formatDisplayFromMM, roomDisplay } from '../../utils/measurements';

const FULL_TILE_COLOR = '#A7C7E7';
const CUT_TILE_COLOR = '#E89B7B';
const GROUT_COLOR = '#4B5563';
const ROOM_BORDER_COLOR = '#60A5FA';
const BG_COLOR = '#111827';
const HANDLE_COLOR = '#60A5FA';

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
 * Render a single tile as a Konva Line (closed polygon).
 * When editMode is on, the tile is draggable.
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
    const points = useMemo(
      () => polyToFlatPoints(tile.clipped),
      [tile.clipped]
    );

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
      <Line
        points={points}
        closed
        fill={color}
        stroke={editMode ? '#F59E0B' : GROUT_COLOR}
        strokeWidth={Math.max(0.5, (editMode ? 2 : 1) / scale)}
        perfectDrawEnabled={false}
        listening={editMode}
        draggable={editMode}
        x={dx}
        y={dy}
        onDragEnd={handleDragEnd}
        shadowColor={editMode ? '#F59E0B' : undefined}
        shadowBlur={editMode ? 4 / scale : 0}
        shadowEnabled={editMode}
      />
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
  const layout = useTileFlowStore((s) => s.layout);
  const isComputing = useTileFlowStore((s) => s.isComputing);
  const setRoomWidthMM = useTileFlowStore((s) => s.setRoomWidthMM);
  const setRoomHeightMM = useTileFlowStore((s) => s.setRoomHeightMM);
  const system = useTileFlowStore((s) => s.system);
  const editMode = useTileFlowStore((s) => s.editMode);
  const toggleEditMode = useTileFlowStore((s) => s.toggleEditMode);
  const manualOffsets = useTileFlowStore((s) => s.manualOffsets);
  const setManualOffset = useTileFlowStore((s) => s.setManualOffset);
  const clearManualOffsets = useTileFlowStore((s) => s.clearManualOffsets);

  const roomUnit = roomDisplay(system);

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

  const computeFitView = useCallback(
    (w: number, h: number): View => {
      const scale = Math.min(
        (w - FIT_PADDING) / room.width,
        (h - FIT_PADDING) / room.height,
        1
      );
      return {
        scale,
        x: (w - room.width * scale) / 2,
        y: (h - room.height * scale) / 2,
      };
    },
    [room.width, room.height]
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

  const baseCursor = editMode ? 'default' : 'grab';

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

  const gripLength = Math.min(60 / scale, room.height / 3);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* Edit mode toolbar */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <button
          onClick={toggleEditMode}
          className={`px-3 py-1.5 text-xs font-medium rounded shadow-lg transition-colors ${
            editMode
              ? 'bg-amber-500 text-black'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          {editMode ? '✎ Edit Mode ON' : '✎ Edit Mode'}
        </button>
        {editMode && (
          <span className="px-2 py-1 text-[11px] rounded bg-gray-900/80 text-amber-300">
            Drag individual tiles to fine-tune
          </span>
        )}
        {editMode && Object.keys(manualOffsets).length > 0 && (
          <button
            onClick={clearManualOffsets}
            className="px-3 py-1.5 text-xs font-medium rounded shadow-lg bg-red-600/80 text-white hover:bg-red-500 transition-colors"
          >
            Reset Positions
          </button>
        )}
        {isComputing && (
          <span className="px-2 py-1 text-[11px] rounded bg-gray-900/80 text-blue-300 animate-pulse">
            computing…
          </span>
        )}
      </div>

      {/* Zoom controls */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-gray-900/90 rounded shadow-lg p-1">
        <button
          onClick={() => zoomButtons(1 / 1.25)}
          title="Zoom out"
          className="w-7 h-7 text-sm rounded text-gray-300 hover:bg-gray-700 transition-colors"
        >
          −
        </button>
        <span className="w-12 text-center text-[11px] text-gray-400 font-mono select-none">
          {Math.round(scale * 100 * 10) / 10}%
        </span>
        <button
          onClick={() => zoomButtons(1.25)}
          title="Zoom in"
          className="w-7 h-7 text-sm rounded text-gray-300 hover:bg-gray-700 transition-colors"
        >
          +
        </button>
        <button
          onClick={fitToScreen}
          title="Fit room to screen"
          className="px-2 h-7 text-[11px] font-medium rounded text-gray-300 hover:bg-gray-700 transition-colors"
        >
          Fit
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-3 bg-gray-900/90 rounded shadow-lg px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] text-gray-300">
          <span
            className="w-3 h-3 rounded-sm"
            style={{ background: FULL_TILE_COLOR }}
          />
          Full tile
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-gray-300">
          <span
            className="w-3 h-3 rounded-sm"
            style={{ background: CUT_TILE_COLOR }}
          />
          Cut tile
        </span>
        <span className="text-[11px] text-gray-500">
          Drag edges to resize · scroll to zoom · drag to pan
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
        draggable={!editMode}
        onDragEnd={handleStageDragEnd}
        onWheel={handleWheel}
        onMouseEnter={() => setCursor(baseCursor)}
        style={{ background: BG_COLOR }}
      >
        <Layer>
          {/* Room background */}
          <Rect
            x={0}
            y={0}
            width={room.width}
            height={room.height}
            fill="#1E293B"
            stroke={ROOM_BORDER_COLOR}
            strokeWidth={2 / scale}
          />

          {/* Tiles */}
          {tileElements}

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
            draggable
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
            draggable
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
            text={formatDisplayFromMM(room.width, roomUnit.unit, roomUnit.imperialFormat)}
            fontSize={14 / scale}
            fill="#94A3B8"
            align="center"
            listening={false}
          />
          <Text
            x={-24 / scale}
            y={room.height / 2}
            text={formatDisplayFromMM(room.height, roomUnit.unit, roomUnit.imperialFormat)}
            fontSize={14 / scale}
            fill="#94A3B8"
            rotation={-90}
            listening={false}
          />
        </Layer>
      </Stage>
    </div>
  );
}
