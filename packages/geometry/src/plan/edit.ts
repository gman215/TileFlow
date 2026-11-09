/**
 * Editing the wall graph.
 *
 * Every operation is pure: it takes a plan and returns a new one, so the
 * store's undo is a snapshot and nothing here can leave a half-edited plan
 * behind. Junctions are always explicit — a wall that ends on another wall's
 * span splits it, and two walls that cross are both split at the crossing —
 * because room derivation and (in 009) framing both read junctions off nodes.
 */

import { LocationLine, Plan, PlanWall, Vec2 } from '../types';
import { totalThickness } from './assemblies';
import {
  assemblyMap,
  clean,
  locationLineShift,
  nodeMap,
  wallGeometry,
  wallLength,
} from './walls';

/** Distances below this are the same point (mm). */
const SAME_POINT = 1e-3;

let idCounter = 0;
/** Short, collision-safe enough for one plan; ids are never shown. */
export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

const cleanPt = (p: Vec2): Vec2 => ({ x: clean(p.x), y: clean(p.y) });
const dist = (p: Vec2, q: Vec2) => Math.hypot(q.x - p.x, q.y - p.y);

function clonePlan(plan: Plan): Plan {
  return {
    ...plan,
    nodes: plan.nodes.map((n) => ({ ...n, position: { ...n.position } })),
    walls: plan.walls.map((w) => ({ ...w })),
  };
}

function positionOf(plan: Plan, nodeId: string): Vec2 {
  const n = plan.nodes.find((x) => x.id === nodeId);
  if (!n) throw new Error(`Unknown node ${nodeId}`);
  return n.position;
}

/** Walls meeting at a node. */
export function wallsAtNode(plan: Plan, nodeId: string): PlanWall[] {
  return plan.walls.filter((w) => w.a === nodeId || w.b === nodeId);
}

// ─── Splitting ────────────────────────────────────────────────────────────────

/** Parameter of the closest point on a→b, and the distance to it. */
function project(p: Vec2, a: Vec2, b: Vec2): { t: number; d: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return { t: 0, d: dist(p, a) };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  return { t, d: dist(p, { x: a.x + t * dx, y: a.y + t * dy }) };
}

/**
 * Split a wall at a point on its span. The two halves keep the original's
 * assembly, location line and direction, so the faces do not move.
 */
