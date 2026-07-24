/**
 * Tile pattern generators.
 *
 * Each generator yields tile polygons for an "infinite" grid that covers
 * a given bounding area + margins. The layout engine then clips these
 * against the room boundary.
 *
 * All generators accept an offset (dx, dy) that the optimizer varies
 * to find the best alignment.
 */

import { Polygon, Room, TileConfig, AlignmentMode, Vec2 } from '../types';
import {
  rectToPolygon,
  rotatePolygon,
  rotatePoint,
  translatePolygon,
} from '../utils/math';

/**
 * The frame the pattern is set out from: where the grid is anchored and which
 * way it runs. Comes from the reference wall an installer picks, so the layout
 * squares to the main sight line instead of to the bounding box.
 */
export interface PatternFrame {
  origin: Vec2;
  /** Grid direction in radians; 0 keeps the pattern axis-aligned */
  angle: number;
}

export interface PatternGeneratorParams {
  tileConfig: TileConfig;
  /** Area width to cover (room width) in mm */
  areaWidth: number;
  /** Area height to cover (room height) in mm */
  areaHeight: number;
  /** X offset to shift the entire grid (optimization parameter) */
  offsetX: number;
  /** Y offset to shift the entire grid (optimization parameter) */
  offsetY: number;
  /** Set out from this wall instead of the area centre */
  frame?: PatternFrame;
}

/**
 * Generate tile polygons for a given pattern.
 * Returns an array of unclipped tile polygons.
 *
 * Without a frame the pattern is anchored on the area's centre — every
 * generator measures its offset from there, which is what makes the alignment
 * modes mean the same thing across all five patterns. With a frame, the
 * pattern is generated in the frame's own rotated coordinates and mapped back,
 * so it runs parallel to the reference wall and is anchored on that wall.
 */
export function generateTiles(params: PatternGeneratorParams): Polygon[] {
  const { frame, areaWidth, areaHeight } = params;
  if (!frame) return generateForArea(params);

  const { origin, angle } = frame;

  // The area's corners, seen in the frame's rotated coordinates. Generating
  // over just this box keeps the tile count close to the un-rotated case.
  const corners: Vec2[] = [
    { x: 0, y: 0 },
    { x: areaWidth, y: 0 },
    { x: areaWidth, y: areaHeight },
    { x: 0, y: areaHeight },
  ].map((p) => rotatePoint(p, origin, -angle));

  const minX = Math.min(...corners.map((p) => p.x));
  const maxX = Math.max(...corners.map((p) => p.x));
  const minY = Math.min(...corners.map((p) => p.y));
  const maxY = Math.max(...corners.map((p) => p.y));
  const width = maxX - minX;
  const height = maxY - minY;

  // Generators anchor on their area's centre; shift the offset so the anchor
  // lands on the frame origin instead.
  const local = generateForArea({
    ...params,
    areaWidth: width,
    areaHeight: height,
    offsetX: params.offsetX + (origin.x - minX) - width / 2,
    offsetY: params.offsetY + (origin.y - minY) - height / 2,
  });

  return local.map((tile) =>
    rotatePolygon(translatePolygon(tile, minX, minY), origin, angle)
  );
}

/** Dispatch to the pattern generator, in whatever coordinates it is handed. */
function generateForArea(params: PatternGeneratorParams): Polygon[] {
  const { tileConfig } = params;

  let tiles: Polygon[];
  switch (tileConfig.pattern) {
    case 'grid':
      tiles = generateGrid(params);
      break;
    case 'offset-1/2':
      tiles = generateOffset(params, 0.5);
      break;
    case 'offset-1/3':
      tiles = generateOffset(params, 1 / 3);
      break;
    case 'herringbone':
      tiles = generateHerringbone(params);
      break;
    case 'diagonal-45':
      tiles = generateDiagonal45(params);
      break;
    default:
      tiles = generateGrid(params);
  }

  return tiles;
}

/**
 * Grid indices covering [0, extent] for a lattice anchored at `origin`,
 * with a tile's worth of margin so shifted tiles still reach the edges.
 */
function indexRange(
  origin: number,
  extent: number,
  step: number
): { min: number; max: number } {
  return {
    min: Math.floor(-origin / step) - 1,
    max: Math.ceil((extent - origin) / step) + 1,
  };
}

/**
 * Standard grid pattern: tiles placed in a regular grid.
 *
 * The lattice is anchored on the area's centre, so `offsetX/offsetY` position
 * a tile corner relative to that centre — the same convention every other
 * generator here uses, and what lets one alignment rule serve all patterns.
 */
