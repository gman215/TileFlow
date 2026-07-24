/**
 * Editing operations for drawn room outlines.
 *
 * These are the moves an installer makes on a floor plan: read the walls off
 * the outline, retype a wall length, drag a corner, add or remove one. All
 * lengths are mm and all polygons are implicitly closed.
 */

import { Polygon, Room, RoomShape, Vec2 } from '../types';
import {
  polygonArea,
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

// ─── Summary ──────────────────────────────────────────────────────────────────

/**
 * The frame the pattern is set out from.
 *
 * With a reference wall picked, the grid runs parallel to that wall and is
 * anchored on its midpoint — how a floor is actually set out, squared to the
 * main sight line rather than to the bounding box. The angle is folded into
 * ±45° so picking any wall of a rectangle gives the same layout instead of
 * spinning it a quarter turn.
 */
export function patternFrameFor(
  room: Room
): { origin: Vec2; angle: number } | undefined {
  const shape = room.shape;
  if (!shape || shape.referenceWall == null) return undefined;

  const walls = wallsOf(shape.boundary);
  const wall = walls[shape.referenceWall];
  if (!wall || wall.length < 1e-9) return undefined;

  const quarter = Math.PI / 2;
  const folded =
    (((wall.angle + Math.PI / 4) % quarter) + quarter) % quarter - Math.PI / 4;

  return {
    origin: { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 },
    angle: folded,
  };
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
