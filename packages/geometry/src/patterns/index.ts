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

import { Polygon, Room, TileConfig, AlignmentMode } from '../types';
import { rectToPolygon, rotatePolygon } from '../utils/math';

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
}

/**
 * Generate tile polygons for a given pattern.
 * Returns an array of unclipped tile polygons.
 */
export function generateTiles(params: PatternGeneratorParams): Polygon[] {
  const { tileConfig, areaWidth, areaHeight } = params;

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
 * Standard grid pattern: tiles placed in a regular grid.
 */
function generateGrid(params: PatternGeneratorParams): Polygon[] {
  const { tileConfig, areaWidth, areaHeight, offsetX, offsetY } = params;
  const tw = tileConfig.width + tileConfig.grout;
  const th = tileConfig.height + tileConfig.grout;
  const tiles: Polygon[] = [];

  // Start from negative margin to cover shifted tiles
  const startX = -tw + (offsetX % tw);
  const startY = -th + (offsetY % th);

  for (let y = startY; y < areaHeight + th; y += th) {
    for (let x = startX; x < areaWidth + tw; x += tw) {
      tiles.push(rectToPolygon(x, y, tileConfig.width, tileConfig.height));
    }
  }

  return tiles;
}

/**
 * Offset pattern: even rows are shifted by `fraction` of the tile width.
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

  const startX = -tw * 2 + (offsetX % tw);
  const startY = -th + (offsetY % th);

  let rowIndex = 0;
  for (let y = startY; y < areaHeight + th; y += th) {
    const rowOffset = (rowIndex % 2 === 1) ? tw * fraction : 0;
    for (let x = startX + rowOffset; x < areaWidth + tw * 2; x += tw) {
      tiles.push(rectToPolygon(x, y, tileConfig.width, tileConfig.height));
    }
    rowIndex++;
  }

  return tiles;
}

/**
 * Herringbone pattern: tiles alternate between horizontal and vertical
 * orientation, each pair forming an "L". Pairs repeat along horizontal
 * "rows" spaced one effective tile width (h + g) apart, and every row
 * shifts left by one tile width — producing the interlocking 45° zigzag.
 *
 * Construction (effective dims W = w + g, H = h + g):
 *   row s sits at y = s·H, shifted horizontally by −s·H
 *   within a row, pairs repeat every (W + 2H):
 *     horizontal tile at (x, y), size w × h
 *     vertical tile at (x + W, y), size h × w (top-aligned)
 *
 * The tiling is exact (no gaps/overlaps) when W = 2H, i.e. the classic
 * 2:1 herringbone tile. Other ratios still render the same pattern with
 * grout-line drift proportional to the mismatch.
 */
function generateHerringbone(params: PatternGeneratorParams): Polygon[] {
  const { tileConfig, areaWidth, areaHeight, offsetX, offsetY } = params;
  const w = tileConfig.width;
  const h = tileConfig.height;
  const g = tileConfig.grout;
  const tiles: Polygon[] = [];

  const W = w + g; // effective tile length
  const H = h + g; // effective tile width
  const period = W + 2 * H; // x spacing between pairs within a row

  // Tiles extend at most max(w, h) below their row line.
  const margin = Math.max(w, h) + g;

  // Normalize offsetY into [0, H); whole-row shifts fold into X
  // (moving down one row is equivalent to shifting right by H).
  const rowsShifted = Math.floor(offsetY / H);
  const adjY = offsetY - rowsShifted * H;
  const baseShift = offsetX + rowsShifted * H;

  const sMin = Math.floor((-margin - adjY) / H);
  const sMax = Math.ceil((areaHeight + margin - adjY) / H);

  for (let s = sMin; s <= sMax; s++) {
    const y = s * H + adjY;
    // Each successive row shifts left by one effective tile width.
    const shift = baseShift - s * H;
    const adjX = ((shift % period) + period) % period;

    for (let x = adjX - 2 * period; x < areaWidth + margin; x += period) {
      // Horizontal tile of the pair
      tiles.push(rectToPolygon(x, y, w, h));
      // Vertical tile, top-aligned at the horizontal tile's right end
      tiles.push(rectToPolygon(x + W, y, h, w));
    }
  }

  return tiles;
}

/**
 * 45° diagonal pattern: entire grid rotated 45°.
 * Tiles are placed in a grid and then the whole grid is rotated 45°
 * around the room center.
 */
function generateDiagonal45(params: PatternGeneratorParams): Polygon[] {
  const { tileConfig, areaWidth, areaHeight, offsetX, offsetY } = params;
  const tw = tileConfig.width + tileConfig.grout;
  const th = tileConfig.height + tileConfig.grout;
  const tiles: Polygon[] = [];

  const centerX = areaWidth / 2;
  const centerY = areaHeight / 2;
  const center = { x: centerX, y: centerY };
  const angle = Math.PI / 4; // 45 degrees

  // Need a larger coverage area since rotation shifts tiles
  const diagonal = Math.sqrt(areaWidth * areaWidth + areaHeight * areaHeight);
  const margin = diagonal;

  const startX = centerX - margin + (offsetX % tw);
  const startY = centerY - margin + (offsetY % th);

  for (let y = startY; y < centerY + margin; y += th) {
    for (let x = startX; x < centerX + margin; x += tw) {
      const tile = rectToPolygon(x, y, tileConfig.width, tileConfig.height);
      const rotated = rotatePolygon(tile, center, angle);
      tiles.push(rotated);
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
 *  - `center-tile`: a full tile is centered on the room center
 *  - `center-grout`: a grout joint runs through the room center
 *
 * Offsets are derived from the basic tile period (width/height + grout),
 * which is exact for grid / running-bond layouts and a sensible best-effort
 * for the others (the grout-center case sits half a tile period away from
 * the tile-center case).
 */
export function computeAlignmentOffset(
  room: Room,
  config: TileConfig,
  mode: Exclude<AlignmentMode, 'optimize'>
): { offsetX: number; offsetY: number } {
  const tw = config.width + config.grout;
  const th = config.height + config.grout;

  // Offset that lands a tile's center on the room center.
  const tileX = mod(room.width / 2 - config.width / 2, tw);
  const tileY = mod(room.height / 2 - config.height / 2, th);

  if (mode === 'center-tile') {
    return { offsetX: tileX, offsetY: tileY };
  }

  // A grout joint sits half a tile period from a tile center.
  return {
    offsetX: mod(tileX - tw / 2, tw),
    offsetY: mod(tileY - th / 2, th),
  };
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
    case 'herringbone':
      // Pairs repeat every (W + 2H) horizontally; rows repeat every H
      // vertically (a row step is equivalent to an X shift of H).
      return {
        unitX: tw + 2 * th,
        unitY: th,
      };
    default:
      return { unitX: tw, unitY: th };
  }
}
