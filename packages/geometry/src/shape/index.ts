/**
 * Editing operations for drawn room outlines.
 *
 * These are the moves an installer makes on a floor plan: read the walls off
 * the outline, retype a wall length, drag a corner, add or remove one. All
 * lengths are mm and all polygons are implicitly closed.
 */

import { LayoutAnchor, PatternType, Polygon, Room, RoomShape, Vec2 } from '../types';
import {
  polygonArea,
  polygonCentroid,
  polygonPerimeter,
  normalizeShape,
  pointInPolygon,
} from '../utils/math';

export interface Wall {
  /** Edge index: the wall runs from vertex `index` to vertex `index + 1` */
  index: number;
  a: Vec2;
  b: Vec2;
  /** Length in mm */
  length: number;
  /** Direction in radians, measured the way the canvas draws it */
  angle: number;
}

/** Read the walls off an outline, in drawing order. */
export function wallsOf(poly: Polygon): Wall[] {
  const v = poly.vertices;
  const n = v.length;
  const walls: Wall[] = [];
  for (let i = 0; i < n; i++) {
    const a = v[i];
    const b = v[(i + 1) % n];
    walls.push({
      index: i,
      a,
      b,
      length: Math.hypot(b.x - a.x, b.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    });
  }
  return walls;
}

/**
 * Retype a wall's length.
 *
 * The wall keeps its start corner and direction; its far corner slides along
 * it. What happens to the rest of the outline depends on the shape:
 *
 *  - **Square corners** (the wall two along is parallel to this one, which is
 *    every rectangle, L, U and T): only the two corners of the adjoining wall
 *    move, so that wall stays rigid and the parallel wall opposite absorbs the
 *    change. A rectangle stays a rectangle; an L stays square.
 *  - **Anything else** (bays, angled walls): the rest of the outline is
 *    carried along and the closing wall takes up the slack, the way a measured
 *    chain behaves. The UI labels that wall as automatic.
 */
export function setWallLength(
  poly: Polygon,
  index: number,
  lengthMM: number
): Polygon {
  const v = poly.vertices;
  const n = v.length;
  if (n < 3 || index < 0 || index >= n || lengthMM <= 0) return poly;

  const a = v[index];
  const b = v[(index + 1) % n];
  const current = Math.hypot(b.x - a.x, b.y - a.y);
  if (current < 1e-9) return poly;

  const ux = (b.x - a.x) / current;
  const uy = (b.y - a.y) / current;
  const delta = lengthMM - current;
  const dx = ux * delta;
  const dy = uy * delta;

  const moved = v.map((p) => ({ ...p }));

  // Is the wall two along parallel (or anti-parallel) to this one? If so the
  // outline can take the change locally and stay square.
  const c = v[(index + 2) % n];
  const d = v[(index + 3) % n];
  const len2 = Math.hypot(d.x - c.x, d.y - c.y);
  const parallelAhead =
    n >= 4 && len2 > 1e-9 && Math.abs(ux * ((d.y - c.y) / len2) - uy * ((d.x - c.x) / len2)) < 1e-6;

  if (parallelAhead) {
    for (const i of [(index + 1) % n, (index + 2) % n]) {
      moved[i] = { x: v[i].x + dx, y: v[i].y + dy };
    }
    return { vertices: moved };
  }

  // Chain fallback: carry everything after the wall; the closing wall absorbs.
  for (let step = 1; step < n; step++) {
    const i = (index + step) % n;
    moved[i] = { x: v[i].x + dx, y: v[i].y + dy };
  }

  return { vertices: moved };
}

/** Move one corner to a new position. */
export function moveVertex(poly: Polygon, index: number, to: Vec2): Polygon {
  if (index < 0 || index >= poly.vertices.length) return poly;
  const vertices = poly.vertices.map((p, i) => (i === index ? { ...to } : { ...p }));
  return { vertices };
}

/** Split a wall by dropping a new corner on it. */
export function insertVertex(poly: Polygon, wallIndex: number, at: Vec2): Polygon {
  const v = poly.vertices;
  if (wallIndex < 0 || wallIndex >= v.length) return poly;
  const vertices = [...v.map((p) => ({ ...p }))];
  vertices.splice(wallIndex + 1, 0, { ...at });
  return { vertices };
}

/** Remove a corner. A triangle is the smallest outline we allow. */
export function deleteVertex(poly: Polygon, index: number): Polygon {
  const v = poly.vertices;
  if (v.length <= 3 || index < 0 || index >= v.length) return poly;
  return { vertices: v.filter((_, i) => i !== index).map((p) => ({ ...p })) };
}

// ─── Validation ───────────────────────────────────────────────────────────────

function segmentsCross(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d = (a: Vec2, b: Vec2, c: Vec2) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);

  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

/**
 * Does the outline cross itself? A bow-tie is not a floor, and it makes area
 * and clipping meaningless, so the UI warns instead of tiling it.
 */
export function isSelfIntersecting(poly: Polygon): boolean {
  const v = poly.vertices;
  const n = v.length;
  if (n < 4) return false;

  for (let i = 0; i < n; i++) {
    const a1 = v[i];
    const a2 = v[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Skip the neighbouring segments that legitimately share a vertex.
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsCross(a1, a2, v[j], v[(j + 1) % n])) return true;
    }
  }
  return false;
}

