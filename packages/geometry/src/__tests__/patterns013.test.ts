import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import polygonClipping from 'polygon-clipping';
import { generateTiles, computeAlignmentOffset, getPatternUnit, type PatternFrame } from '../patterns';
import { computeLayout, optimize } from '../optimization';
import { fullTilesFromEdgeAxis } from '../shape';
import { DEFAULT_OPTIMIZATION_CONFIG, tileFaceArea } from '../types';
import type { PatternType, Polygon, Room, TileConfig, TilePolygon, Vec2 } from '../types';
import { polygonArea, pointInPolygon } from '../utils/math';

// 013 — four new patterns: ¼ offset, basketweave, checkerboard, hexagon.

const NEW: [PatternType, number, number][] = [
  ['offset-1/4', 600, 300],
  ['basketweave', 600, 298.5], // w + g = 2(h + g): a block of two fits one tile's length
  ['checkerboard', 300, 300],
  ['hexagon', 200, 200],
];
const cfg = (pattern: PatternType, width: number, height: number, grout = 3): TileConfig => ({ width, height, grout, pattern });
const ring = (pts: [number, number][]): Polygon => ({ vertices: pts.map(([x, y]) => ({ x, y })) });
const toPC = (p: Polygon) => [p.vertices.map((v) => [v.x, v.y] as [number, number])];
const centroid = (p: Polygon): Vec2 => ({
  x: p.vertices.reduce((s, v) => s + v.x, 0) / p.vertices.length,
  y: p.vertices.reduce((s, v) => s + v.y, 0) / p.vertices.length,
});
function distToPoly(pt: Vec2, p: Polygon): number {
  let best = Infinity;
  const v = p.vertices;
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    const abx = b.x - a.x, aby = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / (abx * abx + aby * aby)));
    best = Math.min(best, Math.hypot(pt.x - (a.x + abx * t), pt.y - (a.y + aby * t)));
  }
  return best;
}
/** Total overlap area between any two tiles near the area's centre. */
function overlapArea(tiles: Polygon[], centre: Vec2, radius: number): number {
  const near = tiles.filter((t) => Math.hypot(centroid(t).x - centre.x, centroid(t).y - centre.y) < radius);
  let total = 0;
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const r = polygonClipping.intersection(toPC(near[i]) as any, toPC(near[j]) as any);
      for (const poly of r) total += polygonArea({ vertices: poly[0].map(([x, y]) => ({ x, y })) });
    }
  }
  return total;
}

