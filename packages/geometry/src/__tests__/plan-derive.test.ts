import { describe, it, expect } from 'vitest';
import { deriveFloors, enclosedRegions } from '../plan/derive';
import { polygonArea } from '../utils/math';
import { rect12x10, extents, addNode, addWall, room, IN, FT } from './plan-fixtures';

const SQIN_PER_SQFT = 144;
const MM2_PER_SQIN = IN * IN;

describe('deriveFloors — 12 × 10 ft centreline rectangle, Interior 2×4', () => {
  it('finish, core and tile boundaries are the hand-calculated sizes', () => {
    const plan = rect12x10();
    plan.rooms[0].expansionGap = IN / 4;
    const d = deriveFloors(plan).rooms.get('r1')!;
    expect(d.status).toBe('ok');

    const finish = extents(d.finishBoundary!.vertices);
    expect(finish.w / IN).toBeCloseTo(139.5, 6);
    expect(finish.h / IN).toBeCloseTo(115.5, 6);
    expect(polygonArea(d.finishBoundary!) / MM2_PER_SQIN / SQIN_PER_SQFT).toBeCloseTo(111.89, 2);

    const core = extents(d.coreBoundary!.vertices);
    expect(core.w / IN).toBeCloseTo(140.5, 6);
    expect(core.h / IN).toBeCloseTo(116.5, 6);

    const tile = extents(d.tileBoundary!.vertices);
    expect(tile.w / IN).toBeCloseTo(139, 6);
    expect(tile.h / IN).toBeCloseTo(115, 6);
    expect(d.tileBoundary!.vertices).toHaveLength(4);
    expect(d.edgeWalls.every((w) => w !== null)).toBe(true);
  });
});

/** Split the rectangle with a partition at x = 6 ft: two 6 × 10 rooms. */
function twoRooms() {
  const plan = rect12x10();
  const [n0, n1, n2, n3] = plan.nodes.map((n) => n.id);
  // Replace the top and bottom walls with two halves each, joined at mid nodes.
  const top = addNode(plan, { x: 6 * FT, y: 0 });
  const bottom = addNode(plan, { x: 6 * FT, y: 10 * FT });
  const asm = 'interior-2x4';
  plan.walls = plan.walls.filter(
    (w) => !((w.a === n0 && w.b === n1) || (w.a === n2 && w.b === n3))
  );
  addWall(plan, n0, top, asm);
  addWall(plan, top, n1, asm);
  addWall(plan, n2, bottom, asm);
  addWall(plan, bottom, n3, asm);
  const partition = addWall(plan, top, bottom, asm);
  plan.rooms = [room('left', { x: 3 * FT, y: 5 * FT }), room('right', { x: 9 * FT, y: 5 * FT })];
  return { plan, partition };
}

describe('deriveFloors — shared partition', () => {
  it('each room gets the clear size either side of the partition', () => {
    const { plan } = twoRooms();
    const floors = deriveFloors(plan).rooms;
    for (const id of ['left', 'right']) {
      const d = floors.get(id)!;
      expect(d.status).toBe('ok');
      const e = extents(d.finishBoundary!.vertices);
      expect(e.w / IN).toBeCloseTo(72 - 4.5, 6);
      expect(e.h / IN).toBeCloseTo(115.5, 6);
      // The T-junctions leave no stray collinear corners behind.
      expect(d.finishBoundary!.vertices).toHaveLength(4);
    }
  });

  it('deleting the partition makes both rooms redundant', () => {
    const { plan, partition } = twoRooms();
    plan.walls = plan.walls.filter((w) => w.id !== partition);
    const floors = deriveFloors(plan).rooms;
    expect(floors.get('left')!.status).toBe('redundant');
    expect(floors.get('right')!.status).toBe('redundant');
  });

  it('removing an outside wall leaves only the room it bounded not enclosed', () => {
    const { plan } = twoRooms();
    plan.walls.splice(0, 1); // the right-hand outside wall (n1 → n2)
    const floors = deriveFloors(plan).rooms;
    expect(floors.get('right')!.status).toBe('not-enclosed');
    // The left room keeps all four of its walls.
    expect(floors.get('left')!.status).toBe('ok');
  });
});

describe('deriveFloors — free-standing wall', () => {
  it('becomes a cut-out of the room it stands in', () => {
    const plan = rect12x10();
    const a = addNode(plan, { x: 4 * FT, y: 5 * FT });
    const b = addNode(plan, { x: 8 * FT, y: 5 * FT });
    addWall(plan, a, b);
    plan.rooms[0].seed = { x: 6 * FT, y: 2 * FT };
    const d = deriveFloors(plan).rooms.get('r1')!;
    expect(d.status).toBe('ok');
    expect(d.holes).toHaveLength(1);
    const hole = extents(d.holes[0].vertices);
    // Free ends are square at their nodes, so the pier is exactly 48″ long.
    expect(hole.w / IN).toBeCloseTo(48, 6);
    expect(hole.h / IN).toBeCloseTo(4.5, 6);
  });
});

describe('deriveFloors — a wall drawn through a room’s placement point', () => {
  it('the room takes a side instead of becoming not enclosed', () => {
    const { plan } = twoRooms();
    // Both seeds where the converted room's centre was: on the partition line.
    plan.rooms = [room('old', { x: 6 * FT, y: 5 * FT }), room('new', { x: 9 * FT, y: 5 * FT })];
    const floors = deriveFloors(plan).rooms;
    expect(floors.get('new')!.status).toBe('ok');
    expect(floors.get('old')!.status).toBe('ok');
    // And it took the side the new room did not.
    const xs = floors.get('old')!.finishBoundary!.vertices.map((v) => v.x);
    expect(Math.max(...xs)).toBeLessThan(6 * FT);
  });
});

describe('enclosedRegions', () => {
  it('finds both halves of a partitioned rectangle, each with a point inside it', () => {
    const { plan } = twoRooms();
    const regions = enclosedRegions(plan);
    expect(regions).toHaveLength(2);
    const xs = regions.map((r) => r.point.x).sort((a, b) => a - b);
    expect(xs[0]).toBeLessThan(6 * FT);
    expect(xs[1]).toBeGreaterThan(6 * FT);
  });
});
