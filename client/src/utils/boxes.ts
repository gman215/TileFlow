/**
 * 012 R3 — order by the box.
 *
 * Tile is sold by the box, so the order is only useful once it is in boxes.
 * Box size is a fact about the product (its size), not the room, so it is
 * keyed by the tile's dimensions — the same 12 × 24 in two rooms is one box
 * size (AC-3.3). All arithmetic here; nothing comes from a model.
 */

import { tileFaceArea, type PatternType } from '@tileflow/geometry';

const MM2_PER_FT2 = 92_903.04;

type Tile = { width: number; height: number; pattern?: PatternType };
const face = (t: Tile) => (t.pattern ? tileFaceArea({ ...t, pattern: t.pattern }) : t.width * t.height);
const MM2_PER_M2 = 1_000_000;

/**
 * "300x600": the two sides sorted, to 0.1 mm, so laying it on its side is the
 * same product. A hexagon is "hex200" (across the flats) — not a 200 square.
 */
export function productKey(t: Tile): string {
  const r = (n: number) => String(Math.round(n * 10) / 10);
  if (t.pattern === 'hexagon') return `hex${r(t.width)}`;
  const [a, b] = [t.width, t.height].sort((x, y) => x - y);
  return `${r(a)}x${r(b)}`;
}

export interface BoxOrder {
  boxes: number;
  /** Tiles in those boxes */
  tiles: number;
  /** Tiles beyond the order quantity (which already includes 10 %) */
  spare: number;
}

/** Boxes = ⌈order ÷ per box⌉ (AC-3.2). Null without a box size. */
export function boxesFor(orderQty: number, perBox: number | undefined): BoxOrder | null {
  if (!perBox || perBox < 1 || !Number.isFinite(perBox)) return null;
  const boxes = Math.ceil(orderQty / perBox);
  return { boxes, tiles: boxes * perBox, spare: boxes * perBox - orderQty };
}

/** Several orders of the same box size, each boxed on its own — a checkerboard's two colours. */
export function boxesForOrders(orders: number[], perBox: number | undefined): BoxOrder | null {
  const each = orders.map((o) => boxesFor(o, perBox));
  if (each.some((b) => b === null)) return null;
  return each.reduce<BoxOrder>((s, b) => ({ boxes: s.boxes + b!.boxes, tiles: s.tiles + b!.tiles, spare: s.spare + b!.spare }), { boxes: 0, tiles: 0, spare: 0 });
}

/** Pieces in a box that covers `areaMM2`, to the nearest whole piece. */
export function piecesFromBoxArea(areaMM2: number, tile: Tile): number {
  return Math.max(1, Math.round(areaMM2 / face(tile)));
}

/**
 * What the Per box field accepts (AC-3.1): a whole number of pieces, or an
 * area with its unit — `15.5 ft²`, `15.5 sqft`, `15.5 sf`, `1.44 m²`, `1.44 m2`.
 * Null when it is neither; `fromArea` says the pieces were worked out.
 */
export function parseBoxSize(
  text: string,
  tile: Tile
): { pieces: number; fromArea: boolean } | null {
  const s = text.trim().toLowerCase().replace(',', '.');
  if (s === '') return null;
  const pcs = s.match(/^(\d+)\s*(pcs?|pieces?|tiles?)?$/);
  if (pcs) {
    const n = parseInt(pcs[1], 10);
    return n >= 1 && n <= 10000 ? { pieces: n, fromArea: false } : null;
  }
  const area = s.match(/^(\d+(?:\.\d+)?)\s*(ft²|ft2|sq\.?\s*ft|sqft|sf|m²|m2|sq\.?\s*m|sqm)$/);
  if (!area) return null;
  const value = parseFloat(area[1]);
  if (!(value > 0)) return null;
  const mm2 = /m/.test(area[2]) && !/ft|sf/.test(area[2]) ? value * MM2_PER_M2 : value * MM2_PER_FT2;
  const pieces = piecesFromBoxArea(mm2, tile);
  return pieces <= 10000 ? { pieces, fromArea: true } : null;
}

/** The box's coverage, shown beside the field so a typed pieces count can be checked. */
export function boxArea(pieces: number, tile: Tile, metric: boolean): string {
  const mm2 = pieces * face(tile);
  return metric ? `${(mm2 / MM2_PER_M2).toFixed(2)} m²` : `${(mm2 / MM2_PER_FT2).toFixed(1)} ft²`;
}

export interface ProductBoxes {
  key: string;
  /** One of the rows' tile configs — any will do, they share a size */
  tile: Tile;
  /** A checkerboard colour, bought as its own product; absent for one-colour rows */
  colour?: number;
  /** Σ of the rows' order quantities */
  order: number;
  perBox: number;
  boxes: BoxOrder;
}

/**
 * Boxes per product across rows that may differ only in pattern (AC-3.3).
 * Boxes are counted on the combined order: two rooms of the same tile buy
 * ⌈(a + b) ÷ n⌉ boxes, not ⌈a ÷ n⌉ + ⌈b ÷ n⌉. Products without a box size
 * are left out.
 */
export function productBoxes(
  rows: { tileConfig: Tile; orders: number[] }[],
  boxSizes: Record<string, number>
): ProductBoxes[] {
  // A checkerboard row's two orders are two colours — two products of one
  // size and one box size, so they are boxed apart (013 AC-1.3).
  const byKey = new Map<string, { key: string; tile: Tile; order: number; colour?: number }>();
  for (const r of rows) {
    const key = productKey(r.tileConfig);
    r.orders.forEach((order, i) => {
      const colour = r.orders.length > 1 ? i : undefined;
      const id = `${key}|${colour ?? ''}`;
      const acc = byKey.get(id) ?? { key, tile: r.tileConfig, order: 0, colour };
      acc.order += order;
      byKey.set(id, acc);
    });
  }
  const out: ProductBoxes[] = [];
  for (const { key, tile, order, colour } of byKey.values()) {
    const perBox = boxSizes[key];
    const boxes = boxesFor(order, perBox);
    if (boxes) out.push({ key, tile, order, perBox, boxes, ...(colour !== undefined ? { colour } : {}) });
  }
  return out;
}
