import { describe, it, expect } from 'vitest';
import type { Opening, Plan } from '../types';
import { frameWalls, layoutMarks, resolveJunctions } from '../framing/frame';
import { upgradePlan, studLength, IMPERIAL_FRAMING } from '../framing/defaults';
import { takeoff, packPlates } from '../framing/takeoff';
import { deriveFloors } from '../plan/derive';
import { addWallChain, splitWallAt } from '../plan/edit';
import { polygonArea } from '../utils/math';
import { emptyPlan, rect12x10, IN, FT } from './plan-fixtures';

const style = { assemblyId: 'interior-2x4', locationLine: 'centerline' as const };
const count = (fw: ReturnType<typeof frameWalls>[number], kind: string) =>
  fw.members.filter((m) => m.kind === kind).length;

/** A single free-standing 12 ft (144″) wall. */
function wall144(): Plan {
  return addWallChain(emptyPlan(), [{ x: 0, y: 0 }, { x: 12 * FT, y: 0 }], style);
}

describe('defaults and upgrade (T1)', () => {
  it('97⅛″ framed height under three plates takes a 92⅝″ stud', () => {
    expect(studLength({ ...IMPERIAL_FRAMING, loadBearing: false }, 1.5 * IN) / IN).toBeCloseTo(92.625, 6);
  });

  it('a v1 plan upgrades with defaults and derives the same floors', () => {
    const v2 = rect12x10();
    const { framingDefaults, openings, junctions, headerRules, ...rest } = v2;
    const v1 = { ...rest, version: 1 };
    const up = upgradePlan(v1)!;
    expect(up.version).toBe(2);
    expect(up.openings).toEqual([]);
    expect(up.framingDefaults.spacing / IN).toBeCloseTo(16, 6);
    const a = deriveFloors(v2).rooms.get('r1')!.finishBoundary;
    const b = deriveFloors(up).rooms.get('r1')!.finishBoundary;
    expect(b).toEqual(a);
    expect(upgradePlan({ ...v1, version: 3 })).toBeNull();
  });
});

describe('plate extents (T2)', () => {
  it('12 × 10 ft centreline rectangle: long walls run through (147½″), short walls butt (116½″)', () => {
    const plan = rect12x10();
    const framed = new Map(frameWalls(plan).map((f) => [f.wallId, f]));
    const lengths = plan.walls.map((w) => framed.get(w.id)!.plateLength / IN);
    // Walls in drawing order: top (12 ft), right (10 ft), bottom (12 ft), left (10 ft).
    expect(lengths[0]).toBeCloseTo(147.5, 6);
    expect(lengths[1]).toBeCloseTo(116.5, 6);
    expect(lengths[2]).toBeCloseTo(147.5, 6);
    expect(lengths[3]).toBeCloseTo(116.5, 6);
  });

  it('choosing the other wall at a corner swaps through and butt there', () => {
    const plan = rect12x10();
    const corner = plan.walls[0].b; // top-right
    const swapped: Plan = { ...plan, junctions: [{ nodeId: corner, throughWallId: plan.walls[1].id }] };
    const j = resolveJunctions(swapped).get(corner)!;
    expect(j.through).toEqual([plan.walls[1].id]);
    const framed = new Map(frameWalls(swapped).map((f) => [f.wallId, f]));
    expect(framed.get(plan.walls[0].id)!.plateLength / IN).toBeCloseTo(144, 6);
    expect(framed.get(plan.walls[1].id)!.plateLength / IN).toBeCloseTo(120, 6);
  });
});

