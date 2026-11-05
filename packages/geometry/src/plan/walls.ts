/**
 * Wall geometry: where a wall's faces are, and how walls meet at a junction.
 *
 * Every offset here is signed along the wall's **right normal** — on screen,
 * walking from a to b, positive is to your right. A wall drawn left-to-right
 * (y down) has its right side below the line.
 */

import {
  LocationLine,
  Plan,
  PlanNode,
  PlanWall,
  Polygon,
  Vec2,
  WallAssembly,
} from '../types';
import { coreIndex } from './assemblies';

export type FaceLevel = 'finish' | 'core';

export interface FaceOffsets {
  left: number;
  right: number;
}

/**
 * Trig on a mitre leaves dust; round to a micrometre so two walls that should
 * meet at one corner do, exactly. Same rule as the drawing snaps use.
 */
export const clean = (value: number) => Math.round(value * 1e6) / 1e6;

const MIRRORED: Record<LocationLine, LocationLine> = {
  centerline: 'centerline',
  'core-center': 'core-center',
  'finish-left': 'finish-right',
  'finish-right': 'finish-left',
  'core-left': 'core-right',
  'core-right': 'core-left',
};

/**
 * The layers and location line as they physically sit, after any flip.
 * Flipping mirrors the layer stack *and* the location-line keyword, so the
 * drawn line stays on the same plane while the cement board changes sides.
 */
function effective(
  wall: PlanWall,
  assembly: WallAssembly
): { layers: WallAssembly['layers']; line: LocationLine } {
  if (!wall.flipped) return { layers: assembly.layers, line: wall.locationLine };
  return {
    layers: [...assembly.layers].reverse(),
    line: MIRRORED[wall.locationLine],
  };
}

/** Distance from the left finish face to each layer boundary, left → right. */
function cumulative(layers: WallAssembly['layers']): number[] {
  const out = [0];
  for (const l of layers) out.push(out[out.length - 1] + l.thickness);
  return out;
}

/** Where the location line sits, measured from the left finish face. */
function referenceFromLeft(layers: WallAssembly['layers'], line: LocationLine): number {
  const p = cumulative(layers);
  const total = p[p.length - 1];
  const core = layers.findIndex((l) => l.function === 'core');
  const coreStart = core >= 0 ? p[core] : 0;
  const coreEnd = core >= 0 ? p[core + 1] : total;

  switch (line) {
    case 'centerline':
      return total / 2;
    case 'core-center':
      return (coreStart + coreEnd) / 2;
    case 'finish-left':
      return 0;
    case 'finish-right':
      return total;
    case 'core-left':
      return coreStart;
    case 'core-right':
      return coreEnd;
  }
}

/** Every layer boundary's offset from the location line, left → right. */
export function layerBoundaries(wall: PlanWall, assembly: WallAssembly): number[] {
  const { layers, line } = effective(wall, assembly);
  const r = referenceFromLeft(layers, line);
  return cumulative(layers).map((p) => p - r);
}

/** The two faces of a wall at a level, as offsets from its location line. */
export function faceOffsets(
  wall: PlanWall,
  assembly: WallAssembly,
  level: FaceLevel
): FaceOffsets {
  const { layers } = effective(wall, assembly);
  const b = layerBoundaries(wall, assembly);
  if (level === 'finish') return { left: b[0], right: b[b.length - 1] };

  const core = layers.findIndex((l) => l.function === 'core');
  return core >= 0
    ? { left: b[core], right: b[core + 1] }
    : { left: b[0], right: b[b.length - 1] };
}

/**
 * How far a wall's location line has to move, along its right normal, for the
 * new keyword to describe the same physical wall.
 */
export function locationLineShift(
  wall: PlanWall,
  assembly: WallAssembly,
  next: LocationLine
): number {
  const { layers } = effective(wall, assembly);
  const nextLine = wall.flipped ? MIRRORED[next] : next;
  const before = referenceFromLeft(layers, effective(wall, assembly).line);
  const after = referenceFromLeft(layers, nextLine);
  return after - before;
}

