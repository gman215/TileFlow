/**
 * The takeoff: what to order, summed from the framed walls and the derived
 * rooms. Every count is computed here; the panel only formats it.
 */

import { DerivedRoom, FramedWall, FramingMember, Plan, Vec2 } from '../types';
import { assemblyMap, nodeMap } from '../plan/walls';
import { clearLength } from '../plan/edit';

export interface LumberRow {
  item: string;
  /** Cut length, mm */
  length: number;
  count: number;
}

export interface PlateStock {
  /** Every plate piece laid end to end, mm */
  totalLength: number;
  stockLength: number;
  /** Stock pieces to buy (first-fit decreasing — not optimal, so "approx.") */
  pieces: number;
  offcut: number;
}

export interface SheetRow {
  material: string;
  /** Net area to cover, mm² */
  area: number;
  sheetWidth: number;
  sheetHeight: number;
  sheets: number;
}

export interface Takeoff {
  lumber: LumberRow[];
  plates: PlateStock;
  /** Wall faces that bound a room */
  sheets: SheetRow[];
  /** Faces that bound no room: the outside of the building */
  sheathing: SheetRow[];
}

export interface TakeoffOptions {
  /** 0.10 = 10% */
  waste: number;
  stockLength: number;
  /** Sheet size by material; anything unlisted uses `defaultSheet` */
  sheetSizes?: Record<string, { width: number; height: number }>;
  defaultSheet: { width: number; height: number };
  /** Only these walls (a room's bounding walls); all walls when omitted */
  wallIds?: Set<string>;
}

const ITEM: Record<FramingMember['kind'], string> = {
  stud: 'Stud',
  corner: 'Stud',
  partition: 'Stud',
  king: 'King stud',
  jack: 'Jack stud',
  cripple: 'Cripple',
  sill: 'Sill',
  header: 'Header',
  block: 'Block',
  'bottom-plate': 'Plate',
  'top-plate': 'Plate',
};

/** Group lengths to a 1⁄16″-ish grain so 92⅝″ studs from different walls are one row. */
const grain = (mm: number) => Math.round(mm / 1.5875) * 1.5875;

/**
 * Pack plate pieces into stock lengths, first-fit decreasing. A piece longer
 * than the stock is spliced: whole sticks first, the remainder packed.
 */
export function packPlates(lengths: number[], stockLength: number): PlateStock {
  const parts: number[] = [];
  for (const len of lengths) {
    let rest = len;
    while (rest > stockLength + 1e-6) {
      parts.push(stockLength);
      rest -= stockLength;
    }
    if (rest > 1e-6) parts.push(rest);
  }
  parts.sort((a, b) => b - a);
  const bins: number[] = [];
  for (const p of parts) {
    const i = bins.findIndex((free) => free + 1e-6 >= p);
    if (i >= 0) bins[i] -= p;
    else bins.push(stockLength - p);
  }
  return {
    totalLength: lengths.reduce((s, l) => s + l, 0),
    stockLength,
    pieces: bins.length,
    offcut: bins.reduce((s, free) => s + free, 0),
  };
}

/**
 * Which side of each wall each room is on, for the walls that bound it.
 * A room is on a wall's right when its label point is on the wall's right.
 */
function roomSides(plan: Plan, derived: Map<string, DerivedRoom>): Map<string, Set<'left' | 'right'>> {
  const nodes = nodeMap(plan);
  const out = new Map<string, Set<'left' | 'right'>>();
  for (const d of derived.values()) {
    if (d.status !== 'ok' || !d.labelPoint) continue;
    for (const wallId of new Set(d.edgeWalls)) {
      if (!wallId) continue;
      const wall = plan.walls.find((w) => w.id === wallId);
      const a = wall && nodes.get(wall.a)?.position;
      const b = wall && nodes.get(wall.b)?.position;
      if (!a || !b) continue;
      const p: Vec2 = d.labelPoint;
      const side = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) > 0 ? 'right' : 'left';
      out.set(wallId, (out.get(wallId) ?? new Set()).add(side));
    }
  }
  return out;
}

export function takeoff(
  plan: Plan,
  framed: FramedWall[],
  derived: Map<string, DerivedRoom>,
  options: TakeoffOptions
): Takeoff {
  const inScope = (id: string) => !options.wallIds || options.wallIds.has(id);
  const walls = framed.filter((f) => inScope(f.wallId));

  // Lumber, grouped by item and cut length.
  const rows = new Map<string, LumberRow>();
  const plates: number[] = [];
  for (const f of walls) {
    for (const m of f.members) {
      if (m.kind === 'bottom-plate' || m.kind === 'top-plate') {
        plates.push(m.length);
        continue;
      }
      const item = m.kind === 'header' && m.label ? `Header ${m.label}` : ITEM[m.kind];
      const length = grain(m.length);
      const key = `${item}|${length}`;
      const row = rows.get(key) ?? { item, length, count: 0 };
      row.count++;
      rows.set(key, row);
    }
  }
  const order = ['Stud', 'King stud', 'Jack stud', 'Cripple', 'Sill', 'Block'];
  const lumber = [...rows.values()].sort(
    (p, q) =>
      (order.indexOf(p.item) + 1 || 99) - (order.indexOf(q.item) + 1 || 99) ||
      p.item.localeCompare(q.item) ||
      q.length - p.length
  );

  // Sheet goods: every non-structural layer on each face, net of openings.
  const assemblies = assemblyMap(plan);
  const sides = roomSides(plan, derived);
  const sheetArea = new Map<string, number>();
  const sheathArea = new Map<string, number>();
  for (const f of walls) {
    const wall = plan.walls.find((w) => w.id === f.wallId);
    const assembly = wall && assemblies.get(wall.assemblyId);
    if (!wall || !assembly) continue;
    const layers = wall.flipped ? [...assembly.layers].reverse() : assembly.layers;
    const core = layers.findIndex((l) => l.function === 'core');
    const openings = plan.openings
      .filter((o) => o.wallId === wall.id && !f.issues.some((i) => i.openingId === o.id))
      .reduce((s, o) => s + o.roughWidth * (o.roughHeight - (o.kind === 'window' ? o.sillHeight ?? 0 : 0)), 0);

    for (const side of ['left', 'right'] as const) {
      const sideLayers = (side === 'left' ? layers.slice(0, core) : layers.slice(core + 1)).filter(
        (l) => l.function !== 'air' && l.thickness > 0
      );
      if (sideLayers.length === 0) continue;
      const net = Math.max(0, clearLength(plan, wall.id, side) * f.framing.framedHeight - openings);
      const target = sides.get(wall.id)?.has(side) ? sheetArea : sheathArea;
      for (const l of sideLayers) target.set(l.material, (target.get(l.material) ?? 0) + net);
    }
  }

  const toRows = (m: Map<string, number>): SheetRow[] =>
    [...m.entries()]
      .sort((p, q) => p[0].localeCompare(q[0]))
      .map(([material, area]) => {
        const size = options.sheetSizes?.[material] ?? options.defaultSheet;
        const sheets = area > 0 ? Math.ceil((area * (1 + options.waste)) / (size.width * size.height) - 1e-9) : 0;
        return { material, area, sheetWidth: size.width, sheetHeight: size.height, sheets };
      });

  return {
    lumber,
    plates: packPlates(plates, options.stockLength),
    sheets: toRows(sheetArea),
    sheathing: toRows(sheathArea),
  };
}
