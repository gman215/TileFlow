import React, { useCallback, useMemo, useRef } from 'react';
import { Line, Circle, Text, Group } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Context } from 'konva/lib/Context';
import type { Polygon, Vec2, WallSolid } from '@tileflow/geometry';
import { layerBoundaries, polygonArea, wallsOf } from '@tileflow/geometry';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { formatDisplayFromMM, roomDisplay } from '../../utils/measurements';
import { snapPoint, snapGridMM } from '../../utils/snapping';

const WALL_FINISH = '#C9C5BB';
const WALL_CORE = '#8E897D';
const HATCH = 'rgba(27,26,24,0.35)';
const LAYER_LINE = 'rgba(27,26,24,0.45)';
const SELECTED = '#F59E0B';
const ROOM_FILL = '#26241F';
const HOLE_FILL = '#1B1A18';
const HOLE_STROKE = 'rgba(255,255,255,0.35)';
const LABEL = 'rgba(255,255,255,0.82)';
const LABEL_MUTED = 'rgba(255,255,255,0.55)';
const WARN = '#F87171';
const GROUP_COLOR = '#93C5FD';
const HANDLE_FILL = '#D6D3CC';
const HANDLE_STROKE = '#1B1A18';

const MM2_PER_M2 = 1_000_000;
const MM2_PER_FT2 = 92_903.04;

/** Layer lines appear once a ½″ layer is at least this wide on screen (AC-9.1). */
const LAYER_LINES_MIN_PX = 3;

function flat(poly: Polygon): number[] {
  const out: number[] = [];
  for (const v of poly.vertices) out.push(v.x, v.y);
  return out;
}

function tracePolygon(ctx: Context, poly: Polygon) {
  const v = poly.vertices;
  ctx.beginPath();
  ctx.moveTo(v[0].x, v[0].y);
  for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
  ctx.closePath();
}

/**
 * Is this ring a rectangle (four right angles)? Then its dimensions are worth
 * printing — width first, as a plan is read, whichever corner the ring starts at.
 */
function rectDims(poly: Polygon): { w: number; h: number } | null {
  const walls = wallsOf(poly);
  if (walls.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const a = walls[i];
    const b = walls[(i + 1) % 4];
    const dot = Math.cos(a.angle) * Math.cos(b.angle) + Math.sin(a.angle) * Math.sin(b.angle);
    if (Math.abs(dot) > 1e-6) return null;
  }
  const horizontalFirst = Math.abs(Math.cos(walls[0].angle)) >= Math.abs(Math.sin(walls[0].angle));
  return horizontalFirst
    ? { w: walls[0].length, h: walls[1].length }
    : { w: walls[1].length, h: walls[0].length };
}