describe('new patterns tile the plane (AC-1.1–1.4)', () => {
  it.each(NEW)('%s with no grout covers a room exactly', (pattern, w, h) => {
    // Raw generated tiles (computeLayout drops slivers under 1 % of a tile on
    // purpose): no overlaps, and their parts inside the room sum to the room.
    const c = pattern === 'basketweave' ? cfg(pattern, 600, 300, 0) : cfg(pattern, w, h, 0);
    const tiles = generateTiles({ tileConfig: c, areaWidth: 2400, areaHeight: 1800, offsetX: 37, offsetY: -21 });
    const room = toPC(ring([[0, 0], [2400, 0], [2400, 1800], [0, 1800]]));
    let covered = 0;
    for (const t of tiles) {
      for (const poly of polygonClipping.intersection(toPC(t) as any, room as any)) {
        covered += polygonArea({ vertices: poly[0].map(([x, y]) => ({ x, y })) });
      }
    }
    expect(covered).toBeCloseTo(2400 * 1800, 0);
    expect(overlapArea(tiles, { x: 1200, y: 900 }, 900)).toBeLessThan(1e-3);
  });

  it.each(NEW)('%s with grout never overlaps, also in a turned frame', (pattern, w, h) => {
    const frame: PatternFrame = { origin: { x: 800, y: 600 }, angle: 0.4 };
    const tiles = generateTiles({ tileConfig: cfg(pattern, w, h), areaWidth: 2400, areaHeight: 1800, offsetX: 11, offsetY: 5, frame });
    expect(overlapArea(tiles, { x: 800, y: 600 }, 900)).toBeLessThan(1e-3);
  });

  it('basketweave fits 3:1 tiles in blocks of three, and portrait tiles too', () => {
    for (const [w, h] of [[900, 300], [300, 600]]) {
      const c = cfg('basketweave', w, h, 0);
      const l = computeLayout({ width: 2700, height: 1800 }, c, 0, 0, DEFAULT_OPTIMIZATION_CONFIG.weights);
      expect(l.tiles.reduce((s, t) => s + t.clippedArea, 0)).toBeCloseTo(2700 * 1800, 0);
    }
  });

  it('a basketweave tile that does not fit leaves gaps, never overlaps', () => {
    const tiles = generateTiles({ tileConfig: cfg('basketweave', 500, 300, 3), areaWidth: 2400, areaHeight: 1800, offsetX: 0, offsetY: 0 });
    expect(overlapArea(tiles, { x: 1200, y: 900 }, 800)).toBeLessThan(1e-3);
  });

  it('checkerboard: every edge neighbour is the other colour', () => {
    const tiles = generateTiles({ tileConfig: cfg('checkerboard', 300, 200), areaWidth: 1500, areaHeight: 1000, offsetX: 0, offsetY: 0 }) as TilePolygon[];
    let pairs = 0;
    for (const a of tiles) {
      for (const b of tiles) {
        const ca = centroid(a), cb = centroid(b);
        const side = (Math.abs(ca.y - cb.y) < 1e-6 && Math.abs(Math.abs(ca.x - cb.x) - 303) < 1e-6) || (Math.abs(ca.x - cb.x) < 1e-6 && Math.abs(Math.abs(ca.y - cb.y) - 203) < 1e-6);
        if (side) {
          pairs++;
          expect(a.variant).not.toBe(b.variant);
        }
      }
    }
    expect(pairs).toBeGreaterThan(50);
  });

  it('checkerboard counts each colour, and the counts add up', () => {
    const l = computeLayout({ width: 2000, height: 1500 }, cfg('checkerboard', 300, 300), 40, 10, DEFAULT_OPTIMIZATION_CONFIG.weights);
    const [a, b] = l.variantCounts!;
    expect(a.full + b.full).toBe(l.fullTileCount);
    expect(a.cut + b.cut).toBe(l.cutTileCount);
    expect(Math.abs(a.full + a.cut - (b.full + b.cut))).toBeLessThanOrEqual(1);
    expect(l.tiles.every((t) => t.variant === 0 || t.variant === 1)).toBe(true);
  });

  it('only two-colour patterns carry colours', () => {
    const l = computeLayout({ width: 2000, height: 1500 }, cfg('grid', 300, 300), 0, 0, DEFAULT_OPTIMIZATION_CONFIG.weights);
    expect(l.variantCounts).toBeUndefined();
    expect(l.tiles.some((t) => 'variant' in t)).toBe(false);
  });
});

describe('alignment (AC-1.5)', () => {
  const frames: (PatternFrame | undefined)[] = [undefined, { origin: { x: 900, y: 700 }, angle: 0.35 }];
  const anchorOf = (f?: PatternFrame) => f?.origin ?? { x: 1200, y: 900 };
  const room = (f?: PatternFrame): Room => ({ width: 2400, height: 1800 });

  it.each(NEW)('%s: Centre a tile puts a tile centre on the anchor', (pattern, w, h) => {
    for (const f of frames) {
      const c = cfg(pattern, w, h);
      const { offsetX, offsetY } = computeAlignmentOffset(room(f), c, 'center-tile');
      const tiles = generateTiles({ tileConfig: c, areaWidth: 2400, areaHeight: 1800, offsetX, offsetY, frame: f });
      const a = anchorOf(f);
      expect(tiles.some((t) => Math.hypot(centroid(t).x - a.x, centroid(t).y - a.y) < 0.01)).toBe(true);
    }
  });

  it.each(NEW)('%s: Centre a joint puts a joint crossing on the anchor', (pattern, w, h) => {
    for (const f of frames) {
      const c = cfg(pattern, w, h);
      const { offsetX, offsetY } = computeAlignmentOffset(room(f), c, 'center-grout');
      const tiles = generateTiles({ tileConfig: c, areaWidth: 2400, areaHeight: 1800, offsetX, offsetY, frame: f });
      const a = anchorOf(f);
      expect(tiles.some((t) => pointInPolygon(a, t))).toBe(false);
      // Tiles meeting at the joint: 3 for a hexagon vertex or an offset bond's
      // T-joint, 4 at a grid or block crossing.
      const meeting = tiles.filter((t) => distToPoly(a, t) <= c.grout + 0.01).length;
      const expected = pattern === 'hexagon' || pattern === 'offset-1/4' ? 3 : 4;
      expect(meeting).toBeGreaterThanOrEqual(expected);
      if (pattern === 'hexagon') {
        // Exactly the three around a vertex, each g/√3 away.
        const d = tiles.map((t) => distToPoly(a, t)).filter((x) => x < c.grout + 0.01);
        expect(d).toHaveLength(3);
        d.forEach((x) => expect(x).toBeCloseTo(c.grout / Math.sqrt(3), 6));
      }
    }
  });
});

