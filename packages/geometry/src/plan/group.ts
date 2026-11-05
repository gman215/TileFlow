/**
 * Pattern groups: several rooms tiled as one floor.
 *
 * Every room in a group is laid out with the same plan-space frame and the
 * same offset, so a grout line leaving the kitchen carries on into the hall.
 * The search scores the group as a whole — one offset that suits every room
 * together, not the best for each room separately.
 */

import {
  AlignmentMode,
  DerivedRoom,
  LayoutResult,
  OptimizationConfig,
  OptimizationWeights,
  Plan,
  PatternGroup,
  TileConfig,
  Vec2,
} from '../types';
import { computeLayout, candidateStep } from '../optimization';
import { computeAlignmentOffset, getPatternUnit, type PatternFrame } from '../patterns';
import { prepareClipShape, type ClipShape } from '../clipping';
import { boundingBoxOf } from '../utils/math';
import type { LayoutRoom } from './adapter';

/** Fold an angle into ±45°, as `patternFrameFor` does for a single room. */
function fold(angle: number): number {
  const quarter = Math.PI / 2;
  return ((((angle + Math.PI / 4) % quarter) + quarter) % quarter) - Math.PI / 4;
}

/**
 * The group's frame in plan space: the midpoint of the reference wall's face
 * in whichever group room it bounds, squared to that wall — or, with no
 * reference wall, the centre of the group's combined floor, axis-aligned.
 */
export function groupFrame(
  plan: Plan,
  group: PatternGroup,
  derived: Map<string, DerivedRoom>
): PatternFrame | null {
  const members = group.roomIds
    .map((id) => derived.get(id))
    .filter((d): d is DerivedRoom => Boolean(d?.tileBoundary && d.status === 'ok'));
  if (members.length === 0) return null;

  if (group.referenceWallId && plan.walls.some((w) => w.id === group.referenceWallId)) {
    for (const d of members) {
      const i = d.edgeWalls.indexOf(group.referenceWallId);
      if (i < 0) continue;
      const v = d.tileBoundary!.vertices;
      const a = v[i];
      const b = v[(i + 1) % v.length];
      return {
        origin: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        angle: fold(Math.atan2(b.y - a.y, b.x - a.x)),
      };
    }
  }

  const bb = boundingBoxOf(members.map((d) => d.tileBoundary!));
  return { origin: { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 }, angle: 0 };
}

/** The plan-space frame as seen from one room's own coordinates. */
export function localFrame(frame: PatternFrame, origin: Vec2): PatternFrame {
  return { origin: { x: frame.origin.x - origin.x, y: frame.origin.y - origin.y }, angle: frame.angle };
}

/**
 * One score for the whole group, by the same formula a single room uses:
 * waste over the summed floor, and the smallest cut anywhere in the group.
 */
function groupScore(layouts: LayoutResult[], tileConfig: TileConfig, weights: OptimizationWeights): number {
  const tileArea = tileConfig.width * tileConfig.height;
  let count = 0;
  let cuts = 0;
  let covered = 0;
  let minCut = Infinity;
  for (const l of layouts) {
    count += l.fullTileCount + l.cutTileCount;
    cuts += l.cutTileCount;
    covered += l.totalTileArea;
    if (l.cutTileCount > 0) minCut = Math.min(minCut, l.smallestCutPiece);
  }
  const normalizedMinCut = cuts === 0 ? 1 : tileArea > 0 ? minCut / tileArea : 0;
  const waste = cuts > 0 && count > 0 ? 1 - covered / (count * tileArea) : 0;
  return weights.alpha * normalizedMinCut - weights.beta * Math.abs(waste);
}

export interface GroupLayoutResult {
  /** One per member, in the order given */
  layouts: LayoutResult[];
  offset: { x: number; y: number };
  candidatesEvaluated: number;
}

/** Lay every member out at one offset. */
export function layoutGroup(
  members: LayoutRoom[],
  tileConfig: TileConfig,
  weights: OptimizationWeights,
  frame: PatternFrame,
  offset: { x: number; y: number },
  prepared?: ClipShape[]
): LayoutResult[] {
  return members.map((m, i) =>
    computeLayout(m.room, tileConfig, offset.x, offset.y, weights, prepared?.[i], localFrame(frame, m.origin))
  );
}

/**
 * Find the group's offset: fixed by the alignment mode, or searched in two
 * phases exactly like `optimize()`. The clip budget is shared across the
 * members, so a group search costs about what one room's search does.
 */
export function optimizeGroup(
  members: LayoutRoom[],
  tileConfig: TileConfig,
  config: OptimizationConfig,
  alignment: AlignmentMode,
  frame: PatternFrame
): GroupLayoutResult {
  const { weights } = config;
  const prepared = members.map((m) => prepareClipShape(m.room));

  if (alignment !== 'optimize') {
    // Alignment offsets are measured from the frame origin, so they mean the
    // same thing for every member.
    const { offsetX, offsetY } = computeAlignmentOffset(members[0].room, tileConfig, alignment);
    const offset = { x: offsetX, y: offsetY };
    return {
      layouts: layoutGroup(members, tileConfig, weights, frame, offset, prepared),
      offset,
      candidatesEvaluated: 1,
    };
  }

  const { unitX, unitY } = getPatternUnit(tileConfig);
  let evaluated = 0;
  let best = { score: -Infinity, offset: { x: 0, y: 0 }, layouts: [] as LayoutResult[] };
  const tryOffset = (x: number, y: number) => {
    const layouts = layoutGroup(members, tileConfig, weights, frame, { x, y }, prepared);
    evaluated++;
    const score = groupScore(layouts, tileConfig, weights);
    if (score > best.score) best = { score, offset: { x, y }, layouts };
  };

  tryOffset(0, 0);
  const tilesPerCandidate = best.layouts.reduce((s, l) => s + l.tiles.length, 0);
  const coarse = candidateStep(config.coarseStep, tilesPerCandidate).step;
  const fine = candidateStep(config.fineStep, tilesPerCandidate).step;

  for (let oy = 0; oy < unitY; oy += unitY * coarse) {
    for (let ox = 0; ox < unitX; ox += unitX * coarse) tryOffset(ox, oy);
  }

  const { x: bx, y: by } = best.offset;
  const rx = unitX * Math.min(config.refineRadius, coarse);
  const ry = unitY * Math.min(config.refineRadius, coarse);
  for (let oy = by - ry; oy <= by + ry; oy += unitY * fine) {
    for (let ox = bx - rx; ox <= bx + rx; ox += unitX * fine) tryOffset(ox, oy);
  }

  // Each member's result carries the group score, so a room's stats card
  // reports the figure the search actually optimised.
  const score = best.score;
  return {
    layouts: best.layouts.map((l) => ({ ...l, optimizationScore: score })),
    offset: best.offset,
    candidatesEvaluated: evaluated,
  };
}