export interface ShapeIssue {
  kind: 'self-intersecting' | 'too-few-corners' | 'zero-area' | 'hole-outside';
  message: string;
}

/** Everything that would stop this outline from being tiled. */
export function validateShape(shape: RoomShape): ShapeIssue[] {
  const issues: ShapeIssue[] = [];

  if (shape.boundary.vertices.length < 3) {
    issues.push({
      kind: 'too-few-corners',
      message: 'A room needs at least three corners.',
    });
    return issues;
  }

  // Checked first: a crossed outline is usually the cause of a zero area, and
  // it is the issue the user can actually act on.
  if (isSelfIntersecting(shape.boundary)) {
    issues.push({
      kind: 'self-intersecting',
      message: 'The outline crosses itself — drag a corner to untangle it.',
    });
  }

  if (polygonArea(shape.boundary) < 1) {
    issues.push({ kind: 'zero-area', message: 'This outline encloses no floor.' });
  }

  for (const hole of shape.holes) {
    if (isSelfIntersecting(hole)) {
      issues.push({
        kind: 'self-intersecting',
        message: 'A cut-out crosses itself.',
      });
      break;
    }
  }

  // A cut-out drawn partly outside the room is almost always a misclick, and
  // it would silently do nothing to the tile count.
  const strayHole = shape.holes.some((hole) =>
    hole.vertices.some((v) => !pointInPolygon(v, shape.boundary))
  );
  if (strayHole) {
    issues.push({
      kind: 'hole-outside',
      message: 'A cut-out reaches outside the room — drag it back inside.',
    });
  }

  return issues;
}


// ─── Keeping an anchor true through edits (011 AC-3.5) ────────────────────────

/**
 * The anchor after cut-out `holeIndex` is deleted: cleared if it was on that
 * cut-out, renumbered if it was on a later one. Returned with whether it was
 * cleared, so the caller can say so.
 */
export function anchorAfterHoleDeleted(
  anchor: LayoutAnchor | undefined,
  holeIndex: number
): { anchor: LayoutAnchor | undefined; cleared: boolean } {
  if (!anchor || anchor.kind === 'point') return { anchor, cleared: false };
  if (anchor.hole === holeIndex) return { anchor: undefined, cleared: true };
  return { anchor: anchor.hole > holeIndex ? { ...anchor, hole: anchor.hole - 1 } : anchor, cleared: false };
}

