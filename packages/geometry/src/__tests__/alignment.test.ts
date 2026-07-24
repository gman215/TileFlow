import { describe, it, expect } from 'vitest';
import type { Polygon, Room, RoomShape, PatternType, TileConfig } from '../types';
import { computeLayout } from '../optimization';
import { generateTiles, computeAlignmentOffset } from '../patterns';
import { patternFrameFor, wallsOf } from '../shape';
import { pointInPolygon, polygonArea, normalizeShape } from '../utils/math';

const poly = (...pts: [number, number][]): Polygon => ({
  vertices: pts.map(([x, y]) => ({ x, y })),
});

const PATTERNS: PatternType[] = [
  'grid',
  'offset-1/2',
  'offset-1/3',
  'herringbone',
  'diagonal-45',
];

const WEIGHTS = { alpha: 0.7, beta: 0.3 };

function tile(overrides: Partial<TileConfig> = {}): TileConfig {
  return { width: 300, height: 300, grout: 3, pattern: 'grid', ...overrides };
}

function centroid(p: Polygon) {
  const v = p.vertices;
  return {
    x: v.reduce((s, q) => s + q.x, 0) / v.length,
    y: v.reduce((s, q) => s + q.y, 0) / v.length,
  };
}

function distanceToEdges(pt: { x: number; y: number }, p: Polygon): number {
  const v = p.vertices;
  let best = Infinity;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy))
    );
    best = Math.min(best, Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy)));
  }
  return best;
}

// ─── One alignment rule, all five patterns ────────────────────────────────────

describe('alignment anchors on the room centre', () => {
  const room: Room = { width: 3200, height: 2450 };
  const centre = { x: 1600, y: 1225 };

  for (const pattern of PATTERNS) {
    it(`${pattern}: center-tile puts a whole tile on the centre`, () => {
      const config = tile({ pattern });
      const { offsetX, offsetY } = computeAlignmentOffset(room, config, 'center-tile');
      const layout = computeLayout(room, config, offsetX, offsetY, WEIGHTS);

      const hits = layout.tiles.filter((t) =>
        t.pieces.some((p) => pointInPolygon(centre, p))
      );
      expect(hits).toHaveLength(1);
      expect(hits[0].isFull).toBe(true);

      const c = centroid(hits[0].clipped);
      expect(c.x).toBeCloseTo(centre.x, 6);
      expect(c.y).toBeCloseTo(centre.y, 6);
    });

    it(`${pattern}: center-grout puts a joint on the centre`, () => {
      const config = tile({ pattern });
      const { offsetX, offsetY } = computeAlignmentOffset(room, config, 'center-grout');
      const layout = computeLayout(room, config, offsetX, offsetY, WEIGHTS);

      // The centre lands in grout, not on a tile...
      const covering = layout.tiles.filter((t) =>
        t.pieces.some((p) => pointInPolygon(centre, p))
      );
      expect(covering).toHaveLength(0);

      // ...and sits half a grout width from the nearest tile edge.
      const nearest = Math.min(
        ...layout.tiles.flatMap((t) => t.pieces.map((p) => distanceToEdges(centre, p)))
      );
      expect(nearest).toBeGreaterThan(config.grout / 2 - 1e-6);
      expect(nearest).toBeLessThan(config.grout);
    });
  }
});

// ─── Reference wall ───────────────────────────────────────────────────────────

/** Room with one wall running at 30°, so "squared to the wall" is visible. */
const ANGLED: RoomShape = {
  boundary: poly([0, 0], [4000, 0], [4000, 3000], [0, 3000]),
  holes: [],
};

function roomWithReference(shape: RoomShape, wall: number | undefined): Room {
  const { shape: normalized, width, height } = normalizeShape(shape);
  return { width, height, shape: { ...normalized, referenceWall: wall } };
}

describe('reference wall', () => {
  it('is ignored until a wall is picked', () => {
    expect(patternFrameFor(roomWithReference(ANGLED, undefined))).toBeUndefined();
  });

  it('anchors on the chosen wall’s midpoint', () => {
    const room = roomWithReference(ANGLED, 0);
    const frame = patternFrameFor(room)!;
    const wall = wallsOf(room.shape!.boundary)[0];

    expect(frame.origin.x).toBeCloseTo((wall.a.x + wall.b.x) / 2, 6);
    expect(frame.origin.y).toBeCloseTo((wall.a.y + wall.b.y) / 2, 6);
  });

  it('folds any wall of a rectangle to the same grid direction', () => {
    // Picking the north or the east wall of a rectangle must not spin the
    // layout a quarter turn — both mean "square to the room".
    for (const wall of [0, 1, 2, 3]) {
      const frame = patternFrameFor(roomWithReference(ANGLED, wall))!;
      expect(frame.angle).toBeCloseTo(0, 9);
    }
  });

  it('runs the grid parallel to an angled wall', () => {
    const angled: RoomShape = {
      boundary: poly([0, 0], [4000, 0], [4600, 3400], [600, 3400]),
      holes: [],
    };
    const room = roomWithReference(angled, 1); // the sloping wall
    const frame = patternFrameFor(room)!;
    expect(frame.angle).not.toBeCloseTo(0, 3);

    const config = tile({ pattern: 'grid', grout: 0 });
    const tiles = generateTiles({
      tileConfig: config,
      areaWidth: room.width,
      areaHeight: room.height,
      offsetX: 0,
      offsetY: 0,
      frame,
    });

    // Every tile edge is either along the wall direction or square to it.
    for (const t of tiles.slice(0, 40)) {
      const v = t.vertices;
      const edgeAngle = Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x);
      const delta = edgeAngle - frame.angle;
      expect(Math.abs(Math.sin(2 * delta))).toBeCloseTo(0, 6);
    }
  });

  it('still covers the whole floor when the grid is rotated', () => {
    const angled: RoomShape = {
      boundary: poly([0, 0], [4000, 0], [4600, 3400], [600, 3400]),
      holes: [],
    };
    const room = roomWithReference(angled, 1);
    const expected = polygonArea(room.shape!.boundary);

    const layout = computeLayout(
      room,
      tile({ grout: 0, pattern: 'grid' }),
      0,
      0,
      WEIGHTS
    );
    expect(layout.totalTileArea / expected).toBeGreaterThan(0.999);
    expect(layout.totalTileArea / expected).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('centres a tile on the reference wall for center-tile', () => {
    const room = roomWithReference(ANGLED, 0);
    const frame = patternFrameFor(room)!;
    const config = tile({ pattern: 'grid' });
    const { offsetX, offsetY } = computeAlignmentOffset(room, config, 'center-tile');

    const layout = computeLayout(room, config, offsetX, offsetY, WEIGHTS);
    const hits = layout.tiles.filter((t) =>
      t.pieces.some((p) => pointInPolygon(frame.origin, p))
    );

    expect(hits).toHaveLength(1);
    const c = centroid(hits[0].original);
    expect(c.x).toBeCloseTo(frame.origin.x, 6);
    expect(c.y).toBeCloseTo(frame.origin.y, 6);
  });
});
