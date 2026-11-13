/**
 * 012 R1 — the cut list.
 *
 * A pure reading of a `LayoutResult`: which pieces have to be cut, how big
 * each is *as marked on the tile*, and which of them are the same cut. The
 * layout itself is never changed (AC-4.1).
 */
import type { LayoutResult, Polygon, TileConfig, TileVariant, Vec2 } from '../types';
import { polygonArea, pointInPolygon } from '../utils/math';

export { setOutLines, type SetOut, type SetOutLine } from './setout';

/**
 * - `straight` — one cut; the other side is the tile's full side
 * - `corner` — cut on two sides, still a rectangle
 * - `notched` — an L or U around a corner or cut-out, square cuts only
 * - `angled` — a cut that is not square to the tile (a diagonal against a wall)
 * - `shave` — within half a millimetre of full on both sides: the clipper
 *   counts it as cut, but it is set as it is (a rub with a stone at most).
 *   Kept apart so it never reads as a "300 × 300 straight cut".
 */
export type CutKind = 'straight' | 'corner' | 'notched' | 'angled' | 'shave';

export interface CutPiece {
  tileId: number;
  /** Index into the tile's `pieces` */
  piece: number;
  /** Colour in a two-colour pattern — a light and a dark cut are different tiles */
  variant?: TileVariant;
  kind: CutKind;
  /** Extent along the tile's width side, mm (the product's width, however it is laid) */
  width: number;
  /** Extent along the tile's height side, mm */
  height: number;
  area: number;
  /**
   * For a notched piece that is an L — the common case, a tile round one
   * corner — the rectangle cut out of it, so the cut can be marked. Absent
   * when the notch is not one rectangle at a corner (a U, two notches).
   */
  notch?: { width: number; height: number };
  /** A point well inside the piece, layout coords — where its label goes */
  labelAt: Vec2;
  /** About the largest square label that fits at `labelAt`, mm */
  labelSize: number;
}

export interface CutGroup {
  /** 'A', 'B', … 'Z', 'AA', … — most common first */
  label: string;
  kind: CutKind;
  variant?: TileVariant;
  /** Rounded to the grouping step, mm */
  width: number;
  height: number;
  notch?: { width: number; height: number };
  /** Pieces in the group */
  count: number;
  /** Distinct tiles cut to make them (a doorway can split one tile in two) */
  tiles: number;
  pieces: CutPiece[];
}

/** Lengths closer than this are the same cut — far below what a saw can tell apart. */
const LEN_TOL = 0.5;
/** A piece whose area is within this share of its box is a rectangle. */
const AREA_TOL = 0.005;
/** Label search grid per axis. Pieces have a handful of vertices, so this is cheap. */
const LABEL_SAMPLES = 12;

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;

function distanceToEdges(p: Vec2, poly: Polygon): number {
  const v = poly.vertices;
  let best = Infinity;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    const ab = sub(b, a);
    const len2 = dot(ab, ab);
    const t = len2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t)));
  }
  return best;
}

/**
 * The tile's own axes. `original` is the uncut tile, so its first two edges
 * run along its sides. Herringbone turns every other tile a quarter, so the
 * sides are matched to the product's width and height by length rather than
 * by order — a 600 × 300 tile on its side still reads 600 × 300.
 */
