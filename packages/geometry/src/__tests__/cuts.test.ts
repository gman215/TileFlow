import { describe, it, expect } from 'vitest';
import { computeLayout } from '../optimization';
import { computeAlignmentOffset } from '../patterns';
import { patternFrameFor } from '../shape';
import { cutPieces, groupCuts, cutLabel, setOutLines, type CutPiece } from '../cuts';
import { DEFAULT_OPTIMIZATION_CONFIG } from '../types';
import type { LayoutAnchor, PatternType, Polygon, Room, TileConfig } from '../types';

// 012 — the cut list (R1) and start lines (R2).

const ring = (pts: [number, number][]): Polygon => ({ vertices: pts.map(([x, y]) => ({ x, y })) });
const rect = (w: number, h: number): Room => ({ width: w, height: h });
const shaped = (pts: [number, number][], holes: Polygon[] = [], extra: Partial<Room['shape']> = {}): Room => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { width: Math.max(...xs), height: Math.max(...ys), shape: { boundary: ring(pts), holes, ...extra } };
};
const tile = (pattern: PatternType, width = 300, height = 300, grout = 3): TileConfig => ({ width, height, grout, pattern });

function lay(room: Room, cfg: TileConfig, mode: 'center-tile' | 'center-grout') {
  const { offsetX, offsetY } = computeAlignmentOffset(room, cfg, mode);
  return computeLayout(room, cfg, offsetX, offsetY, DEFAULT_OPTIMIZATION_CONFIG.weights);
}
const sizes = (pieces: CutPiece[]) => pieces.map((p) => `${p.kind} ${Math.round(p.width)}×${Math.round(p.height)}`).sort();

describe('cutPieces', () => {
  it('measures straight and corner cuts in a grid room exactly (AC-1.1, 1.2)', () => {
    // Joints through the centre of 1000 × 700: columns cut to 200, rows to 50.
    const cfg = tile('grid', 300, 300, 0);
    const result = lay(rect(1000, 700), cfg, 'center-grout');
    const pieces = cutPieces(result, cfg);
    expect(result.cutTileCount).toBe(12);
    expect(sizes(pieces)).toEqual(
      [...Array(4).fill('corner 200×50'), ...Array(4).fill('straight 200×300'), ...Array(4).fill('straight 300×50')].sort()
    );
    for (const p of pieces) {
      expect(p.width).toBeCloseTo(Math.round(p.width), 6);
      expect(p.height).toBeCloseTo(Math.round(p.height), 6);
    }
  });

  it('calls a tile round an inside corner notched, with its label inside the piece', () => {
    // A tile centred on the L's inside corner keeps three quarters of itself.
    const room = shaped([[0, 0], [1000, 0], [1000, 500], [500, 500], [500, 1000], [0, 1000]]);
    const cfg = tile('grid', 300, 300, 0);
    const pieces = cutPieces(lay(room, cfg, 'center-tile'), cfg);
    const notched = pieces.filter((p) => p.kind === 'notched');
    expect(notched).toHaveLength(1);
    expect(notched[0].width).toBeCloseTo(300, 6);
    expect(notched[0].height).toBeCloseTo(300, 6);
    expect(notched[0].area).toBeCloseTo(300 * 300 * 0.75, 3);
    // The quarter cut away round the inside corner, so the cut can be marked.
    expect(notched[0].notch!.width).toBeCloseTo(150, 6);
    expect(notched[0].notch!.height).toBeCloseTo(150, 6);
    const { x, y } = notched[0].labelAt;
    // Not in the missing quarter (x > 500 and y > 500).
    expect(x > 500 && y > 500).toBe(false);
    expect(notched[0].labelSize).toBeGreaterThan(100);
  });

  it('calls a tile shaved by under half a millimetre a shave, not a straight cut', () => {
    // A tile centred in an 899.4 mm wide room: the outer columns lose 0.3 mm each.
    const cfg = tile('grid', 300, 300, 0);
    const result = lay(rect(899.4, 900), cfg, 'center-tile');
    const pieces = cutPieces(result, cfg);
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.every((p) => p.kind === 'shave')).toBe(true);
    expect(groupCuts(pieces, 1).map((g) => `${g.kind} ${g.width}×${g.height}`)).toEqual(['shave 300×300']);
  });

  it('calls diagonal cuts angled and keeps them within the tile (AC-1.2)', () => {
    const cfg = tile('diagonal-45');
    const pieces = cutPieces(lay(rect(1500, 1200), cfg, 'center-tile'), cfg);
    expect(pieces.some((p) => p.kind === 'angled')).toBe(true);
    for (const p of pieces) {
      expect(p.width).toBeLessThanOrEqual(300 + 0.5);
      expect(p.height).toBeLessThanOrEqual(300 + 0.5);
    }
  });

  it('reports herringbone cuts against the product, however the tile is turned (AC-1.1)', () => {
    const cfg = tile('herringbone', 600, 298.5);
    const pieces = cutPieces(lay(rect(2400, 1800), cfg, 'center-tile'), cfg);
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.some((p) => p.width > 299)).toBe(true);
    for (const p of pieces) {
      expect(p.width).toBeLessThanOrEqual(600 + 0.5);
      expect(p.height).toBeLessThanOrEqual(298.5 + 0.5);
    }
  });

  it('lists both pieces of a tile split by a narrow divider (AC-1.4)', () => {
    // A 40 mm partition stub from y = 300 up splits the centre tile in two.
    const room = shaped([[0, 0], [1000, 0], [1000, 1000], [520, 1000], [520, 300], [480, 300], [480, 1000], [0, 1000]]);
    const cfg = tile('grid', 300, 300, 0);
    const result = lay(room, cfg, 'center-tile');
    const pieces = cutPieces(result, cfg);
    const centre = result.tiles.find((t) => t.pieces.length === 2);
    expect(centre).toBeDefined();
    const mine = pieces.filter((p) => p.tileId === centre!.id);
    expect(mine).toHaveLength(2);
    for (const p of mine) {
      expect(p.notch).toBeUndefined();
      expect(p.width).toBeCloseTo(130, 6);
      expect(p.height).toBeCloseTo(300, 6);
    }
  });

  it.each<[PatternType, number, number]>([
    ['grid', 300, 300],
    ['offset-1/2', 600, 300],
    ['offset-1/3', 600, 300],
    ['herringbone', 600, 298.5],
    ['diagonal-45', 300, 300],
  ])('reconciles with cutTileCount for %s (AC-1.7)', (pattern, w, h) => {
    const room = shaped([[0, 0], [3100, 0], [3100, 1400], [1900, 1400], [1900, 2500], [0, 2500]], [ring([[300, 300], [900, 300], [900, 800], [300, 800]])]);
    const cfg = tile(pattern, w, h);
    for (const mode of ['center-tile', 'center-grout'] as const) {
      const result = lay(room, cfg, mode);
      const pieces = cutPieces(result, cfg);
      expect(new Set(pieces.map((p) => p.tileId)).size).toBe(result.cutTileCount);
      const groups = groupCuts(pieces, 1);
      expect(groups.reduce((s, g) => s + g.count, 0)).toBe(pieces.length);
    }
  });
});

