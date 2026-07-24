import { Vec2, Polygon, RoomShape } from '../types';

/** Compute the signed area of a polygon (positive = CCW) */
export function signedArea(poly: Polygon): number {
  const { vertices } = poly;
  const n = vertices.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return area / 2;
}

/** Compute the absolute area of a polygon */
export function polygonArea(poly: Polygon): number {
  return Math.abs(signedArea(poly));
}

/** Create an axis-aligned rectangle polygon (CCW) */
export function rectToPolygon(
  x: number,
  y: number,
  w: number,
  h: number
): Polygon {
  return {
    vertices: [
      { x: x, y: y },
      { x: x + w, y: y },
      { x: x + w, y: y + h },
      { x: x, y: y + h },
    ],
  };
}

/** Rotate a point around an origin */
export function rotatePoint(p: Vec2, origin: Vec2, angleRad: number): Vec2 {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

/** Rotate an entire polygon around an origin */
export function rotatePolygon(
  poly: Polygon,
  origin: Vec2,
  angleRad: number
): Polygon {
  return {
    vertices: poly.vertices.map((v) => rotatePoint(v, origin, angleRad)),
  };
}

/** Translate a polygon */
export function translatePolygon(poly: Polygon, dx: number, dy: number): Polygon {
  return {
    vertices: poly.vertices.map((v) => ({ x: v.x + dx, y: v.y + dy })),
  };
}

/** Bounding box of a polygon */
export function boundingBox(poly: Polygon): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const v of poly.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Check if two bounding boxes overlap */
export function bboxOverlaps(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number }
): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/** Bounding box of a set of polygons */
export function boundingBoxOf(polys: Polygon[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const poly of polys) {
    for (const v of poly.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Is a point inside a polygon? Ray casting, so points exactly on an edge are
 * decided arbitrarily but consistently — callers only use this well away from
 * edges (see `prepareClipShape`).
 */
export function pointInPolygon(pt: Vec2, poly: Polygon): boolean {
  const v = poly.vertices;
  let inside = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const xi = v[i].x,
      yi = v[i].y,
      xj = v[j].x,
      yj = v[j].y;
    if (
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Is a point inside the floor — within the boundary and outside every hole? */
export function pointInShape(pt: Vec2, shape: RoomShape): boolean {
  if (!pointInPolygon(pt, shape.boundary)) return false;
  for (const hole of shape.holes) {
    if (pointInPolygon(pt, hole)) return false;
  }
  return true;
}

/** Tileable floor area: the boundary minus its cut-outs, in mm² */
export function shapeArea(shape: RoomShape): number {
  let area = polygonArea(shape.boundary);
  for (const hole of shape.holes) {
    area -= polygonArea(hole);
  }
  return Math.max(0, area);
}

/** Total length of a polygon's edges (closed) */
export function polygonPerimeter(poly: Polygon): number {
  const v = poly.vertices;
  let total = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** Centroid of a polygon (area-weighted; falls back to vertex mean if degenerate) */
export function polygonCentroid(poly: Polygon): Vec2 {
  const v = poly.vertices;
  const n = v.length;
  if (n === 0) return { x: 0, y: 0 };

  let cx = 0,
    cy = 0,
    a2 = 0;
  for (let i = 0; i < n; i++) {
    const p = v[i];
    const q = v[(i + 1) % n];
    const cross = p.x * q.y - q.x * p.y;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }

  if (Math.abs(a2) < 1e-9) {
    return {
      x: v.reduce((s, p) => s + p.x, 0) / n,
      y: v.reduce((s, p) => s + p.y, 0) / n,
    };
  }

  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

/**
 * Shift a shape so its bounding box starts at (0, 0) and report the resulting
 * extents. Keeps drawn shapes in the same coordinate space as the room rect.
 */
export function normalizeShape(shape: RoomShape): {
  shape: RoomShape;
  width: number;
  height: number;
} {
  const bb = boundingBoxOf([shape.boundary, ...shape.holes]);
  if (!Number.isFinite(bb.minX)) {
    return { shape, width: 0, height: 0 };
  }

  const dx = -bb.minX;
  const dy = -bb.minY;
  const shift = (p: Polygon): Polygon =>
    dx === 0 && dy === 0 ? p : translatePolygon(p, dx, dy);

  return {
    shape: {
      ...shape,
      boundary: shift(shape.boundary),
      holes: shape.holes.map(shift),
    },
    width: bb.maxX - bb.minX,
    height: bb.maxY - bb.minY,
  };
}

/** A rectangle expressed as a RoomShape — the implicit shape of a plain room */
export function rectShape(width: number, height: number): RoomShape {
  return { boundary: rectToPolygon(0, 0, width, height), holes: [] };
}

/** Approximate equality */
export function approxEqual(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

/** Clamp a number between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
