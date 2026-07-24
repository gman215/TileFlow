import { describe, it, expect } from 'vitest';
import type { Polygon, Room, RoomShape, TileConfig, PatternType } from '../types';
import { computeLayout } from '../optimization';
import { generateTiles } from '../patterns';
import { prepareClipShape, clipTileToShape } from '../clipping';
import { shapeArea, pointInPolygon, pointInShape, normalizeShape } from '../utils/math';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const poly = (...pts: [number, number][]): Polygon => ({
  vertices: pts.map(([x, y]) => ({ x, y })),
});

const shapeOf = (boundary: Polygon, holes: Polygon[] = []): RoomShape => ({
  boundary,
  holes,
});

/** L-shaped room — the single most common odd shape. */
const L_SHAPE = shapeOf(
  poly([0, 0], [4000, 0], [4000, 2000], [2000, 2000], [2000, 3000], [0, 3000])
);

/**
 * U-shape: a 250 mm notch cut down into the room. The notch is deliberately
 * off the tile grid, so tiles straddle it with floor on both sides — which is
 * what cuts a single tile into two disjoint pieces.
 */
const U_SHAPE = shapeOf(
  poly(
    [0, 0],
    [1300, 0],
    [1300, 2600],
    [1550, 2600],
    [1550, 0],
    [2800, 0],
    [2800, 3000],
    [0, 3000]
  )
);

const T_SHAPE = shapeOf(
  poly(
    [0, 0],
    [4000, 0],
    [4000, 1200],
    [2600, 1200],
    [2600, 3000],
    [1400, 3000],
    [1400, 1200],
    [0, 1200]
  )
);

/** Angled bay wall at 45°. */
const BAY_SHAPE = shapeOf(
  poly([0, 0], [4000, 0], [4000, 3000], [1000, 3000], [0, 2000])
);

/** Rectangular room with a kitchen island cut out of the middle. */
const ISLAND_SHAPE = shapeOf(poly([0, 0], [4000, 0], [4000, 3000], [0, 3000]), [
  poly([1500, 1000], [2500, 1000], [2500, 1800], [1500, 1800]),
]);

/** Column cut-out small enough to sit entirely inside one tile. */
const COLUMN_SHAPE = shapeOf(poly([0, 0], [2400, 0], [2400, 2400], [0, 2400]), [
  poly([1000, 1000], [1120, 1000], [1120, 1120], [1000, 1120]),
]);

const SHAPES: [string, RoomShape][] = [
  ['L-shape', L_SHAPE],
  ['U-shape (narrow neck)', U_SHAPE],
  ['T-shape', T_SHAPE],
  ['45° bay wall', BAY_SHAPE],
  ['island cut-out', ISLAND_SHAPE],
  ['column cut-out', COLUMN_SHAPE],
];

const PATTERNS: PatternType[] = [
  'grid',
  'offset-1/2',
  'offset-1/3',
  'herringbone',
  'diagonal-45',
];

function roomFor(shape: RoomShape): Room {
  const { shape: normalized, width, height } = normalizeShape(shape);
  return { width, height, shape: normalized };
}

function tile(overrides: Partial<TileConfig> = {}): TileConfig {
  return { width: 300, height: 300, grout: 0, pattern: 'grid', ...overrides };
}

const WEIGHTS = { alpha: 0.7, beta: 0.3 };

/** Deterministic PRNG so sampled points never vary between runs. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ─── Coverage ─────────────────────────────────────────────────────────────────

/**
 * Sum every clipped tile straight from the clipper, with no layout policy in
 * the way. With zero grout the tiles tile the plane, so this must equal the
 * floor area exactly: a gap makes it too small, an overlap too large.
 */
function clippedAreaSum(room: Room, config: TileConfig, ox = 0, oy = 0): number {
  const cs = prepareClipShape(room);
  const tiles = generateTiles({
    tileConfig: config,
    areaWidth: cs.width,
    areaHeight: cs.height,
    offsetX: ox,
    offsetY: oy,
  });
  let total = 0;
  for (const t of tiles) {
    const r = clipTileToShape(t, cs);
    if (!r.isOutside) total += r.area;
  }
  return total;
}

describe('the clipper covers the floor exactly', () => {
  for (const [name, shape] of SHAPES) {
    for (const pattern of PATTERNS) {
      it(`${name} / ${pattern}: clipped areas sum to the floor area`, () => {
        const room = roomFor(shape);
        const expected = shapeArea(room.shape!);
        expect(clippedAreaSum(room, tile({ pattern })) / expected).toBeCloseTo(1, 9);
      });
    }
  }

  it('holds for non-square tiles and non-zero offsets', () => {
    const room = roomFor(L_SHAPE);
    const config = tile({ width: 600, height: 300, pattern: 'herringbone' });
    const expected = shapeArea(room.shape!);
    for (const [ox, oy] of [
      [0, 0],
      [137, 349],
      [-221, 88],
    ]) {
      expect(clippedAreaSum(room, config, ox, oy) / expected).toBeCloseTo(1, 9);
    }
  });
});

describe('computeLayout reports the floor correctly', () => {
  for (const [name, shape] of SHAPES) {
    for (const pattern of PATTERNS) {
      it(`${name} / ${pattern}: room area and tile coverage`, () => {
        const room = roomFor(shape);
        const layout = computeLayout(room, tile({ pattern }), 0, 0, WEIGHTS);
        const expected = shapeArea(room.shape!);

        expect(layout.roomArea).toBeCloseTo(expected, 3);
        // Cuts under 1% of a tile are dropped as unusable slivers
        // (optimization/index.ts), so coverage lands just under 100%.
        const coverage = layout.totalTileArea / expected;
        expect(coverage).toBeGreaterThan(0.999);
        expect(coverage).toBeLessThanOrEqual(1 + 1e-9);
      });
    }
  }
});

