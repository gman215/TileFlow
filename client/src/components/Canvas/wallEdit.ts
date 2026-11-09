/**
 * Editing a wall's length on the wall itself (011 R2) — the pure half.
 *
 * Three kinds of room, one interface: what is being edited, where it sits,
 * what it would look like at a new length, and how to commit it. Each kind
 * goes through the action the sidebar already uses for it, so the inline
 * field and the sidebar can never disagree about what a length means:
 *
 *   - a plain rectangle  → `resizeRoomRect` (stays a plain rectangle; one undo step);
 *   - a drawn outline    → `setShapeWallLength` (one outline-history step);
 *   - a floor-plan wall  → `setPlanWallLengthMM`, on the length the canvas is
 *     showing: the drawn line in "Centre" view, the clear length facing the
 *     active room in "Inside" view.
 *
 * Previews use the same pure functions the actions do (`setWallLength`,
 * `setPlanWallLength` / `setClearLength`), so what the ghost shows is what
 * Enter will do.
 */

import type { Plan, Polygon, Vec2 } from '@tileflow/geometry';
import {
  clearLength,
  pointInPolygon,
  setClearLength,
  setPlanWallLength,
  setWallLength,
  validatePlan,
  validateShape,
  wallGeometry,
  wallLength,
  wallsOf,
} from '@tileflow/geometry';
import { useTileFlowStore } from '../../store/tileFlowStore';

export type RectEdge = 'top' | 'right' | 'bottom' | 'left';

export type WallTarget =
  | { kind: 'rect'; edge: RectEdge }
  | { kind: 'outline'; index: number }
  | { kind: 'plan'; wallId: string };

export interface EditableWall {
  a: Vec2;
  b: Vec2;
  /** Unit normal pointing away from the floor — where the field sits. */
  outward: Vec2;
  lengthMM: number;
  /** What this length is, for the field's label. */
  label: string;
}

export interface WallPreview {
  /** The outline (or plan walls) as they would be, to draw as a ghost. */
  lines: Vec2[][];
  /** The walls whose length changes to absorb the edit. */
  absorbing: [Vec2, Vec2][];
  /** Why Enter would be refused, or null. */
  issue: string | null;
}

const RECT_MIN_MM = 100;
const WALL_MIN_MM = 50;
const RECT_EDGES: RectEdge[] = ['top', 'right', 'bottom', 'left'];

const state = () => useTileFlowStore.getState();
const sub = (p: Vec2, q: Vec2) => ({ x: p.x - q.x, y: p.y - q.y });
const len = (v: Vec2) => Math.hypot(v.x, v.y);
const mid = (p: Vec2, q: Vec2) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

/** The normal of segment a→b that points away from `inside`. */
function outwardFrom(a: Vec2, b: Vec2, inside: Vec2): Vec2 {
  const d = sub(b, a);
  const l = len(d) || 1;
  let n = { x: -d.y / l, y: d.x / l };
  const m = mid(a, b);
  if (len(sub({ x: m.x + n.x, y: m.y + n.y }, inside)) < len(sub(m, inside))) n = { x: -n.x, y: -n.y };
  return n;
}

function centroid(points: Vec2[]): Vec2 {
  return {
    x: points.reduce((s, p) => s + p.x, 0) / (points.length || 1),
    y: points.reduce((s, p) => s + p.y, 0) / (points.length || 1),
  };
}

function rectCorners(w: number, h: number): Vec2[] {
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
}

function rectSegment(w: number, h: number, edge: RectEdge): [Vec2, Vec2] {
  const [tl, tr, br, bl] = rectCorners(w, h);
  return edge === 'top' ? [tl, tr] : edge === 'right' ? [tr, br] : edge === 'bottom' ? [br, bl] : [bl, tl];
}

// ─── Plans: which length the canvas is showing ────────────────────────────────

/**
 * In "Inside" view the canvas shows clear lengths, and the one a user means is
 * the face toward the room they are working in. Falls back to the drawn line
 * when the wall does not bound the active room.
 */