export function isValidAssembly(assembly: WallAssembly): boolean {
  return (
    assembly.layers.length > 0 &&
    assembly.layers.filter((l) => l.function === 'core').length === 1 &&
    coreIndex(assembly) >= 0 &&
    assembly.layers.every((l) => Number.isFinite(l.thickness) && l.thickness >= 0)
  );
}

// ─── Joins ────────────────────────────────────────────────────────────────────

/** Below this angle between neighbouring walls a mitre would spike: bevel. */
const MITRE_MIN_ANGLE = (15 * Math.PI) / 180;
/** A mitre point further than this many wall-thicknesses out is bevelled. */
const MITRE_MAX_REACH = 4;

export interface WallSolid {
  wallId: string;
  /** [aLeft, bLeft, bRight, aRight] — the wall's footprint at a level */
  polygon: Polygon;
  /** Face lines at that level, endpoint to endpoint: what bounds a room */
  leftFace: [Vec2, Vec2];
  rightFace: [Vec2, Vec2];
}

export interface WallGeometry {
  solids: WallSolid[];
  /** Fill for the centre of a junction where mitres leave a gap (T, X, bevels) */
  caps: Polygon[];
}

interface Incident {
  wall: PlanWall;
  /** Unit direction leaving the node */
  u: Vec2;
  angle: number;
  /** Face offsets in the leaving direction's own frame */
  left: number;
  right: number;
  atA: boolean;
  thickness: number;
}

const rightNormal = (u: Vec2): Vec2 => ({ x: -u.y, y: u.x });
const add = (p: Vec2, v: Vec2, s: number): Vec2 => ({ x: p.x + v.x * s, y: p.y + v.y * s });
const cleanPt = (p: Vec2): Vec2 => ({ x: clean(p.x), y: clean(p.y) });

/** Where two face lines cross, or null when they are (near) parallel. */
function lineIntersection(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const cross = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(cross) < 1e-9) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / cross;
  return add(p1, d1, t);
}

/** Find a node by id; plans are small enough that a map per call is fine. */
export function nodeMap(plan: Plan): Map<string, PlanNode> {
  return new Map(plan.nodes.map((n) => [n.id, n]));
}

export function assemblyMap(plan: Plan): Map<string, WallAssembly> {
  return new Map(plan.assemblies.map((a) => [a.id, a]));
}

/**
 * Every wall's footprint at a level, with mitred joins.
 *
 * At each node the walls are sorted by the angle they leave at. Between each
 * pair of neighbours (in that order) there is one wedge of space; the corner
 * of that wedge is where the first wall's right face meets the second wall's
 * left face. That one rule produces a clean L at any angle, a T, an X, and
 * walls of different thickness meeting, without special cases.
 *
 * `extra` pushes every face outward by that much (both sides). Deriving the
 * tileable floor this way — rather than offsetting the room polygon inward —
 * keeps the corners exactly mitred.
 */