describe('groupCuts', () => {
  const piece = (width: number, height: number, tileId: number, kind: CutPiece['kind'] = 'straight'): CutPiece => ({
    tileId, piece: 0, kind, width, height, area: width * height, labelAt: { x: 0, y: 0 }, labelSize: 10,
  });

  it('labels most common first, then largest (AC-1.3)', () => {
    const groups = groupCuts([piece(100, 300, 1), piece(200, 300, 2), piece(200, 300, 3), piece(50, 300, 4), piece(50, 300, 5, 'corner')], 1);
    expect(groups.map((g) => `${g.label} ${g.kind} ${g.width}×${g.height} ×${g.count}`)).toEqual([
      'A straight 200×300 ×2',
      'B straight 100×300 ×1',
      'C corner 50×300 ×1',
      'D straight 50×300 ×1',
    ]);
  });

  it('groups to the step and counts distinct tiles', () => {
    const pieces = [piece(412.2, 300, 1), piece(412.7, 300, 2), piece(412.7, 300, 2)];
    expect(groupCuts(pieces, 1)).toHaveLength(2);
    const sixteenth = groupCuts(pieces, 25.4 / 16);
    expect(sixteenth).toHaveLength(1);
    expect(sixteenth[0].count).toBe(3);
    expect(sixteenth[0].tiles).toBe(2);
    expect(sixteenth[0].width).toBeCloseTo(260 * (25.4 / 16), 9);
  });

  it('runs labels past Z like spreadsheet columns', () => {
    expect([0, 25, 26, 27, 51, 52].map(cutLabel)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });
});

describe('setOutLines (AC-2.3)', () => {
  it('strikes both lines on the joints through the centre of a grid room', () => {
    const cfg = tile('grid');
    const room = rect(3000, 2000);
    const result = lay(room, cfg, 'center-grout');
    const { point, lines } = setOutLines(room, cfg, result);
    expect(point).toEqual({ x: 1500, y: 1000 });
    const [a, b] = lines;
    expect(Math.abs(a.dir.y)).toBeCloseTo(0, 9);
    expect(a.from.y).toBeCloseTo(1000, 6);
    expect(a.toNeg).toBeCloseTo(1000, 6);
    expect(a.toPos).toBeCloseTo(1000, 6);
    expect(Math.abs(b.dir.x)).toBeCloseTo(0, 9);
    expect(b.from.x).toBeCloseTo(1500, 6);
    expect(b.toNeg + b.toPos).toBeCloseTo(3000, 6);
    expect(a.onJoint && b.onJoint).toBe(true);
  });

  it('strikes the nearest joints when a tile is centred, and keeps A along the rows of an offset bond', () => {
    const cfg = tile('offset-1/2', 600, 300);
    const room = rect(3000, 2000);
    const result = lay(room, cfg, 'center-tile');
    const [a, b] = setOutLines(room, cfg, result).lines;
    expect(Math.abs(a.dir.y)).toBeCloseTo(0, 9);
    // The centre tile spans y 850…1150; its nearer joint is 1.5 mm outside that.
    expect([850 - 1.5, 1150 + 1.5]).toContainEqual(expect.closeTo(a.from.y, 6));
    expect([1200 - 1.5, 1800 + 1.5]).toContainEqual(expect.closeTo(b.from.x, 6));
  });

  it('runs parallel to the reference wall', () => {
    const room = shaped([[0, 0], [3000, 600], [3000, 2600], [0, 2000]], [], { referenceWall: 0 });
    const cfg = tile('grid');
    const { offsetX, offsetY } = computeAlignmentOffset(room, cfg, 'center-grout');
    const result = computeLayout(room, cfg, offsetX, offsetY, DEFAULT_OPTIMIZATION_CONFIG.weights);
    const [a, b] = setOutLines(room, cfg, result).lines;
    const wall = { x: 3000 / Math.hypot(3000, 600), y: 600 / Math.hypot(3000, 600) };
    expect(Math.abs(a.dir.x * wall.y - a.dir.y * wall.x)).toBeLessThan(1e-6);
    expect(Math.abs(b.dir.x * wall.x + b.dir.y * wall.y)).toBeLessThan(1e-6);
    // A runs through the reference wall's midpoint, on the joint there.
    const mid = { x: 1500, y: 300 };
    expect(Math.abs((mid.x - a.from.x) * a.normal.x + (mid.y - a.from.y) * a.normal.y)).toBeLessThan(0.01);
  });

  it('lies on the tub front with full tiles from that edge', () => {
    const TUB = ring([[200, 200], [1800, 200], [1800, 1000], [200, 1000]]);
    const anchor: LayoutAnchor = { kind: 'hole-edge', hole: 0, edge: 2, fullTilesFromEdge: true };
    const room = shaped([[0, 0], [3000, 0], [3000, 2400], [0, 2400]], [TUB], { anchor });
    const cfg = tile('grid');
    const result = lay(room, cfg, 'center-tile');
    const [a] = setOutLines(room, cfg, result, patternFrameFor(room)).lines;
    expect(Math.abs(a.dir.y)).toBeCloseTo(0, 9);
    expect(a.from.y).toBeCloseTo(1000, 6);
    expect(a.toNeg + a.toPos).toBeCloseTo(2400, 6);
  });

  it('sets herringbone out from the point, not on a joint', () => {
    const anchor: LayoutAnchor = { kind: 'point', at: { x: 1000, y: 700 } };
    const room = shaped([[0, 0], [3000, 0], [3000, 2400], [0, 2400]], [], { anchor });
    const cfg = tile('herringbone', 600, 298.5);
    const result = lay(room, cfg, 'center-tile');
    const out = setOutLines(room, cfg, result);
    expect(out.point).toEqual({ x: 1000, y: 700 });
    expect(out.lines.every((l) => !l.onJoint)).toBe(true);
    expect(out.lines[0].from.y).toBeCloseTo(700, 9);
    expect(out.lines[0].toNeg).toBeCloseTo(700, 9);
    expect(out.lines[1].from.x).toBeCloseTo(1000, 9);
  });

  it('measures to the walls it is given', () => {
    const cfg = tile('grid');
    const room = rect(3000, 2000);
    const result = lay(room, cfg, 'center-grout');
    const finish = ring([[-6, -6], [3006, -6], [3006, 2006], [-6, 2006]]);
    const [a] = setOutLines(room, cfg, result, undefined, finish).lines;
    expect(a.toNeg).toBeCloseTo(1006, 6);
    expect(a.toPos).toBeCloseTo(1006, 6);
  });
});