export function splitWallAt(
  plan: Plan,
  wallId: string,
  point: Vec2
): { plan: Plan; nodeId: string } {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall) return { plan, nodeId: '' };
  const a = positionOf(plan, wall.a);
  const b = positionOf(plan, wall.b);
  const { t } = project(point, a, b);
  // At (or beyond) an end, the junction is that end's node.
  if (t <= 0 || dist(point, a) < SAME_POINT) return { plan, nodeId: wall.a };
  if (t >= 1 || dist(point, b) < SAME_POINT) return { plan, nodeId: wall.b };

  const next = clonePlan(plan);
  const nodeId = newId('n');
  const at = cleanPt({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
  next.nodes.push({ id: nodeId, position: at });
  const i = next.walls.findIndex((w) => w.id === wallId);
  const first: PlanWall = { ...wall, b: nodeId };
  const second: PlanWall = { ...wall, id: newId('w'), a: nodeId };
  next.walls.splice(i, 1, first, second);
  // Openings go with the half they sit in, measured from that half's start.
  const splitAt = t * dist(a, b);
  next.openings = (plan.openings ?? []).map((o) =>
    o.wallId === wallId && o.center > splitAt ? { ...o, wallId: second.id, center: o.center - splitAt } : o
  );
  return { plan: next, nodeId };
}

/**
 * The node for a point: an existing node there, a split of a wall whose span
 * the point lies on, or a fresh node.
 */
function nodeFor(plan: Plan, point: Vec2, tolerance: number): { plan: Plan; nodeId: string } {
  const p = cleanPt(point);
  const existing = plan.nodes.find((n) => dist(n.position, p) <= Math.max(tolerance, SAME_POINT));
  if (existing) return { plan, nodeId: existing.id };

  for (const w of plan.walls) {
    const a = positionOf(plan, w.a);
    const b = positionOf(plan, w.b);
    const { t, d } = project(p, a, b);
    if (t > 0 && t < 1 && d <= Math.max(tolerance, SAME_POINT)) return splitWallAt(plan, w.id, p);
  }

  const next = { ...plan, nodes: [...plan.nodes] };
  const nodeId = newId('n');
  next.nodes.push({ id: nodeId, position: p });
  return { plan: next, nodeId };
}

/** Where segment p→q crosses segment a→b strictly inside both, if it does. */
function crossing(p: Vec2, q: Vec2, a: Vec2, b: Vec2): Vec2 | null {
  const r = { x: q.x - p.x, y: q.y - p.y };
  const s = { x: b.x - a.x, y: b.y - a.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((a.x - p.x) * s.y - (a.y - p.y) * s.x) / denom;
  const u = ((a.x - p.x) * r.y - (a.y - p.y) * r.x) / denom;
  const eps = 1e-6;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return { x: p.x + t * r.x, y: p.y + t * r.y };
}

export interface WallStyle {
  assemblyId: string;
  locationLine: LocationLine;
}

/**
 * Add one wall between two points, joining or splitting whatever it meets.
 * Crossings with existing walls become X-junctions: both walls are split.
 */
function addSegment(
  plan: Plan,
  from: Vec2,
  to: Vec2,
  style: WallStyle,
  tolerance: number
): Plan {
  let next = plan;
  const start = nodeFor(next, from, tolerance);
  next = start.plan;
  const end = nodeFor(next, to, tolerance);
  next = end.plan;

  const a = positionOf(next, start.nodeId);
  const b = positionOf(next, end.nodeId);
  if (dist(a, b) < SAME_POINT) return next;

  // Split every existing wall this one crosses, then chain through the
  // crossing nodes in order along the new wall.
  const hits: { t: number; point: Vec2; wallId: string }[] = [];
  for (const w of next.walls) {
    if ([w.a, w.b].includes(start.nodeId) || [w.a, w.b].includes(end.nodeId)) continue;
    const x = crossing(a, b, positionOf(next, w.a), positionOf(next, w.b));
    if (x) hits.push({ t: project(x, a, b).t, point: x, wallId: w.id });
  }
  hits.sort((p, q) => p.t - q.t);

  // Existing corners lying on the new wall (it runs along an existing wall,
  // or through its ends) become junctions too, so a wall drawn along another
  // reuses it instead of doubling it.
  const along: { t: number; nodeId?: string; point?: Vec2; wallId?: string }[] = hits.map((h) => ({ ...h }));
  for (const n of next.nodes) {
    if (n.id === start.nodeId || n.id === end.nodeId) continue;
    const { t, d } = project(n.position, a, b);
    if (t > 1e-6 && t < 1 - 1e-6 && d < SAME_POINT * 10) along.push({ t, nodeId: n.id });
  }
  along.sort((p, q) => p.t - q.t);

  const chain = [start.nodeId];
  for (const h of along) {
    if (h.nodeId) {
      chain.push(h.nodeId);
      continue;
    }
    const split = splitWallAt(next, h.wallId!, h.point!);
    next = split.plan;
    chain.push(split.nodeId);
  }
  chain.push(end.nodeId);

  next = { ...next, walls: [...next.walls] };
  const joined = (p: string, q: string) =>
    next.walls.some((w) => (w.a === p && w.b === q) || (w.a === q && w.b === p));
  for (let i = 0; i + 1 < chain.length; i++) {
    if (chain[i] === chain[i + 1] || joined(chain[i], chain[i + 1])) continue;
    next.walls.push({
      id: newId('w'),
      a: chain[i],
      b: chain[i + 1],
      assemblyId: style.assemblyId,
      locationLine: style.locationLine,
    });
  }
  return next;
}

/**
 * Add a chain of walls through these points. `closed` joins the last point
 * back to the first. Points within `tolerance` mm of an existing node join it;
 * points on an existing wall's span split it (a T-junction).
 */
export function addWallChain(
  plan: Plan,
  points: Vec2[],
  style: WallStyle,
  options: { closed?: boolean; tolerance?: number } = {}
): Plan {
  const tolerance = options.tolerance ?? SAME_POINT;
  const pts = options.closed && points.length > 2 ? [...points, points[0]] : points;
  let next = plan;
  for (let i = 0; i + 1 < pts.length; i++) {
    next = addSegment(next, pts[i], pts[i + 1], style, tolerance);
  }
  return next;
}

// ─── Moving ───────────────────────────────────────────────────────────────────

export function moveNode(plan: Plan, nodeId: string, to: Vec2): Plan {
  return {
    ...plan,
    nodes: plan.nodes.map((n) => (n.id === nodeId ? { ...n, position: cleanPt(to) } : n)),
  };
}

function moveNodes(plan: Plan, moves: Map<string, Vec2>): Plan {
  return {
    ...plan,
    nodes: plan.nodes.map((n) => {
      const d = moves.get(n.id);
      return d ? { ...n, position: cleanPt({ x: n.position.x + d.x, y: n.position.y + d.y }) } : n;
    }),
  };
}

/** Unit direction a→b of a wall. */
function directionOf(plan: Plan, wall: PlanWall): Vec2 {
  const a = positionOf(plan, wall.a);
  const b = positionOf(plan, wall.b);
  const len = dist(a, b);
  return len > 1e-9 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 1, y: 0 };
}

/**
 * Slide a wall sideways, keeping it parallel to itself. Only the component of
 * `delta` across the wall is used: dragging along its length would just be a
 * shear of its neighbours.
 */
export function moveWallParallel(plan: Plan, wallId: string, delta: Vec2): Plan {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall) return plan;
  const u = directionOf(plan, wall);
  const n = { x: -u.y, y: u.x };
  const along = delta.x * n.x + delta.y * n.y;
  const d = { x: n.x * along, y: n.y * along };
  return moveNodes(plan, new Map([[wall.a, d], [wall.b, d]]));
}

