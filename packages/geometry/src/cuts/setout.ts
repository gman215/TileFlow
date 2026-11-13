/**
 * 012 R2 — where to strike the first lines (AC-2.3).
 *
 * A tiler squares the floor from two chalk lines on a joint near the set-out
 * point, measured off the walls. Both lines are read off the tiles the engine
 * actually placed, so they are where the joints are, not where a formula
 * thinks they should be.
 */
import type { LayoutResult, Polygon, Room, TileConfig, Vec2 } from '../types';
import type { PatternFrame } from '../patterns';
import { patternFrameFor } from '../shape';

export interface SetOutLine {
  id: 'A' | 'B';
  /** The line across the room's extent, layout coords */
  from: Vec2;
  to: Vec2;
  /** Unit direction of the line */
  dir: Vec2;
  /** Unit normal: `dir` turned a quarter (x, y) → (−y, x) */
  normal: Vec2;
  /** Farthest wall on the −normal side, perpendicular, mm */
  toNeg: number;
  /** Farthest wall on the +normal side, perpendicular, mm */
  toPos: number;
  /** True when the line is the centre of a real grout joint */
  onJoint: boolean;
}

export interface SetOut {
  /** The anchor, the reference wall's midpoint, or the room centre */
  point: Vec2;
  /** The pattern's axis, radians */
  angle: number;
  lines: [SetOutLine, SetOutLine];
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.y);
  return { x: v.x / l, y: v.y / l };
};

function lineThrough(id: 'A' | 'B', base: Vec2, dir: Vec2, walls: Polygon, onJoint: boolean): SetOutLine {
  const normal = { x: -dir.y, y: dir.x };
  let tMin = Infinity, tMax = -Infinity, sMin = 0, sMax = 0;
  for (const v of walls.vertices) {
    const d = sub(v, base);
    const t = dot(d, dir);
    const s = dot(d, normal);
    tMin = Math.min(tMin, t);
    tMax = Math.max(tMax, t);
    sMin = Math.min(sMin, s);
    sMax = Math.max(sMax, s);
  }
  return {
    id,
    from: { x: base.x + dir.x * tMin, y: base.y + dir.y * tMin },
    to: { x: base.x + dir.x * tMax, y: base.y + dir.y * tMax },
    dir,
    normal,
    toNeg: -sMin,
    toPos: sMax,
    onJoint,
  };
}

/**
 * Two perpendicular start lines for the layout on screen.
 *
 * @param frame  A pattern group's frame in this room's coordinates; otherwise
 *               the room's own (anchor or reference wall), else its centre.
 * @param walls  What the distances are measured to — the finish faces in a
 *               floor plan, where the tiled edge sits an expansion gap in.
 *               Defaults to the room's outline.
 */
export function setOutLines(
  room: Room,
  tile: TileConfig,
  result: LayoutResult,
  frame?: PatternFrame,
  walls?: Polygon
): SetOut {
  const f = frame ?? patternFrameFor(room);
  const point = f?.origin ?? { x: room.width / 2, y: room.height / 2 };
  const angle = f?.angle ?? 0;
  const outline =
    walls ??
    room.shape?.boundary ?? {
      vertices: [
        { x: 0, y: 0 },
        { x: room.width, y: 0 },
        { x: room.width, y: room.height },
        { x: 0, y: room.height },
      ],
    };
  const ax = { x: Math.cos(angle), y: Math.sin(angle) };
  const ay = { x: -ax.y, y: ax.x };

  const placed = result.tiles.filter((t) => !t.isOutside && t.original.vertices.length >= 4);
  // Herringbone and hexagon have no straight joint to strike: the pattern is
  // set out from the point on its own axes.
  if (tile.pattern === 'herringbone' || tile.pattern === 'hexagon' || placed.length === 0) {
    return {
      point,
      angle,
      lines: [lineThrough('A', point, ax, outline, false), lineThrough('B', point, ay, outline, false)],
    };
  }

  // Directions from the tile nearest the point; every rectangular pattern's
  // tiles share them (a turned basketweave tile is still square to them).
  const byDistance = placed
    .map((t) => {
      const v = t.original.vertices;
      return { t, d: Math.hypot((v[0].x + v[2].x) / 2 - point.x, (v[0].y + v[2].y) / 2 - point.y) };
    })
    .sort((a, b) => a.d - b.d);
  const [p0, p1, p2] = byDistance[0].t.original.vertices;
  const u = unit(sub(p1, p0));
  const v = unit(sub(p2, p1));
  const pickLine = (id: 'A' | 'B', dir: Vec2) => {
    const n = { x: -dir.y, y: dir.x };
    const g = tile.grout / 2;
    // Every joint centre parallel to `dir` among the nearby tiles, as a
    // distance from the point across the line.
    const candidates: number[] = [];
    for (const { t } of byDistance.slice(0, 12)) {
      const vs = t.original.vertices;
      const c = { x: vs.reduce((a, q) => a + q.x, 0) / vs.length, y: vs.reduce((a, q) => a + q.y, 0) / vs.length };
      for (let i = 0; i < vs.length; i++) {
        const a = vs[i];
        const b = vs[(i + 1) % vs.length];
        const e = sub(b, a);
        if (Math.abs(e.x * dir.y - e.y * dir.x) > 1e-6 * Math.hypot(e.x, e.y)) continue;
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const out = Math.sign(dot(sub(m, c), n)) || 1;
        const s = dot(sub(m, point), n) + out * g;
        if (!candidates.some((x) => Math.abs(x - s) < 0.01)) candidates.push(s);
      }
    }
    candidates.sort((a, b) => Math.abs(a) - Math.abs(b));
    // A joint is continuous when no tile straddles it anywhere in the room —
    // block boundaries in basketweave, every joint in a grid (013 AC-2.2).
    const continuous = (s: number) =>
      placed.every((t) => {
        let lo = Infinity;
        let hi = -Infinity;
        for (const q of t.original.vertices) {
          const d = dot(sub(q, point), n) - s;
          lo = Math.min(lo, d);
          hi = Math.max(hi, d);
        }
        return lo >= -0.5 || hi <= 0.5;
      });
    // Else the nearest joint: an offset bond's cross joint, the line a tiler
    // still squares from.
    const s = candidates.find(continuous) ?? candidates[0] ?? 0;
    return lineThrough(id, { x: point.x + n.x * s, y: point.y + n.y * s }, dir, outline, candidates.length > 0);
  };
  // A runs along the pattern's rows — the continuous joint in an offset bond.
  const uFirst = Math.abs(dot(u, ax)) >= Math.abs(dot(v, ax));
  const lineA = pickLine('A', uFirst ? u : v);
  const lineB = pickLine('B', uFirst ? v : u);
  return { point, angle, lines: [lineA, lineB] };
}