function tileAxes(original: Polygon, tile: TileConfig) {
  const [p0, p1, p2] = original.vertices;
  if (original.vertices.length === 6) {
    // A hexagon (013): across the flats (normal to a side) × point to point
    // (along that side) — F × 2F/√3, how a hex tile is measured.
    const e = sub(p1, p0);
    const l = Math.hypot(e.x, e.y);
    const along = { x: e.x / l, y: e.y / l };
    const across = { x: -along.y, y: along.x };
    const start = original.vertices.reduce((m, v) => (dot(v, across) < dot(m, across) ? v : m), p0);
    const startAlong = original.vertices.reduce((m, v) => (dot(v, along) < dot(m, along) ? v : m), p0);
    // Origin at the box corner, so local coordinates start at zero.
    const origin = { x: across.x * dot(start, across) + along.x * dot(startAlong, along), y: across.y * dot(start, across) + along.y * dot(startAlong, along) };
    return { origin, w: across, h: along, fullW: tile.width, fullH: (2 * tile.width) / Math.sqrt(3), hex: true };
  }
  const e1 = sub(p1, p0);
  const e2 = sub(p2, p1);
  const l1 = Math.hypot(e1.x, e1.y);
  const l2 = Math.hypot(e2.x, e2.y);
  const u1 = { x: e1.x / l1, y: e1.y / l1 };
  const u2 = { x: e2.x / l2, y: e2.y / l2 };
  const firstIsWidth = Math.abs(l1 - tile.width) <= Math.abs(l1 - tile.height);
  return firstIsWidth
    ? { origin: p0, w: u1, h: u2, fullW: l1, fullH: l2, hex: false }
    : { origin: p0, w: u2, h: u1, fullW: l2, fullH: l1, hex: false };
}

/** The uncut tile's face area in its own frame: a hexagon is ¾ of its box. */
function tileArea(axes: { fullW: number; fullH: number; hex?: boolean }): number {
  return axes.hex ? axes.fullW * axes.fullH * 0.75 : axes.fullW * axes.fullH;
}

function measurePiece(poly: Polygon, axes: ReturnType<typeof tileAxes>) {
  const local = poly.vertices.map((p) => {
    const d = sub(p, axes.origin);
    return { a: dot(d, axes.w), b: dot(d, axes.h) };
  });
  const minA = Math.min(...local.map((p) => p.a));
  const maxA = Math.max(...local.map((p) => p.a));
  const minB = Math.min(...local.map((p) => p.b));
  const maxB = Math.max(...local.map((p) => p.b));
  const width = maxA - minA;
  const height = maxB - minB;
  const area = polygonArea(poly);

  let kind: CutKind;
  const fullW = Math.abs(width - axes.fullW) <= LEN_TOL;
  const fullH = Math.abs(height - axes.fullH) <= LEN_TOL;
  if (fullW && fullH && area >= tileArea(axes) * (1 - AREA_TOL)) {
    kind = 'shave';
  } else if (Math.abs(area - width * height) <= AREA_TOL * width * height) {
    kind = fullW || fullH ? 'straight' : 'corner';
  } else {
    // Square to the tile when every edge runs along one of its sides.
    // Measured as drift across the edge in mm, so a long edge is held to the
    // same standard as a short one.
    const square = local.every((p, i) => {
      const q = local[(i + 1) % local.length];
      return Math.abs(q.a - p.a) <= LEN_TOL || Math.abs(q.b - p.b) <= LEN_TOL;
    });
    kind = square ? 'notched' : 'angled';
  }
  const notch = kind === 'notched' ? cornerNotch(local, minA, maxA, minB, maxB, area) : undefined;

  // The label goes at the point deepest inside the piece. A centroid will not
  // do: an L's centroid can sit in the notch, outside the piece.
  let labelAt: Vec2 | null = null;
  let depth = 0;
  for (let i = 0; i < LABEL_SAMPLES; i++) {
    for (let j = 0; j < LABEL_SAMPLES; j++) {
      const a = minA + ((i + 0.5) / LABEL_SAMPLES) * width;
      const b = minB + ((j + 0.5) / LABEL_SAMPLES) * height;
      const p = {
        x: axes.origin.x + axes.w.x * a + axes.h.x * b,
        y: axes.origin.y + axes.w.y * a + axes.h.y * b,
      };
      if (!pointInPolygon(p, poly)) continue;
      const d = distanceToEdges(p, poly);
      if (d > depth) {
        depth = d;
        labelAt = p;
      }
    }
  }
  if (!labelAt) {
    const n = poly.vertices.length;
    labelAt = {
      x: poly.vertices.reduce((s, v) => s + v.x, 0) / n,
      y: poly.vertices.reduce((s, v) => s + v.y, 0) / n,
    };
  }
  // A square of side d·√2 fits in a circle of radius d.
  return { kind, width, height, area, ...(notch ? { notch } : {}), labelAt, labelSize: depth * Math.SQRT2 };
}

