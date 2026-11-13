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
  // Herringbone has no straight joint to strike: the weave is set out from
  // the point on its own axes.
  if (tile.pattern === 'herringbone' || placed.length === 0) {
    return {
      point,
      angle,
      lines: [lineThrough('A', point, ax, outline, false), lineThrough('B', point, ay, outline, false)],
    };
  }

  // The tile nearest the set-out point, and of its sides, the two nearest it.
  let nearest = placed[0];
  let best = Infinity;
  for (const t of placed) {
    const v = t.original.vertices;
    const c = { x: (v[0].x + v[2].x) / 2, y: (v[0].y + v[2].y) / 2 };
    const d = Math.hypot(c.x - point.x, c.y - point.y);
    if (d < best) {
      best = d;
      nearest = t;
    }
  }
  const [p0, p1, p2] = nearest.original.vertices;
  const u = unit(sub(p1, p0));
  const v = unit(sub(p2, p1));
  const lu = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const lv = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const g = tile.grout / 2;
  // Each side's joint centre, as a coordinate across the side.
  const a = dot(sub(point, p0), u);
  const b = dot(sub(point, p0), v);
  const jointU = b < lv / 2 ? -g : lv + g; // offset along v of the joint running along u
  const jointV = a < lu / 2 ? -g : lu + g; // offset along u of the joint running along v
  let lineU = lineThrough('A', { x: p0.x + v.x * jointU, y: p0.y + v.y * jointU }, u, outline, true);
  let lineV = lineThrough('B', { x: p0.x + u.x * jointV, y: p0.y + u.y * jointV }, v, outline, true);
  // A runs along the pattern's rows — the continuous joint in an offset bond.
  if (Math.abs(dot(v, ax)) > Math.abs(dot(u, ax))) {
    [lineU, lineV] = [{ ...lineV, id: 'A' }, { ...lineU, id: 'B' }];
  }
  return { point, angle, lines: [lineU, lineV] };
}
