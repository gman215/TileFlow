/**
 * Plan-view geometry for framing: where openings sit in the wall, and where
 * each stud lands in plan. Drawing only — nothing here feeds a number.
 */

import polygonClipping from 'polygon-clipping';
import type { Geom } from 'polygon-clipping';
import { FramedWall, Opening, Plan, Polygon, Vec2 } from '../types';
import { assemblyMap, faceOffsets, nodeMap } from '../plan/walls';
import { polygonToRing, ringToPolygon } from '../clipping';

export interface OpeningFootprint {
  opening: Opening;
  /** The opening through the wall's full thickness, plan space */
  polygon: Polygon;
  /** Wall frame, for dragging the opening along its wall */
  a: Vec2;
  u: Vec2;
}

export function openingFootprints(plan: Plan): OpeningFootprint[] {
  const nodes = nodeMap(plan);
  const assemblies = assemblyMap(plan);
  const out: OpeningFootprint[] = [];
  for (const o of plan.openings) {
    const wall = plan.walls.find((w) => w.id === o.wallId);
    const assembly = wall && assemblies.get(wall.assemblyId);
    const a = wall && nodes.get(wall.a)?.position;
    const b = wall && nodes.get(wall.b)?.position;
    if (!wall || !assembly || !a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = { x: -u.y, y: u.x };
    const f = faceOffsets(wall, assembly, 'finish');
    // A millimetre past each face so the cut is clean.
    const at = (s: number, off: number) => ({ x: a.x + u.x * s + n.x * off, y: a.y + u.y * s + n.y * off });
    const s0 = o.center - o.roughWidth / 2;
    const s1 = o.center + o.roughWidth / 2;
    out.push({
      opening: o,
      polygon: { vertices: [at(s0, f.left - 1), at(s1, f.left - 1), at(s1, f.right + 1), at(s0, f.right + 1)] },
      a,
      u,
    });
  }
  return out;
}

/** Wall footprints with door openings cut out of them. */
export function cutOpenings(polygons: Polygon[], cuts: Polygon[]): Polygon[] {
  if (cuts.length === 0) return polygons;
  const cutGeoms = cuts.map((c) => [polygonToRing(c)] as Geom);
  return polygons.flatMap((p) => {
    const result = polygonClipping.difference([polygonToRing(p)], ...cutGeoms);
    return result.map((poly) => ringToPolygon(poly[0]));
  });
}

/**
 * Vertical members as plan rectangles: each stud's width along the wall and
 * the core's depth across it. Cripples are left out — a plan is cut at about
 * 4 ft, through the studs, kings and jacks but above or below the cripples.
 */
export function studFootprints(plan: Plan, framed: FramedWall[]): { kind: string; polygon: Polygon }[] {
  const nodes = nodeMap(plan);
  const assemblies = assemblyMap(plan);
  const out: { kind: string; polygon: Polygon }[] = [];
  for (const fw of framed) {
    const wall = plan.walls.find((w) => w.id === fw.wallId);
    const assembly = wall && assemblies.get(wall.assemblyId);
    const a = wall && nodes.get(wall.a)?.position;
    const b = wall && nodes.get(wall.b)?.position;
    if (!wall || !assembly || !a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = { x: -u.y, y: u.x };
    const core = faceOffsets(wall, assembly, 'core');
    const at = (s: number, off: number) => ({ x: a.x + u.x * s + n.x * off, y: a.y + u.y * s + n.y * off });
    for (const m of fw.members) {
      if (!['stud', 'king', 'jack', 'corner', 'partition'].includes(m.kind)) continue;
      const s0 = fw.plateStart + m.x;
      const s1 = s0 + m.width;
      out.push({
        kind: m.kind,
        polygon: { vertices: [at(s0, core.left), at(s1, core.left), at(s1, core.right), at(s0, core.right)] },
      });
    }
  }
  return out;
}
