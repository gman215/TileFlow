import React, { useMemo, useCallback } from 'react';
import { Line, Circle, Text, Group } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Polygon, RoomShape, Vec2 } from '@tileflow/geometry';
import { wallsOf } from '@tileflow/geometry';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { formatDisplayFromMM, roomDisplay } from '../../utils/measurements';
import { snapPoint, snapGridMM } from '../../utils/snapping';

const OUTLINE_COLOR = 'rgba(255,255,255,0.42)';
const REFERENCE_COLOR = '#4ADE80';
const SELECTED_COLOR = '#F59E0B';
const HANDLE_FILL = '#D6D3CC';
const HANDLE_STROKE = '#1B1A18';
const LABEL_COLOR = 'rgba(255,255,255,0.62)';
const HOLE_FILL = '#1B1A18';
const HOLE_STROKE = 'rgba(255,255,255,0.35)';

function flatPoints(poly: Polygon): number[] {
  const pts: number[] = [];
  for (const v of poly.vertices) pts.push(v.x, v.y);
  return pts;
}

function centroidOf(poly: Polygon): Vec2 {
  const v = poly.vertices;
  if (v.length === 0) return { x: 0, y: 0 };
  return {
    x: v.reduce((s, p) => s + p.x, 0) / v.length,
    y: v.reduce((s, p) => s + p.y, 0) / v.length,
  };
}

/**
 * Dimension text sitting alongside a wall, rotated to run with it and pushed
 * to the outside of the room. Text that would read upside-down is flipped, so
 * every label stays readable however the outline was drawn.
 */