export function wallGeometry(plan: Plan, level: FaceLevel, extra = 0): WallGeometry {
  const nodes = nodeMap(plan);
  const assemblies = assemblyMap(plan);

  // corners[wallId] = { aLeft, aRight, bLeft, bRight } in the wall's own a→b frame
  const corners = new Map<string, { aLeft?: Vec2; aRight?: Vec2; bLeft?: Vec2; bRight?: Vec2 }>();
  const incidentByNode = new Map<string, Incident[]>();

  for (const wall of plan.walls) {
    const a = nodes.get(wall.a);
    const b = nodes.get(wall.b);
    const assembly = assemblies.get(wall.assemblyId);
    if (!a || !b || !assembly) continue;
    const dx = b.position.x - a.position.x;
    const dy = b.position.y - a.position.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;

    const faces = faceOffsets(wall, assembly, level);
    const left = faces.left - extra;
    const right = faces.right + extra;
    const thickness = right - left;
    const u = { x: dx / len, y: dy / len };
    const back = { x: -u.x, y: -u.y };

    corners.set(wall.id, {});
    const push = (nodeId: string, inc: Incident) => {
      const list = incidentByNode.get(nodeId) ?? [];
      list.push(inc);
      incidentByNode.set(nodeId, list);
    };
    push(wall.a, { wall, u, angle: Math.atan2(u.y, u.x), left, right, atA: true, thickness });
    // Leaving from b the frame is reversed: the wall's right face is now on the left.
    push(wall.b, {
      wall,
      u: back,
      angle: Math.atan2(back.y, back.x),
      left: -right,
      right: -left,
      atA: false,
      thickness,
    });
  }

  const caps: Polygon[] = [];

  for (const [nodeId, list] of incidentByNode) {
    const origin = nodes.get(nodeId)!.position;
    list.sort((p, q) => p.angle - q.angle);
    const n = list.length;

    // Per incident, the corner on its right (toward the next wall) and on its
    // left (toward the previous one), in its leaving frame.
    const rightCorner: Vec2[] = new Array(n);
    const leftCorner: Vec2[] = new Array(n);

    for (let i = 0; i < n; i++) {
      const cur = list[i];
      const nR = rightNormal(cur.u);
      const ownRight = add(origin, nR, cur.right);
      const ownLeft = add(origin, nR, cur.left);

      if (n === 1) {
        rightCorner[i] = ownRight;
        leftCorner[i] = ownLeft;
        continue;
      }

      const next = list[(i + 1) % n];
      let sweep = next.angle - cur.angle;
      if (sweep <= 0) sweep += 2 * Math.PI;

      const nextR = rightNormal(next.u);
      const nextOwnLeft = add(origin, nextR, next.left);
      const hit =
        sweep < MITRE_MIN_ANGLE
          ? null
          : lineIntersection(ownRight, cur.u, nextOwnLeft, next.u);
      const reach = Math.max(cur.thickness, next.thickness) * MITRE_MAX_REACH;

      if (hit && Math.hypot(hit.x - origin.x, hit.y - origin.y) <= reach) {
        rightCorner[i] = hit;
        leftCorner[(i + 1) % n] = hit;
      } else {
        // Parallel (a straight run) or too sharp: each wall keeps its own
        // face end; the cap below fills the wedge between them.
        rightCorner[i] = ownRight;
        leftCorner[(i + 1) % n] = nextOwnLeft;
      }
    }

    for (let i = 0; i < n; i++) {
      const inc = list[i];
      const c = corners.get(inc.wall.id)!;
      const r = cleanPt(rightCorner[i]);
      const l = cleanPt(leftCorner[i]);
      if (inc.atA) {
        c.aLeft = l;
        c.aRight = r;
      } else {
        // Leaving-frame left/right are the wall's right/left at this end.
        c.bRight = l;
        c.bLeft = r;
      }
    }

    if (n >= 2) {
      // The corner points in angular order. For an L these are just the two
      // mitre points (no area), for a T or X they enclose the junction core.
      const ring: Vec2[] = [];
      for (let i = 0; i < n; i++) {
        for (const p of [leftCorner[i], rightCorner[i]].map(cleanPt)) {
          const last = ring[ring.length - 1];
          if (!last || last.x !== p.x || last.y !== p.y) ring.push(p);
        }
      }
      if (ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y) {
        ring.pop();
      }
      if (ring.length >= 3 && Math.abs(signedArea(ring)) > 1e-6) {
        caps.push({ vertices: ring });
      }
    }
  }

  const solids: WallSolid[] = [];
  for (const wall of plan.walls) {
    const c = corners.get(wall.id);
    if (!c || !c.aLeft || !c.aRight || !c.bLeft || !c.bRight) continue;
    solids.push({
      wallId: wall.id,
      polygon: { vertices: [c.aLeft, c.bLeft, c.bRight, c.aRight] },
      leftFace: [c.aLeft, c.bLeft],
      rightFace: [c.aRight, c.bRight],
    });
  }

  return { solids, caps };
}

function signedArea(v: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    const j = (i + 1) % v.length;
    s += v[i].x * v[j].y - v[j].x * v[i].y;
  }
  return s / 2;
}

/** Length of a wall's location line, in mm. */
export function wallLength(plan: Plan, wall: PlanWall): number {
  const nodes = nodeMap(plan);
  const a = nodes.get(wall.a)?.position;
  const b = nodes.get(wall.b)?.position;
  return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
}
