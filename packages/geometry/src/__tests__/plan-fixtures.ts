import type { LocationLine, Plan, PlanRoom, Vec2 } from '../types';
import { MM_PER_INCH, MM_PER_FOOT } from '../types';
import { ASSEMBLY_PRESETS, cloneAssembly } from '../plan/assemblies';
import { DEFAULT_HEADER_RULES, IMPERIAL_FRAMING } from '../framing/defaults';

export const IN = MM_PER_INCH;
export const FT = MM_PER_FOOT;

/** A plan with every preset available and nothing drawn. */
export function emptyPlan(): Plan {
  return {
    version: 2,
    nodes: [],
    walls: [],
    assemblies: ASSEMBLY_PRESETS.map(cloneAssembly),
    rooms: [],
    groups: [],
    framingDefaults: { ...IMPERIAL_FRAMING },
    openings: [],
    junctions: [],
    headerRules: DEFAULT_HEADER_RULES.map((r) => ({ ...r })),
  };
}

export function room(id: string, seed: Vec2, extra: Partial<PlanRoom> = {}): PlanRoom {
  return {
    id,
    name: id,
    seed,
    holes: [],
    expansionGap: 0,
    tileConfig: { width: 12 * IN, height: 12 * IN, grout: IN / 8, pattern: 'grid' },
    alignment: 'optimize',
    weights: { alpha: 0.7, beta: 0.3 },
    ...extra,
  };
}

let counter = 0;

/**
 * Add a closed loop of walls through these points (plan mm). Returns the node
 * ids in order so tests can join more walls to them.
 */
export function addLoop(
  plan: Plan,
  pts: Vec2[],
  assemblyId = 'interior-2x4',
  locationLine: LocationLine = 'centerline'
): string[] {
  const ids = pts.map((position) => {
    const id = `n${++counter}`;
    plan.nodes.push({ id, position });
    return id;
  });
  ids.forEach((a, i) => {
    plan.walls.push({
      id: `w${++counter}`,
      a,
      b: ids[(i + 1) % ids.length],
      assemblyId,
      locationLine,
    });
  });
  return ids;
}

export function addNode(plan: Plan, position: Vec2): string {
  const id = `n${++counter}`;
  plan.nodes.push({ id, position });
  return id;
}

export function addWall(
  plan: Plan,
  a: string,
  b: string,
  assemblyId = 'interior-2x4',
  locationLine: LocationLine = 'centerline'
): string {
  const id = `w${++counter}`;
  plan.walls.push({ id, a, b, assemblyId, locationLine });
  return id;
}

/** The 12 × 10 ft centreline rectangle used throughout the spec. */
export function rect12x10(assemblyId = 'interior-2x4'): Plan {
  const plan = emptyPlan();
  addLoop(
    plan,
    [
      { x: 0, y: 0 },
      { x: 12 * FT, y: 0 },
      { x: 12 * FT, y: 10 * FT },
      { x: 0, y: 10 * FT },
    ],
    assemblyId
  );
  plan.rooms.push(room('r1', { x: 6 * FT, y: 5 * FT }));
  return plan;
}

export function extents(vertices: Vec2[]): { w: number; h: number } {
  const xs = vertices.map((v) => v.x);
  const ys = vertices.map((v) => v.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
