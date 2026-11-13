/**
 * What to order — the one place the order figure is computed, so the stats
 * card, the plan totals, the sheet, the brief and the estimate quote the same
 * number (Constitution I).
 */

/** The order buffer: +10 % for breakage, offcuts and dye-lot matching. */
export const ORDER_BUFFER = 1.1;

/**
 * Tiles to order for `tiles` placed: +10 %, rounded up. Done in integers —
 * `Math.ceil(100 * 1.1)` is 111, because 100 × 1.1 is 110.00000000000001 in
 * floating point, which over-ordered every multiple of ten by one tile.
 */
export function orderQuantity(tiles: number): number {
  return Math.ceil((tiles * Math.round(ORDER_BUFFER * 100)) / 100);
}

interface Counts {
  fullTileCount: number;
  cutTileCount: number;
  variantCounts?: { full: number; cut: number }[];
}

/** Tiles placed per colour: [light, dark] for a checkerboard, else [all]. */
export function colourTiles(l: Counts): number[] {
  return l.variantCounts ? l.variantCounts.map((c) => c.full + c.cut) : [l.fullTileCount + l.cutTileCount];
}

/**
 * The order for a layout. Two colours are two products, each bought with its
 * own 10 % (013 AC-1.3) — so a checkerboard orders ⌈light × 1.1⌉ + ⌈dark × 1.1⌉.
 */
export function layoutOrder(l: Counts): number {
  return colourTiles(l).reduce((s, n) => s + orderQuantity(n), 0);
}

/** Same, for a plan total row that may carry per-colour tiles. */
export function rowOrders(row: { tiles: number; colours?: number[] }): number[] {
  return (row.colours ?? [row.tiles]).map(orderQuantity);
}

export const COLOUR_NAMES = ['Light', 'Dark'] as const;