describe('no point of the floor is covered twice', () => {
  for (const [name, shape] of SHAPES) {
    it(`${name}: every sampled interior point lies under exactly one tile`, () => {
      const room = roomFor(shape);
      const layout = computeLayout(room, tile({ grout: 0 }), 0, 0, WEIGHTS);
      const random = lcg(20260724);

      let sampled = 0;
      let miscovered = 0;
      while (sampled < 3000) {
        const pt = {
          x: random() * room.width,
          y: random() * room.height,
        };
        if (!pointInShape(pt, room.shape!)) continue;
        sampled++;

        let hits = 0;
        for (const placed of layout.tiles) {
          for (const piece of placed.pieces) {
            if (pointInPolygon(pt, piece)) hits++;
          }
        }
        if (hits !== 1) miscovered++;
      }

      // Sample points can land exactly on a shared tile edge; allow a hair.
      expect(miscovered / sampled).toBeLessThan(0.005);
    });
  }
});

describe('cut-outs are excluded', () => {
  it('island area is removed from the floor area', () => {
    const room = roomFor(ISLAND_SHAPE);
    const layout = computeLayout(room, tile(), 0, 0, WEIGHTS);
    const island = 1000 * 800;

    expect(layout.roomArea).toBeCloseTo(4000 * 3000 - island, 3);
    expect(layout.totalTileArea).toBeCloseTo(4000 * 3000 - island, 3);
  });

  it('no tile piece covers the middle of the island', () => {
    const room = roomFor(ISLAND_SHAPE);
    const layout = computeLayout(room, tile(), 0, 0, WEIGHTS);
    const middle = { x: 2000, y: 1400 };

    for (const placed of layout.tiles) {
      for (const piece of placed.pieces) {
        expect(pointInPolygon(middle, piece)).toBe(false);
      }
    }
  });

  it('a column swallowed by one tile still subtracts from that tile', () => {
    const room = roomFor(COLUMN_SHAPE);
    // 300 mm grid, column at (1000,1000)-(1120,1120) straddles a tile boundary,
    // so several tiles lose part of their area but none is a full tile there.
    const layout = computeLayout(room, tile(), 0, 0, WEIGHTS);
    expect(layout.totalTileArea).toBeCloseTo(2400 * 2400 - 120 * 120, 3);
  });
});

describe('tiles cut into more than one piece', () => {
  it('the U-shape neck splits tiles in two', () => {
    const room = roomFor(U_SHAPE);
    const config = tile({ width: 600, height: 600 });

    // Whether a tile straddles the neck depends on where the grid lands, so
    // sweep the offset rather than depend on one lucky phase.
    let layout = computeLayout(room, config, 0, 0, WEIGHTS);
    let split = layout.tiles.filter((t) => t.pieces.length > 1);
    for (let off = 0; off <= 600 && split.length === 0; off += 50) {
      layout = computeLayout(room, config, off, 0, WEIGHTS);
      split = layout.tiles.filter((t) => t.pieces.length > 1);
    }

    expect(split.length).toBeGreaterThan(0);

    // `clipped` must be the largest piece, and the pieces must account for the
    // whole clipped area.
    for (const placed of split) {
      const areas = placed.pieces.map((p) => Math.abs(polygonAreaOf(p)));
      const largest = Math.max(...areas);
      expect(Math.abs(polygonAreaOf(placed.clipped))).toBeCloseTo(largest, 6);
      expect(areas.reduce((a, b) => a + b, 0)).toBeCloseTo(placed.clippedArea, 6);
    }
  });
});

function polygonAreaOf(p: Polygon): number {
  let area = 0;
  const v = p.vertices;
  for (let i = 0; i < v.length; i++) {
    const j = (i + 1) % v.length;
    area += v[i].x * v[j].y - v[j].x * v[i].y;
  }
  return Math.abs(area / 2);
}

// ─── Regression: plain rectangles must not change ─────────────────────────────

describe('rectangular rooms are unaffected', () => {
  for (const pattern of PATTERNS) {
    it(`${pattern}: rect room and equivalent rect shape agree`, () => {
      const plain: Room = { width: 3000, height: 2400 };
      const drawn = roomFor(
        shapeOf(poly([0, 0], [3000, 0], [3000, 2400], [0, 2400]))
      );
      const config = tile({ width: 300, height: 300, grout: 3, pattern });

      const a = computeLayout(plain, config, 0, 0, WEIGHTS);
      const b = computeLayout(drawn, config, 0, 0, WEIGHTS);

      expect(b.fullTileCount).toBe(a.fullTileCount);
      expect(b.cutTileCount).toBe(a.cutTileCount);
      expect(b.roomArea).toBeCloseTo(a.roomArea, 6);
      expect(b.totalTileArea).toBeCloseTo(a.totalTileArea, 3);
    });
  }

  it('a room with no shape still takes the rectangle fast path', () => {
    const prepared = prepareClipShape({ width: 3000, height: 2400 });
    expect(prepared.isRect).toBe(true);
    expect(prepared.area).toBeCloseTo(3000 * 2400, 6);
  });
});
