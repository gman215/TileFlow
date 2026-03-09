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

import { Polygon, TileConfig, PatternType } from '../types';
import { rectToPolygon, rotatePolygon, translatePolygon } from '../utils/math';

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
  const { tileConfig } = params;
  switch (tileConfig.pattern) {
    case 'grid':
      return generateGrid(params);
    case 'offset-1/2':
      return generateOffset(params, 0.5);
    case 'offset-1/3':
      return generateOffset(params, 1 / 3);
    case 'herringbone':
      return generateHerringbone(params);
    case 'diagonal-45':
      return generateDiagonal45(params);
    default:
      return generateGrid(params);
  }
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
 * Herringbone pattern: alternating rows of horizontal and vertical tiles
 * arranged in a zigzag staircase pattern.
 *
 * Each "H-row" has tiles oriented (h × w) — long side horizontal.
 * Each "V-row" has tiles oriented (w × h) — long side vertical.
 * Between successive row-pairs the grid shifts right by (w + g)
 * to produce the characteristic diagonal zigzag.
 */
function generateHerringbone(params: PatternGeneratorParams): Polygon[] {
  const { tileConfig, areaWidth, areaHeight, offsetX, offsetY } = params;
  const w = tileConfig.width;
  const h = tileConfig.height;
  const g = tileConfig.grout;
  const tiles: Polygon[] = [];

  // Height of one H-row + V-row pair (one "lane pair")
  const hRowH = w + g;  // height taken by an H-row (tile height = w) + grout
  const vRowH = h + g;  // height taken by a V-row (tile height = h) + grout
  const lanePairH = hRowH + vRowH;

  // Tile spacing within each row
  const hTileSpacing = h + g; // H-row tiles: each h wide + grout
  const vTileSpacing = w + g; // V-row tiles: each w wide + grout

  const margin = (w + h) * 3;

  // Normalize offsets into positive modular range
  const adjOffY = ((offsetY % lanePairH) + lanePairH) % lanePairH;

  let pairIndex = 0;
  for (
    let baseY = -margin + adjOffY - lanePairH;
    baseY < areaHeight + margin;
    baseY += lanePairH
  ) {
    // Progressive shift: each lane pair shifts right by (w + g)
    const shift = pairIndex * (w + g) + offsetX;

    // ── H-row ──
    const hAdj = ((shift % hTileSpacing) + hTileSpacing) % hTileSpacing;
    for (
      let x = -margin + hAdj - hTileSpacing;
      x < areaWidth + margin;
      x += hTileSpacing
    ) {
      tiles.push(rectToPolygon(x, baseY, h, w));
    }

    // ── V-row (below the H-row) ──
    const vShift = shift + (h - w) / 2 + g / 2; // center V tiles on H-tile joints
    const vAdj = ((vShift % vTileSpacing) + vTileSpacing) % vTileSpacing;
    for (
      let x = -margin + vAdj - vTileSpacing;
      x < areaWidth + margin;
      x += vTileSpacing
    ) {
      tiles.push(rectToPolygon(x, baseY + hRowH, w, h));
    }

    pairIndex++;
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
      return {
        unitX: tw + th - config.grout, // (w + g) + (h + g) - g = w + h + g
        unitY: tw + th - config.grout,
      };
    default:
      return { unitX: tw, unitY: th };
  }
}
