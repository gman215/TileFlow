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
import { patternFrameFor } from '../shape';
import { prepareClipShape, clipTileToShape, type ClipShape } from '../clipping';
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
  weights: OptimizationWeights,
  /** Pre-processed floor; pass it in to clip many offsets against one shape */
  prepared?: ClipShape
): LayoutResult {
  const clipShape = prepared ?? prepareClipShape(room);

  const tilePolygons = generateTiles({
    tileConfig,
    areaWidth: clipShape.width,
    areaHeight: clipShape.height,
    offsetX,
    offsetY,
    frame: patternFrameFor(room),
  });

  const roomArea = clipShape.area;
  const tiles: PlacedTile[] = [];
  let fullTileCount = 0;
  let cutTileCount = 0;
  let totalTileArea = 0;
  let smallestCutPiece = Infinity;

  for (let i = 0; i < tilePolygons.length; i++) {
    const original = tilePolygons[i];
    const { pieces, clipped, area, isOutside, isFull } = clipTileToShape(
      original,
      clipShape
    );

    if (isOutside) continue;

    const originalArea = polygonArea(original);
    const clippedArea = area;
    const coverageRatio = originalArea > 0 ? clippedArea / originalArea : 0;

    // Skip slivers that are too small to be useful (< 1% of tile)
    if (!isFull && coverageRatio < 0.01) continue;

    const tile: PlacedTile = {
      id: tiles.length,
      original,
      clipped,
      pieces,
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
  /** True when the search was thinned to keep the canvas responsive */
  reduced?: boolean;
}

/**
 * How many candidate offsets we can afford.
 *
 * Cost per candidate scales with the tile count, and on a drawn floor each
 * tile near a wall costs a boolean clip on top. Rather than let a busy room
 * stall the canvas for seconds while someone drags a corner, spend a fixed
 * budget of tile-clips and thin the search to fit — the offsets that survive
 * still span the whole period, just more coarsely.
 */
const CANDIDATE_BUDGET_TILE_CLIPS = 120_000;
const MIN_CANDIDATES_PER_AXIS = 3;

function candidateStep(
  requestedStep: number,
  tilesPerCandidate: number
): { step: number; reduced: boolean } {
  const requestedPerAxis = Math.max(1, Math.ceil(1 / Math.max(requestedStep, 1e-6)));
  const affordable = Math.sqrt(
    CANDIDATE_BUDGET_TILE_CLIPS / Math.max(tilesPerCandidate, 1)
  );
  const perAxis = Math.max(
    MIN_CANDIDATES_PER_AXIS,
    Math.min(requestedPerAxis, Math.floor(affordable))
  );

  return { step: 1 / perAxis, reduced: perAxis < requestedPerAxis };
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

  // One pre-pass over the floor, reused by every candidate offset.
  const prepared = prepareClipShape(room);

  let bestScore = -Infinity;
  let bestLayout: LayoutResult | null = null;
  let candidatesEvaluated = 0;

  // Price one candidate, then size the search to the budget.
  const probe = computeLayout(room, tileConfig, 0, 0, weights, prepared);
  const { step: scaledCoarse, reduced: coarseReduced } = candidateStep(
    coarseStep,
    probe.tiles.length
  );
  const { step: scaledFine, reduced: fineReduced } = candidateStep(
    fineStep,
    probe.tiles.length
  );
  const reduced = coarseReduced || fineReduced;

  bestScore = probe.optimizationScore;
  bestLayout = probe;
  candidatesEvaluated++;

  // ─── Phase 1: Coarse Scan ───────────────────────────────────────────
  const coarseDx = unitX * scaledCoarse;
  const coarseDy = unitY * scaledCoarse;

  // Scan one full tile period in each direction
  for (let oy = 0; oy < unitY; oy += coarseDy) {
    for (let ox = 0; ox < unitX; ox += coarseDx) {
      const layout = computeLayout(room, tileConfig, ox, oy, weights, prepared);
      candidatesEvaluated++;

      if (layout.optimizationScore > bestScore) {
        bestScore = layout.optimizationScore;
        bestLayout = layout;
      }
    }
  }

  // ─── Phase 2: Fine Refinement ───────────────────────────────────────
  const bestOx = bestLayout.offsetX;
  const bestOy = bestLayout.offsetY;
  // Refining no finer than the coarse step would just re-test the same offsets.
  const radiusX = unitX * Math.min(refineRadius, scaledCoarse);
  const radiusY = unitY * Math.min(refineRadius, scaledCoarse);
  const fineDx = unitX * scaledFine;
  const fineDy = unitY * scaledFine;

  for (let oy = bestOy - radiusY; oy <= bestOy + radiusY; oy += fineDy) {
    for (let ox = bestOx - radiusX; ox <= bestOx + radiusX; ox += fineDx) {
      const layout = computeLayout(room, tileConfig, ox, oy, weights, prepared);
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
    reduced,
  };
}
