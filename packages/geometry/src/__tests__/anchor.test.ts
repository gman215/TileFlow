import { describe, it, expect } from 'vitest';
import { generateTiles, computeAlignmentOffset } from '../patterns';
import { patternFrameFor, fullTilesFromEdgeAxis, resolveAnchor, anchorAfterHoleDeleted, anchorAfterHoleVertexDeleted, anchorIssue } from '../shape';
import { pointInPolygon, normalizeShape } from '../utils/math';
import type { LayoutAnchor, PatternType, Polygon, Room, RoomShape, TileConfig, Vec2 } from '../types';

// 011 R3 — anchors. A 3.0 × 2.4 m bathroom with a 1.60 × 0.80 m tub cut-out
// against the top wall; the tub's front edge is the line y = 1000.
const W = 3000;
const H = 2400;
const ring = (pts: [number, number][]): Polygon => ({ vertices: pts.map(([x, y]) => ({ x, y })) });
const TUB = ring([[200, 200], [1800, 200], [1800, 1000], [200, 1000]]);
const FRONT = 2; // vertex 2 → 3: (1800,1000) → (200,1000)

function bathroom(anchor?: LayoutAnchor, referenceWall?: number): Room {
  const shape: RoomShape = { boundary: ring([[0, 0], [W, 0], [W, H], [0, H]]), holes: [TUB], anchor, referenceWall };
  return { width: W, height: H, shape };
}

const tile = (pattern: PatternType, width = 300, height = 300): TileConfig => ({ width, height, grout: 3, pattern });
const PATTERNS: [PatternType, number, number][] = [
  ['grid', 300, 300],
  ['offset-1/2', 600, 300],
  ['offset-1/3', 600, 300],
  ['herringbone', 600, 300 - 1.5], // w + g = 2(h + g)
  ['diagonal-45', 300, 300],
];

function layout(room: Room, cfg: TileConfig, mode: 'center-tile' | 'center-grout') {
  const { offsetX, offsetY } = computeAlignmentOffset(room, cfg, mode);
  return generateTiles({ tileConfig: cfg, areaWidth: W, areaHeight: H, offsetX, offsetY, frame: patternFrameFor(room) });
}
const centroid = (p: Polygon): Vec2 => ({
  x: p.vertices.reduce((s, v) => s + v.x, 0) / p.vertices.length,
  y: p.vertices.reduce((s, v) => s + v.y, 0) / p.vertices.length,
});
const near = (a: Vec2, b: Vec2, tol = 0.01) => Math.hypot(a.x - b.x, a.y - b.y) < tol;
function distanceToEdges(pt: Vec2, p: Polygon): number {
  let best = Infinity;
  const v = p.vertices;
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy)));
  }
  return best;
}
/** Same definitions as alignment.test.ts: one whole tile centred on the point… */
function tileCentredOn(tiles: Polygon[], pt: Vec2): boolean {
  const hits = tiles.filter((t) => pointInPolygon(pt, t));
  return hits.length === 1 && near(centroid(hits[0]), pt);
}
/** …or the point in grout, half a joint from the nearest tile. */
function jointOn(tiles: Polygon[], pt: Vec2, g: number): boolean {
  if (tiles.some((t) => pointInPolygon(pt, t))) return false;
  const nearest = Math.min(...tiles.map((t) => distanceToEdges(pt, t)));
  return nearest > g / 2 - 1e-6 && nearest < g;
}

describe('anchors put the tile centre or joint crossing on the feature (T5)', () => {
  const anchors: [string, LayoutAnchor, Vec2][] = [
    ['the tub centre', { kind: 'hole-centre', hole: 0 }, { x: 1000, y: 600 }],
    ['the tub front midpoint', { kind: 'hole-edge', hole: 0, edge: FRONT }, { x: 1000, y: 1000 }],
    ['a clicked point', { kind: 'point', at: { x: 2500, y: 2000 } }, { x: 2500, y: 2000 }],
  ];
  for (const [what, anchor, origin] of anchors) {
    for (const [pattern, w, h] of PATTERNS) {
      const cfg = tile(pattern, w, h);
      const room = bathroom(anchor);
      const frame = patternFrameFor(room)!;

      it(`${pattern}: Centre a tile on ${what}`, () => {
        expect(near(frame.origin, origin)).toBe(true);
        expect(tileCentredOn(layout(room, cfg, 'center-tile'), origin)).toBe(true);
      });

      it(`${pattern}: Centre a joint on ${what}`, () => {
        expect(jointOn(layout(room, cfg, 'center-grout'), origin, cfg.grout)).toBe(true);
      });
    }
  }
});