function generateGrid(params: PatternGeneratorParams): Polygon[] {
  const { tileConfig, areaWidth, areaHeight, offsetX, offsetY } = params;
  const tw = tileConfig.width + tileConfig.grout;
  const th = tileConfig.height + tileConfig.grout;
  const tiles: Polygon[] = [];
  if (tw <= 0 || th <= 0) return tiles;

  const originX = areaWidth / 2 + offsetX;
  const originY = areaHeight / 2 + offsetY;
  const cols = indexRange(originX, areaWidth, tw);
  const rows = indexRange(originY, areaHeight, th);

  for (let j = rows.min; j <= rows.max; j++) {
    for (let i = cols.min; i <= cols.max; i++) {
      tiles.push(
        rectToPolygon(
          originX + i * tw,
          originY + j * th,
          tileConfig.width,
          tileConfig.height
        )
      );
    }
  }

  return tiles;
}

/**
 * Offset pattern: alternate rows are shifted by `fraction` of the tile width.
 * fraction=0.5 → 1/2 offset (brick bond)
 * fraction=1/3 → 1/3 offset
 */
function generateOffset(
  params: PatternGeneratorParams,
  fraction: number
): Polygon[] {
  const { tileConfig, areaWidth, areaHeight, offsetX, offsetY } = params;
  const tw = tileConfig.width + tileConfig.grout;
  const th = tileConfig.height + tileConfig.grout;
  const tiles: Polygon[] = [];
  if (tw <= 0 || th <= 0) return tiles;

  const originX = areaWidth / 2 + offsetX;
  const originY = areaHeight / 2 + offsetY;
  const cols = indexRange(originX, areaWidth, tw);
  const rows = indexRange(originY, areaHeight, th);

  for (let j = rows.min; j <= rows.max; j++) {
    // Positive modulo: row indices go negative above the anchor row.
    const staggered = ((j % 2) + 2) % 2 === 1;
    const rowOffset = staggered ? tw * fraction : 0;
    for (let i = cols.min - 1; i <= cols.max; i++) {
      tiles.push(
        rectToPolygon(
          originX + i * tw + rowOffset,
          originY + j * th,
          tileConfig.width,
          tileConfig.height
        )
      );
    }
  }

  return tiles;
}

/**
 * Herringbone pattern — the classic 45° interlocking weave.
 *
 * The weave is built from L-shaped blocks, each a long tile (w × h) with a
 * short tile (h × w) standing on its upper-left corner:
 *
 *   H tile: rect at (P.x, P.y),     size w × h
 *   V tile: rect at (P.x, P.y + S), size h × w     (S = h + g)
 *
 * Blocks repeat on the lattice generated by
 *   t1 = (S,  S)     (S = h + g)
 *   t2 = (L, −L)     (L = w + g)
 * whose cell area |det| = 2·L·S matches the area of a block, so the weave
 * tiles the plane exactly (no gaps, no overlaps) for any tile ratio.
 *
 * The whole lattice is then rotated −45° about the area centre so the braids
 * run horizontally, giving the diagonal herringbone look.
 */
function generateHerringbone(params: PatternGeneratorParams): Polygon[] {
  const { tileConfig, areaWidth, areaHeight, offsetX, offsetY } = params;
  const w = tileConfig.width;
  const h = tileConfig.height;
  const g = tileConfig.grout;
  const tiles: Polygon[] = [];

  const S = h + g; // effective short side
  const L = w + g; // effective long side
  if (S <= 0 || L <= 0) return tiles;

  const center = { x: areaWidth / 2, y: areaHeight / 2 };
  const angle = -Math.PI / 4; // braids run horizontally

  // Cover the room's circumscribed circle before rotation, plus tile extent.
  const diagonal = Math.sqrt(areaWidth * areaWidth + areaHeight * areaHeight);
  const R = diagonal / 2 + L + S;

  // Lattice origin (the optimizer shifts the weave via offsetX/offsetY).
  const ox = center.x + offsetX;
  const oy = center.y + offsetY;

  // Invert the lattice to find which (a, b) blocks land inside the coverage
  // square [center ± R]. P − origin = a·t1 + b·t2 ⇒
  //   a = (dx + dy) / (2S),  b = (dx − dy) / (2L)
  let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
  for (const cx of [center.x - R, center.x + R]) {
    for (const cy of [center.y - R, center.y + R]) {
      const dx = cx - ox;
      const dy = cy - oy;
      const a = (dx + dy) / (2 * S);
      const b = (dx - dy) / (2 * L);
      aMin = Math.min(aMin, a);
      aMax = Math.max(aMax, a);
      bMin = Math.min(bMin, b);
      bMax = Math.max(bMax, b);
    }
  }
  // Pad to account for a block extending up to L beyond its lattice point.
  const pad = 2;
  aMin = Math.floor(aMin) - pad;
  aMax = Math.ceil(aMax) + pad;
  bMin = Math.floor(bMin) - pad;
  bMax = Math.ceil(bMax) + pad;

  for (let a = aMin; a <= aMax; a++) {
    for (let b = bMin; b <= bMax; b++) {
      const px = ox + a * S + b * L;
      const py = oy + a * S - b * L;
      // Long (horizontal) tile + short (vertical) tile standing on its corner.
      const hTile = rectToPolygon(px, py, w, h);
      const vTile = rectToPolygon(px, py + S, h, w);
      tiles.push(rotatePolygon(hTile, center, angle));
      tiles.push(rotatePolygon(vTile, center, angle));
    }
  }

  return tiles;
}