/**
 * Retype a wall's location-line length. Its start stays put and its far end
 * slides along it. As with outlines, a square neighbour is carried rigidly
 * (both its ends move) so a rectangle of walls stays a rectangle and the wall
 * opposite absorbs the change.
 */
export function setPlanWallLength(plan: Plan, wallId: string, length: number): Plan {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall || length <= 0) return plan;
  const current = wallLength(plan, wall);
  if (current < 1e-9) return plan;

  const u = directionOf(plan, wall);
  const delta = length - current;
  const d = { x: u.x * delta, y: u.y * delta };
  const moves = new Map<string, Vec2>([[wall.b, d]]);

  // The neighbour beyond b: if b is a plain corner and that wall turns square,
  // carry its far end too.
  const others = wallsAtNode(plan, wall.b).filter((w) => w.id !== wall.id);
  if (others.length === 1) {
    const other = others[0];
    const far = other.a === wall.b ? other.b : other.a;
    const v = directionOf(plan, other);
    if (Math.abs(u.x * v.x + u.y * v.y) < 1e-6) moves.set(far, d);
  }

  return moveNodes(plan, moves);
}

/**
 * The clear length of a wall on one side: its finish face, junction to
 * junction, as a tape measure would read it.
 */
export function clearLength(plan: Plan, wallId: string, side: 'left' | 'right'): number {
  const solid = wallGeometry(plan, 'finish').solids.find((s) => s.wallId === wallId);
  if (!solid) return 0;
  const [p, q] = side === 'left' ? solid.leftFace : solid.rightFace;
  return dist(p, q);
}

/**
 * Retype a wall's clear length on one side (the measured-with-a-tape number).
 *
 * The clear length does not always move one-for-one with the drawn length:
 * where another wall tees into this one, the face on that side is cut short by
 * a junction that itself shifts as the wall grows. A single proportional step
 * landed 2–8 mm off on such a side (found in 011). So step, re-measure with the
 * real geometry, and step again — the residual shrinks fast, and the loop is
 * bounded so a wall that cannot reach the target returns its best attempt.
 */
export function setClearLength(
  plan: Plan,
  wallId: string,
  side: 'left' | 'right',
  target: number
): Plan {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall || target <= 0) return plan;
  let next = plan;
  for (let i = 0; i < 8; i++) {
    const diff = target - clearLength(next, wallId, side);
    if (Math.abs(diff) < 0.01) break;
    const w = next.walls.find((x) => x.id === wallId)!;
    const stepped = setPlanWallLength(next, wallId, wallLength(next, w) + diff);
    if (stepped === next) break;
    next = stepped;
  }
  return next;
}

// ─── Wall properties ──────────────────────────────────────────────────────────

/**
 * Change which plane the drawn line names, without moving the wall: the
 * line's nodes shift across the wall by the distance between the two planes.
 */
export function setLocationLine(plan: Plan, wallId: string, line: LocationLine): Plan {
  const wall = plan.walls.find((w) => w.id === wallId);
  const assembly = wall && assemblyMap(plan).get(wall.assemblyId);
  if (!wall || !assembly || wall.locationLine === line) return plan;

  const shift = locationLineShift(wall, assembly, line);
  const u = directionOf(plan, wall);
  const d = { x: -u.y * shift, y: u.x * shift };
  const moved = moveNodes(plan, new Map([[wall.a, d], [wall.b, d]]));
  return {
    ...moved,
    walls: moved.walls.map((w) => (w.id === wallId ? { ...w, locationLine: line } : w)),
  };
}

/** Change the build-up. The drawn line stays; the faces move. */
export function setAssembly(plan: Plan, wallId: string, assemblyId: string): Plan {
  if (!plan.assemblies.some((a) => a.id === assemblyId)) return plan;
  return {
    ...plan,
    walls: plan.walls.map((w) => (w.id === wallId ? { ...w, assemblyId } : w)),
  };
}

export function flipWall(plan: Plan, wallId: string): Plan {
  return {
    ...plan,
    walls: plan.walls.map((w) => (w.id === wallId ? { ...w, flipped: !w.flipped } : w)),
  };
}