describe('reference wall with rotated patterns (existing bug, fixed in 011)', () => {
  // Shifting the offset to move the anchor only translates translational
  // lattices; herringbone and diagonal rotate it first, so Centre a tile on a
  // reference wall missed its midpoint by 200+ mm.
  for (const [pattern, w, h] of PATTERNS) {
    it(`${pattern}: Centre a tile lands on the reference wall's midpoint`, () => {
      const room = bathroom(undefined, 1);
      expect(tileCentredOn(layout(room, tile(pattern, w, h), 'center-tile'), { x: W, y: H / 2 })).toBe(true);
    });
  }
});

describe('no anchor is exactly today\'s behaviour', () => {
  it('without an anchor the frame is the reference wall\'s, or none', () => {
    expect(patternFrameFor(bathroom())).toBeUndefined();
    const withWall = patternFrameFor(bathroom(undefined, 1))!;
    expect(near(withWall.origin, { x: W, y: H / 2 })).toBe(true);
  });
  it('a centre anchor keeps the reference wall\'s direction', () => {
    const r = bathroom({ kind: 'hole-centre', hole: 0 }, 1);
    expect(patternFrameFor(r)!.angle).toBeCloseTo(patternFrameFor(bathroom(undefined, 1))!.angle, 9);
  });
  it('an anchor on a cut-out that no longer exists falls back to the room', () => {
    expect(resolveAnchor(bathroom({ kind: 'hole-centre', hole: 3 }).shape!)).toBeUndefined();
    expect(patternFrameFor(bathroom({ kind: 'hole-edge', hole: 0, edge: 9 }, 1))).toEqual(patternFrameFor(bathroom(undefined, 1)));
  });
  it('alignment offsets are unchanged without full tiles from an edge', () => {
    const cfg = tile('grid');
    expect(computeAlignmentOffset(bathroom({ kind: 'hole-edge', hole: 0, edge: FRONT }), cfg, 'center-tile')).toEqual({ offsetX: -150, offsetY: -150 });
    expect(computeAlignmentOffset(bathroom(), cfg, 'center-grout')).toEqual({ offsetX: 1.5, offsetY: 1.5 });
  });
});

describe('full tiles from the tub front (T6)', () => {
  const edgeAnchor: LayoutAnchor = { kind: 'hole-edge', hole: 0, edge: FRONT, fullTilesFromEdge: true };

  for (const [pattern, w, h] of PATTERNS.slice(0, 3)) {
    for (const mode of ['center-tile', 'center-grout'] as const) {
      it(`${pattern}, ${mode}: a joint lies on the front edge and the layout is symmetric about the tub's centreline`, () => {
        const cfg = tile(pattern, w, h);
        const tiles = layout(bathroom(edgeAnchor), cfg, mode);
        const g = cfg.grout;
        // The first row below the tub starts g/2 below the edge — a full row.
        const firstRow = tiles.filter((t) => Math.abs(Math.min(...t.vertices.map((v) => v.y)) - (1000 + g / 2)) < 0.01);
        expect(firstRow.length).toBeGreaterThan(3);
        // …and the row above it ends g/2 above the edge: a grout band centred on the edge.
        expect(tiles.some((t) => Math.abs(Math.max(...t.vertices.map((v) => v.y)) - (1000 - g / 2)) < 0.01)).toBe(true);
        // Symmetric about the tub's centreline x = 1000: every first-row tile
        // under the tub has its mirror image, so the cuts at its two ends match.
        const spans = firstRow
          .map((t) => [Math.min(...t.vertices.map((v) => v.x)), Math.max(...t.vertices.map((v) => v.x))])
          .filter(([a, b]) => a < 1800 && b > 200);
        for (const [a, b] of spans) {
          expect(spans.some(([c, d]) => Math.abs(c - (2000 - b)) < 0.01 && Math.abs(d - (2000 - a)) < 0.01)).toBe(true);
        }
        // Centre a tile: a tile on the centreline; Centre a joint: a joint on it.
        if (mode === 'center-tile') expect(spans.some(([a, b]) => Math.abs((a + b) / 2 - 1000) < 0.01)).toBe(true);
        else expect(spans.some(([a]) => Math.abs(a - (1000 + g / 2)) < 0.01)).toBe(true);
      });
    }
  }

  it('is refused, with the reason, for herringbone and 45° diagonal', () => {
    for (const p of ['herringbone', 'diagonal-45'] as const) {
      const r = fullTilesFromEdgeAxis(bathroom(edgeAnchor).shape, p);
      expect(r.along).toBeNull();
      expect('reason' in r && r.reason).toMatch(/no joint/);
    }
  });

  it('works on an edge across the rows for grid, but not for offset patterns', () => {
    const side: LayoutAnchor = { kind: 'hole-edge', hole: 0, edge: 1, fullTilesFromEdge: true }; // (1800,200)→(1800,1000)
    expect(fullTilesFromEdgeAxis(bathroom(side).shape, 'grid')).toEqual({ along: 'y' });
    const offset = fullTilesFromEdgeAxis(bathroom(side).shape, 'offset-1/2');
    expect(offset.along).toBeNull();
    // Grid on the side edge: a joint runs down the edge (x = 1800 ± g/2).
    const tiles = layout(bathroom(side), tile('grid'), 'center-tile');
    expect(tiles.some((t) => Math.abs(Math.min(...t.vertices.map((v) => v.x)) - 1801.5) < 0.01)).toBe(true);
  });

  it('a refused rule leaves the plain centred offsets', () => {
    expect(computeAlignmentOffset(bathroom(edgeAnchor), tile('herringbone', 600, 298.5), 'center-tile')).toEqual({ offsetX: -300, offsetY: -149.25 });
  });
});

