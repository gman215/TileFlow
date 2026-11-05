/**
 * The seam between the plan and the tile engine.
 *
 * The engine knows nothing about walls: it tiles a `Room` whose outline sits
 * at the origin. `toLayoutRoom` hands it exactly that, and returns the shift
 * so the canvas can put the tiles back where the room is in the plan.
 * `planFromRoom` goes the other way, for "Convert to floor plan".
 */

import {
  AlignmentMode,
  DerivedRoom,
  OptimizationWeights,
  Plan,
  PlanRoom,
  Polygon,
  Room,
  RoomShape,
  TileConfig,
  Vec2,
} from '../types';
import { boundingBoxOf, normalizeShape, pointInPolygon, rectShape } from '../utils/math';
import { presetAssembly, ASSEMBLY_PRESETS, cloneAssembly } from './assemblies';
import { interiorPoint } from './derive';
import { newId } from './edit';
import { DEFAULT_HEADER_RULES, IMPERIAL_FRAMING, METRIC_FRAMING } from '../framing/defaults';

export interface LayoutRoom {
  room: Room;
  /** Plan-space position of the layout room's (0, 0) */
  origin: Vec2;
}

/**
 * A derived room as the engine's input. Returns null when the room has no
 * floor to tile (not enclosed, or redundant).
 */
export function toLayoutRoom(derived: DerivedRoom, room: PlanRoom): LayoutRoom | null {
  if (derived.status !== 'ok' || !derived.tileBoundary) return null;

  const index = room.referenceWallId ? derived.edgeWalls.indexOf(room.referenceWallId) : -1;
  const shape: RoomShape = {
    boundary: derived.tileBoundary,
    holes: derived.holes,
    referenceWall: index >= 0 ? index : undefined,
  };

  const bb = boundingBoxOf([shape.boundary, ...shape.holes]);
  const { shape: normalized, width, height } = normalizeShape(shape);
  return { room: { width, height, shape: normalized }, origin: { x: bb.minX, y: bb.minY } };
}

export interface RoomTileSettings {
  tileConfig: TileConfig;
  alignment: AlignmentMode;
  weights: OptimizationWeights;
}

/**
 * Wrap a single room in walls without changing its floor.
 *
 * Each outline edge becomes a wall whose finish face *is* that edge, with the
 * wall body outside the room, and the expansion gap starts at zero — so the
 * tiled polygon is the old outline exactly and the tile count does not move.
 * Cut-outs stay hand-drawn cut-outs of the new room.
 */
export function planFromRoom(
  room: Room,
  settings: RoomTileSettings,
  assemblyId = 'interior-2x4',
  system: 'imperial' | 'metric' = 'imperial'
): Plan {
  const shape = room.shape ?? rectShape(room.width, room.height);
  const boundary = shape.boundary;
  const assembly = presetAssembly(assemblyId) ?? presetAssembly('interior-2x4')!;

  const nodes = boundary.vertices.map((p) => ({ id: newId('n'), position: { ...p } }));
  const n = nodes.length;
  const walls = nodes.map((node, i) => {
    const a = node.position;
    const b = nodes[(i + 1) % n].position;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // A point just off the edge's midpoint, on its right: inside or not?
    const probe = {
      x: (a.x + b.x) / 2 - ((b.y - a.y) / len) * 1,
      y: (a.y + b.y) / 2 + ((b.x - a.x) / len) * 1,
    };
    const roomOnRight = pointInPolygon(probe, boundary);
    return {
      id: newId('w'),
      a: node.id,
      b: nodes[(i + 1) % n].id,
      assemblyId: assembly.id,
      // The finish face on the room's side is the drawn line; the body goes out.
      locationLine: roomOnRight ? ('finish-right' as const) : ('finish-left' as const),
    };
  });

  const holes: Polygon[] = shape.holes.map((h) => ({ vertices: h.vertices.map((p) => ({ ...p })) }));
  const planRoom: PlanRoom = {
    id: newId('r'),
    name: 'Room 1',
    seed: interiorPoint(boundary, holes),
    holes,
    expansionGap: 0,
    referenceWallId: shape.referenceWall != null ? walls[shape.referenceWall]?.id : undefined,
    tileConfig: { ...settings.tileConfig },
    alignment: settings.alignment,
    weights: { ...settings.weights },
  };

  return {
    version: 2,
    nodes,
    walls,
    assemblies: [assembly],
    rooms: [planRoom],
    groups: [],
    framingDefaults: { ...(system === 'metric' ? METRIC_FRAMING : IMPERIAL_FRAMING) },
    openings: [],
    junctions: [],
    headerRules: DEFAULT_HEADER_RULES.map((r) => ({ ...r })),
  };
}

/** A plan with nothing drawn and every preset build-up available. */
export function emptyPlan(system: 'imperial' | 'metric' = 'imperial'): Plan {
  return {
    version: 2,
    nodes: [],
    walls: [],
    assemblies: ASSEMBLY_PRESETS.map(cloneAssembly),
    rooms: [],
    groups: [],
    framingDefaults: { ...(system === 'metric' ? METRIC_FRAMING : IMPERIAL_FRAMING) },
    openings: [],
    junctions: [],
    headerRules: DEFAULT_HEADER_RULES.map((r) => ({ ...r })),
  };
}
