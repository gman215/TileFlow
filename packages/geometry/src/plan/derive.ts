/**
 * Rooms from walls.
 *
 * A room is never stored as a polygon. It is a placement point, and its floor
 * is whatever closed region of wall faces surrounds that point — found by
 * unioning every wall's footprint and reading the holes of the result. Edit a
 * wall and every room it touches follows; open a wall and the room says it is
 * no longer enclosed instead of quietly vanishing.
 */

import polygonClipping from 'polygon-clipping';
import type { Geom, MultiPolygon } from 'polygon-clipping';
import { DerivedRoom, Plan, PlanRoom, Polygon, Vec2 } from '../types';
import { polygonArea, pointInPolygon, boundingBox, polygonCentroid } from '../utils/math';
import { polygonToRing, ringToPolygon } from '../clipping';
import { FaceLevel, wallGeometry, WallGeometry, clean, faceOffsets, nodeMap, assemblyMap } from './walls';

/** A closed region of floor, bounded by wall faces at one level. */
interface Region {
  ring: Polygon;
  area: number;
  /** Union polygons sitting directly inside this region (free-standing walls) */
  islands: Polygon[];
}

interface LevelRegions {
  regions: Region[];
  /** Outer outlines of every union polygon — the wall mass itself */
  mass: Polygon[];
  geometry: WallGeometry;
}

