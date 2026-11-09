import { describe, it, expect } from 'vitest';
import {
  addWallChain,
  splitWallAt,
  moveNode,
  moveWallParallel,
  deleteWall,
  setLocationLine,
  setAssembly,
  setClearLength,
  clearLength,
  setPlanWallLength,
  validatePlan,
  wallsAtNode,
} from '../plan/edit';
import { wallGeometry } from '../plan/walls';
import { deriveFloors } from '../plan/derive';
import { emptyPlan, rect12x10, extents, room, IN, FT } from './plan-fixtures';

const style = { assemblyId: 'interior-2x4', locationLine: 'centerline' as const };

const rectPts = [
  { x: 0, y: 0 },
  { x: 12 * FT, y: 0 },
  { x: 12 * FT, y: 10 * FT },
  { x: 0, y: 10 * FT },
];

describe('addWallChain', () => {
  it('a closed chain makes a loop with one node per corner', () => {
    const plan = addWallChain(emptyPlan(), rectPts, style, { closed: true });
    expect(plan.nodes).toHaveLength(4);
    expect(plan.walls).toHaveLength(4);
  });

  it('ending on a wall span splits it into a T-junction', () => {
    let plan = addWallChain(emptyPlan(), rectPts, style, { closed: true });
    plan = addWallChain(plan, [{ x: 6 * FT, y: 0 }, { x: 6 * FT, y: 10 * FT }], style);
    expect(plan.nodes).toHaveLength(6);
    expect(plan.walls).toHaveLength(7);
    const t = plan.nodes.find((n) => Math.abs(n.position.x - 6 * FT) < 1e-3 && n.position.y === 0)!;
    expect(wallsAtNode(plan, t.id)).toHaveLength(3);
  });

  it('a wall crossing another mid-span makes an X-junction', () => {
    let plan = addWallChain(emptyPlan(), [{ x: 0, y: 1000 }, { x: 2000, y: 1000 }], style);
    plan = addWallChain(plan, [{ x: 1000, y: 0 }, { x: 1000, y: 2000 }], style);
    const x = plan.nodes.find((n) => n.position.x === 1000 && n.position.y === 1000)!;
    expect(x).toBeDefined();
    expect(wallsAtNode(plan, x.id)).toHaveLength(4);
  });
});

describe('walls drawn along existing walls', () => {
  it('a room drawn against another reuses the shared wall instead of doubling it', () => {
    let plan = addWallChain(emptyPlan(), rectPts, style, { closed: true });
    plan = addWallChain(
      plan,
      [{ x: 12 * FT, y: 0 }, { x: 18 * FT, y: 0 }, { x: 18 * FT, y: 10 * FT }, { x: 12 * FT, y: 10 * FT }],
      style,
      { closed: true }
    );
    expect(validatePlan(plan)).toEqual([]);
    expect(plan.walls).toHaveLength(7);
  });

  it('a shorter room against a longer wall splits it and shares the part it touches', () => {
    let plan = addWallChain(emptyPlan(), rectPts, style, { closed: true });
    plan = addWallChain(
      plan,
      [{ x: 12 * FT, y: 2 * FT }, { x: 16 * FT, y: 2 * FT }, { x: 16 * FT, y: 6 * FT }, { x: 12 * FT, y: 6 * FT }],
      style,
      { closed: true }
    );
    expect(validatePlan(plan)).toEqual([]);
  });

  it('a wall overlapping past the end of another shares the overlap and extends', () => {
    let plan = addWallChain(emptyPlan(), [{ x: 0, y: 0 }, { x: 3000, y: 0 }], style);
    plan = addWallChain(plan, [{ x: 1000, y: 0 }, { x: 5000, y: 0 }], style);
    expect(validatePlan(plan)).toEqual([]);
    const total = plan.walls.reduce((s, w) => {
      const a = plan.nodes.find((n) => n.id === w.a)!.position;
      const b = plan.nodes.find((n) => n.id === w.b)!.position;
      return s + Math.hypot(b.x - a.x, b.y - a.y);
    }, 0);
    expect(total).toBeCloseTo(5000, 6);
  });
});

describe('moving', () => {
  it('moving a node drags every wall that meets there', () => {
    const plan = rect12x10();
    const n = plan.nodes[1].id;
    const moved = moveNode(plan, n, { x: 13 * FT, y: 0 });
    expect(wallsAtNode(moved, n)).toHaveLength(2);
    expect(moved.nodes[1].position.x).toBeCloseTo(13 * FT, 6);
  });

  it('a parallel drag only moves the wall across itself', () => {
    const plan = rect12x10();
    const top = plan.walls[0];
    const moved = moveWallParallel(plan, top.id, { x: 500, y: -100 });
    const a = moved.nodes.find((n) => n.id === top.a)!.position;
    expect(a.x).toBeCloseTo(0, 6);
    // Right normal of an east-going wall is +y (down), so −100 moves it up.
    expect(a.y).toBeCloseTo(-100, 6);
  });

  it('retyping a rectangle wall keeps the rectangle square', () => {
    const plan = rect12x10();
    const top = plan.walls[0];
    const next = setPlanWallLength(plan, top.id, 14 * FT);
    const d = deriveFloors(next).rooms.get('r1')!;
    expect(d.finishBoundary!.vertices).toHaveLength(4);
    expect(extents(d.finishBoundary!.vertices).w / IN).toBeCloseTo(168 - 4.5, 6);
  });
});