function WallLabel({
  a,
  b,
  text,
  scale,
  color,
  outward,
}: {
  a: Vec2;
  b: Vec2;
  text: string;
  scale: number;
  color: string;
  outward: Vec2;
}) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 1e-6) return null;

  let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  let flip = false;
  if (deg > 90 || deg < -90) {
    deg += 180;
    flip = true;
  }

  const gap = 16 / scale;
  const fontSize = 13 / scale;
  const width = length;

  return (
    <Text
      x={mid.x + outward.x * gap - (flip ? -1 : 1) * (width / 2) * Math.cos((deg * Math.PI) / 180)}
      y={mid.y + outward.y * gap - (flip ? -1 : 1) * (width / 2) * Math.sin((deg * Math.PI) / 180)}
      width={width}
      text={text}
      fontSize={fontSize}
      fill={color}
      align="center"
      rotation={deg}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

interface Props {
  shape: RoomShape;
  scale: number;
  /** Corner handles and wall picking are live only while editing the outline */
  interactive: boolean;
}

/**
 * Draws the room outline: the floor edge, every cut-out, a dimension on each
 * wall, and draggable corner handles while editing.
 *
 * Cut-outs are painted in the stage colour *above* the tiles, which is what
 * punches an island or column out of the tiles drawn underneath.
 */
export default function RoomShapeLayer({ shape, scale, interactive }: Props) {
  const system = useTileFlowStore((s) => s.system);
  const selectedWall = useTileFlowStore((s) => s.selectedWall);
  const setSelectedWall = useTileFlowStore((s) => s.setSelectedWall);
  const moveShapeVertex = useTileFlowStore((s) => s.moveShapeVertex);
  const beginVertexDrag = useTileFlowStore((s) => s.beginVertexDrag);
  const endVertexDrag = useTileFlowStore((s) => s.endVertexDrag);

  const display = roomDisplay(system);
  const gridMM = snapGridMM(system);
  const referenceWall = shape.referenceWall;

  const walls = useMemo(() => wallsOf(shape.boundary), [shape.boundary]);
  const center = useMemo(() => centroidOf(shape.boundary), [shape.boundary]);

  const handleVertexDrag = useCallback(
    (ring: number, index: number, e: KonvaEventObject<DragEvent>) => {
      const raw = { x: e.target.x(), y: e.target.y() };
      const ringVerts =
        ring === 0 ? shape.boundary.vertices : shape.holes[ring - 1].vertices;
      const anchor = ringVerts[(index - 1 + ringVerts.length) % ringVerts.length];

      const snapped = snapPoint(raw, {
        anchor,
        // Don't let a corner snap to itself.
        vertices: ringVerts.filter((_, i) => i !== index),
        gridMM,
        freeAngle: (e.evt as unknown as { shiftKey?: boolean })?.shiftKey ?? false,
        scale,
      });

      e.target.position(snapped.point);
      moveShapeVertex(ring, index, snapped.point);
    },
    [shape, gridMM, scale, moveShapeVertex]
  );

  return (
    <Group>
      {/* Cut-outs, painted over the tiles to punch them through */}
      {shape.holes.map((hole, i) => (
        <Line
          key={`hole-${i}`}
          points={flatPoints(hole)}
          closed
          fill={HOLE_FILL}
          stroke={HOLE_STROKE}
          strokeWidth={1.5 / scale}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}

      {/* Wall lines — each is separately hittable so a wall can be picked */}
      {walls.map((wall) => {
        const isReference = referenceWall === wall.index;
        const isSelected = selectedWall === wall.index;
        return (
          <Line
            key={`wall-${wall.index}`}
            points={[wall.a.x, wall.a.y, wall.b.x, wall.b.y]}
            stroke={
              isReference ? REFERENCE_COLOR : isSelected ? SELECTED_COLOR : OUTLINE_COLOR
            }
            strokeWidth={(isReference || isSelected ? 3.5 : 2) / scale}
            hitStrokeWidth={14 / scale}
            listening={interactive}
            onClick={() => setSelectedWall(isSelected ? null : wall.index)}
            onTap={() => setSelectedWall(isSelected ? null : wall.index)}
            perfectDrawEnabled={false}
          />
        );
      })}

      {/* Dimension on every wall */}
      {walls.map((wall) => {
        const dx = wall.b.x - wall.a.x;
        const dy = wall.b.y - wall.a.y;
        const len = Math.hypot(dx, dy) || 1;
        // Normal pointing away from the room's middle.
        let nx = -dy / len;
        let ny = dx / len;
        const mid = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 };
        if ((mid.x + nx - center.x) ** 2 + (mid.y + ny - center.y) ** 2 <
            (mid.x - center.x) ** 2 + (mid.y - center.y) ** 2) {
          nx = -nx;
          ny = -ny;
        }

        return (
          <WallLabel
            key={`label-${wall.index}`}
            a={wall.a}
            b={wall.b}
            outward={{ x: nx, y: ny }}
            scale={scale}
            color={
              referenceWall === wall.index
                ? REFERENCE_COLOR
                : selectedWall === wall.index
                ? SELECTED_COLOR
                : LABEL_COLOR
            }
            text={formatDisplayFromMM(wall.length, display.unit, display.imperialFormat)}
          />
        );
      })}

      {/* Corner handles */}
      {interactive &&
        shape.boundary.vertices.map((v, i) => (
          <Circle
            key={`corner-${i}`}
            x={v.x}
            y={v.y}
            radius={5.5 / scale}
            fill={HANDLE_FILL}
            stroke={HANDLE_STROKE}
            strokeWidth={1.5 / scale}
            draggable
            onDragStart={beginVertexDrag}
            onDragMove={(e) => handleVertexDrag(0, i, e)}
            onDragEnd={endVertexDrag}
            perfectDrawEnabled={false}
          />
        ))}

      {interactive &&
        shape.holes.map((hole, ring) =>
          hole.vertices.map((v, i) => (
            <Circle
              key={`hole-${ring}-corner-${i}`}
              x={v.x}
              y={v.y}
              radius={4.5 / scale}
              fill={HOLE_STROKE}
              stroke={HANDLE_STROKE}
              strokeWidth={1.5 / scale}
              draggable
              onDragStart={beginVertexDrag}
              onDragMove={(e) => handleVertexDrag(ring + 1, i, e)}
              onDragEnd={endVertexDrag}
              perfectDrawEnabled={false}
            />
          ))
        )}
    </Group>
  );
}
