import { useMemo } from 'react';
import { cutPieces, groupCuts, type CutGroup, type CutKind, type LayoutResult, type TileConfig } from '@tileflow/geometry';
import { useTileFlowStore } from '../store/tileFlowStore';
import { formatImperialInchesFraction, type MeasurementSystem } from '../utils/measurements';

/** The precision an installer marks a tile to (AC-1.3). */
export function cutStepMM(system: MeasurementSystem): number {
  return system === 'metric' ? 1 : 25.4 / 16;
}

export const CUT_KIND_LABEL: Record<CutKind, string> = {
  straight: 'Straight',
  corner: 'Two cuts',
  notched: 'Notched',
  angled: 'Angled',
  shave: 'Shave < 0.5 mm',
};

export interface CutList {
  groups: CutGroup[];
  /** Piece count, all groups */
  pieces: number;
  /** Tiles cut — equals the stats card's Cut (AC-1.7) */
  tiles: number;
  /** "1 mm" / "1/16 in" */
  precision: string;
  /** label → group, for the canvas and the sheet */
  labelOf: Map<string, string>;
}

/** Group key per piece, so a drawing can find a piece's letter. */
export const pieceKey = (tileId: number, piece: number) => `${tileId}:${piece}`;

/** The cut list for any layout — the sheet uses it for every room of a plan. */
export function buildCutList(layout: LayoutResult, tileConfig: TileConfig, system: MeasurementSystem): CutList {
  const pieces = cutPieces(layout, tileConfig);
  const groups = groupCuts(pieces, cutStepMM(system));
  const labelOf = new Map<string, string>();
  for (const g of groups) for (const p of g.pieces) labelOf.set(pieceKey(p.tileId, p.piece), g.label);
  return {
    groups,
    pieces: pieces.length,
    tiles: new Set(pieces.map((p) => p.tileId)).size,
    precision: system === 'metric' ? '1 mm' : '1/16 in',
    labelOf,
  };
}

/** The layout on screen's cut list (in a floor plan, the active room's). One source for the drawer and the canvas. */
export function useCutList(): CutList | null {
  const layout = useTileFlowStore((s) => s.layout);
  const tileConfig = useTileFlowStore((s) => s.tileConfig);
  const system = useTileFlowStore((s) => s.system);
  return useMemo(() => (layout ? buildCutList(layout, tileConfig, system) : null), [layout, tileConfig, system]);
}

/**
 * "412 × 300 mm" or "16 1/4 × 12 in": what is marked on the tile — whole mm,
 * or sixteenths of an inch, the step the pieces were grouped to.
 */
export function cutLength(mm: number, system: MeasurementSystem): string {
  return system === 'metric' ? String(Math.round(mm)) : formatImperialInchesFraction(mm / 25.4).replace(/ in$/, '');
}
export function cutSize(g: { width: number; height: number }, system: MeasurementSystem): string {
  return `${cutLength(g.width, system)} × ${cutLength(g.height, system)} ${system === 'metric' ? 'mm' : 'in'}`;
}

/** "Notched · 6 × 4" — the notch to cut out of an L piece, when it is one rectangle. */
export function cutKindText(g: { kind: CutKind; notch?: { width: number; height: number } }, system: MeasurementSystem): string {
  return g.notch ? `${CUT_KIND_LABEL[g.kind]} ${cutLength(g.notch.width, system)} × ${cutLength(g.notch.height, system)}` : CUT_KIND_LABEL[g.kind];
}