describe('hexagon size and area (AC-1.4)', () => {
  it('is regular, F across the flats, with its own face area', () => {
    const c = cfg('hexagon', 200, 200);
    const [t] = generateTiles({ tileConfig: c, areaWidth: 100, areaHeight: 100, offsetX: 0, offsetY: 0 });
    const v = t.vertices;
    expect(v).toHaveLength(6);
    const sides = v.map((p, i) => Math.hypot(v[(i + 1) % 6].x - p.x, v[(i + 1) % 6].y - p.y));
    sides.forEach((s) => expect(s).toBeCloseTo(200 / Math.sqrt(3), 9));
    const xs = v.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(200, 9);
    expect(polygonArea(t)).toBeCloseTo(tileFaceArea(c), 6);
  });

  it('waste is measured against the hexagon, not its box', () => {
    const c = cfg('hexagon', 200, 200, 0);
    const l = computeLayout({ width: 1500, height: 1200 }, c, 0, 0, DEFAULT_OPTIMIZATION_CONFIG.weights);
    const count = l.fullTileCount + l.cutTileCount;
    expect(l.wastePercentage).toBeCloseTo((1 - l.totalTileArea / (count * tileFaceArea(c))) * 100, 6);
    expect(l.wastePercentage).toBeGreaterThan(0);
  });

  it('the optimizer runs for every new pattern', () => {
    for (const [pattern, w, h] of NEW) {
      const r = optimize({ width: 2100, height: 1600 }, cfg(pattern, w, h), DEFAULT_OPTIMIZATION_CONFIG);
      expect(r.bestLayout.fullTileCount + r.bestLayout.cutTileCount).toBeGreaterThan(0);
    }
    expect(getPatternUnit(cfg('hexagon', 200, 200)).unitY).toBeCloseTo(203 * Math.sqrt(3), 9);
  });
});

describe('full tiles from an edge (AC-2.3)', () => {
  const TUB = ring([[200, 200], [1800, 200], [1800, 1000], [200, 1000]]);
  const shapeWith = (edge: number) => ({ boundary: ring([[0, 0], [3000, 0], [3000, 2400], [0, 2400]]), holes: [TUB], anchor: { kind: 'hole-edge' as const, hole: 0, edge, fullTilesFromEdge: true } });
  it('allows checkerboard and basketweave either way, ¼ offset along its rows, refuses hexagon', () => {
    for (const p of ['checkerboard', 'basketweave'] as PatternType[]) {
      expect(fullTilesFromEdgeAxis(shapeWith(2), p).along).toBe('x');
      expect(fullTilesFromEdgeAxis(shapeWith(1), p).along).toBe('y');
    }
    expect(fullTilesFromEdgeAxis(shapeWith(2), 'offset-1/4').along).toBe('x');
    expect(fullTilesFromEdgeAxis(shapeWith(1), 'offset-1/4').along).toBeNull();
    const hex = fullTilesFromEdgeAxis(shapeWith(2), 'hexagon');
    expect(hex.along).toBeNull();
  });
});

