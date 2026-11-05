import { describe, it, expect } from 'vitest';
import type { Room, TileConfig } from '../types';
import { DEFAULT_OPTIMIZATION_CONFIG } from '../types';
import { computeLayout, optimize } from '../optimization';
import { rectShape } from '../utils/math';
import { deriveFloors } from '../plan/derive';
import { planFromRoom, toLayoutRoom } from '../plan/adapter';
import { IN } from './plan-fixtures';

const tile: TileConfig = { width: 12 * IN, height: 12 * IN, grout: IN / 8, pattern: 'grid' };
const settings = { tileConfig: tile, alignment: 'optimize' as const, weights: DEFAULT_OPTIMIZATION_CONFIG.weights };
const poly = (...pts: [number, number][]) => ({ vertices: pts.map(([x, y]) => ({ x, y })) });

const L = poly([0, 0], [4000, 0], [4000, 2000], [2000, 2000], [2000, 3000], [0, 3000]);

const cases: [string, Room][] = [
  ['rectangle', { width: 3048, height: 2438.4 }],
  ['L', { width: 4000, height: 3000, shape: { boundary: L, holes: [] } }],
  [
    'L with an island',
    { width: 4000, height: 3000, shape: { boundary: L, holes: [poly([500, 500], [1500, 500], [1500, 1200], [500, 1200])] } },
  ],
];

describe('planFromRoom → toLayoutRoom preserves the floor', () => {
  for (const [name, room] of cases) {
    it(`${name}: same tile counts and area`, () => {
      const plan = planFromRoom(room, settings);
      const derived = deriveFloors(plan).rooms.get(plan.rooms[0].id)!;
      expect(derived.status).toBe('ok');
      const layoutRoom = toLayoutRoom(derived, plan.rooms[0])!;

      const w = DEFAULT_OPTIMIZATION_CONFIG.weights;
      const before = computeLayout(room, tile, 0, 0, w);
      const after = computeLayout(layoutRoom.room, tile, 0, 0, w);
      expect(after.roomArea).toBeCloseTo(before.roomArea, 3);
      expect(after.fullTileCount).toBe(before.fullTileCount);
      expect(after.cutTileCount).toBe(before.cutTileCount);

      const ob = optimize(room, tile, DEFAULT_OPTIMIZATION_CONFIG).bestLayout;
      const oa = optimize(layoutRoom.room, tile, DEFAULT_OPTIMIZATION_CONFIG).bestLayout;
      expect(oa.fullTileCount + oa.cutTileCount).toBe(ob.fullTileCount + ob.cutTileCount);
      expect(oa.wastePercentage).toBeCloseTo(ob.wastePercentage, 6);
    });
  }

  it('the walls sit outside the room', () => {
    const plan = planFromRoom({ width: 3000, height: 2000 }, settings);
    const d = deriveFloors(plan);
    const outline = d.finishGeometry.solids.flatMap((s) => s.polygon.vertices);
    expect(Math.min(...outline.map((p) => p.x))).toBeCloseTo(-114.3, 6);
    expect(d.rooms.get(plan.rooms[0].id)!.coreBoundary).toBeDefined();
  });

  it('keeps the reference wall', () => {
    const room: Room = { width: 3000, height: 2000, shape: { ...rectShape(3000, 2000), referenceWall: 1 } };
    const plan = planFromRoom(room, settings);
    expect(plan.rooms[0].referenceWallId).toBe(plan.walls[1].id);
    const derived = deriveFloors(plan).rooms.get(plan.rooms[0].id)!;
    const lr = toLayoutRoom(derived, plan.rooms[0])!;
    expect(lr.room.shape!.referenceWall).toBeGreaterThanOrEqual(0);
  });
});