describe('deleteWall', () => {
  it('removes orphaned nodes and merges a straight run back into one wall', () => {
    let plan = addWallChain(emptyPlan(), rectPts, style, { closed: true });
    plan = addWallChain(plan, [{ x: 6 * FT, y: 0 }, { x: 6 * FT, y: 10 * FT }], style);
    const partition = plan.walls[plan.walls.length - 1];
    const after = deleteWall(plan, partition.id);
    expect(after.walls).toHaveLength(4);
    expect(after.nodes).toHaveLength(4);
  });
});

describe('wall properties', () => {
  it('changing the location line leaves the wall exactly where it was', () => {
    const plan = rect12x10();
    const w = plan.walls[0];
    const before = wallGeometry(plan, 'finish').solids.find((s) => s.wallId === w.id)!;
    const after = wallGeometry(setLocationLine(plan, w.id, 'finish-right'), 'finish').solids.find(
      (s) => s.wallId === w.id
    )!;
    // The wall's own faces along its length are unchanged.
    expect(after.leftFace[0].y).toBeCloseTo(before.leftFace[0].y, 6);
    expect(after.rightFace[0].y).toBeCloseTo(before.rightFace[0].y, 6);
  });

  it('changing the assembly keeps the location line and moves the faces', () => {
    const plan = rect12x10();
    const w = plan.walls[0];
    const next = setAssembly(plan, w.id, 'interior-2x6');
    const node = next.nodes.find((n) => n.id === w.a)!;
    expect(node.position).toEqual(plan.nodes.find((n) => n.id === w.a)!.position);
    const d = deriveFloors(next).rooms.get('r1')!;
    // One 2×6 wall: the room loses 1″ on that side.
    expect(extents(d.finishBoundary!.vertices).h / IN).toBeCloseTo(115.5 - 1, 6);
  });

  it('a clear-length retype makes the clear length exactly the typed value', () => {
    const plan = rect12x10();
    const top = plan.walls[0];
    // Interior side of an east-going top wall is its right side (+y, down).
    const next = setClearLength(plan, top.id, 'right', 150 * IN);
    expect(clearLength(next, top.id, 'right') / IN).toBeCloseTo(150, 6);
  });

  it('is exact on a side where another wall tees in (one step landed 2–8 mm off — 011)', () => {
    // A partition from the middle of the top wall down to the bottom splits
    // the top wall and tees into it from the interior (right) side.
    const plan = addWallChain(rect12x10(), [{ x: 6 * FT, y: 0 }, { x: 6 * FT, y: 10 * FT }], style);
    const topLeft = plan.walls.find((w) => {
      const a = plan.nodes.find((n) => n.id === w.a)!.position;
      const b = plan.nodes.find((n) => n.id === w.b)!.position;
      return a.y === 0 && b.y === 0 && Math.min(a.x, b.x) === 0;
    })!;
    for (const target of [60, 66, 80]) {
      const next = setClearLength(plan, topLeft.id, 'right', target * IN);
      expect(validatePlan(next)).toEqual([]);
      expect(clearLength(next, topLeft.id, 'right') / IN).toBeCloseTo(target, 3);
    }
  });
});

describe('validatePlan', () => {
  it('rejects a wall shorter than it is thick', () => {
    const plan = addWallChain(emptyPlan(), [{ x: 0, y: 0 }, { x: 50, y: 0 }], style);
    expect(validatePlan(plan).map((i) => i.kind)).toContain('too-short');
  });

  it('rejects walls lying on top of each other', () => {
    let plan = addWallChain(emptyPlan(), [{ x: 0, y: 0 }, { x: 3000, y: 0 }], style);
    // Bypass the chain tool's joining to force an overlap.
    plan = { ...plan, nodes: [...plan.nodes, { id: 'p', position: { x: 1000, y: 0 } }, { id: 'q', position: { x: 4000, y: 0 } }] };
    plan = { ...plan, walls: [...plan.walls, { id: 'dup', a: 'p', b: 'q', ...style }] };
    expect(validatePlan(plan).map((i) => i.kind)).toContain('overlap');
  });

  it('a clean plan has no issues', () => {
    expect(validatePlan(rect12x10())).toEqual([]);
  });
});

describe('splitWallAt', () => {
  it('splitting keeps both rooms on either side identical', () => {
    const plan = rect12x10();
    const before = deriveFloors(plan).rooms.get('r1')!;
    const { plan: split } = splitWallAt(plan, plan.walls[0].id, { x: 5 * FT, y: 0 });
    split.rooms = [room('r1', { x: 6 * FT, y: 5 * FT })];
    const after = deriveFloors(split).rooms.get('r1')!;
    expect(after.finishBoundary!.vertices).toHaveLength(before.finishBoundary!.vertices.length);
  });
});