describe('stud layout (T3)', () => {
  it('144″ @ 16″ o.c. → 10 studs; first intermediate near edge at 15¼″', () => {
    const fw = frameWalls(wall144())[0];
    expect(count(fw, 'stud')).toBe(10);
    const xs = fw.members.filter((m) => m.kind === 'stud').map((m) => m.x / IN).sort((p, q) => p - q);
    expect(xs[1]).toBeCloseTo(15.25, 6);
  });

  it('layout from b mirrors it; 24″ o.c. → 7; 3 600 mm @ 600 → 7', () => {
    const fromB = layoutMarks(144 * IN, 16 * IN, 1.5 * IN, 'b').map((m) => m / IN);
    expect(fromB[fromB.length - 1]).toBeCloseTo(128, 6);
    expect(fromB[0]).toBeCloseTo(16, 6);
    expect(layoutMarks(144 * IN, 24 * IN, 1.5 * IN, 'a')).toHaveLength(5);
    expect(layoutMarks(3600, 600, 38, 'a')).toHaveLength(5);
  });
});

describe('openings (T4)', () => {
  const door = (extra: Partial<Opening> = {}): Opening => ({
    id: 'd1',
    wallId: '',
    kind: 'door',
    center: 72 * IN,
    roughWidth: 38 * IN,
    roughHeight: 82.5 * IN,
    ...extra,
  });

  it('38″ × 82½″ door centred in a 144″ wall: 8 commons, 2 kings, 2 jacks, 2 cripples, 41″ header, 106″ bottom plate', () => {
    const plan = wall144();
    plan.openings = [door({ wallId: plan.walls[0].id })];
    const fw = frameWalls(plan)[0];
    expect(fw.issues).toEqual([]);
    expect(count(fw, 'stud')).toBe(8);
    expect(count(fw, 'king')).toBe(2);
    expect(count(fw, 'jack')).toBe(2);
    expect(count(fw, 'cripple')).toBe(2);
    const header = fw.members.find((m) => m.kind === 'header')!;
    expect(header.length / IN).toBeCloseTo(41, 6);
    expect(header.label).toBe('2×4 flat');
    const plates = fw.members.filter((m) => m.kind === 'bottom-plate').map((m) => m.length / IN);
    expect(plates.reduce((s, x) => s + x, 0)).toBeCloseTo(106, 6);
    expect(plates).toHaveLength(2);
  });

  it('a 36″ window at a 36″ sill adds a sill and cripples below it', () => {
    const plan = wall144();
    plan.openings = [door({ wallId: plan.walls[0].id, kind: 'window', roughWidth: 36 * IN, roughHeight: 84 * IN, sillHeight: 36 * IN })];
    const fw = frameWalls(plan)[0];
    expect(count(fw, 'sill')).toBe(1);
    // Two marks inside the opening (64, 80): two above the header, two below the sill.
    expect(count(fw, 'cripple')).toBe(4);
    // A window keeps its bottom plate.
    expect(count(fw, 'bottom-plate')).toBe(1);
  });

  it('a 100″ opening in a bearing wall needs an engineered header', () => {
    const plan = wall144();
    plan.walls[0] = { ...plan.walls[0], framing: { loadBearing: true } };
    plan.openings = [door({ wallId: plan.walls[0].id, roughWidth: 100 * IN })];
    const fw = frameWalls(plan)[0];
    expect(fw.issues.map((i) => i.kind)).toContain('needs-engineered-header');
  });

  it('bearing headers are sized from the table', () => {
    const plan = wall144();
    plan.walls[0] = { ...plan.walls[0], framing: { loadBearing: true } };
    plan.openings = [door({ wallId: plan.walls[0].id })];
    // 38 + 2 × 1½ = 41″ span → the 48″ rule.
    expect(frameWalls(plan)[0].members.find((m) => m.kind === 'header')!.label).toBe('2×8 ×2');
  });

  it('overlapping and out-of-range openings are reported and skipped', () => {
    const plan = wall144();
    const id = plan.walls[0].id;
    plan.openings = [door({ wallId: id }), door({ id: 'd2', wallId: id, center: 80 * IN }), door({ id: 'd3', wallId: id, center: 10 * IN })];
    const kinds = frameWalls(plan)[0].issues.map((i) => i.kind).sort();
    expect(kinds).toEqual(['opening-outside', 'opening-overlap']);
  });
});

