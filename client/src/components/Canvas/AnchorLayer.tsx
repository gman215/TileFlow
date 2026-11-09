import React from 'react';
import { Circle, Group, Line } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { anchorIssue, patternFrameFor } from '@tileflow/geometry';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { anchorAtDrop } from './anchorPick';

const ANCHOR = '#F59E0B';
const BAD = '#F87171';

/**
 * The layout anchor on the canvas (011 AC-3.2): a crosshair where the tile is
 * set out from, and for an edge anchor the edge itself. Drag it and it snaps to
 * cut-out centres, cut-out edge midpoints and wall midpoints — or stays a free
 * point. Red when it has ended up somewhere it should not be (AC-3.5).
 */
export default function AnchorLayer({ scale, interactive }: { scale: number; interactive: boolean }) {
  const room = useTileFlowStore((s) => s.room);
  const setLayoutAnchor = useTileFlowStore((s) => s.setLayoutAnchor);
  const anchor = room.shape?.anchor ?? room.anchor;
  const frame = anchor ? patternFrameFor(room) : undefined;
  if (!anchor || !frame) return null;

  const color = room.shape && anchorIssue(room.shape) ? BAD : ANCHOR;
  const r = 9 / scale;
  const arm = 16 / scale;
  const edge =
    anchor.kind === 'hole-edge' && room.shape
      ? (() => {
          const v = room.shape.holes[anchor.hole]?.vertices;
          if (!v) return null;
          const a = v[anchor.edge];
          const b = v[(anchor.edge + 1) % v.length];
          return a && b ? [a.x, a.y, b.x, b.y] : null;
        })()
      : null;

  const onDragEnd = (e: KonvaEventObject<DragEvent>) => {
    const next = anchorAtDrop(room, { x: e.target.x(), y: e.target.y() }, scale);
    // Keep "full tiles from this edge" when the marker lands back on an edge.
    const keep = anchor.kind === 'hole-edge' && anchor.fullTilesFromEdge && next.kind === 'hole-edge';
    setLayoutAnchor(keep ? { ...next, fullTilesFromEdge: true } : next);
    e.target.position(frame.origin); // the store re-renders it where it resolved
  };

  return (
    <>
      {edge && <Line points={edge} stroke={color} strokeWidth={4 / scale} opacity={0.8} listening={false} />}
      <Group
        x={frame.origin.x}
        y={frame.origin.y}
        draggable={interactive}
        onDragEnd={onDragEnd}
        onMouseEnter={(e) => { const c = e.target.getStage()?.container(); if (c && interactive) c.style.cursor = 'move'; }}
        onMouseLeave={(e) => { const c = e.target.getStage()?.container(); if (c) c.style.cursor = ''; }}
      >
        <Circle radius={r * 1.8} fill="transparent" />
        <Circle radius={r} stroke={color} strokeWidth={2 / scale} />
        <Line points={[-arm, 0, arm, 0]} stroke={color} strokeWidth={1.5 / scale} />
        <Line points={[0, -arm, 0, arm]} stroke={color} strokeWidth={1.5 / scale} />
        <Circle radius={2 / scale} fill={color} />
      </Group>
    </>
  );
}