/** Drop vertices that sit on a straight run: where a partition meets a wall face. */
function simplify(poly: Polygon): Polygon {
  let v = poly.vertices;
  let changed = true;
  while (changed && v.length > 3) {
    changed = false;
    for (let i = 0; i < v.length; i++) {
      const p = v[(i + v.length - 1) % v.length];
      const q = v[i];
      const r = v[(i + 1) % v.length];
      const cross = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      const span = Math.hypot(r.x - p.x, r.y - p.y);
      // Area-normalised: a 1 µm deviation over a metre-long wall is still a straight wall.
      if (span < 1e-9 || Math.abs(cross) / span < 1e-4) {
        v = v.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return { vertices: v.map((p) => ({ x: clean(p.x), y: clean(p.y) })) };
}

function regionsAt(plan: Plan, level: FaceLevel, extra = 0): LevelRegions {
  const geometry = wallGeometry(plan, level, extra);
  const pieces: Geom[] = [
    ...geometry.solids.map((s) => [polygonToRing(s.polygon)] as Geom),
    ...geometry.caps.map((c) => [polygonToRing(c)] as Geom),
  ];
  if (pieces.length === 0) return { regions: [], mass: [], geometry };

  const union: MultiPolygon = polygonClipping.union(pieces[0], ...pieces.slice(1));

  const mass = union.map((poly) => ringToPolygon(poly[0]));
  const holes = union.flatMap((poly) => poly.slice(1).map((r) => simplify(ringToPolygon(r))));
  const regions: Region[] = holes.map((ring) => ({ ring, area: polygonArea(ring), islands: [] }));

  // Each wall mass belongs to the smallest region that contains it — that is
  // the room a free-standing wall stands in. The mass that *forms* a region
  // never lies inside it, so it is not mistaken for an island of its own room.
  for (const m of mass) {
    const probe = m.vertices[0];
    let best: Region | null = null;
    for (const r of regions) {
      if (pointInPolygon(probe, r.ring) && (!best || r.area < best.area)) best = r;
    }
    if (best) best.islands.push(m);
  }

  return { regions, mass, geometry };
}

/** A placement point closer than this to a wall face is moved clear of it (mm). */
const SEED_CLEARANCE = 150;

/** How far a placement point buried in a wall may reach for a region (mm). */
const BURIED_SEED_REACH = 1000;

/** Is the point inside the wall itself (in some wall mass, in no region)? */
function inWall(point: Vec2, level: LevelRegions): boolean {
  const inMass = level.mass.some((m) => pointInPolygon(point, m));
  const inIsland = level.regions.some((r) => r.islands.some((i) => pointInPolygon(point, i)));
  return inIsland || (inMass && !level.regions.some((r) => pointInPolygon(point, r.ring)));
}

/** The smallest region around a point: a closet inside a room wins over the room. */
function regionAround(point: Vec2, regions: Region[], mass: Polygon[]): Region | null {
  // A point inside the wall itself is in no room.
  if (mass.some((m) => pointInPolygon(point, m) && !regions.some((r) => pointInPolygon(point, r.ring)))) {
    return null;
  }
  let best: Region | null = null;
  for (const r of regions) {
    if (!pointInPolygon(point, r.ring)) continue;
    if (r.islands.some((i) => pointInPolygon(point, i))) continue;
    if (!best || r.area < best.area) best = r;
  }
  return best;
}

/** Shortest distance from a point to any edge of a set of rings. */
function distanceToEdges(p: Vec2, rings: Polygon[]): number {
  let best = Infinity;
  for (const ring of rings) {
    const v = ring.vertices;
    for (let i = 0; i < v.length; i++) {
      const a = v[i];
      const b = v[(i + 1) % v.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
    }
  }
  return best;
}

/**
 * A comfortable point inside a floor: the centroid when it is clear of walls,
 * otherwise the best of a coarse grid. Used to keep a room's placement point
 * from drifting out of its own room as walls are dragged.
 */
export function interiorPoint(boundary: Polygon, holes: Polygon[]): Vec2 {
  const inside = (p: Vec2) =>
    pointInPolygon(p, boundary) && !holes.some((h) => pointInPolygon(p, h));

  const c = polygonCentroid(boundary);
  const rings = [boundary, ...holes];
  const bb = boundingBox(boundary);
  const scale = Math.min(bb.maxX - bb.minX, bb.maxY - bb.minY);
  if (inside(c) && distanceToEdges(c, rings) > scale * 0.2) return c;

  const N = 16;
  let best = inside(c) ? c : boundary.vertices[0];
  let bestD = inside(c) ? distanceToEdges(c, rings) : -1;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const p = {
        x: bb.minX + ((bb.maxX - bb.minX) * i) / N,
        y: bb.minY + ((bb.maxY - bb.minY) * j) / N,
      };
      if (!inside(p)) continue;
      const d = distanceToEdges(p, rings);
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

/**
 * Which wall each edge of a floor ring runs along. An edge sits on a wall's
 * face line when both its endpoints are on that line (within a micrometre or
 * so) and its midpoint is within the face's extent.
 */
function edgeWallsFor(ring: Polygon, geometry: WallGeometry): (string | null)[] {
  const onSegment = (p: Vec2, a: Vec2, b: Vec2) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return false;
    const off = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len);
    return off < 1e-3 && t > -1e-6 && t < 1 + 1e-6;
  };

  const v = ring.vertices;
  return v.map((p, i) => {
    const q = v[(i + 1) % v.length];
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    for (const s of geometry.solids) {
      for (const [a, b] of [s.leftFace, s.rightFace]) {
        if (onSegment(mid, a, b) && onSegment(p, a, b) === onSegment(q, a, b)) return s.wallId;
      }
    }
    return null;
  });
}

/**
 * Doorways: the strips of floor a door adds to a room (009 R5). The tile runs
 * from the room's own face into the opening — to the wall's centre by
 * default, where a threshold sits, or right through, or not at all — so a
 * door between two rooms is tiled from both sides with nothing missing and
 * nothing counted twice. Windows never change a floor.
 */
function doorwayStrips(plan: Plan, probe: Vec2, wallIds: Set<string>, gap: number): Polygon[] {
  const nodes = nodeMap(plan);
  const assemblies = assemblyMap(plan);
  const strips: Polygon[] = [];
  for (const o of plan.openings ?? []) {
    if (o.kind === 'window' || !wallIds.has(o.wallId)) continue;
    const wall = plan.walls.find((w) => w.id === o.wallId);
    const assembly = wall && assemblies.get(wall.assemblyId);
    const a = wall && nodes.get(wall.a)?.position;
    const b = wall && nodes.get(wall.b)?.position;
    if (!wall || !assembly || !a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = { x: -u.y, y: u.x };
    const faces = faceOffsets(wall, assembly, 'finish');
    const side: 'left' | 'right' = (probe.x - a.x) * n.x + (probe.y - a.y) * n.y > 0 ? 'right' : 'left';

    const transition = o.floorTransition ?? 'centerline';
    const far = side === 'right' ? faces.left : faces.right;
    const target =
      transition === 'centerline'
        ? (faces.left + faces.right) / 2
        : (transition === 'through') === (o.side === side)
        ? far
        : null;
    if (target == null) continue;

    // Start a hair inside the room so the strip bridges the expansion gap.
    const start = side === 'right' ? faces.right + gap + 1 : faces.left - gap - 1;
    const s0 = o.center - o.roughWidth / 2;
    const s1 = o.center + o.roughWidth / 2;
    const at = (s: number, off: number): Vec2 => ({
      x: clean(a.x + u.x * s + n.x * off),
      y: clean(a.y + u.y * s + n.y * off),
    });
    strips.push({ vertices: [at(s0, start), at(s1, start), at(s1, target), at(s0, target)] });
  }
  return strips;
}

/** The room's tile ring with its doorways added. */
function withDoorways(ring: Polygon, strips: Polygon[], probe: Vec2): Polygon {
  if (strips.length === 0) return ring;
  const union: MultiPolygon = polygonClipping.union(
    [polygonToRing(ring)],
    ...strips.map((s) => [polygonToRing(s)] as Geom)
  );
  const outer = union.map((p) => ringToPolygon(p[0]));
  return simplify(outer.find((p) => pointInPolygon(probe, p)) ?? outer[0] ?? ring);
}

export interface DerivedFloors {
  rooms: Map<string, DerivedRoom>;
  /** Placement points a wall has reached, and where to move them */
  seeds: Map<string, Vec2>;
  /** Wall mass at the finish level, for drawing */
  finishGeometry: WallGeometry;
  coreGeometry: WallGeometry;
}

/**
 * Every room's floor, as the walls make it.
 *
 * Three unions: finish faces (the clear room), core faces (the framed room),
 * and finish faces pushed out by each room's expansion gap (what is tiled).
 * The third is done per distinct gap; nearly every plan uses one.
 */
export function deriveFloors(plan: Plan): DerivedFloors {
  const finish = regionsAt(plan, 'finish');
  const core = regionsAt(plan, 'core');
  const byGap = new Map<number, LevelRegions>([[0, finish]]);
  const tileLevel = (gap: number) => {
    let r = byGap.get(gap);
    if (!r) {
      r = regionsAt(plan, 'finish', gap);
      byGap.set(gap, r);
    }
    return r;
  };

  const rooms = new Map<string, DerivedRoom>();
  const seeds = new Map<string, Vec2>();
  const claims = new Map<Region, PlanRoom[]>();

  const buried: PlanRoom[] = [];
  for (const room of plan.rooms) {
    const region = regionAround(room.seed, finish.regions, finish.mass);
    if (region) claims.set(region, [...(claims.get(region) ?? []), room]);
    else if (inWall(room.seed, finish)) buried.push(room);
    else rooms.set(room.id, { roomId: room.id, status: 'not-enclosed', holes: [], edgeWalls: [] });
  }

  // A wall drawn straight through a room's placement point would otherwise
  // orphan the room. It takes the nearest region beside that wall that no
  // other room has claimed — the side it was mostly on.
  for (const room of buried) {
    const nearest = finish.regions
      .filter((r) => !claims.has(r))
      .map((r) => ({ r, d: distanceToEdges(room.seed, [r.ring]) }))
      .filter(({ d }) => d <= BURIED_SEED_REACH)
      .sort((p, q) => p.d - q.d || q.r.area - p.r.area)[0];
    if (nearest) claims.set(nearest.r, [room]);
    else rooms.set(room.id, { roomId: room.id, status: 'not-enclosed', holes: [], edgeWalls: [] });
  }

  for (const [region, claimants] of claims) {
    const status = claimants.length > 1 ? 'redundant' : 'ok';
    for (const room of claimants) {
      // Find the same room at the other levels by the region's own interior
      // point rather than the stored seed: after a drag the seed may sit right
      // against a wall, and the core and tile rings are a little larger.
      const probe = interiorPoint(region.ring, region.islands);
      const coreRegion = regionAround(probe, core.regions, core.mass);
      const tile = tileLevel(Math.max(0, room.expansionGap));
      const tileRegion = regionAround(probe, tile.regions, tile.mass);

      const holes = [
        ...(tileRegion?.islands ?? []),
        ...room.holes.map((h) => ({ vertices: h.vertices.map((p) => ({ ...p })) })),
      ];

      const bounding = tileRegion ? edgeWallsFor(tileRegion.ring, tile.geometry) : [];
      const strips = tileRegion
        ? doorwayStrips(plan, probe, new Set(bounding.filter((id): id is string => id !== null)), Math.max(0, room.expansionGap))
        : [];
      const tileRing = tileRegion ? withDoorways(tileRegion.ring, strips, probe) : undefined;

      rooms.set(room.id, {
        roomId: room.id,
        status,
        finishBoundary: region.ring,
        coreBoundary: coreRegion?.ring,
        tileBoundary: tileRing,
        holes,
        edgeWalls: tileRing ? (strips.length > 0 ? edgeWallsFor(tileRing, tile.geometry) : bounding) : [],
        labelPoint: probe,
      });
      // The placement point stays where the user put it, as in Revit. It
      // only moves when a wall has reached it — buried, or so close to a face
      // that the next nudge would bury it — so a room follows a dragged wall
      // without wandering across the plan as partitions go in.
      const seedOk =
        region === regionAround(room.seed, finish.regions, finish.mass) &&
        distanceToEdges(room.seed, [region.ring, ...region.islands]) >= SEED_CLEARANCE;
      if (status === 'ok' && !seedOk) seeds.set(room.id, probe);
    }
  }

  return {
    rooms,
    seeds,
    finishGeometry: finish.geometry,
    coreGeometry: core.geometry,
  };
}

/** Is there an enclosed region at this point? (For placing a room.) */
export function regionAt(plan: Plan, point: Vec2): Polygon | null {
  const finish = regionsAt(plan, 'finish');
  return regionAround(point, finish.regions, finish.mass)?.ring ?? null;
}

/**
 * Every closed region the walls make, with a comfortable point inside each —
 * what the store uses to add rooms by themselves when walls close a space.
 */
export function enclosedRegions(plan: Plan): { ring: Polygon; point: Vec2 }[] {
  const finish = regionsAt(plan, 'finish');
  return finish.regions.map((r) => ({ ring: r.ring, point: interiorPoint(r.ring, r.islands) }));
}