describe('junction backing (T5)', () => {
  it('3-stud corners add 2 studs, California 1', () => {
    const plan = rect12x10();
    const top = plan.walls[0];
    const fw = frameWalls(plan).find((f) => f.wallId === top.id)!;
    // The top wall runs through both of its corners.
    expect(count(fw, 'corner')).toBe(4);
    const cal: Plan = {
      ...plan,
      junctions: [top.a, top.b].map((nodeId) => ({ nodeId, corner: 'california' as const })),
    };
    expect(count(frameWalls(cal).find((f) => f.wallId === top.id)!, 'corner')).toBe(2);
  });

  it('a partition post adds 2 studs; ladder blocking on a 92⅝″ stud adds 4 blocks', () => {
    let plan = addWallChain(emptyPlan(), [{ x: 0, y: 0 }, { x: 12 * FT, y: 0 }], style);
    plan = addWallChain(plan, [{ x: 6 * FT, y: 0 }, { x: 6 * FT, y: 8 * FT }], style);
    const posts = frameWalls(plan).reduce((s, f) => s + count(f, 'partition'), 0);
    expect(posts).toBe(2);

    const tee = [...resolveJunctions(plan).values()].find((j) => j.straightRun)!;
    const ladder: Plan = { ...plan, junctions: [{ nodeId: tee.nodeId, partition: 'ladder' }] };
    const framed = frameWalls(ladder);
    expect(framed.reduce((s, f) => s + count(f, 'partition'), 0)).toBe(0);
    expect(framed.reduce((s, f) => s + count(f, 'block'), 0)).toBe(4);
  });
});

describe('doors into floors (T6)', () => {
  /** The 12 × 10 rectangle split at 6 ft, with a room each side. */
  function twoRooms(): { plan: Plan; partition: string } {
    let plan = addWallChain(emptyPlan(), [
      { x: 0, y: 0 }, { x: 12 * FT, y: 0 }, { x: 12 * FT, y: 10 * FT }, { x: 0, y: 10 * FT },
    ], style, { closed: true });
    plan = addWallChain(plan, [{ x: 6 * FT, y: 0 }, { x: 6 * FT, y: 10 * FT }], style);
    const partition = plan.walls[plan.walls.length - 1].id;
    const base = rect12x10().rooms[0];
    plan.rooms = [
      { ...base, id: 'L', name: 'L', seed: { x: 3 * FT, y: 5 * FT } },
      { ...base, id: 'R', name: 'R', seed: { x: 9 * FT, y: 5 * FT } },
    ];
    return { plan, partition };
  }
  const area = (plan: Plan, id: string) => {
    const d = deriveFloors(plan).rooms.get(id)!;
    return polygonArea(d.tileBoundary!) / (IN * IN);
  };
  const withDoor = (plan: Plan, partition: string, extra: Partial<Opening> = {}): Plan => ({
    ...plan,
    openings: [{ id: 'd', wallId: partition, kind: 'door', center: 5 * FT, roughWidth: 36 * IN, roughHeight: 82.5 * IN, ...extra }],
  });

  it('a 36″ centreline door adds 36 × 2¼ = 81 in² to each room', () => {
    const { plan, partition } = twoRooms();
    const before = { L: area(plan, 'L'), R: area(plan, 'R') };
    const door = withDoor(plan, partition);
    expect(area(door, 'L') - before.L).toBeCloseTo(81, 3);
    expect(area(door, 'R') - before.R).toBeCloseTo(81, 3);
  });

  it('through on one side, room-side on the other: combined area unchanged', () => {
    const { plan, partition } = twoRooms();
    const centre = withDoor(plan, partition);
    const total = area(centre, 'L') + area(centre, 'R');
    for (const extra of [
      { floorTransition: 'through' as const, side: 'left' as const },
      { floorTransition: 'room-side' as const, side: 'left' as const },
    ]) {
      const p = withDoor(plan, partition, extra);
      expect(area(p, 'L') + area(p, 'R')).toBeCloseTo(total, 3);
      // One room got the whole 36 × 4½, the other nothing.
      const gains = [area(p, 'L') - area(plan, 'L'), area(p, 'R') - area(plan, 'R')].sort((x, y) => x - y);
      expect(gains[0]).toBeCloseTo(0, 3);
      expect(gains[1]).toBeCloseTo(162, 3);
    }
  });

  it('windows change nothing', () => {
    const { plan, partition } = twoRooms();
    const win = withDoor(plan, partition, { kind: 'window', sillHeight: 36 * IN, roughHeight: 84 * IN });
    expect(area(win, 'L')).toBeCloseTo(area(plan, 'L'), 6);
  });

  it('splitting a wall carries its openings to the half they sit in', () => {
    const plan = wall144();
    const id = plan.walls[0].id;
    plan.openings = [{ id: 'd', wallId: id, kind: 'door', center: 100 * IN, roughWidth: 30 * IN, roughHeight: 80 * IN }];
    const split = splitWallAt(plan, id, { x: 50 * IN, y: 0 }).plan;
    const o = split.openings[0];
    expect(o.wallId).not.toBe(id);
    expect(o.center / IN).toBeCloseTo(50, 6);
  });
});