describe('the five original patterns are unchanged (AC-4.1)', () => {
  it('generate exactly what they did before 013', () => {
    // Fingerprints recorded on `main` before any 013 change.
    const before: Record<string, string> = {
      'grid|-': 'ce71eec667445c8f', 'grid|f': '4faafaae7393c544',
      'offset-1/2|-': 'bea7cd35a2dc4b3e', 'offset-1/2|f': '09ef23d08aa0c347',
      'offset-1/3|-': 'fd41e90f97f490bc', 'offset-1/3|f': '5fe8a59bf3f94d17',
      'herringbone|-': 'cdf4be7bd659cda6', 'herringbone|f': '3917121b3e7b93af',
      'diagonal-45|-': 'b38c987e2ee046d1', 'diagonal-45|f': 'a134ed6d0efdcf1d',
    };
    for (const p of ['grid', 'offset-1/2', 'offset-1/3', 'herringbone', 'diagonal-45'] as PatternType[]) {
      for (const frame of [undefined, { origin: { x: 700, y: 400 }, angle: 0.3 }]) {
        const tiles = generateTiles({ tileConfig: { width: 600, height: 297, grout: 3, pattern: p }, areaWidth: 3100, areaHeight: 2300, offsetX: 37, offsetY: -12, frame });
        const hash = createHash('sha256').update(JSON.stringify(tiles)).digest('hex').slice(0, 16);
        expect(hash, `${p} ${frame ? 'framed' : ''}`).toBe(before[`${p}|${frame ? 'f' : '-'}`]);
      }
    }
  });
});

import { cutPieces, groupCuts, setOutLines } from '../cuts';

describe('cuts and start lines for the new patterns (AC-2.1, AC-2.2)', () => {
  const lay = (room: Room, c: TileConfig, mode: 'center-tile' | 'center-grout') => {
    const { offsetX, offsetY } = computeAlignmentOffset(room, c, mode);
    return computeLayout(room, c, offsetX, offsetY, DEFAULT_OPTIMIZATION_CONFIG.weights);
  };

  it('measures hexagon cuts across the flats × point to point', () => {
    const c = cfg('hexagon', 200, 200);
    const pieces = cutPieces(lay({ width: 1500, height: 1100 }, c, 'center-tile'), c);
    expect(pieces.length).toBeGreaterThan(10);
    for (const p of pieces) {
      expect(p.width).toBeLessThanOrEqual(200 + 0.5);
      expect(p.height).toBeLessThanOrEqual((400 / Math.sqrt(3)) + 0.5);
      expect(['angled', 'shave']).toContain(p.kind);
    }
  });

  it('gives the same cut in two colours two labels', () => {
    const c = cfg('checkerboard', 300, 300, 0);
    const pieces = cutPieces(lay({ width: 1000, height: 700 }, c, 'center-grout'), c);
    const groups = groupCuts(pieces, 1);
    expect(pieces.every((p) => p.variant === 0 || p.variant === 1)).toBe(true);
    // Grid would give 3 sizes; each comes in both colours.
    expect(groups).toHaveLength(6);
    expect(new Set(groups.map((g) => `${g.kind} ${g.width}×${g.height}`)).size).toBe(3);
  });

  it('strikes basketweave start lines on block boundaries, which no tile crosses', () => {
    const c = cfg('basketweave', 600, 298.5);
    const room: Room = { width: 3000, height: 2400 };
    const l = lay(room, c, 'center-tile');
    const { lines } = setOutLines(room, c, l);
    for (const line of lines) {
      expect(line.onJoint).toBe(true);
      const crossed = l.tiles.some((t) => {
        const ds = t.original.vertices.map((q) => (q.x - line.from.x) * line.normal.x + (q.y - line.from.y) * line.normal.y);
        return Math.min(...ds) < -0.5 && Math.max(...ds) > 0.5;
      });
      expect(crossed).toBe(false);
    }
  });

  it('sets hexagon out from the point', () => {
    const c = cfg('hexagon', 200, 200);
    const room: Room = { width: 2000, height: 1600 };
    const { point, lines } = setOutLines(room, c, lay(room, c, 'center-tile'));
    expect(point).toEqual({ x: 1000, y: 800 });
    expect(lines.every((l) => !l.onJoint)).toBe(true);
  });

  it('keeps grid start lines on the centre joints', () => {
    const c = cfg('checkerboard', 300, 300);
    const room: Room = { width: 3000, height: 2000 };
    const [a, b] = setOutLines(room, c, lay(room, c, 'center-grout')).lines;
    expect(a.from.y).toBeCloseTo(1000, 6);
    expect(b.from.x).toBeCloseTo(1500, 6);
  });
});
