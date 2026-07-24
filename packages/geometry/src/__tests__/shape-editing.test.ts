import { describe, it, expect } from 'vitest';
import type { Polygon } from '../types';
import {
  wallsOf,
  setWallLength,
  moveVertex,
  insertVertex,
  deleteVertex,
  isSelfIntersecting,
  validateShape,
  summarizeShape,
} from '../shape';

const poly = (...pts: [number, number][]): Polygon => ({
  vertices: pts.map(([x, y]) => ({ x, y })),
});

const RECT = poly([0, 0], [4000, 0], [4000, 3000], [0, 3000]);

describe('wallsOf', () => {
  it('reads every wall including the closing one', () => {
    const walls = wallsOf(RECT);
    expect(walls).toHaveLength(4);
    expect(walls.map((w) => Math.round(w.length))).toEqual([4000, 3000, 4000, 3000]);
    // Last wall closes back to the first corner.
    expect(walls[3].b).toEqual({ x: 0, y: 0 });
  });
});

const L_SHAPE = poly(
  [0, 0],
  [4000, 0],
  [4000, 2000],
  [2000, 2000],
  [2000, 3000],
  [0, 3000]
);

describe('setWallLength', () => {
  it('a retyped rectangle wall keeps the room a rectangle', () => {
    const walls = wallsOf(setWallLength(RECT, 0, 5000));

    expect(walls.map((w) => Math.round(w.length))).toEqual([5000, 3000, 5000, 3000]);
    // Every corner still square.
    for (const w of walls) {
      expect(Math.abs(Math.sin(2 * w.angle))).toBeCloseTo(0, 9);
    }
  });

  it('keeps every wall angle unchanged for an orthogonal room', () => {
    const before = wallsOf(RECT).map((w) => w.angle);
    const after = wallsOf(setWallLength(RECT, 1, 2500)).map((w) => w.angle);
    after.forEach((angle, i) => expect(angle).toBeCloseTo(before[i], 9));
  });

  it('keeps an L-shape square, widening only the parallel wall', () => {
    const walls = wallsOf(setWallLength(L_SHAPE, 0, 5000));

    // Wall 0 grew by 1000 and wall 2 (its parallel partner) grew to match;
    // every other wall is untouched and every corner is still square.
    expect(walls.map((w) => Math.round(w.length))).toEqual([
      5000, 2000, 3000, 1000, 2000, 3000,
    ]);
    for (const w of walls) {
      expect(Math.abs(Math.sin(2 * w.angle))).toBeCloseTo(0, 9);
    }
  });

  it('leaves an angled bay wall untouched when widening the room', () => {
    const bay = poly([0, 0], [4000, 0], [4000, 3000], [1000, 3000], [0, 2000]);
    const before = wallsOf(bay);
    const after = wallsOf(setWallLength(bay, 0, 4500));

    expect(after[0].length).toBeCloseTo(4500, 6);
    expect(after[1].length).toBeCloseTo(3000, 6);
    // The wall parallel to the one being typed takes the extra 500 mm...
    expect(after[2].length).toBeCloseTo(before[2].length + 500, 6);
    // ...and the 45° bay wall keeps both its length and its angle.
    expect(after[3].length).toBeCloseTo(before[3].length, 6);
    expect(after[3].angle).toBeCloseTo(before[3].angle, 9);
  });

  it('falls back to the measured chain when no wall can absorb it locally', () => {
    // A triangle has no wall two along to take the change, so the closing wall
    // does — the walls behave like a chain of tape measurements.
    const triangle = poly([0, 0], [4000, 0], [2000, 3000]);
    const before = wallsOf(triangle);
    const after = wallsOf(setWallLength(triangle, 0, 5000));

    expect(after[0].length).toBeCloseTo(5000, 6);
    expect(after[1].length).toBeCloseTo(before[1].length, 6);
    expect(after[2].length).toBeGreaterThan(before[2].length);
  });

  it('shrinking a wall shrinks the floor area by the expected strip', () => {
    const before = summarizeShape({ boundary: RECT, holes: [] }).area;
    const after = summarizeShape({
      boundary: setWallLength(RECT, 0, 3000),
      holes: [],
    }).area;
    expect(before - after).toBeCloseTo(1000 * 3000, 6);
  });

  it('ignores nonsense input', () => {
    expect(setWallLength(RECT, 0, 0)).toBe(RECT);
    expect(setWallLength(RECT, -1, 100)).toBe(RECT);
    expect(setWallLength(RECT, 99, 100)).toBe(RECT);
  });
});

describe('corner editing', () => {
  it('moves a corner without touching the others', () => {
    const moved = moveVertex(RECT, 2, { x: 3000, y: 2500 });
    expect(moved.vertices[2]).toEqual({ x: 3000, y: 2500 });
    expect(moved.vertices[0]).toEqual({ x: 0, y: 0 });
    expect(moved.vertices).toHaveLength(4);
  });

  it('inserts a corner on the chosen wall', () => {
    const split = insertVertex(RECT, 0, { x: 2000, y: 0 });
    expect(split.vertices).toHaveLength(5);
    expect(split.vertices[1]).toEqual({ x: 2000, y: 0 });
  });

  it('deletes a corner but never below a triangle', () => {
    const four = deleteVertex(RECT, 3);
    expect(four.vertices).toHaveLength(3);
    expect(deleteVertex(four, 0).vertices).toHaveLength(3);
  });
});

describe('validation', () => {
  it('accepts a plain rectangle', () => {
    expect(validateShape({ boundary: RECT, holes: [] })).toEqual([]);
    expect(isSelfIntersecting(RECT)).toBe(false);
  });

  it('accepts a concave L-shape', () => {
    const l = poly([0, 0], [4000, 0], [4000, 2000], [2000, 2000], [2000, 3000], [0, 3000]);
    expect(isSelfIntersecting(l)).toBe(false);
    expect(validateShape({ boundary: l, holes: [] })).toEqual([]);
  });

  it('catches a bow-tie', () => {
    const bowtie = poly([0, 0], [4000, 3000], [4000, 0], [0, 3000]);
    expect(isSelfIntersecting(bowtie)).toBe(true);

    const kinds = validateShape({ boundary: bowtie, holes: [] }).map((i) => i.kind);
    // Crossing is reported first — it is the cause, and the actionable one.
    expect(kinds[0]).toBe('self-intersecting');
  });

  it('rejects an outline with too few corners', () => {
    const issues = validateShape({ boundary: poly([0, 0], [1000, 0]), holes: [] });
    expect(issues[0].kind).toBe('too-few-corners');
  });
});

describe('summarizeShape', () => {
  it('subtracts cut-outs from the area but not the perimeter', () => {
    const island = poly([1000, 1000], [2000, 1000], [2000, 1800], [1000, 1800]);
    const summary = summarizeShape({ boundary: RECT, holes: [island] });

    expect(summary.area).toBeCloseTo(4000 * 3000 - 1000 * 800, 6);
    expect(summary.perimeter).toBeCloseTo(2 * (4000 + 3000), 6);
    expect(summary.wallCount).toBe(4);
    expect(summary.holeCount).toBe(1);
  });
});