describe('takeoff (T7)', () => {
  const sheet = { width: 48 * IN, height: 96 * IN };
  const opts = (waste = 0.1) => ({ waste, stockLength: 16 * FT, defaultSheet: sheet });

  it('12 × 10 rectangle: drywall sheets match the hand calculation', () => {
    const plan = rect12x10();
    const t = takeoff(plan, frameWalls(plan), deriveFloors(plan).rooms, opts());
    // Inside faces: 2 × 139½ + 2 × 115½ = 510″ of wall, 97⅛″ high → 49 534 in².
    // × 1.1 waste / 4 608 in² per 4×8 sheet = 11.82 → 12 sheets.
    const inside = t.sheets.find((r) => r.material === 'Drywall ½″')!;
    expect(inside.area / (IN * IN)).toBeCloseTo(510 * 97.125, 3);
    expect(inside.sheets).toBe(12);
    // Outside faces bound no room: 2 × 148½ + 2 × 124½ = 546″ → separate.
    const outside = t.sheathing.find((r) => r.material === 'Drywall ½″')!;
    expect(outside.area / (IN * IN)).toBeCloseTo(546 * 97.125, 3);
  });

  it('changing waste changes only the sheet counts', () => {
    const plan = rect12x10();
    const a = takeoff(plan, frameWalls(plan), deriveFloors(plan).rooms, opts(0.1));
    const b = takeoff(plan, frameWalls(plan), deriveFloors(plan).rooms, opts(0.15));
    expect(b.lumber).toEqual(a.lumber);
    expect(b.plates).toEqual(a.plates);
    expect(b.sheets.map((r) => r.area)).toEqual(a.sheets.map((r) => r.area));
    expect(b.sheets.find((r) => r.material === 'Drywall ½″')!.sheets).toBe(13);
  });

  it('studs group by length across walls; plates pack into stock', () => {
    const plan = rect12x10();
    const t = takeoff(plan, frameWalls(plan), deriveFloors(plan).rooms, opts());
    const studs = t.lumber.filter((r) => r.item === 'Stud');
    expect(studs).toHaveLength(1);
    expect(studs[0].length / IN).toBeCloseTo(92.625, 1);
    // Plates: 3 per wall (1 bottom + 2 top) × (2 × 147½ + 2 × 116½) = 1 584″.
    expect(t.plates.totalLength / IN).toBeCloseTo(1584, 6);
    // 147½″ and 116½″ pieces don't share a 192″ stick: 6 + 6 = 12 sticks.
    expect(t.plates.pieces).toBe(12);
  });

  it('first-fit decreasing splices pieces longer than the stock', () => {
    const p = packPlates([300, 100, 100], 200);
    // 300 → 200 + 100; then 100, 100, 100 pack into two sticks with the 200.
    expect(p.pieces).toBe(3);
    expect(p.totalLength).toBe(500);
  });
});