function planRef(plan: Plan, wallId: string): { ref: 'location' | 'left' | 'right'; face: [Vec2, Vec2] | null } {
  const s = state();
  const solid = wallGeometry(plan, 'finish').solids.find((x) => x.wallId === wallId);
  if (s.dimensionMode !== 'clear' || !solid) return { ref: 'location', face: null };
  const room = s.activeRoomId ? s.derived?.rooms.get(s.activeRoomId) : undefined;
  const floor = room?.finishBoundary;
  if (!floor) return { ref: 'location', face: null };
  // Nudge each face's midpoint a little off the wall, to the face's own side.
  for (const [side, face] of [['left', solid.leftFace], ['right', solid.rightFace]] as const) {
    const m = mid(face[0], face[1]);
    const n = outwardFrom(face[0], face[1], mid(solid.leftFace[0], solid.rightFace[1]));
    if (pointInPolygon({ x: m.x + n.x * 20, y: m.y + n.y * 20 }, floor)) return { ref: side, face: [face[0], face[1]] };
  }
  return { ref: 'location', face: null };
}

function planWallEnds(plan: Plan, wallId: string): [Vec2, Vec2] | null {
  const w = plan.walls.find((x) => x.id === wallId);
  if (!w) return null;
  const a = plan.nodes.find((n) => n.id === w.a)?.position;
  const b = plan.nodes.find((n) => n.id === w.b)?.position;
  return a && b ? [a, b] : null;
}

function planLines(plan: Plan): Vec2[][] {
  return plan.walls.map((w) => planWallEnds(plan, w.id)).filter((x): x is [Vec2, Vec2] => x !== null);
}

// ─── The interface ────────────────────────────────────────────────────────────

export function editableWall(t: WallTarget): EditableWall | null {
  const { room, plan, derived, activeRoomId } = state();
  if (t.kind === 'rect') {
    if (room.shape || plan) return null;
    const [a, b] = rectSegment(room.width, room.height, t.edge);
    return {
      a, b,
      outward: outwardFrom(a, b, { x: room.width / 2, y: room.height / 2 }),
      lengthMM: t.edge === 'top' || t.edge === 'bottom' ? room.width : room.height,
      label: t.edge === 'top' || t.edge === 'bottom' ? 'Room width' : 'Room depth',
    };
  }
  if (t.kind === 'outline') {
    if (!room.shape) return null;
    const wall = wallsOf(room.shape.boundary)[t.index];
    if (!wall) return null;
    return {
      a: wall.a, b: wall.b,
      outward: outwardFrom(wall.a, wall.b, centroid(room.shape.boundary.vertices)),
      lengthMM: wall.length,
      label: `W${t.index + 1}`,
    };
  }
  if (!plan) return null;
  const ends = planWallEnds(plan, t.wallId);
  const wall = plan.walls.find((w) => w.id === t.wallId);
  if (!ends || !wall) return null;
  const { ref, face } = planRef(plan, t.wallId);
  const [a, b] = face ?? ends;
  const floor = activeRoomId ? derived?.rooms.get(activeRoomId)?.finishBoundary : undefined;
  const inside = floor ? centroid(floor.vertices) : centroid(plan.nodes.map((n) => n.position));
  return {
    a, b,
    // In a plan the field sits on the room side of the face — the far side may be another room.
    outward: (() => { const o = outwardFrom(a, b, inside); return { x: -o.x, y: -o.y }; })(),
    lengthMM: ref === 'location' ? wallLength(plan, wall) : clearLength(plan, t.wallId, ref),
    label: ref === 'location' ? 'Wall (drawn line)' : 'Wall (inside, clear)',
  };
}

