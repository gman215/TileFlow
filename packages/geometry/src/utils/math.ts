import { Vec2, Polygon } from '../types';

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

/** Approximate equality */
export function approxEqual(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

/** Clamp a number between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
