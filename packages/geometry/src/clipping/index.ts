/**
 * Tile clipping.
 *
 * Rectangular rooms use Sutherland-Hodgman, which is exact and fast for a
 * convex clip region. Drawn rooms — concave outlines, cut-outs — go through
 * `clipTileToShape`, which falls back to a full boolean intersection only for
 * the tiles that actually straddle a wall (see `prepareClipShape`).
 */

import * as polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Ring } from 'polygon-clipping';
import { Polygon, Vec2, Room, RoomShape } from '../types';
import {
  polygonArea,
  rectToPolygon,
  boundingBox,
  boundingBoxOf,
  bboxOverlaps,
  pointInShape,
  polygonCentroid,
  shapeArea,
  rectShape,
} from '../utils/math';

/**
 * polygon-clipping ships an ESM build with only a default export but type
 * declarations with only named exports, so neither import style works on its
 * own. Take whichever the bundler hands us.
 */
const booleanIntersection: (typeof polygonClipping)['intersection'] =
  (polygonClipping as unknown as { default?: typeof polygonClipping }).default
    ?.intersection ?? polygonClipping.intersection;

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

// ─── Drawn (polygon) rooms ────────────────────────────────────────────────────

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * A room outline pre-processed for repeated tile clipping.
 *
 * Built once per layout run — the optimizer clips thousands of tiles against
 * the same floor, so everything that does not depend on the tile is hoisted:
 * the bounding box, the tileable area, the boolean-op geometry, and a uniform
 * grid of wall segments used to prove that a tile touches no wall at all.
 */
export interface ClipShape {
  shape: RoomShape;
  bbox: BBox;
  /** Tileable area (boundary minus cut-outs) in mm² */
  area: number;
  /** True when the room is a plain rectangle — enables the original fast path */
  isRect: boolean;
  width: number;
  height: number;
  geom: MultiPolygon;
  /** Uniform grid over `bbox`; each cell lists the indices of edges crossing it */
  grid: {
    cols: number;
    rows: number;
    cellW: number;
    cellH: number;
    cells: number[][];
  };
  edgeBoxes: BBox[];
}

/** Grid resolution — enough to keep buckets small without a huge allocation. */
const GRID_TARGET_CELLS = 1024;
const GRID_MAX_SIDE = 64;

function polygonToRing(poly: Polygon): Ring {
  const ring: Ring = poly.vertices.map((v) => [v.x, v.y] as [number, number]);
  // polygon-clipping is happiest with explicitly closed rings.
  if (ring.length > 0) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  }
  return ring;
}

function ringToPolygon(ring: Ring): Polygon {
  const vertices: Vec2[] = ring.map(([x, y]) => ({ x, y }));
  // Drop the duplicated closing vertex — the rest of the engine treats
  // polygons as implicitly closed.
  if (vertices.length > 1) {
    const first = vertices[0];
    const last = vertices[vertices.length - 1];
    if (first.x === last.x && first.y === last.y) vertices.pop();
  }
  return { vertices };
}

/**
 * Pre-process a room for clipping. Rooms without a drawn shape are treated as
 * the rectangle they have always been.
 */
export function prepareClipShape(room: Room): ClipShape {
  const isRect = !room.shape;
  const shape = room.shape ?? rectShape(room.width, room.height);

  const bbox = boundingBoxOf([shape.boundary, ...shape.holes]);
  const width = bbox.maxX - bbox.minX;
  const height = bbox.maxY - bbox.minY;

  // Boolean geometry: outer ring first, then one ring per cut-out.
  const geom: MultiPolygon = [
    [polygonToRing(shape.boundary), ...shape.holes.map(polygonToRing)],
  ];

  // Index every wall and cut-out segment into a uniform grid.
  const edgeBoxes: BBox[] = [];
  const pushEdges = (poly: Polygon) => {
    const v = poly.vertices;
    for (let i = 0; i < v.length; i++) {
      const a = v[i];
      const b = v[(i + 1) % v.length];
      edgeBoxes.push({
        minX: Math.min(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x),
        maxY: Math.max(a.y, b.y),
      });
    }
  };
  pushEdges(shape.boundary);
  for (const hole of shape.holes) pushEdges(hole);

  const side = Math.max(
    1,
    Math.min(GRID_MAX_SIDE, Math.round(Math.sqrt(GRID_TARGET_CELLS)))
  );
  const cols = side;
  const rows = side;
  const cellW = width > 0 ? width / cols : 1;
  const cellH = height > 0 ? height / rows : 1;
  const cells: number[][] = Array.from({ length: cols * rows }, () => []);

  const colOf = (x: number) =>
    Math.max(0, Math.min(cols - 1, Math.floor((x - bbox.minX) / cellW)));
  const rowOf = (y: number) =>
    Math.max(0, Math.min(rows - 1, Math.floor((y - bbox.minY) / cellH)));

  edgeBoxes.forEach((eb, index) => {
    const c0 = colOf(eb.minX);
    const c1 = colOf(eb.maxX);
    const r0 = rowOf(eb.minY);
    const r1 = rowOf(eb.maxY);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        cells[r * cols + c].push(index);
      }
    }
  });

  return {
    shape,
    bbox,
    area: shapeArea(shape),
    isRect,
    width,
    height,
    geom,
    grid: { cols, rows, cellW, cellH, cells },
    edgeBoxes,
  };
}