// ─── Deleting ─────────────────────────────────────────────────────────────────

/**
 * Delete a wall. Nodes left with nothing attached go too, and a straight run
 * left split by a node that no longer joins anything is merged back into one
 * wall — but only when the two halves are the same wall in every respect.
 */
export function deleteWall(plan: Plan, wallId: string): Plan {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall) return plan;
  let next: Plan = {
    ...plan,
    walls: plan.walls.filter((w) => w.id !== wallId),
    openings: (plan.openings ?? []).filter((o) => o.wallId !== wallId),
  };

  for (const nodeId of [wall.a, wall.b]) {
    const at = wallsAtNode(next, nodeId);
    if (at.length === 0) {
      next = { ...next, nodes: next.nodes.filter((n) => n.id !== nodeId) };
    } else if (at.length === 2) {
      next = mergeAt(next, nodeId, at[0], at[1]);
    }
  }
  // A junction choice naming a wall or node that is gone means nothing now.
  const nodes = new Set(next.nodes.map((n) => n.id));
  const walls = new Set(next.walls.map((w) => w.id));
  return {
    ...next,
    junctions: (next.junctions ?? []).filter(
      (j) => nodes.has(j.nodeId) && (!j.throughWallId || walls.has(j.throughWallId))
    ),
  };
}

function mergeAt(plan: Plan, nodeId: string, w1: PlanWall, w2: PlanWall): Plan {
  const same =
    w1.assemblyId === w2.assemblyId &&
    w1.locationLine === w2.locationLine &&
    Boolean(w1.flipped) === Boolean(w2.flipped);
  // Running the same way through the node: p→n then n→q.
  const [first, second] = w1.b === nodeId && w2.a === nodeId ? [w1, w2] : w2.b === nodeId && w1.a === nodeId ? [w2, w1] : [null, null];
  if (!same || !first || !second) return plan;

  const u = directionOf(plan, first);
  const v = directionOf(plan, second);
  if (Math.abs(u.x * v.y - u.y * v.x) > 1e-9 || u.x * v.x + u.y * v.y < 0) return plan;

  const merged: PlanWall = { ...first, b: second.b };
  const offset = wallLength(plan, first);
  return {
    ...plan,
    nodes: plan.nodes.filter((n) => n.id !== nodeId),
    walls: plan.walls.filter((w) => w.id !== second.id).map((w) => (w.id === first.id ? merged : w)),
    openings: (plan.openings ?? []).map((o) =>
      o.wallId === second.id ? { ...o, wallId: first.id, center: o.center + offset } : o
    ),
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface PlanIssue {
  kind: 'zero-length' | 'too-short' | 'overlap' | 'bad-reference';
  wallId: string;
  message: string;
}

/**
 * What would make the plan unusable. Checked when an edit is committed: the
 * store refuses the edit rather than storing a wall the derivation cannot
 * make sense of.
 */
export function validatePlan(plan: Plan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const nodes = nodeMap(plan);
  const assemblies = assemblyMap(plan);

  for (const w of plan.walls) {
    const a = nodes.get(w.a)?.position;
    const b = nodes.get(w.b)?.position;
    const assembly = assemblies.get(w.assemblyId);
    if (!a || !b || !assembly) {
      issues.push({ kind: 'bad-reference', wallId: w.id, message: 'A wall refers to a corner or build-up that does not exist.' });
      continue;
    }
    const len = dist(a, b);
    if (len < SAME_POINT) {
      issues.push({ kind: 'zero-length', wallId: w.id, message: 'A wall has no length.' });
    } else if (len < totalThickness(assembly)) {
      issues.push({ kind: 'too-short', wallId: w.id, message: 'A wall is shorter than it is thick.' });
    }
  }

  // Collinear walls lying on top of each other.
  for (let i = 0; i < plan.walls.length; i++) {
    const wi = plan.walls[i];
    const a = nodes.get(wi.a)?.position;
    const b = nodes.get(wi.b)?.position;
    if (!a || !b || dist(a, b) < SAME_POINT) continue;
    for (let j = i + 1; j < plan.walls.length; j++) {
      const wj = plan.walls[j];
      const c = nodes.get(wj.a)?.position;
      const d = nodes.get(wj.b)?.position;
      if (!c || !d) continue;
      const pc = project(c, a, b);
      const pd = project(d, a, b);
      if (pc.d > SAME_POINT || pd.d > SAME_POINT) continue;
      const lo = Math.max(0, Math.min(pc.t, pd.t));
      const hi = Math.min(1, Math.max(pc.t, pd.t));
      if ((hi - lo) * dist(a, b) > SAME_POINT) {
        issues.push({ kind: 'overlap', wallId: wj.id, message: 'Two walls lie on top of each other.' });
      }
    }
  }

  return issues;
}

