/**
 * Hybrid optimization engine.
 *
 * Phase 1: Coarse scan — samples offsets at large increments
 *          (e.g., 1/2 tile steps) across one full tile period.
 * Phase 2: Fine refine — zooms into the neighbourhood of the
 *          best coarse candidate and re-samples at finer steps.
 *
 * Score function:
 *   score = (α × normalizedMinCutArea) − (β × wastePercentage)
 *
 * Where:
 *   normalizedMinCutArea = smallestCutPiece / tileArea  (0..1)
 *   wastePercentage = waste / roomArea                  (0..1)
 */

import {
  Room,
  TileConfig,
  OptimizationConfig,
  LayoutResult,
  PlacedTile,
  OptimizationWeights,
} from '../types';
import { generateTiles, getPatternUnit } from '../patterns';
import { clipTileToRoom, analyzeTile } from '../clipping';
import { polygonArea } from '../utils/math';

// ─── Layout Computation ───────────────────────────────────────────────────────

/**
 * Compute the full layout for a given room, tile config, and offset.
 */
export function computeLayout(
  room: Room,
  tileConfig: TileConfig,
  offsetX: number,
  offsetY: number,
  weights: OptimizationWeights
): LayoutResult {
  const tilePolygons = generateTiles({
    tileConfig,
    areaWidth: room.width,
    areaHeight: room.height,
    offsetX,
    offsetY,
  });

  const roomArea = room.width * room.height;
  const tiles: PlacedTile[] = [];
  let fullTileCount = 0;
  let cutTileCount = 0;
  let totalTileArea = 0;
  let smallestCutPiece = Infinity;

  for (let i = 0; i < tilePolygons.length; i++) {
    const original = tilePolygons[i];
    const { clipped, isOutside, isFull } = clipTileToRoom(
      original,
      room.width,
      room.height
    );

    if (isOutside) continue;

    const { clippedArea, originalArea, coverageRatio } = analyzeTile(
      original,
      clipped,
      isFull,
      isOutside
    );

    // Skip slivers that are too small to be useful (< 1% of tile)
    if (!isFull && coverageRatio < 0.01) continue;

    const tile: PlacedTile = {
      id: tiles.length,
      original,
      clipped,
      clippedArea,
      originalArea,
      isFull,
      isOutside: false,
      coverageRatio,
    };

    tiles.push(tile);

    if (isFull) {
      fullTileCount++;
    } else {
      cutTileCount++;
      if (clippedArea < smallestCutPiece) {
        smallestCutPiece = clippedArea;
      }
    }

    totalTileArea += clippedArea;
  }

  if (smallestCutPiece === Infinity) smallestCutPiece = 0;

  const wastePercentage =
    roomArea > 0 ? Math.max(0, (totalTileArea - roomArea) / totalTileArea) : 0;

  // For score calculation: normalize smallest cut piece
  const tileArea = tileConfig.width * tileConfig.height;
  const normalizedMinCut = tileArea > 0 ? smallestCutPiece / tileArea : 0;
  const wasteRatio = cutTileCount > 0
    ? 1 - totalTileArea / ((fullTileCount + cutTileCount) * tileArea)
    : 0;

  const score =
    weights.alpha * normalizedMinCut - weights.beta * Math.abs(wasteRatio);

  return {
    tiles,
    fullTileCount,
    cutTileCount,
    totalTileArea,
    roomArea,
    wastePercentage: Math.abs(wasteRatio) * 100,
    smallestCutPiece,
    optimizationScore: score,
    offsetX,
    offsetY,
  };
}

// ─── Hybrid Optimizer ─────────────────────────────────────────────────────────

export interface OptimizationResult {
  bestLayout: LayoutResult;
  candidatesEvaluated: number;
}

/**
 * Run the two-phase hybrid optimization.
 */
export function optimize(
  room: Room,
  tileConfig: TileConfig,
  config: OptimizationConfig
): OptimizationResult {
  const { unitX, unitY } = getPatternUnit(tileConfig);
  const { coarseStep, fineStep, refineRadius, weights } = config;

  let bestScore = -Infinity;
  let bestLayout: LayoutResult | null = null;
  let candidatesEvaluated = 0;

  // ─── Phase 1: Coarse Scan ───────────────────────────────────────────
  const coarseDx = unitX * coarseStep;
  const coarseDy = unitY * coarseStep;

  // Scan one full tile period in each direction
  for (let oy = 0; oy < unitY; oy += coarseDy) {
    for (let ox = 0; ox < unitX; ox += coarseDx) {
      const layout = computeLayout(room, tileConfig, ox, oy, weights);
      candidatesEvaluated++;

      if (layout.optimizationScore > bestScore) {
        bestScore = layout.optimizationScore;
        bestLayout = layout;
      }
    }
  }

  if (!bestLayout) {
    // Fallback: zero offset
    bestLayout = computeLayout(room, tileConfig, 0, 0, weights);
    candidatesEvaluated++;
  }

  // ─── Phase 2: Fine Refinement ───────────────────────────────────────
  const bestOx = bestLayout.offsetX;
  const bestOy = bestLayout.offsetY;
  const radiusX = unitX * refineRadius;
  const radiusY = unitY * refineRadius;
  const fineDx = unitX * fineStep;
  const fineDy = unitY * fineStep;

  for (let oy = bestOy - radiusY; oy <= bestOy + radiusY; oy += fineDy) {
    for (let ox = bestOx - radiusX; ox <= bestOx + radiusX; ox += fineDx) {
      const layout = computeLayout(room, tileConfig, ox, oy, weights);
      candidatesEvaluated++;

      if (layout.optimizationScore > bestScore) {
        bestScore = layout.optimizationScore;
        bestLayout = layout;
      }
    }
  }

  return {
    bestLayout: bestLayout!,
    candidatesEvaluated,
  };
}
