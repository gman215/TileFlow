/**
 * 012 R3 — order by the box.
 *
 * Tile is sold by the box, so the order is only useful once it is in boxes.
 * Box size is a fact about the product (its size), not the room, so it is
 * keyed by the tile's dimensions — the same 12 × 24 in two rooms is one box
 * size (AC-3.3). All arithmetic here; nothing comes from a model.
 */

const MM2_PER_FT2 = 92_903.04;
const MM2_PER_M2 = 1_000_000;

/** "300x600": the two sides sorted, to 0.1 mm, so laying it on its side is the same product. */
export function productKey(t: { width: number; height: number }): string {
  const [a, b] = [t.width, t.height].sort((x, y) => x - y);
  const r = (n: number) => String(Math.round(n * 10) / 10);
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

/** Pieces in a box that covers `areaMM2`, to the nearest whole piece. */
export function piecesFromBoxArea(areaMM2: number, tile: { width: number; height: number }): number {
  return Math.max(1, Math.round(areaMM2 / (tile.width * tile.height)));
}

/**
 * What the Per box field accepts (AC-3.1): a whole number of pieces, or an
 * area with its unit — `15.5 ft²`, `15.5 sqft`, `15.5 sf`, `1.44 m²`, `1.44 m2`.
 * Null when it is neither; `fromArea` says the pieces were worked out.
 */
export function parseBoxSize(
  text: string,
  tile: { width: number; height: number }
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
export function boxArea(pieces: number, tile: { width: number; height: number }, metric: boolean): string {
  const mm2 = pieces * tile.width * tile.height;
  return metric ? `${(mm2 / MM2_PER_M2).toFixed(2)} m²` : `${(mm2 / MM2_PER_FT2).toFixed(1)} ft²`;
}

export interface ProductBoxes {
  key: string;
  /** One of the rows' tile configs — any will do, they share a size */
  tile: { width: number; height: number };
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
  rows: { tileConfig: { width: number; height: number }; order: number }[],
  boxSizes: Record<string, number>
): ProductBoxes[] {
  const byKey = new Map<string, { tile: { width: number; height: number }; order: number }>();
  for (const r of rows) {
    const key = productKey(r.tileConfig);
    const acc = byKey.get(key) ?? { tile: r.tileConfig, order: 0 };
    acc.order += r.order;
    byKey.set(key, acc);
  }
  const out: ProductBoxes[] = [];
  for (const [key, { tile, order }] of byKey) {
    const perBox = boxSizes[key];
    const boxes = boxesFor(order, perBox);
    if (boxes) out.push({ key, tile, order, perBox, boxes });
  }
  return out;
}
