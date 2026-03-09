/**
 * Sutherland-Hodgman polygon clipping algorithm.
 * Clips a subject polygon against a convex clip polygon.
 * For rectangular rooms this is highly efficient.
 *
 * Future: swap to Weiler-Atherton for concave room polygons.
 */

import { Polygon, Vec2 } from '../types';
import { polygonArea, rectToPolygon, boundingBox, bboxOverlaps } from '../utils/math';

interface Edge {
  a: Vec2;
  b: Vec2;
}

function isInside(point: Vec2, edgeA: Vec2, edgeB: Vec2): boolean {
  return (edgeB.x - edgeA.x) * (point.y - edgeA.y) -
         (edgeB.y - edgeA.y) * (point.x - edgeA.x) >= 0;
}

function intersection(a: Vec2, b: Vec2, edgeA: Vec2, edgeB: Vec2): Vec2 {
  const x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y;
  const x3 = edgeA.x, y3 = edgeA.y, x4 = edgeB.x, y4 = edgeB.y;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) {
    // Parallel — return midpoint as fallback
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;

  return {
    x: x1 + t * (x2 - x1),
    y: y1 + t * (y2 - y1),
  };
}

/**
 * Clip a polygon against a single edge of the clip polygon.
 */
function clipByEdge(polygon: Vec2[], edgeA: Vec2, edgeB: Vec2): Vec2[] {
  const output: Vec2[] = [];
  const n = polygon.length;
  if (n === 0) return output;

  for (let i = 0; i < n; i++) {
    const current = polygon[i];
    const next = polygon[(i + 1) % n];
    const curInside = isInside(current, edgeA, edgeB);
    const nextInside = isInside(next, edgeA, edgeB);

    if (curInside) {
      output.push(current);
      if (!nextInside) {
        output.push(intersection(current, next, edgeA, edgeB));
      }
    } else if (nextInside) {
      output.push(intersection(current, next, edgeA, edgeB));
    }
  }

  return output;
}

/**
 * Clip `subject` polygon against `clip` convex polygon using
 * Sutherland-Hodgman algorithm.
 */
export function clipPolygon(subject: Polygon, clip: Polygon): Polygon {
  let output = [...subject.vertices];
  const clipVerts = clip.vertices;
  const n = clipVerts.length;

  for (let i = 0; i < n; i++) {
    if (output.length === 0) break;
    const edgeA = clipVerts[i];
    const edgeB = clipVerts[(i + 1) % n];
    output = clipByEdge(output, edgeA, edgeB);
  }

  return { vertices: output };
}

/**
 * Fast rectangular clip: clips a tile polygon against a room rectangle.
 * Uses bounding box pre-check to skip tiles that are clearly outside.
 */
export function clipTileToRoom(
  tile: Polygon,
  roomWidth: number,
  roomHeight: number
): { clipped: Polygon; isOutside: boolean; isFull: boolean } {
  const tileBB = boundingBox(tile);
  const roomBB = { minX: 0, minY: 0, maxX: roomWidth, maxY: roomHeight };

  // Fast reject: no overlap at all
  if (!bboxOverlaps(tileBB, roomBB)) {
    return { clipped: { vertices: [] }, isOutside: true, isFull: false };
  }

  // Fast accept: tile fully inside room
  if (
    tileBB.minX >= 0 &&
    tileBB.minY >= 0 &&
    tileBB.maxX <= roomWidth &&
    tileBB.maxY <= roomHeight
  ) {
    return { clipped: tile, isOutside: false, isFull: true };
  }

  // Clip required
  const roomPoly = rectToPolygon(0, 0, roomWidth, roomHeight);
  const clipped = clipPolygon(tile, roomPoly);

  if (clipped.vertices.length < 3) {
    return { clipped: { vertices: [] }, isOutside: true, isFull: false };
  }

  return { clipped, isOutside: false, isFull: false };
}

/**
 * Calculate results for a clipped tile.
 */
export function analyzeTile(
  original: Polygon,
  clipped: Polygon,
  isFull: boolean,
  isOutside: boolean
): { clippedArea: number; originalArea: number; coverageRatio: number } {
  if (isOutside) {
    return { clippedArea: 0, originalArea: polygonArea(original), coverageRatio: 0 };
  }

  const originalArea = polygonArea(original);
  const clippedArea = isFull ? originalArea : polygonArea(clipped);
  const coverageRatio = originalArea > 0 ? clippedArea / originalArea : 0;

  return { clippedArea, originalArea, coverageRatio };
}
