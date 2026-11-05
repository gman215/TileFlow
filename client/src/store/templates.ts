import type { Plan, PlanRoom, RoomShape, TileConfig, Vec2, OpeningKind } from '@tileflow/geometry';
import { addWallChain, emptyPlan, newId, MM_PER_FOOT, MM_PER_INCH, wallLength } from '@tileflow/geometry';
import type { RoomTileSettings } from '@tileflow/geometry';
import { joinGroup } from './planHelpers';

/**
 * Example projects for the Start card (010 R1). Each is built from the same
 * plan-editing functions a user's clicks go through, so an example behaves
 * exactly like something drawn by hand.
 */

export type TemplateId = 'bathroom' | 'l-kitchen' | 'two-rooms' | 'apartment';

export interface TemplateInfo {
  id: TemplateId;
  name: string;
  blurb: string;
}

export const TEMPLATES: TemplateInfo[] = [
  { id: 'bathroom', name: 'Bathroom', blurb: 'One small room, 12×24 tile' },
  { id: 'l-kitchen', name: 'L-shaped kitchen', blurb: 'A drawn outline with an island' },
  { id: 'two-rooms', name: 'Two rooms with a door', blurb: 'Pattern runs through the doorway' },
  { id: 'apartment', name: 'Small apartment', blurb: 'Three rooms, doors, real walls' },
];

export type TemplateResult =
  | { kind: 'room'; width: number; height: number; shape?: RoomShape; tile: Partial<TileConfig> }
  | { kind: 'plan'; plan: Plan; activeRoomId: string };

export function buildTemplate(
  id: TemplateId,
  system: 'imperial' | 'metric',
  settings: RoomTileSettings
): TemplateResult {
  const metric = system === 'metric';
  // Lengths given as [feet, metres] so both systems open on round numbers.
  const L = (ft: number, m: number) => (metric ? m * 1000 : ft * MM_PER_FOOT);
  const tile = (inW: number, inH: number, cmW: number, cmH: number): Partial<TileConfig> =>
    metric ? { width: cmW * 10, height: cmH * 10 } : { width: inW * MM_PER_INCH, height: inH * MM_PER_INCH };

  if (id === 'bathroom') {
    return { kind: 'room', width: L(5, 1.5), height: L(8, 2.4), tile: { ...tile(12, 24, 30, 60), pattern: 'offset-1/3' } };
  }

  if (id === 'l-kitchen') {
    const w = L(14, 4.2), h = L(12, 3.6), nw = L(6, 1.8), nh = L(5, 1.5);
    const pts: [number, number][] = [[0, 0], [w, 0], [w, h - nh], [w - nw, h - nh], [w - nw, h], [0, h]];
    const island = [[L(3, 0.9), L(3, 0.9)], [L(7, 2.1), L(3, 0.9)], [L(7, 2.1), L(5.5, 1.65)], [L(3, 0.9), L(5.5, 1.65)]];
    return {
      kind: 'room',
      width: w,
      height: h,
      shape: {
        boundary: { vertices: pts.map(([x, y]) => ({ x, y })) },
        holes: [{ vertices: island.map(([x, y]) => ({ x, y })) }],
      },
      tile: { ...tile(24, 24, 60, 60), pattern: 'grid' },
    };
  }

  // Each example brings its own tile, so it looks the same whatever was open before.
  const withTile = (t: Partial<TileConfig>): RoomTileSettings => ({
    ...settings,
    tileConfig: { ...settings.tileConfig, pattern: 'grid', ...t },
  });

  const interior = metric ? 'interior-89' : 'interior-2x4';
  const exterior = metric ? 'interior-140' : 'exterior-2x6';
  const doorW = metric ? 900 : 38 * MM_PER_INCH;
  const doorH = metric ? 2100 : 82.5 * MM_PER_INCH;
  let plan = emptyPlan(system);
  const rooms: PlanRoom[] = [];
  const room = (name: string, seed: Vec2, t: Partial<TileConfig> = tile(12, 12, 30, 30)) => {
    const r: PlanRoom = { id: newId('r'), name, seed, holes: [], expansionGap: metric ? 6 : 6.35, ...withTile(t) };
    rooms.push(r);
    return r;
  };
  const door = (at: Vec2, kind: OpeningKind = 'door') => {
    // The wall whose span holds this point, and how far along it the point is.
    const byId = new Map(plan.nodes.map((n) => [n.id, n.position]));
    for (const w of plan.walls) {
      const a = byId.get(w.a)!, b = byId.get(w.b)!;
      const len = wallLength(plan, w);
      const t = ((at.x - a.x) * (b.x - a.x) + (at.y - a.y) * (b.y - a.y)) / (len * len);
      const off = Math.abs((at.x - a.x) * (b.y - a.y) - (at.y - a.y) * (b.x - a.x)) / len;
      if (t > 0 && t < 1 && off < 1) {
        plan = { ...plan, openings: [...plan.openings, { id: newId('o'), wallId: w.id, kind, center: t * len, roughWidth: doorW, roughHeight: doorH }] };
        return;
      }
    }
  };
  const loop = (w: number, h: number, assemblyId: string) =>
    (plan = addWallChain(plan, [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], { assemblyId, locationLine: 'centerline' }, { closed: true }));
  const wall = (p: Vec2, q: Vec2) => (plan = addWallChain(plan, [p, q], { assemblyId: interior, locationLine: 'centerline' }));

  if (id === 'two-rooms') {
    const w = L(14, 4.2), h = L(10, 3.0), mid = L(7, 2.1);
    loop(w, h, interior);
    wall({ x: mid, y: 0 }, { x: mid, y: h });
    const a = room('Kitchen', { x: mid / 2, y: h / 2 });
    const b = room('Hall', { x: mid * 1.5, y: h / 2 });
    door({ x: mid, y: h / 2 });
    plan = { ...plan, rooms };
    plan = joinGroup(plan, a.id, b.id, newId('g'));
    return { kind: 'plan', plan, activeRoomId: a.id };
  }

  // Small apartment: living room on the left, bedroom and bath on the right.
  const w = L(24, 7.2), h = L(16, 4.8), x = L(14, 4.2), y = L(9, 2.7);
  loop(w, h, exterior);
  wall({ x, y: 0 }, { x, y: h });
  wall({ x, y }, { x: w, y });
  const living = room('Living', { x: x / 2, y: h / 2 }, tile(24, 24, 60, 60));
  room('Bedroom', { x: (x + w) / 2, y: y / 2 }, tile(6, 24, 15, 60));
  room('Bath', { x: (x + w) / 2, y: (y + h) / 2 }, tile(12, 24, 30, 60));
  door({ x, y: y / 2 });
  door({ x, y: (y + h) / 2 });
  door({ x: x / 2, y: h });
  plan = { ...plan, rooms };
  return { kind: 'plan', plan, activeRoomId: living.id };
}