/**
 * The rectangle missing from an L: the box corner with no vertex on it, and
 * the one vertex strictly inside the box (the inside corner). Accepted only
 * when box − notch is the piece's area, i.e. the L really is one notch.
 */
function cornerNotch(
  local: { a: number; b: number }[],
  minA: number,
  maxA: number,
  minB: number,
  maxB: number,
  area: number
): { width: number; height: number } | undefined {
  const at = (x: number, y: number) => Math.abs(x - y) <= LEN_TOL;
  const corners = [
    [minA, minB],
    [maxA, minB],
    [maxA, maxB],
    [minA, maxB],
  ].filter(([a, b]) => !local.some((p) => at(p.a, a) && at(p.b, b)));
  const inner = local.filter((p) => p.a > minA + LEN_TOL && p.a < maxA - LEN_TOL && p.b > minB + LEN_TOL && p.b < maxB - LEN_TOL);
  if (corners.length !== 1 || inner.length !== 1) return undefined;
  const [ca, cb] = corners[0];
  const width = Math.abs(inner[0].a - ca);
  const height = Math.abs(inner[0].b - cb);
  const box = (maxA - minA) * (maxB - minB);
  return Math.abs(box - width * height - area) <= AREA_TOL * box ? { width, height } : undefined;
}

/**
 * Every cut piece in the layout, measured in its tile's frame (AC-1.1, 1.2).
 *
 * Walks exactly the tiles `cutTileCount` counts and every piece each was cut
 * into (AC-1.4, AC-1.7), so the list always reconciles with the stats card.
 */
export function cutPieces(result: LayoutResult, tile: TileConfig): CutPiece[] {
  const out: CutPiece[] = [];
  for (const t of result.tiles) {
    if (t.isFull || t.isOutside) continue;
    const axes = tileAxes(t.original, tile);
    const polys = t.pieces?.length ? t.pieces : [t.clipped];
    polys.forEach((poly, piece) => {
      if (poly.vertices.length < 3 || polygonArea(poly) <= 0) return;
      out.push({ tileId: t.id, piece, ...(t.variant !== undefined ? { variant: t.variant } : {}), ...measurePiece(poly, axes) });
    });
  }
  return out;
}

/** 0 → A, 25 → Z, 26 → AA — spreadsheet columns, so any number of sizes has a label. */
export function cutLabel(index: number): string {
  let s = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Pieces that are the same cut, to `stepMM` — the precision the installer
 * marks to (1 mm, or 1/16″) — share a label (AC-1.3). Most common first, then
 * largest, so A is the cut made most often.
 */
export function groupCuts(pieces: CutPiece[], stepMM: number): CutGroup[] {
  const step = stepMM > 0 ? stepMM : 1;
  const byKey = new Map<string, CutPiece[]>();
  for (const p of pieces) {
    const n = p.notch ? `|${Math.round(p.notch.width / step)}|${Math.round(p.notch.height / step)}` : '';
    const key = `${p.variant ?? ''}|${p.kind}|${Math.round(p.width / step)}|${Math.round(p.height / step)}${n}`;
    const list = byKey.get(key);
    if (list) list.push(p);
    else byKey.set(key, [p]);
  }
  const groups = [...byKey.values()].map((list) => {
    const first = list[0];
    return {
      label: '',
      kind: first.kind,
      ...(first.variant !== undefined ? { variant: first.variant } : {}),
      width: Math.round(first.width / step) * step,
      height: Math.round(first.height / step) * step,
      ...(first.notch
        ? { notch: { width: Math.round(first.notch.width / step) * step, height: Math.round(first.notch.height / step) * step } }
        : {}),
      count: list.length,
      tiles: new Set(list.map((p) => p.tileId)).size,
      pieces: list,
    };
  });
  groups.sort((a, b) => b.count - a.count || b.width * b.height - a.width * a.height || a.kind.localeCompare(b.kind));
  groups.forEach((g, i) => (g.label = cutLabel(i)));
  return groups;
}