/** Does any wall or cut-out segment reach into this box? */
function touchesAnyEdge(cs: ClipShape, box: BBox): boolean {
  const { cols, rows, cellW, cellH, cells } = cs.grid;
  const c0 = Math.max(0, Math.floor((box.minX - cs.bbox.minX) / cellW));
  const c1 = Math.min(cols - 1, Math.floor((box.maxX - cs.bbox.minX) / cellW));
  const r0 = Math.max(0, Math.floor((box.minY - cs.bbox.minY) / cellH));
  const r1 = Math.min(rows - 1, Math.floor((box.maxY - cs.bbox.minY) / cellH));

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      for (const index of cells[r * cols + c]) {
        if (bboxOverlaps(box, cs.edgeBoxes[index])) return true;
      }
    }
  }
  return false;
}

export interface ShapeClipResult {
  /** Every piece of the tile that lies on the floor; empty when outside */
  pieces: Polygon[];
  /** The largest piece — what gets rendered as the tile's outline */
  clipped: Polygon;
  /** Area of all pieces, cut-outs already subtracted, in mm² */
  area: number;
  isOutside: boolean;
  isFull: boolean;
}

const EMPTY: Polygon = { vertices: [] };

/**
 * Clip one tile against a drawn floor.
 *
 * Three tiers, cheapest first:
 *  1. bounding boxes miss entirely → the tile is outside;
 *  2. no wall segment reaches into the tile → it cannot be cut, so a single
 *     point test settles whether it is wholly on the floor or wholly off it.
 *     This is the common case and costs no boolean work;
 *  3. otherwise the tile really does straddle a wall → boolean intersection.
 *
 * Cut-outs that fall entirely inside a tile subtract from its area here; they
 * are punched out visually by the shape layer drawn above the tiles.
 */
export function clipTileToShape(tile: Polygon, cs: ClipShape): ShapeClipResult {
  const tileBB = boundingBox(tile);

  if (!bboxOverlaps(tileBB, cs.bbox)) {
    return { pieces: [], clipped: EMPTY, area: 0, isOutside: true, isFull: false };
  }

  if (cs.isRect) {
    const { clipped, isOutside, isFull } = clipTileToRoom(tile, cs.width, cs.height);
    return {
      pieces: isOutside ? [] : [clipped],
      clipped,
      area: isOutside ? 0 : polygonArea(clipped),
      isOutside,
      isFull,
    };
  }

  if (!touchesAnyEdge(cs, tileBB)) {
    const inside = pointInShape(polygonCentroid(tile), cs.shape);
    return inside
      ? {
          pieces: [tile],
          clipped: tile,
          area: polygonArea(tile),
          isOutside: false,
          isFull: true,
        }
      : { pieces: [], clipped: EMPTY, area: 0, isOutside: true, isFull: false };
  }

  const result = booleanIntersection([polygonToRing(tile)], cs.geom);

  const pieces: Polygon[] = [];
  let area = 0;
  let largest = EMPTY;
  let largestArea = 0;

  for (const poly of result) {
    if (poly.length === 0) continue;
    const outer = ringToPolygon(poly[0]);
    if (outer.vertices.length < 3) continue;

    const outerArea = polygonArea(outer);
    // Rings after the first are holes in this piece (a cut-out swallowed by a
    // single tile) — they count against the area but are not separate pieces.
    let netArea = outerArea;
    for (let i = 1; i < poly.length; i++) {
      netArea -= polygonArea(ringToPolygon(poly[i]));
    }

    pieces.push(outer);
    area += Math.max(0, netArea);
    if (outerArea > largestArea) {
      largestArea = outerArea;
      largest = outer;
    }
  }

  if (pieces.length === 0 || area <= 0) {
    return { pieces: [], clipped: EMPTY, area: 0, isOutside: true, isFull: false };
  }

  const originalArea = polygonArea(tile);
  const isFull =
    pieces.length === 1 && originalArea > 0 && area >= originalArea * (1 - 1e-9);

  return { pieces, clipped: largest, area, isOutside: false, isFull };
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