/** Dimension text along an edge, pushed toward `toward` and kept upright. */
function EdgeLabel({
  a,
  b,
  text,
  scale,
  toward,
  color,
}: {
  a: Vec2;
  b: Vec2;
  text: string;
  scale: number;
  toward: Vec2;
  color: string;
}) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len * scale < 40) return null;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let nx = -(b.y - a.y) / len;
  let ny = (b.x - a.x) / len;
  if (nx * (toward.x - mid.x) + ny * (toward.y - mid.y) < 0) {
    nx = -nx;
    ny = -ny;
  }
  let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (deg > 90 || deg < -90) deg += 180;
  const rad = (deg * Math.PI) / 180;
  const fontSize = 12 / scale;
  const gap = 10 / scale;
  // Text is drawn from its top-left; centre it on the edge, then step inward.
  const cx = mid.x + nx * (gap + fontSize / 2);
  const cy = mid.y + ny * (gap + fontSize / 2);
  return (
    <Text
      x={cx - (Math.cos(rad) * len) / 2 + (Math.sin(rad) * fontSize) / 2}
      y={cy - (Math.sin(rad) * len) / 2 - (Math.cos(rad) * fontSize) / 2}
      width={len}
      align="center"
      rotation={deg}
      text={text}
      fontSize={fontSize}
      fill={color}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

interface Props {
  scale: number;
  /** Selection, node and wall dragging are live (select tool, not drawing) */
  interactive: boolean;
}

/**
 * The floor plan above the tiles: cut-outs, walls drawn as solid poché with
 * their layers, room labels, dimension strings and, in the select tool, the
 * handles that edit them. Room floors and tiles are drawn underneath by
 * TileCanvas, which already knows how to draw tiles.
 */
export default function PlanLayer({ scale, interactive }: Props) {
  const plan = useTileFlowStore((s) => s.plan);
  const derived = useTileFlowStore((s) => s.derived);
  const system = useTileFlowStore((s) => s.system);
  const activeRoomId = useTileFlowStore((s) => s.activeRoomId);
  const selectedWallId = useTileFlowStore((s) => s.selectedWallId);
  const dimensionMode = useTileFlowStore((s) => s.dimensionMode);
  const openEnds = useTileFlowStore((s) => s.openEndHighlights);
  const selectWall = useTileFlowStore((s) => s.selectWall);
  const movePlanNode = useTileFlowStore((s) => s.movePlanNode);
  const moveWall = useTileFlowStore((s) => s.moveWall);
  const beginDrag = useTileFlowStore((s) => s.beginVertexDrag);
  const endDrag = useTileFlowStore((s) => s.endVertexDrag);

  const display = roomDisplay(system);
  const gridMM = snapGridMM(system);
  const imperial = system === 'imperial';
  const fmt = useCallback(
    (mm: number) => formatDisplayFromMM(mm, display.unit, display.imperialFormat),
    [display.unit, display.imperialFormat]
  );

  const assemblies = useMemo(
    () => new Map((plan?.assemblies ?? []).map((a) => [a.id, a])),
    [plan?.assemblies]
  );
  const nodes = useMemo(
    () => new Map((plan?.nodes ?? []).map((n) => [n.id, n.position])),
    [plan?.nodes]
  );

  const showLayers = scale * 12.7 >= LAYER_LINES_MIN_PX;

  // Parallel wall drags move by the increment since the last event; Konva
  // reports the cumulative drag, so remember where we were.
  const dragLast = useRef<Vec2>({ x: 0, y: 0 });

  if (!plan || !derived) return null;

  const finishSolids = derived.finishGeometry.solids;

  const wallLayers = (solid: WallSolid) => {
    const wall = plan.walls.find((w) => w.id === solid.wallId);
    const assembly = wall && assemblies.get(wall.assemblyId);
    const a = wall && nodes.get(wall.a);
    const b = wall && nodes.get(wall.b);
    if (!wall || !assembly || !a || !b) return null;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = { x: -u.y, y: u.x };
    // Run the lines well past the ends; the clip trims them to the mitre.
    const reach = len + 2000;
    const bounds = layerBoundaries(wall, assembly).slice(1, -1);
    return bounds.map((o, i) => (
      <Line
        key={i}
        points={[
          a.x - u.x * 1000 + n.x * o,
          a.y - u.y * 1000 + n.y * o,
          a.x + u.x * reach + n.x * o,
          a.y + u.y * reach + n.y * o,
        ]}
        stroke={LAYER_LINE}
        strokeWidth={1 / scale}
        listening={false}
        perfectDrawEnabled={false}
      />
    ));
  };

  /** Diagonal hatch across a core footprint, clipped to it. */
  const hatch = (poly: Polygon) => {
    const xs = poly.vertices.map((v) => v.x);
    const ys = poly.vertices.map((v) => v.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const step = Math.max(25, 10 / scale);
    const lines: number[][] = [];
    for (let k = minX - (maxY - minY); k < maxX; k += step) {
      lines.push([k, maxY, k + (maxY - minY), minY]);
    }
    return lines.map((pts, i) => (
      <Line key={i} points={pts} stroke={HATCH} strokeWidth={1 / scale} listening={false} perfectDrawEnabled={false} />
    ));
  };

  const areaText = (mm2: number) =>
    imperial ? `${(mm2 / MM2_PER_FT2).toFixed(1)} ft²` : `${(mm2 / MM2_PER_M2).toFixed(2)} m²`;

  return (
    <Group>
      {/* Hand-drawn cut-outs, painted over the tiles */}
      {plan.rooms.flatMap((r) =>
        r.holes.map((h, i) => (
          <Line
            key={`${r.id}-hole-${i}`}
            points={flat(h)}
            closed
            fill={HOLE_FILL}
            stroke={HOLE_STROKE}
            strokeWidth={1.5 / scale}
            listening={false}
            perfectDrawEnabled={false}
          />
        ))
      )}

      {/* Wall poché: finish layers, then the core on top */}
      {[...finishSolids.map((s) => s.polygon), ...derived.finishGeometry.caps].map((p, i) => (
        <Line key={`fin-${i}`} points={flat(p)} closed fill={WALL_FINISH} listening={false} perfectDrawEnabled={false} />
      ))}
      {[...derived.coreGeometry.solids.map((s) => s.polygon), ...derived.coreGeometry.caps].map((p, i) => (
        <Line key={`core-${i}`} points={flat(p)} closed fill={WALL_CORE} listening={false} perfectDrawEnabled={false} />
      ))}
      {showLayers &&
        derived.coreGeometry.solids.map((s) => (
          <Group key={`hatch-${s.wallId}`} clipFunc={(ctx: Context) => tracePolygon(ctx, s.polygon)} listening={false}>
            {hatch(s.polygon)}
          </Group>
        ))}
      {showLayers &&
        finishSolids.map((s) => (
          <Group key={`layers-${s.wallId}`} clipFunc={(ctx: Context) => tracePolygon(ctx, s.polygon)} listening={false}>
            {wallLayers(s)}
          </Group>
        ))}

      {/* Selected wall */}
      {selectedWallId &&
        finishSolids
          .filter((s) => s.wallId === selectedWallId)
          .map((s) => (
            <Line
              key="selected"
              points={flat(s.polygon)}
              closed
              stroke={SELECTED}
              strokeWidth={2.5 / scale}
              listening={false}
              perfectDrawEnabled={false}
            />
          ))}

      {/* Dimension strings */}
      {dimensionMode === 'clear'
        ? plan.rooms.map((r) => {
            const d = derived.rooms.get(r.id);
            if (!d?.finishBoundary || d.status === 'not-enclosed') return null;
            const v = d.finishBoundary.vertices;
            return v.map((p, i) => (
              <EdgeLabel
                key={`${r.id}-dim-${i}`}
                a={p}
                b={v[(i + 1) % v.length]}
                text={fmt(Math.hypot(v[(i + 1) % v.length].x - p.x, v[(i + 1) % v.length].y - p.y))}
                scale={scale}
                toward={d.labelPoint ?? r.seed}
                color={LABEL_MUTED}
              />
            ));
          })
        : plan.walls.map((w) => {
            const a = nodes.get(w.a);
            const b = nodes.get(w.b);
            if (!a || !b) return null;
            // Centreline figures sit on the wall's left side, clear of the clear-dimension strings.
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const away = {
              x: (a.x + b.x) / 2 + (b.y - a.y) / len,
              y: (a.y + b.y) / 2 - (b.x - a.x) / len,
            };
            return (
              <EdgeLabel
                key={`cl-${w.id}`}
                a={a}
                b={b}
                text={fmt(Math.hypot(b.x - a.x, b.y - a.y))}
                scale={scale}
                toward={away}
                color={LABEL_MUTED}
              />
            );
          })}

      {/* Room labels */}
      {plan.rooms.map((r) => {
        const d = derived.rooms.get(r.id);
        const fontSize = 13 / scale;
        const lines: { text: string; color: string; bold?: boolean }[] = [
          { text: r.name, color: r.id === activeRoomId ? '#FFFFFF' : LABEL, bold: true },
        ];
        if (d?.status === 'ok' && d.finishBoundary) {
          lines.push({ text: areaText(polygonArea(d.finishBoundary)), color: LABEL });
          const dims = rectDims(d.finishBoundary);
          if (dims) lines.push({ text: `${fmt(dims.w)} × ${fmt(dims.h)}`, color: LABEL_MUTED });
        } else if (d?.status === 'redundant') {
          lines.push({ text: '⚠ Redundant room — delete one', color: WARN });
        } else {
          lines.push({ text: '⚠ Not enclosed', color: WARN });
        }
        if (r.groupId) lines.push({ text: '⇄ pattern group', color: GROUP_COLOR });
        const width = 260 / scale;
        const at = d?.labelPoint ?? r.seed;
        return (
          <Group key={`label-${r.id}`} x={at.x - width / 2} y={at.y - (lines.length * fontSize * 1.35) / 2} listening={false}>
            {lines.map((l, i) => (
              <Text
                key={i}
                y={i * fontSize * 1.35}
                width={width}
                align="center"
                text={l.text}
                fontSize={i === 0 ? fontSize * 1.1 : fontSize * 0.92}
                fontStyle={l.bold ? 'bold' : 'normal'}
                fill={l.color}
                perfectDrawEnabled={false}
              />
            ))}
          </Group>
        );
      })}

      {/* Open ends, after a room could not be placed */}
      {openEnds.map((p, i) => (
        <Circle key={`open-${i}`} x={p.x} y={p.y} radius={9 / scale} stroke={WARN} strokeWidth={2.5 / scale} listening={false} />
      ))}

      {/* Wall pick + parallel drag targets, along each location line */}
      {interactive &&
        plan.walls.map((w) => {
          const a = nodes.get(w.a);
          const b = nodes.get(w.b);
          if (!a || !b) return null;
          return (
            <Line
              key={`hit-${w.id}`}
              points={[a.x, a.y, b.x, b.y]}
              stroke="transparent"
              hitStrokeWidth={Math.max(14 / scale, 120)}
              draggable
              onClick={(e) => {
                e.cancelBubble = true;
                selectWall(w.id === selectedWallId ? null : w.id);
              }}
              onTap={(e) => {
                e.cancelBubble = true;
                selectWall(w.id);
              }}
              onDragStart={(e: KonvaEventObject<DragEvent>) => {
                e.cancelBubble = true;
                dragLast.current = { x: 0, y: 0 };
                selectWall(w.id);
                beginDrag();
              }}
              onDragMove={(e: KonvaEventObject<DragEvent>) => {
                const pos = { x: e.target.x(), y: e.target.y() };
                const delta = { x: pos.x - dragLast.current.x, y: pos.y - dragLast.current.y };
                dragLast.current = pos;
                moveWall(w.id, delta);
              }}
              onDragEnd={(e: KonvaEventObject<DragEvent>) => {
                e.target.position({ x: 0, y: 0 });
                endDrag();
              }}
              perfectDrawEnabled={false}
            />
          );
        })}

      {/* Node handles */}
      {interactive &&
        plan.nodes.map((n) => (
          <Circle
            key={`node-${n.id}`}
            x={n.position.x}
            y={n.position.y}
            radius={5.5 / scale}
            fill={HANDLE_FILL}
            stroke={HANDLE_STROKE}
            strokeWidth={1.5 / scale}
            draggable
            onDragStart={(e) => {
              e.cancelBubble = true;
              beginDrag();
            }}
            onDragMove={(e: KonvaEventObject<DragEvent>) => {
              const snapped = snapPoint(
                { x: e.target.x(), y: e.target.y() },
                {
                  anchor: null,
                  vertices: plan.nodes.filter((m) => m.id !== n.id).map((m) => m.position),
                  gridMM,
                  freeAngle: true,
                  scale,
                }
              );
              e.target.position(snapped.point);
              movePlanNode(n.id, snapped.point);
            }}
            onDragEnd={endDrag}
            perfectDrawEnabled={false}
          />
        ))}
    </Group>
  );
}
