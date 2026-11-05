import { describe, it, expect } from 'vitest';
import type { PatternGroup, Plan } from '../types';
import { DEFAULT_OPTIMIZATION_CONFIG } from '../types';
import { CANDIDATE_BUDGET_TILE_CLIPS } from '../optimization';
import { getPatternUnit } from '../patterns';
import { deriveFloors } from '../plan/derive';
import { toLayoutRoom } from '../plan/adapter';
import { groupFrame, optimizeGroup } from '../plan/group';
import { addWallChain } from '../plan/edit';
import { emptyPlan, room, IN, FT } from './plan-fixtures';

const style = { assemblyId: 'interior-2x4', locationLine: 'centerline' as const };

/** Two 6 × 10 ft rooms side by side, sharing a partition. */
function sideBySide(widthFt = 12, heightFt = 10): Plan {
  let plan = addWallChain(
    emptyPlan(),
    [
      { x: 0, y: 0 },
      { x: widthFt * FT, y: 0 },
      { x: widthFt * FT, y: heightFt * FT },
      { x: 0, y: heightFt * FT },
    ],
    style,
    { closed: true }
  );
  const mid = (widthFt / 2) * FT;
  plan = addWallChain(plan, [{ x: mid, y: 0 }, { x: mid, y: heightFt * FT }], style);
  plan.rooms = [
    room('a', { x: mid / 2, y: (heightFt / 2) * FT }),
    room('b', { x: mid * 1.5, y: (heightFt / 2) * FT }),
  ];
  return plan;
}

function grouped(plan: Plan) {
  const tileConfig = { width: 12 * IN, height: 12 * IN, grout: IN / 8, pattern: 'grid' as const };
  const group: PatternGroup = {
    id: 'g',
    roomIds: ['a', 'b'],
    tileConfig,
    alignment: 'optimize',
    weights: DEFAULT_OPTIMIZATION_CONFIG.weights,
  };
  const derived = deriveFloors(plan).rooms;
  const members = group.roomIds.map((id) => toLayoutRoom(derived.get(id)!, plan.rooms.find((r) => r.id === id)!)!);
  const frame = groupFrame(plan, group, derived)!;
  return { group, members, frame, tileConfig };
}

/** Plan-space x of every vertical tile edge, folded into one pattern period. */
function verticalLines(xs: number[], unit: number): number[] {
  const set = new Set(xs.map((x) => Math.round((((x % unit) + unit) % unit) * 1000)));
  return [...set].sort((p, q) => p - q);
}

describe('pattern groups', () => {
  it('grout lines in both rooms sit on one lattice (to 1 µm)', () => {
    const plan = sideBySide();
    const { members, frame, tileConfig } = grouped(plan);
    const result = optimizeGroup(members, tileConfig, DEFAULT_OPTIMIZATION_CONFIG, 'optimize', frame);
    const unit = getPatternUnit(tileConfig).unitX;

    const lines = result.layouts.map((layout, i) =>
      verticalLines(
        layout.tiles.flatMap((t) => t.original.vertices.map((v) => v.x + members[i].origin.x)),
        unit
      )
    );
    expect(lines[0].length).toBeGreaterThan(0);
    expect(lines[1]).toEqual(lines[0]);
  });

  it('fixed alignment uses the same offset in every room', () => {
    const plan = sideBySide();
    const { members, frame, tileConfig } = grouped(plan);
    const r = optimizeGroup(members, tileConfig, DEFAULT_OPTIMIZATION_CONFIG, 'center-tile', frame);
    expect(r.candidatesEvaluated).toBe(1);
    expect(r.layouts.map((l) => l.offsetX)).toEqual([r.offset.x, r.offset.x]);
  });

  it('a group search stays inside the single-room clip budget', () => {
    // Big enough that the budget binds rather than the requested step.
    const plan = sideBySide(80, 40);
    const { members, frame, tileConfig } = grouped(plan);
    const r = optimizeGroup(members, tileConfig, DEFAULT_OPTIMIZATION_CONFIG, 'optimize', frame);
    const tiles = r.layouts.reduce((s, l) => s + l.tiles.length, 0);
    const groupWork = r.candidatesEvaluated * tiles;

    // Each phase is sized to the same fixed budget a single-room search
    // uses, so the whole search is bounded by two budgets plus the probe.
    expect(groupWork).toBeLessThanOrEqual(2 * CANDIDATE_BUDGET_TILE_CLIPS + tiles);
  });
});