/** What `mm` would do, without doing it. */
export function previewWall(t: WallTarget, mm: number): WallPreview | null {
  const { room, plan } = state();
  if (!Number.isFinite(mm) || mm <= 0) return null;
  if (t.kind === 'rect') {
    if (mm < RECT_MIN_MM) return { lines: [], absorbing: [], issue: 'Too short for a room.' };
    const horizontal = t.edge === 'top' || t.edge === 'bottom';
    const w = horizontal ? mm : room.width;
    const h = horizontal ? room.height : mm;
    // The far side moves: right edge for a width, bottom edge for a depth.
    return { lines: [rectCorners(w, h)], absorbing: [rectSegment(w, h, horizontal ? 'right' : 'bottom')], issue: null };
  }
  if (t.kind === 'outline') {
    if (!room.shape) return null;
    if (mm < WALL_MIN_MM) return { lines: [], absorbing: [], issue: 'Too short for a wall.' };
    const next: Polygon = setWallLength(room.shape.boundary, t.index, mm);
    const before = wallsOf(room.shape.boundary);
    const after = wallsOf(next);
    const absorbing = after
      .filter((w) => w.index !== t.index && Math.abs(w.length - (before[w.index]?.length ?? 0)) > 0.5)
      .map((w) => [w.a, w.b] as [Vec2, Vec2]);
    const issues = validateShape({ ...room.shape, boundary: next });
    return { lines: [next.vertices], absorbing, issue: issues[0]?.message ?? null };
  }
  if (!plan) return null;
  if (mm < WALL_MIN_MM) return { lines: [], absorbing: [], issue: 'Too short for a wall.' };
  const { ref } = planRef(plan, t.wallId);
  const next = ref === 'location' ? setPlanWallLength(plan, t.wallId, mm) : setClearLength(plan, t.wallId, ref, mm);
  if (next === plan) return { lines: [], absorbing: [], issue: 'That length is not possible for this wall.' };
  // The store refuses a plan its own validation rejects (walls on top of each
  // other, …) — so the preview must too, or the ghost would promise an edit
  // that Enter cannot make.
  const planIssue = validatePlan(next)[0]?.message ?? null;
  if (planIssue) return { lines: planLines(next), absorbing: [], issue: planIssue };
  const absorbing = next.walls
    .filter((w) => w.id !== t.wallId)
    .filter((w) => {
      const old = plan.walls.find((x) => x.id === w.id);
      return old && Math.abs(wallLength(next, w) - wallLength(plan, old)) > 0.5;
    })
    .map((w) => planWallEnds(next, w.id))
    .filter((x): x is [Vec2, Vec2] => x !== null);
  return { lines: planLines(next), absorbing, issue: null };
}

/** Apply it through the action the sidebar uses. Returns false if refused. */
export function commitWall(t: WallTarget, mm: number): boolean {
  const p = previewWall(t, mm);
  if (!p || p.issue) return false;
  const s = state();
  if (t.kind === 'rect') {
    const horizontal = t.edge === 'top' || t.edge === 'bottom';
    s.resizeRoomRect(horizontal ? mm : s.room.width, horizontal ? s.room.height : mm);
  } else if (t.kind === 'outline') {
    s.setShapeWallLength(t.index, mm);
  } else if (s.plan) {
    s.setPlanWallLengthMM(t.wallId, mm, planRef(s.plan, t.wallId).ref);
  }
  return true;
}

/** Tab / Shift+Tab: the next wall round the room. */
export function neighbourWall(t: WallTarget, step: 1 | -1): WallTarget | null {
  const { room, plan } = state();
  const wrap = (i: number, n: number) => ((i % n) + n) % n;
  if (t.kind === 'rect') return { kind: 'rect', edge: RECT_EDGES[wrap(RECT_EDGES.indexOf(t.edge) + step, 4)] };
  if (t.kind === 'outline') {
    const n = room.shape?.boundary.vertices.length ?? 0;
    return n ? { kind: 'outline', index: wrap(t.index + step, n) } : null;
  }
  if (!plan || plan.walls.length === 0) return null;
  const i = plan.walls.findIndex((w) => w.id === t.wallId);
  return { kind: 'plan', wallId: plan.walls[wrap(i + step, plan.walls.length)].id };
}

export function sameTarget(a: WallTarget | null, b: WallTarget | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
