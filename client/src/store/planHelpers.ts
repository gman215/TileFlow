import type {
  DerivedFloors,
  LayoutResult,
  OptimizationWeights,
  Plan,
  PlanRoom,
  PatternGroup,
  RoomTileSettings,
  TileConfig,
  AlignmentMode,
  Vec2,
} from '@tileflow/geometry';
import { boundingBoxOf } from '@tileflow/geometry';

/**
 * Pure helpers for the store's floor-plan state. Kept out of the store body so
 * the rules — whose settings a grouped room uses, what happens to a group when
 * a room leaves it — are in one readable place.
 */

export function roomById(plan: Plan, id: string | null): PlanRoom | undefined {
  return id ? plan.rooms.find((r) => r.id === id) : undefined;
}

export function groupOf(plan: Plan, room: PlanRoom | undefined): PatternGroup | undefined {
  return room?.groupId ? plan.groups.find((g) => g.id === room.groupId) : undefined;
}

/** The tile settings a room is actually laid with: its group's, if it has one. */
export function settingsOf(plan: Plan, room: PlanRoom): RoomTileSettings {
  const g = groupOf(plan, room);
  const src = g ?? room;
  return {
    tileConfig: { ...src.tileConfig },
    alignment: src.alignment,
    weights: { ...src.weights },
  };
}

export interface SettingsPatch {
  tileConfig?: Partial<TileConfig>;
  alignment?: AlignmentMode;
  weights?: Partial<OptimizationWeights>;
}

/** Apply a settings change to a room — or to its whole group. */
export function patchSettings(plan: Plan, roomId: string, patch: SettingsPatch): Plan {
  const room = roomById(plan, roomId);
  if (!room) return plan;
  const apply = <T extends RoomTileSettings>(s: T): T => ({
    ...s,
    tileConfig: { ...s.tileConfig, ...patch.tileConfig },
    alignment: patch.alignment ?? s.alignment,
    weights: { ...s.weights, ...patch.weights },
  });

  const g = groupOf(plan, room);
  if (g) {
    return { ...plan, groups: plan.groups.map((x) => (x.id === g.id ? apply(x) : x)) };
  }
  return { ...plan, rooms: plan.rooms.map((r) => (r.id === roomId ? apply(r) : r)) };
}

/**
 * Take a room out of its group. It keeps a copy of the group's settings, so
 * nothing on screen changes until it is edited. A group left with one room is
 * dissolved the same way.
 */
export function leaveGroup(plan: Plan, roomId: string): Plan {
  const room = roomById(plan, roomId);
  const g = groupOf(plan, room);
  if (!room || !g) return plan;

  const remaining = g.roomIds.filter((id) => id !== roomId);
  const dissolve = remaining.length < 2;
  const released = new Set(dissolve ? [roomId, ...remaining] : [roomId]);
  const settings = { tileConfig: { ...g.tileConfig }, alignment: g.alignment, weights: { ...g.weights } };

  return {
    ...plan,
    rooms: plan.rooms.map((r) =>
      released.has(r.id) ? { ...r, ...settings, groupId: undefined } : r
    ),
    groups: dissolve
      ? plan.groups.filter((x) => x.id !== g.id)
      : plan.groups.map((x) => (x.id === g.id ? { ...x, roomIds: remaining } : x)),
  };
}

/**
 * Continue `fromId`'s pattern into `intoId`. If `fromId` is already grouped
 * the other room joins that group; otherwise a new group starts with
 * `fromId`'s settings. A room already in another group leaves it first.
 */
export function joinGroup(plan: Plan, fromId: string, intoId: string, newGroupId: string): Plan {
  if (fromId === intoId) return plan;
  let next = plan;
  const into = roomById(next, intoId);
  if (into?.groupId && into.groupId !== roomById(next, fromId)?.groupId) next = leaveGroup(next, intoId);

  const from = roomById(next, fromId);
  if (!from) return plan;
  const existing = groupOf(next, from);

  if (existing) {
    if (existing.roomIds.includes(intoId)) return next;
    return {
      ...next,
      groups: next.groups.map((g) =>
        g.id === existing.id ? { ...g, roomIds: [...g.roomIds, intoId] } : g
      ),
      rooms: next.rooms.map((r) => (r.id === intoId ? { ...r, groupId: existing.id } : r)),
    };
  }

  const group: PatternGroup = {
    id: newGroupId,
    roomIds: [fromId, intoId],
    tileConfig: { ...from.tileConfig },
    alignment: from.alignment,
    weights: { ...from.weights },
    referenceWallId: from.referenceWallId,
  };
  return {
    ...next,
    groups: [...next.groups, group],
    rooms: next.rooms.map((r) =>
      r.id === fromId || r.id === intoId ? { ...r, groupId: group.id } : r
    ),
  };
}

/** Delete a room, dissolving its group if that leaves one room in it. */
export function deleteRoom(plan: Plan, roomId: string): Plan {
  const next = leaveGroup(plan, roomId);
  return { ...next, rooms: next.rooms.filter((r) => r.id !== roomId) };
}

export function nextRoomName(plan: Plan): string {
  let n = plan.rooms.length + 1;
  const names = new Set(plan.rooms.map((r) => r.name));
  while (names.has(`Room ${n}`)) n++;
  return `Room ${n}`;
}

/** Nodes with one wall: the open ends to show when walls don't close. */
export function openEnds(plan: Plan): Vec2[] {
  const degree = new Map<string, number>();
  for (const w of plan.walls) {
    degree.set(w.a, (degree.get(w.a) ?? 0) + 1);
    degree.set(w.b, (degree.get(w.b) ?? 0) + 1);
  }
  return plan.nodes.filter((n) => degree.get(n.id) === 1).map((n) => n.position);
}

/** Plan extents for fitting the view; null for a plan with nothing drawn. */
export function planBounds(plan: Plan): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (plan.nodes.length === 0) return null;
  return boundingBoxOf([{ vertices: plan.nodes.map((n) => n.position) }]);
}

export interface TileTotal {
  /** Stable key: size and pattern */
  key: string;
  tileConfig: TileConfig;
  tiles: number;
  cuts: number;
  area: number;
  rooms: string[];
  /** Two-colour patterns: tiles placed per colour, light then dark (013) */
  colours?: number[];
}

/**
 * Tile per product (size + pattern) across rooms, summed from engine layouts.
 * Rooms in one pattern group share a product by construction.
 */
export function tileTotals(
  plan: Plan,
  derived: DerivedFloors | null,
  roomLayouts: Record<string, LayoutResult>,
  only?: Set<string>
): TileTotal[] {
  const rows = new Map<string, TileTotal>();
  for (const r of plan.rooms) {
    if (only && !only.has(r.id)) continue;
    const layout = roomLayouts[r.id];
    if (!layout || derived?.rooms.get(r.id)?.status !== 'ok') continue;
    const { tileConfig } = settingsOf(plan, r);
    const key = `${tileConfig.width.toFixed(3)}×${tileConfig.height.toFixed(3)}|${tileConfig.pattern}`;
    const row = rows.get(key) ?? { key, tileConfig, tiles: 0, cuts: 0, area: 0, rooms: [] };
    row.tiles += layout.fullTileCount + layout.cutTileCount;
    if (layout.variantCounts) {
      const add = layout.variantCounts.map((c) => c.full + c.cut);
      row.colours = row.colours ? row.colours.map((n, i) => n + add[i]) : add;
    }
    row.cuts += layout.cutTileCount;
    row.area += layout.roomArea;
    row.rooms.push(r.name);
    rows.set(key, row);
  }
  return [...rows.values()];
}
