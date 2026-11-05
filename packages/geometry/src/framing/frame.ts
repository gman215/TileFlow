/**
 * Framing a wall: plates, studs on layout, openings, and junction backing.
 *
 * Everything is derived from the plan on demand, never stored: move a wall 2″
 * and every stud re-lays. Each wall is framed in its own elevation space — x
 * along the plate from its start, y up from the floor — which is what both the
 * elevation view and the plan overlay draw.
 */

import {
  FramedWall,
  FramingIssue,
  FramingMember,
  HeaderRule,
  JunctionChoice,
  Opening,
  Plan,
  PlanWall,
  Vec2,
  WallAssembly,
} from '../types';
import { assemblyMap, faceOffsets, nodeMap } from '../plan/walls';
import { effectiveFraming, studLength as studLengthOf } from './defaults';

const EPS = 1e-6;

interface WallFrame {
  wall: PlanWall;
  assembly: WallAssembly;
  a: Vec2;
  u: Vec2;
  /** Right normal */
  n: Vec2;
  length: number;
  /** Core faces and centre, as offsets from the location line */
  coreLeft: number;
  coreRight: number;
  coreCenter: number;
  coreDepth: number;
  index: number;
}

function frames(plan: Plan): Map<string, WallFrame> {
  const nodes = nodeMap(plan);
  const assemblies = assemblyMap(plan);
  const out = new Map<string, WallFrame>();
  plan.walls.forEach((wall, index) => {
    const a = nodes.get(wall.a)?.position;
    const b = nodes.get(wall.b)?.position;
    const assembly = assemblies.get(wall.assemblyId);
    if (!a || !b || !assembly) return;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < EPS) return;
    const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const core = faceOffsets(wall, assembly, 'core');
    out.set(wall.id, {
      wall,
      assembly,
      a,
      u,
      n: { x: -u.y, y: u.x },
      length,
      coreLeft: core.left,
      coreRight: core.right,
      coreCenter: (core.left + core.right) / 2,
      coreDepth: core.right - core.left,
      index,
    });
  });
  return out;
}

/**
 * Where a wall's core centreline crosses a line `offset` off another wall's
 * location line, as a distance along the first wall from its end a.
 */
function crossAt(w: WallFrame, other: WallFrame, offset: number): number | null {
  const p = { x: w.a.x + w.n.x * w.coreCenter, y: w.a.y + w.n.y * w.coreCenter };
  const q = { x: other.a.x + other.n.x * offset, y: other.a.y + other.n.y * offset };
  const cross = w.u.x * other.u.y - w.u.y * other.u.x;
  if (Math.abs(cross) < 1e-9) return null;
  return ((q.x - p.x) * other.u.y - (q.y - p.y) * other.u.x) / cross;
}

// ─── Junctions ────────────────────────────────────────────────────────────────

export interface Junction {
  nodeId: string;
  /** Walls whose plates run through the node (a collinear pair, or one wall) */
  through: string[];
  /** Walls that stop against the through wall */
  butts: string[];
  /** True when the through walls continue past the node (a T or X) */
  straightRun: boolean;
  corner: 'three-stud' | 'california';
  partition: 'post' | 'ladder';
}

/**
 * Decide, at every node where walls meet, which wall runs through.
 *
 * A straight run through the node (two collinear walls — the two halves of a
 * wall a partition tees into) always runs through as a pair. Otherwise the
 * deeper core wins, then the longer wall, then the wall drawn first: that
 * frames a rectangle with its long walls through both ends, as a framer
 * would, rather than as a pinwheel. A stored choice overrides all of that.
 */