describe('anchors follow edits (T7)', () => {
  it('deleting the anchored cut-out clears the anchor; deleting an earlier one renumbers it', () => {
    expect(anchorAfterHoleDeleted({ kind: 'hole-centre', hole: 1 }, 1)).toEqual({ anchor: undefined, cleared: true });
    expect(anchorAfterHoleDeleted({ kind: 'hole-edge', hole: 2, edge: 1 }, 0)).toEqual({ anchor: { kind: 'hole-edge', hole: 1, edge: 1 }, cleared: false });
    expect(anchorAfterHoleDeleted({ kind: 'hole-centre', hole: 0 }, 3)).toEqual({ anchor: { kind: 'hole-centre', hole: 0 }, cleared: false });
    expect(anchorAfterHoleDeleted({ kind: 'point', at: { x: 1, y: 2 } }, 0).cleared).toBe(false);
  });
  it('deleting a corner of the anchored edge clears it; later edges are renumbered', () => {
    const a: LayoutAnchor = { kind: 'hole-edge', hole: 0, edge: 2 };
    // Edge 2 runs from vertex 2 to vertex 3 of a 5-corner cut-out.
    expect(anchorAfterHoleVertexDeleted(a, 0, 2, 5).cleared).toBe(true);
    expect(anchorAfterHoleVertexDeleted(a, 0, 3, 5).cleared).toBe(true);
    expect(anchorAfterHoleVertexDeleted(a, 0, 0, 5)).toEqual({ anchor: { ...a, edge: 1 }, cleared: false });
    expect(anchorAfterHoleVertexDeleted(a, 0, 4, 5)).toEqual({ anchor: a, cleared: false });
    expect(anchorAfterHoleVertexDeleted(a, 1, 2, 5)).toEqual({ anchor: a, cleared: false });
  });
  it('a cut-out anchor follows its cut-out when it moves', () => {
    const moved = bathroom({ kind: 'hole-centre', hole: 0 });
    moved.shape!.holes[0] = ring([[1200, 1400], [2800, 1400], [2800, 2200], [1200, 2200]]);
    expect(near(patternFrameFor(moved)!.origin, { x: 2000, y: 1800 })).toBe(true);
  });
  it('normalising an outline moves a point anchor with it', () => {
    const shifted: RoomShape = { boundary: ring([[500, 300], [3500, 300], [3500, 2700], [500, 2700]]), holes: [], anchor: { kind: 'point', at: { x: 1500, y: 1300 } } };
    const n = normalizeShape(shifted).shape;
    expect(n.anchor).toEqual({ kind: 'point', at: { x: 1000, y: 1000 } });
  });
  it('a point outside the floor is flagged, not refused', () => {
    const out = bathroom({ kind: 'point', at: { x: 1000, y: 600 } }).shape!; // inside the tub
    expect(anchorIssue(out)).toMatch(/outside the floor/);
    expect(patternFrameFor({ width: W, height: H, shape: out })).toBeDefined();
    expect(anchorIssue(bathroom({ kind: 'point', at: { x: 2500, y: 2000 } }).shape!)).toBeNull();
  });
  it('a point anchor on a plain rectangle (no shape) sets the frame without making it an outline', () => {
    expect(patternFrameFor({ width: W, height: H, anchor: { kind: 'point', at: { x: 700, y: 900 } } })).toEqual({ origin: { x: 700, y: 900 }, angle: 0 });
  });
});
