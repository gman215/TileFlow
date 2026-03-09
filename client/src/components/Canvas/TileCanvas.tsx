import React, { useMemo, useCallback, useRef } from 'react';
import { Stage, Layer, Rect, Line, Group, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useTileFlowStore } from '../../store/tileFlowStore';
import type { PlacedTile, Polygon } from '@tileflow/geometry';
import { fromMM, UNIT_LABELS } from '@tileflow/geometry';

const FULL_TILE_COLOR = '#A7C7E7';
const CUT_TILE_COLOR = '#E89B7B';
const GROUT_COLOR = '#4B5563';
const ROOM_BORDER_COLOR = '#60A5FA';
const BG_COLOR = '#111827';

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
 */
export default function TileCanvas() {
  const room = useTileFlowStore((s) => s.room);
  const layout = useTileFlowStore((s) => s.layout);
  const canvasScale = useTileFlowStore((s) => s.canvasScale);
  const setCanvasScale = useTileFlowStore((s) => s.setCanvasScale);
  const setRoomWidth = useTileFlowStore((s) => s.setRoomWidth);
  const setRoomHeight = useTileFlowStore((s) => s.setRoomHeight);
  const unit = useTileFlowStore((s) => s.unit);
  const editMode = useTileFlowStore((s) => s.editMode);
  const toggleEditMode = useTileFlowStore((s) => s.toggleEditMode);
  const manualOffsets = useTileFlowStore((s) => s.manualOffsets);
  const setManualOffset = useTileFlowStore((s) => s.setManualOffset);
  const clearManualOffsets = useTileFlowStore((s) => s.clearManualOffsets);

  const stageRef = useRef<any>(null);
  const isDraggingRef = useRef(false);

  // Container sizing
  const containerWidth = typeof window !== 'undefined' ? window.innerWidth * 0.65 : 800;
  const containerHeight = typeof window !== 'undefined' ? window.innerHeight - 64 : 600;

  // Auto-fit scale
  const fitScale = useMemo(() => {
    const padding = 80;
    const sx = (containerWidth - padding) / room.width;
    const sy = (containerHeight - padding) / room.height;
    return Math.min(sx, sy, 1);
  }, [containerWidth, containerHeight, room.width, room.height]);

  const scale = canvasScale || fitScale;

  // Center offset
  const offsetX = (containerWidth - room.width * scale) / 2;
  const offsetY = (containerHeight - room.height * scale) / 2;

  // Wheel zoom
  const handleWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const scaleBy = 1.08;
      const newScale =
        e.evt.deltaY > 0 ? scale / scaleBy : scale * scaleBy;
      setCanvasScale(Math.max(0.01, Math.min(5, newScale)));
    },
    [scale, setCanvasScale]
  );

  // Room resize handles
  const handleRightEdgeDrag = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      const newWidthMM = Math.max(100, e.target.x());
      e.target.y(0);
      setRoomWidth(fromMM(newWidthMM, unit));
    },
    [setRoomWidth, unit]
  );

  const handleBottomEdgeDrag = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      const newHeightMM = Math.max(100, e.target.y());
      e.target.x(0);
      setRoomHeight(fromMM(newHeightMM, unit));
    },
    [setRoomHeight, unit]
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

  return (
    <div className="relative">
      {/* Edit mode toolbar */}
      <div className="absolute top-3 left-3 z-10 flex gap-2">
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
        {editMode && Object.keys(manualOffsets).length > 0 && (
          <button
            onClick={clearManualOffsets}
            className="px-3 py-1.5 text-xs font-medium rounded shadow-lg bg-red-600/80 text-white hover:bg-red-500 transition-colors"
          >
            Reset Positions
          </button>
        )}
      </div>

      <Stage
      ref={stageRef}
      width={containerWidth}
      height={containerHeight}
      onWheel={handleWheel}
      style={{ background: BG_COLOR }}
    >
      <Layer>
        {/* Transform group: scale + center */}
        <Group x={offsetX} y={offsetY} scaleX={scale} scaleY={scale}>
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

          {/* Resize handle — right edge */}
          <Rect
            x={room.width}
            y={0}
            width={12 / scale}
            height={room.height}
            fill="transparent"
            draggable
            onDragMove={handleRightEdgeDrag}
            onDragStart={() => {
              isDraggingRef.current = true;
            }}
            onDragEnd={() => {
              isDraggingRef.current = false;
            }}
            hitStrokeWidth={20 / scale}
          />

          {/* Resize handle — bottom edge */}
          <Rect
            x={0}
            y={room.height}
            width={room.width}
            height={12 / scale}
            fill="transparent"
            draggable
            onDragMove={handleBottomEdgeDrag}
            onDragStart={() => {
              isDraggingRef.current = true;
            }}
            onDragEnd={() => {
              isDraggingRef.current = false;
            }}
            hitStrokeWidth={20 / scale}
          />

          {/* Dimension labels */}
          <Text
            x={room.width / 2 - 40}
            y={-24 / scale}
            text={`${fromMM(room.width, unit).toFixed(unit === 'mm' ? 0 : unit === 'cm' ? 1 : 2)} ${UNIT_LABELS[unit]}`}
            fontSize={14 / scale}
            fill="#94A3B8"
            align="center"
          />
          <Text
            x={-60 / scale}
            y={room.height / 2}
            text={`${fromMM(room.height, unit).toFixed(unit === 'mm' ? 0 : unit === 'cm' ? 1 : 2)} ${UNIT_LABELS[unit]}`}
            fontSize={14 / scale}
            fill="#94A3B8"
            rotation={-90}
          />
        </Group>
      </Layer>
    </Stage>
    </div>
  );
}
