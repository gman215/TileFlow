/**
 * Turning a click or a drag into a layout anchor (011 R3, AC-3.2) — the pure
 * half, so the rules can be tested without a canvas.
 *
 * A click, in priority order:
 *   1. within `edgePx` of a cut-out's edge → that edge (the tub front);
 *   2. inside a cut-out                    → its centre;
 *   3. on the floor                        → that point;
 *   4. anywhere else                       → refused (null).
 * The edge is tested before "inside" because a click just inside the tub
 * front means the front.
 *
 * A dragged marker snaps, within `snapPx`, to cut-out centres, cut-out edge
 * midpoints and wall midpoints; otherwise it lands as a free point.
 */

import type { LayoutAnchor, Room, Vec2 } from '@tileflow/geometry';
import { pointInPolygon, polygonCentroid, rectShape, wallsOf } from '@tileflow/geometry';

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

export function anchorAtClick(room: Room, p: Vec2, scale: number, edgePx = 12): LayoutAnchor | null {
  const shape = room.shape ?? rectShape(room.width, room.height);
  const tol = edgePx / scale;
  // 1. Nearest cut-out edge within reach.
  let best: { hole: number; edge: number; d: number } | null = null;
  shape.holes.forEach((h, hole) => {
    h.vertices.forEach((a, edge) => {
      const b = h.vertices[(edge + 1) % h.vertices.length];
      const d = distanceToSegment(p, a, b);
      if (d <= tol && (!best || d < best.d)) best = { hole, edge, d };
    });
  });
  if (best) return { kind: 'hole-edge', hole: (best as { hole: number }).hole, edge: (best as { edge: number }).edge };
  // 2. Inside a cut-out.
  const inHole = shape.holes.findIndex((h) => pointInPolygon(p, h));
  if (inHole >= 0) return { kind: 'hole-centre', hole: inHole };
  // 3. On the floor.
  if (pointInPolygon(p, shape.boundary)) return { kind: 'point', at: { x: p.x, y: p.y } };
  return null;
}

/** Where a dragged marker lands: a snap target within reach, or a free point. */
export function anchorAtDrop(room: Room, p: Vec2, scale: number, snapPx = 14): LayoutAnchor {
  const shape = room.shape ?? rectShape(room.width, room.height);
  const tol = snapPx / scale;
  const targets: { at: Vec2; anchor: LayoutAnchor }[] = [];
  shape.holes.forEach((h, hole) => {
    targets.push({ at: polygonCentroid(h), anchor: { kind: 'hole-centre', hole } });
    h.vertices.forEach((a, edge) => {
      const b = h.vertices[(edge + 1) % h.vertices.length];
      targets.push({ at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, anchor: { kind: 'hole-edge', hole, edge } });
    });
  });
  for (const w of wallsOf(shape.boundary)) {
    const m = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
    targets.push({ at: m, anchor: { kind: 'point', at: m } });
  }
  let best: { anchor: LayoutAnchor; d: number } | null = null;
  for (const t of targets) {
    const d = dist(p, t.at);
    if (d <= tol && (!best || d < best.d)) best = { anchor: t.anchor, d };
  }
  return best ? best.anchor : { kind: 'point', at: { x: p.x, y: p.y } };
}

/** A short name for the anchor, for the sidebar row and the AI snapshot. */
export function anchorLabel(room: Room, islands = 0): string | null {
  const a = room.shape?.anchor ?? room.anchor;
  if (!a) return null;
  if (a.kind === 'point') return 'A point on the floor';
  // In a plan the layout room lists free-standing islands before the cut-outs
  // the user drew; number the cut-outs as the user knows them.
  const n = a.hole - islands + 1;
  if (a.kind === 'hole-centre') return `Cut-out ${n} — centre`;
  return `Cut-out ${n} — edge ${a.edge + 1}${a.fullTilesFromEdge ? ', full tiles from it' : ''}`;
}