/**
 * The anchor after corner `vertexIndex` of cut-out `holeIndex` is deleted
 * (from a ring of `vertexCount` corners). The two edges meeting at that corner
 * become one new edge, so an edge anchor on either is cleared — it no longer
 * names the line the user picked; later edges are renumbered.
 */
export function anchorAfterHoleVertexDeleted(
  anchor: LayoutAnchor | undefined,
  holeIndex: number,
  vertexIndex: number,
  vertexCount: number
): { anchor: LayoutAnchor | undefined; cleared: boolean } {
  if (anchor?.kind !== 'hole-edge' || anchor.hole !== holeIndex || vertexCount <= 3) return { anchor, cleared: false };
  const before = (vertexIndex - 1 + vertexCount) % vertexCount;
  if (anchor.edge === vertexIndex || anchor.edge === before) return { anchor: undefined, cleared: true };
  return { anchor: anchor.edge > vertexIndex ? { ...anchor, edge: anchor.edge - 1 } : anchor, cleared: false };
}

/**
 * Why the anchor needs attention, or null. Flagged, not refused: a point that
 * ends up outside the floor after an edit still lays the tile out from where
 * it is, and the user decides whether to move it.
 */
export function anchorIssue(shape: RoomShape): string | null {
  const a = shape.anchor;
  if (!a) return null;
  if (a.kind === 'point') {
    const onFloor = pointInPolygon(a.at, shape.boundary) && !shape.holes.some((h) => pointInPolygon(a.at, h));
    return onFloor ? null : 'The layout anchor is outside the floor — drag it back, or clear it.';
  }
  if (!shape.holes[a.hole]) return 'The layout anchor\'s cut-out no longer exists.';
  return null;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

/** Fold an angle into ±45° so a quarter turn never spins the layout. */
function foldQuarter(angle: number): number {
  const quarter = Math.PI / 2;
  return (((angle + Math.PI / 4) % quarter) + quarter) % quarter - Math.PI / 4;
}

/** The reference wall's frame, or undefined. */
function referenceFrame(shape: RoomShape): { origin: Vec2; angle: number } | undefined {
  if (shape.referenceWall == null) return undefined;
  const wall = wallsOf(shape.boundary)[shape.referenceWall];
  if (!wall || wall.length < 1e-9) return undefined;
  return {
    origin: { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 },
    angle: foldQuarter(wall.angle),
  };
}

/** The edge an edge anchor names, or null when it no longer exists. */
function anchorEdge(shape: RoomShape, anchor: Extract<LayoutAnchor, { kind: 'hole-edge' }>): [Vec2, Vec2] | null {
  const v = shape.holes[anchor.hole]?.vertices;
  if (!v || v.length < 3 || anchor.edge < 0 || anchor.edge >= v.length) return null;
  const a = v[anchor.edge];
  const b = v[(anchor.edge + 1) % v.length];
  return Math.hypot(b.x - a.x, b.y - a.y) < 1e-9 ? null : [a, b];
}

/**
 * The anchor's origin and direction, or undefined when there is no anchor or
 * it names a cut-out that no longer exists (the layout then falls back to the
 * room, rather than to a stale point).
 */
export function resolveAnchor(shape: RoomShape): { origin: Vec2; angle: number } | undefined {
  const anchor = shape.anchor;
  if (!anchor) return undefined;
  // Centre and point anchors keep the room's direction — squared to the
  // reference wall if one is picked, else axis-aligned.
  const angle = referenceFrame(shape)?.angle ?? 0;
  if (anchor.kind === 'point') return { origin: anchor.at, angle };
  if (anchor.kind === 'hole-centre') {
    const hole = shape.holes[anchor.hole];
    return hole && hole.vertices.length >= 3 ? { origin: polygonCentroid(hole), angle } : undefined;
  }
  // An edge anchor squares the grid to that edge: the tub front, not the wall.
  const edge = anchorEdge(shape, anchor);
  if (!edge) return undefined;
  const [a, b] = edge;
  return { origin: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle: foldQuarter(Math.atan2(b.y - a.y, b.x - a.x)) };
}

/**
 * The frame the pattern is set out from.
 *
 * With an anchor (011), the grid is set out from that feature. Otherwise, with
 * a reference wall picked, the grid runs parallel to that wall and is anchored
 * on its midpoint — how a floor is actually set out, squared to the main sight
 * line rather than to the bounding box. Angles are folded into ±45° so picking
 * any wall of a rectangle gives the same layout instead of spinning it a
 * quarter turn.
 */
export function patternFrameFor(
  room: Room
): { origin: Vec2; angle: number } | undefined {
  const shape = room.shape;
  if (!shape) return room.anchor ? { origin: room.anchor.at, angle: 0 } : undefined;
  return resolveAnchor(shape) ?? referenceFrame(shape);
}

/**
 * For an edge anchor with "full tiles from this edge": which frame axis runs
 * along the edge. The other axis gets a joint on the edge. Null when the rule
 * does not apply, with the reason the UI shows (011 AC-3.6).
 *
 * The frame's angle is the edge's folded into ±45°, so the edge runs along the
 * frame's x axis unless folding turned it a quarter, when it runs along y.
 * Grid works either way. Offset patterns stagger their rows along x, so an
 * edge across the rows would start a full tile on every other row only.
 * Herringbone and 45° diagonal have no joint parallel to the edge at all.
 */
export function fullTilesFromEdgeAxis(
  shape: RoomShape | undefined,
  pattern: PatternType
): { along: 'x' | 'y' } | { along: null; reason: string } {
  const anchor = shape?.anchor;
  if (!shape || anchor?.kind !== 'hole-edge') return { along: null, reason: 'Pick an edge of a cut-out first.' };
  const edge = anchorEdge(shape, anchor);
  if (!edge) return { along: null, reason: 'That cut-out edge no longer exists.' };
  if (pattern === 'herringbone' || pattern === 'diagonal-45') {
    return { along: null, reason: 'Herringbone and 45° diagonal have no joint that runs along an edge.' };
  }
  if (pattern === 'hexagon') {
    return { along: null, reason: 'Hexagons have no straight joint to start full tiles from.' };
  }
  const raw = Math.atan2(edge[1].y - edge[0].y, edge[1].x - edge[0].x);
  const quarters = Math.round((raw - foldQuarter(raw)) / (Math.PI / 2));
  const along = Math.abs(quarters) % 2 === 1 ? 'y' : 'x';
  // Grid, checkerboard and basketweave have unbroken joints both ways (013);
  // offset bonds only along their rows.
  if (along === 'y' && pattern !== 'grid' && pattern !== 'checkerboard' && pattern !== 'basketweave') {
    return { along: null, reason: 'Offset rows run across this edge, so only every other row would start full. Use Grid, or an edge along the rows.' };
  }
  return { along };
}

export interface ShapeSummary {
  /** Tileable area (cut-outs removed) in mm² */
  area: number;
  /** Outer wall run in mm */
  perimeter: number;
  wallCount: number;
  holeCount: number;
}

export function summarizeShape(shape: RoomShape): ShapeSummary {
  let area = polygonArea(shape.boundary);
  for (const hole of shape.holes) area -= polygonArea(hole);

  return {
    area: Math.max(0, area),
    perimeter: polygonPerimeter(shape.boundary),
    wallCount: shape.boundary.vertices.length,
    holeCount: shape.holes.length,
  };
}

/**
 * Apply an edit and put the result back in room coordinates: the outline is
 * shifted so its bounding box starts at (0, 0), and the new extents come back
 * with it so the room's width/height stay in step.
 */
export function withShapeEdit(
  shape: RoomShape,
  edit: (s: RoomShape) => RoomShape
): { shape: RoomShape; width: number; height: number } {
  return normalizeShape(edit(shape));
}