export function resolveJunctions(plan: Plan): Map<string, Junction> {
  const f = frames(plan);
  const choices = new Map<string, JunctionChoice>(plan.junctions.map((j) => [j.nodeId, j]));
  const byNode = new Map<string, WallFrame[]>();
  for (const w of f.values()) {
    for (const id of [w.wall.a, w.wall.b]) byNode.set(id, [...(byNode.get(id) ?? []), w]);
  }

  // Direction a wall leaves a node in.
  const away = (w: WallFrame, nodeId: string): Vec2 =>
    w.wall.a === nodeId ? w.u : { x: -w.u.x, y: -w.u.y };
  const rank = (ws: WallFrame[]) => [
    Math.max(...ws.map((w) => w.coreDepth)),
    ws.reduce((s, w) => s + w.length, 0),
    -Math.min(...ws.map((w) => w.index)),
  ];
  const better = (p: number[], q: number[]) => {
    for (let i = 0; i < p.length; i++) {
      if (Math.abs(p[i] - q[i]) > 1e-6) return p[i] > q[i];
    }
    return false;
  };

  const out = new Map<string, Junction>();
  for (const [nodeId, walls] of byNode) {
    if (walls.length < 2) continue;
    const choice = choices.get(nodeId);

    const partnerOf = (w: WallFrame) =>
      walls.find((o) => {
        if (o === w) return false;
        const p = away(w, nodeId);
        const q = away(o, nodeId);
        return p.x * q.x + p.y * q.y < -1 + 1e-9;
      });

    let through: WallFrame[] | null = null;
    const chosen = choice?.throughWallId && walls.find((w) => w.wall.id === choice.throughWallId);
    if (chosen) {
      const partner = partnerOf(chosen);
      through = partner ? [chosen, partner] : [chosen];
    } else {
      const pairs: WallFrame[][] = [];
      for (const w of walls) {
        const p = partnerOf(w);
        if (p && w.index < p.index) pairs.push([w, p]);
      }
      const candidates = pairs.length > 0 ? pairs : walls.map((w) => [w]);
      for (const c of candidates) if (!through || better(rank(c), rank(through))) through = c;
    }

    const ids = new Set(through!.map((w) => w.wall.id));
    out.set(nodeId, {
      nodeId,
      through: [...ids],
      butts: walls.filter((w) => !ids.has(w.wall.id)).map((w) => w.wall.id),
      straightRun: through!.length === 2,
      corner: choice?.corner ?? 'three-stud',
      partition: choice?.partition ?? 'post',
    });
  }
  return out;
}

// ─── Plates ───────────────────────────────────────────────────────────────────

/**
 * A wall's plate, as distances along its location line from end a.
 *
 * At a node where it runs through, the plate reaches the far core face of
 * every wall butting it (the outside of an L). Where it butts, it stops at
 * the near core face of the through wall. A free end is square at its node.
 */
function plateRange(
  w: WallFrame,
  f: Map<string, WallFrame>,
  junctions: Map<string, Junction>
): { start: number; end: number } {
  const endAt = (nodeId: string, t0: number, outward: 1 | -1): number => {
    const j = junctions.get(nodeId);
    if (!j) return t0;
    const isThrough = j.through.includes(w.wall.id);
    const others = (isThrough ? j.butts : j.through).map((id) => f.get(id)!).filter(Boolean);
    if (others.length === 0) return t0;

    const hits: number[] = [];
    for (const o of others) {
      for (const off of [o.coreLeft, o.coreRight]) {
        const t = crossAt(w, o, off);
        if (t != null) hits.push((t - t0) * outward);
      }
    }
    if (hits.length === 0) return t0;
    // Through: out to the farthest face. Butting: in to the nearest one.
    if (isThrough) return t0 + outward * Math.max(0, ...hits);
    const inward = hits.filter((h) => h <= EPS);
    return t0 + outward * (inward.length > 0 ? Math.max(...inward) : Math.min(...hits));
  };

  return { start: endAt(w.wall.a, 0, -1), end: endAt(w.wall.b, w.length, 1) };
}

// ─── Layout ───────────────────────────────────────────────────────────────────

/**
 * Stud centres on layout, measured from one end of the plate the way a framer
 * marks it: every `spacing` from the end, so that 48″ sheet joints land on a
 * stud centre. Marks that would collide with the end studs are dropped.
 */
export function layoutMarks(plateLength: number, spacing: number, studWidth: number, from: 'a' | 'b'): number[] {
  const marks: number[] = [];
  for (let k = 1; ; k++) {
    const d = k * spacing;
    if (d > plateLength - 1.5 * studWidth + EPS) break;
    marks.push(from === 'a' ? d : plateLength - d);
  }
  return from === 'a' ? marks : marks.reverse();
}

