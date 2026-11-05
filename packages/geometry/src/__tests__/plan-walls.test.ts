import { describe, it, expect } from 'vitest';
import type { PlanWall } from '../types';
import { presetAssembly } from '../plan/assemblies';
import { faceOffsets, layerBoundaries, wallGeometry, locationLineShift } from '../plan/walls';
import { isSelfIntersecting } from '../shape';
import { emptyPlan, addNode, addWall, IN, FT } from './plan-fixtures';

const wall = (extra: Partial<PlanWall> = {}): PlanWall => ({
  id: 'w',
  a: 'a',
  b: 'b',
  assemblyId: 'interior-2x4',
  locationLine: 'centerline',
  ...extra,
});

const close = (xs: number[], ys: number[]) =>
  xs.forEach((x, i) => expect(x).toBeCloseTo(ys[i], 6));

describe('faceOffsets', () => {
  const a2x4 = presetAssembly('interior-2x4')!;

  it('centreline 2×4: layer boundaries at ±57.15 and ±44.45', () => {
    close(layerBoundaries(wall(), a2x4), [-57.15, -44.45, 44.45, 57.15]);
    const core = faceOffsets(wall(), a2x4, 'core');
    close([core.left, core.right], [-44.45, 44.45]);
  });

  it('finish-right 2×4: the drawn line is the right finish face', () => {
    close(layerBoundaries(wall({ locationLine: 'finish-right' }), a2x4), [-114.3, -101.6, -12.7, 0]);
  });

  it('every location line references the plane it names', () => {
    const at = (locationLine: PlanWall['locationLine']) =>
      layerBoundaries(wall({ locationLine }), a2x4);
    expect(at('finish-left')[0]).toBeCloseTo(0, 6);
    expect(at('core-left')[1]).toBeCloseTo(0, 6);
    expect(at('core-right')[2]).toBeCloseTo(0, 6);
    expect(at('core-center')[1] + at('core-center')[2]).toBeCloseTo(0, 6);
  });

  it('flipping a wet wall moves the cement board, not the location line', () => {
    const wet = presetAssembly('wet-2x4')!;
    const line = wall({ assemblyId: 'wet-2x4', locationLine: 'finish-left' });
    const flipped = { ...line, flipped: true };
    // Unflipped: the drawn line is the cement board's face, body to the right.
    close(layerBoundaries(line, wet), [0, 12.7, 101.6, 114.3]);
    // Flipped: mirrored about the drawn line — the body swings to the left and
    // the cement board is the layer against the line, now on the right side.
    close(layerBoundaries(flipped, wet), [-114.3, -101.6, -12.7, 0]);
    // Centreline flip leaves the faces exactly in place.
    const c = wall({ assemblyId: 'wet-2x4' });
    close(layerBoundaries({ ...c, flipped: true }, wet), layerBoundaries(c, wet));
  });

  it('locationLineShift is the distance between the two named planes', () => {
    expect(locationLineShift(wall(), a2x4, 'finish-right')).toBeCloseTo(57.15, 6);
    expect(locationLineShift(wall(), a2x4, 'core-left')).toBeCloseTo(-44.45, 6);
  });
});

describe('wallGeometry joins', () => {
  const t = 4.5 * IN; // Interior 2×4

  it('square L: inside and outside corners land exactly on the mitre', () => {
    const plan = emptyPlan();
    const a = addNode(plan, { x: -10 * FT, y: 0 });
    const c = addNode(plan, { x: 0, y: 0 });
    const d = addNode(plan, { x: 0, y: 10 * FT });
    addWall(plan, a, c);
    addWall(plan, c, d);
    const { solids, caps } = wallGeometry(plan, 'finish');
    const corners = solids.flatMap((s) => s.polygon.vertices);
    const has = (x: number, y: number) =>
      corners.some((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6);
    expect(has(-t / 2, t / 2)).toBe(true); // inside corner
    expect(has(t / 2, -t / 2)).toBe(true); // outside corner
    expect(caps).toHaveLength(0);
    for (const s of solids) expect(isSelfIntersecting(s.polygon)).toBe(false);
  });

  it('135° L mitres without self-intersection', () => {
    const plan = emptyPlan();
    const a = addNode(plan, { x: -3000, y: 0 });
    const c = addNode(plan, { x: 0, y: 0 });
    const d = addNode(plan, { x: 2000, y: 2000 });
    addWall(plan, a, c);
    addWall(plan, c, d);
    const { solids } = wallGeometry(plan, 'finish');
    expect(solids).toHaveLength(2);
    for (const s of solids) expect(isSelfIntersecting(s.polygon)).toBe(false);
  });

  it('T and X junctions get a cap filling the junction core', () => {
    const plan = emptyPlan();
    const w = addNode(plan, { x: -3000, y: 0 });
    const c = addNode(plan, { x: 0, y: 0 });
    const e = addNode(plan, { x: 3000, y: 0 });
    const s = addNode(plan, { x: 0, y: 3000 });
    addWall(plan, w, c);
    addWall(plan, c, e);
    addWall(plan, c, s);
    expect(wallGeometry(plan, 'finish').caps).toHaveLength(1);

    const n = addNode(plan, { x: 0, y: -3000 });
    addWall(plan, c, n);
    const x = wallGeometry(plan, 'finish');
    expect(x.caps).toHaveLength(1);
    for (const solid of x.solids) expect(isSelfIntersecting(solid.polygon)).toBe(false);
  });

  it('a 2×6 meeting a 2×4 at an L mitres on each wall’s own faces', () => {
    const plan = emptyPlan();
    const a = addNode(plan, { x: -3000, y: 0 });
    const c = addNode(plan, { x: 0, y: 0 });
    const d = addNode(plan, { x: 0, y: 3000 });
    addWall(plan, a, c, 'interior-2x6');
    addWall(plan, c, d, 'interior-2x4');
    const corners = wallGeometry(plan, 'finish').solids.flatMap((s) => s.polygon.vertices);
    // Inside corner: x at the 2×4's half-thickness, y at the 2×6's.
    const inside = corners.find(
      (p) => Math.abs(p.x + 2.25 * IN) < 1e-6 && Math.abs(p.y - 3.25 * IN) < 1e-6
    );
    expect(inside).toBeDefined();
  });

  it('a 10° join bevels instead of throwing a spike across the plan', () => {
    const plan = emptyPlan();
    const a = addNode(plan, { x: 3000, y: 0 });
    const c = addNode(plan, { x: 0, y: 0 });
    const ang = (10 * Math.PI) / 180;
    const d = addNode(plan, { x: 3000 * Math.cos(ang), y: 3000 * Math.sin(ang) });
    addWall(plan, a, c);
    addWall(plan, c, d);
    const pts = wallGeometry(plan, 'finish').solids.flatMap((s) => s.polygon.vertices);
    const reach = Math.max(...pts.map((p) => Math.hypot(p.x, p.y)).filter((r) => r < 2000));
    expect(reach).toBeLessThanOrEqual(4 * t + 1e-6);
  });
});
