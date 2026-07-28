import { describe, it, expect } from 'vitest';
import type { Room, TileConfig } from '../types';
import { DEFAULT_OPTIMIZATION_CONFIG } from '../types';
import { computeLayout, optimize } from '../optimization';

const WEIGHTS = { alpha: 0.7, beta: 0.3 };

function tile(overrides: Partial<TileConfig> = {}): TileConfig {
  return { width: 300, height: 300, grout: 0, pattern: 'grid', ...overrides };
}

/** 3000 × 2400 with a 300 grid and no grout — exactly 10 × 8 whole tiles. */
const EXACT_ROOM: Room = { width: 3000, height: 2400 };

describe('layout scoring', () => {
  it('a zero-cut layout is reachable for a room that is a whole tile multiple', () => {
    const perfect = computeLayout(EXACT_ROOM, tile(), 0, 0, WEIGHTS);
    expect(perfect.cutTileCount).toBe(0);
    expect(perfect.fullTileCount).toBe(80);
    expect(perfect.wastePercentage).toBe(0);
  });

  it('scores a zero-cut layout above one that wastes a fifth of the tiles', () => {
    const perfect = computeLayout(EXACT_ROOM, tile(), 0, 0, WEIGHTS);
    // Half a tile off in both axes — cuts all four edges.
    const cut = computeLayout(EXACT_ROOM, tile(), 150, 150, WEIGHTS);

    expect(cut.cutTileCount).toBeGreaterThan(0);
    expect(cut.wastePercentage).toBeGreaterThan(10);
    expect(perfect.optimizationScore).toBeGreaterThan(cut.optimizationScore);
  });

  it('gives a no-cut layout the maximum min-cut term rather than the minimum', () => {
    const perfect = computeLayout(EXACT_ROOM, tile(), 0, 0, WEIGHTS);
    // No cuts and no waste, so the score is the whole alpha weight.
    expect(perfect.optimizationScore).toBeCloseTo(WEIGHTS.alpha, 10);
  });

  it('optimize() finds the zero-waste alignment', () => {
    const { bestLayout } = optimize(
      EXACT_ROOM,
      tile(),
      DEFAULT_OPTIMIZATION_CONFIG
    );

    expect(bestLayout.cutTileCount).toBe(0);
    expect(bestLayout.wastePercentage).toBe(0);
  });

  it('still prefers the larger offcut when cuts are unavoidable', () => {
    // 3050 leaves a 50 mm strip that has to go somewhere.
    const room: Room = { width: 3050, height: 2400 };
    const { bestLayout } = optimize(room, tile(), DEFAULT_OPTIMIZATION_CONFIG);

    expect(bestLayout.cutTileCount).toBeGreaterThan(0);
    // Splitting the strip across both walls beats a single 50 mm sliver.
    expect(bestLayout.smallestCutPiece).toBeGreaterThan(50 * 300);
  });
});