function headerFor(rules: HeaderRule[], bearing: boolean, span: number): { rule: HeaderRule; ok: boolean } | null {
  const list = rules.filter((r) => r.loadBearing === bearing).sort((p, q) => p.maxSpan - q.maxSpan);
  if (list.length === 0) return null;
  const fit = list.find((r) => r.maxSpan + EPS >= span);
  return fit ? { rule: fit, ok: true } : { rule: list[list.length - 1], ok: false };
}

/**
 * Check an opening against its wall: inside the plate with room for its
 * kings, and clear of the wall's other openings. Returns the problem, or null.
 */
export function openingProblem(plan: Plan, opening: Opening): FramingIssue | null {
  const framed = frameWalls(plan).find((fw) => fw.wallId === opening.wallId);
  if (!framed) return null;
  return framed.issues.find((i) => i.openingId === opening.id) ?? null;
}

/**
 * Frame every wall with a framed core. Walls whose build-up has no framing
 * (masonry) are skipped.
 */
export function frameWalls(plan: Plan): FramedWall[] {
  const f = frames(plan);
  const junctions = resolveJunctions(plan);
  const out: FramedWall[] = [];

  for (const w of f.values()) {
    const stud = w.assembly.framing;
    if (!stud) continue;
    const sw = stud.studWidth;
    const framing = effectiveFraming(plan, w.wall, w.assembly);
    const { start, end } = plateRange(w, f, junctions);
    const L = end - start;
    if (L <= 2 * sw) continue;

    const studLen = studLengthOf(framing, sw);
    const bottom = sw;
    const topY = framing.framedHeight - framing.topPlates * sw;
    const members: FramingMember[] = [];
    const issues: FramingIssue[] = [];
    const vertical = (kind: FramingMember['kind'], x: number, y0: number, y1: number): FramingMember => ({
      kind,
      x,
      y: y0,
      width: sw,
      height: y1 - y0,
      length: y1 - y0,
    });

    // Openings first: they decide which layout studs survive.
    type Zone = { lo: number; hi: number; roL: number; roR: number; o: Opening };
    const zones: Zone[] = [];
    const doorGaps: [number, number][] = [];
    const openings = plan.openings
      .filter((o) => o.wallId === w.wall.id)
      .sort((p, q) => p.center - q.center);
    for (const o of openings) {
      const c = o.center - start;
      const roL = c - o.roughWidth / 2;
      const roR = c + o.roughWidth / 2;
      const zone = { lo: roL - 2 * sw, hi: roR + 2 * sw, roL, roR, o };
      if (zone.lo < -EPS || zone.hi > L + EPS || o.roughWidth <= 0) {
        issues.push({ kind: 'opening-outside', openingId: o.id, message: 'An opening runs past the end of its wall.' });
        continue;
      }
      if (zones.some((z) => zone.lo < z.hi - EPS && z.lo < zone.hi - EPS)) {
        issues.push({ kind: 'opening-overlap', openingId: o.id, message: 'Two openings overlap — move one along the wall.' });
        continue;
      }
      zones.push(zone);
    }

    // Plates. The bottom plate is cut out across door and cased openings.
    for (const z of zones) if (z.o.kind !== 'window') doorGaps.push([z.roL, z.roR]);
    let pieces: [number, number][] = [[0, L]];
    for (const [g0, g1] of doorGaps) {
      pieces = pieces.flatMap(([p0, p1]) =>
        g1 <= p0 || g0 >= p1 ? [[p0, p1] as [number, number]] : ([[p0, g0], [g1, p1]] as [number, number][]).filter(([x0, x1]) => x1 - x0 > EPS)
      );
    }
    for (const [p0, p1] of pieces) {
      members.push({ kind: 'bottom-plate', x: p0, y: 0, width: p1 - p0, height: sw, length: p1 - p0 });
    }
    for (let k = 0; k < framing.topPlates; k++) {
      members.push({ kind: 'top-plate', x: 0, y: topY + k * sw, width: L, height: sw, length: L });
    }

    // End studs and common studs on layout, less any inside an opening's framing.
    const marks = layoutMarks(L, framing.spacing, sw, framing.layoutFrom);
    const blocked = (x0: number, x1: number) => zones.some((z) => x0 < z.hi - EPS && z.lo + EPS < x1);
    members.push(vertical('stud', 0, bottom, bottom + studLen));
    members.push(vertical('stud', L - sw, bottom, bottom + studLen));
    for (const m of marks) {
      if (!blocked(m - sw / 2, m + sw / 2)) members.push(vertical('stud', m - sw / 2, bottom, bottom + studLen));
    }

    // Each opening's framing.
    for (const z of zones) {
      const { o, roL, roR } = z;
      const span = o.roughWidth + 2 * sw;
      const header = headerFor(plan.headerRules, framing.loadBearing, span);
      const depth = header?.rule.depth ?? sw;
      if (header && !header.ok) {
        issues.push({
          kind: 'needs-engineered-header',
          openingId: o.id,
          message: 'This opening is wider than the header table covers — it needs an engineered header.',
        });
      }
      const headTop = Math.min(o.roughHeight + depth, topY);

      members.push(vertical('king', roL - 2 * sw, bottom, bottom + studLen));
      members.push(vertical('king', roR + sw, bottom, bottom + studLen));
      members.push(vertical('jack', roL - sw, bottom, o.roughHeight));
      members.push(vertical('jack', roR, bottom, o.roughHeight));
      members.push({
        kind: 'header',
        x: roL - sw,
        y: o.roughHeight,
        width: span,
        height: headTop - o.roughHeight,
        length: span,
        label: header ? `${header.rule.member}${header.rule.plies > 1 ? ` ×${header.rule.plies}` : ''}` : undefined,
      });

      const inside = marks.filter((m) => m - sw / 2 >= roL - EPS && m + sw / 2 <= roR + EPS);
      if (topY - headTop > EPS) {
        for (const m of inside) members.push(vertical('cripple', m - sw / 2, headTop, topY));
      }
      if (o.kind === 'window' && o.sillHeight != null && o.sillHeight > bottom + sw) {
        members.push({ kind: 'sill', x: roL, y: o.sillHeight - sw, width: o.roughWidth, height: sw, length: o.roughWidth });
        for (const m of inside) members.push(vertical('cripple', m - sw / 2, bottom, o.sillHeight - sw));
      }
    }

    // Backing where other walls meet this one, if it runs through.
    for (const nodeId of [w.wall.a, w.wall.b]) {
      const j = junctions.get(nodeId);
      if (!j || !j.through.includes(w.wall.id)) continue;
      for (const buttId of j.butts) {
        const b = f.get(buttId);
        if (!b) continue;
        // Where the butting wall's core centre meets this plate.
        const xc = crossAtLocal(w, b, start);
        if (xc == null) continue;
        const half = b.coreDepth / 2;

        if (j.straightRun) {
          if (j.partition === 'post') {
            for (const x of [xc - half - sw, xc + half]) {
              if (x >= -EPS && x + sw <= L + EPS) members.push(vertical('partition', x, bottom, bottom + studLen));
            }
          } else if (w.wall.id === j.through.slice().sort((p, q) => f.get(p)!.index - f.get(q)!.index)[0]) {
            // Ladder blocking: flat blocks across the gap, one every 600 mm of height.
            const count = Math.ceil(studLen / 600);
            for (let k = 0; k < count; k++) {
              const y = bottom + ((k + 0.5) * studLen) / count;
              members.push({ kind: 'block', x: Math.max(0, xc - half), y, width: b.coreDepth, height: sw, length: framing.spacing - sw });
            }
          }
        } else {
          // A corner: backing next to the end stud, on whichever end the corner is.
          const atStart = xc < L / 2;
          const count = j.corner === 'three-stud' ? 2 : 1;
          for (let k = 1; k <= count; k++) {
            const x = atStart ? k * sw : L - (k + 1) * sw;
            members.push(vertical('corner', x, bottom, bottom + studLen));
          }
        }
      }
    }

    out.push({
      wallId: w.wall.id,
      plateStart: start,
      plateLength: L,
      framing,
      studLength: studLen,
      members,
      issues,
    });
  }
  return out;
}

/** Plate-local x on wall `w` (plate starting at `start`) where `b`'s core centreline crosses w's. */
function crossAtLocal(w: WallFrame, b: WallFrame, start: number): number | null {
  const t = crossAt(w, b, b.coreCenter);
  return t == null ? null : t - start;
}