/**
 * 45° diagonal pattern: entire grid rotated 45°.
 * Tiles are placed in a grid and then the whole grid is rotated 45°
 * around the room center.
 *
 * Like the herringbone, the grid phase is measured from the room centre —
 * the fixed point of the rotation — so `offsetX/offsetY` place a tile corner
 * relative to the centre and any alignment set up there survives the rotation.
 */
function generateDiagonal45(params: PatternGeneratorParams): Polygon[] {
  const { tileConfig, areaWidth, areaHeight, offsetX, offsetY } = params;
  const tw = tileConfig.width + tileConfig.grout;
  const th = tileConfig.height + tileConfig.grout;
  const tiles: Polygon[] = [];

  if (tw <= 0 || th <= 0) return tiles;

  const center = { x: areaWidth / 2, y: areaHeight / 2 };
  const angle = Math.PI / 4; // 45 degrees

  // Cover the room's circumscribed circle before rotation, plus tile extent.
  const diagonal = Math.sqrt(areaWidth * areaWidth + areaHeight * areaHeight);
  const R = diagonal / 2 + Math.max(tw, th);

  const originX = center.x + offsetX;
  const originY = center.y + offsetY;

  const iMin = Math.floor((center.x - R - originX) / tw);
  const iMax = Math.ceil((center.x + R - originX) / tw);
  const jMin = Math.floor((center.y - R - originY) / th);
  const jMax = Math.ceil((center.y + R - originY) / th);

  for (let j = jMin; j <= jMax; j++) {
    for (let i = iMin; i <= iMax; i++) {
      const tile = rectToPolygon(
        originX + i * tw,
        originY + j * th,
        tileConfig.width,
        tileConfig.height
      );
      tiles.push(rotatePolygon(tile, center, angle));
    }
  }

  return tiles;
}

/** Positive modulo. */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * Compute the grid offset that aligns the layout to the room:
 *  - `center-tile`: a full tile is centered on the anchor
 *  - `center-grout`: a grout joint runs through the anchor
 *
 * The anchor is the area's centre, or the reference wall when one is picked.
 *
 * Every generator lays its lattice out from that anchor, and the tile at the
 * lattice origin spans [O.x, O.x + w] × [O.y, O.y + h], so one rule covers all
 * five patterns:
 *  - `center-tile`:  offset = (−w/2, −h/2) drops that tile's centre exactly on
 *                    the anchor.
 *  - `center-grout`: offset = (g/2, g/2) puts the anchor on the grout crossing
 *                    at that tile's lower-left corner (with g = 0 it lands on
 *                    the joint lines themselves).
 *
 * The rotated patterns build their weave around the anchor and only then spin
 * it about that same point, and rotation about a point leaves it fixed — so an
 * alignment arranged before the rotation still holds after it.
 *
 * The result is deliberately not reduced modulo a period: the herringbone weave
 * repeats on the lattice spanned by (S, S) and (L, −L), where neither axis on
 * its own is a lattice vector, so wrapping offsetX or offsetY alone would move
 * the weave.
 */
export function computeAlignmentOffset(
  _room: Room,
  config: TileConfig,
  mode: Exclude<AlignmentMode, 'optimize'>
): { offsetX: number; offsetY: number } {
  if (mode === 'center-tile') {
    return { offsetX: -config.width / 2, offsetY: -config.height / 2 };
  }

  return { offsetX: config.grout / 2, offsetY: config.grout / 2 };
}

/**
 * Get the pattern-specific unit dimensions for offset calculations.
 */
export function getPatternUnit(config: TileConfig): { unitX: number; unitY: number } {
  const tw = config.width + config.grout;
  const th = config.height + config.grout;

  switch (config.pattern) {
    case 'grid':
    case 'offset-1/2':
    case 'offset-1/3':
    case 'diagonal-45':
      return { unitX: tw, unitY: th };
    case 'herringbone': {
      // Two offsets differing by a weave lattice vector give the same layout,
      // so every distinct layout appears within one fundamental cell. The cell
      // spanned by t1 = (S, S) and t2 = (L, −L) has an (L + S) × (L + S)
      // bounding box, so scanning that square covers every configuration.
      const period = tw + th; // (w + g) + (h + g) = L + S
      return { unitX: period, unitY: period };
    }
    default:
      return { unitX: tw, unitY: th };
  }
}
