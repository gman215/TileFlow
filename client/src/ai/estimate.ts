/**
 * The cost estimator's arithmetic (005) — every multiplication and every sum
 * the estimate shows happens here, never in the model (Constitution I).
 *
 * The model returns quantities and unit rates with a stated basis. Before
 * anything is shown, this module:
 *
 *   1. `sanityFilter`            drops lines a careful person would not trust —
 *                                no basis, impossible numbers, a unit that makes
 *                                no sense for the material, or a quantity far
 *                                outside a per-area bound (AC-1.5, AC-5.2);
 *   2. `overrideEngineQuantities` forces the tile and area quantities to the
 *                                engine's, whatever the model said (AC-1.1, 1.2);
 *   3. `applyPrices`             costs each line with the user's own price where
 *                                there is one (AC-3.1);
 *   4. `computeTotals`           subtotal = quantity × unit cost, total = their
 *                                sum, in integer cents (AC-2.1, AC-2.2).
 *
 * Steps 2–4 are pure and cheap, so a price edit re-runs them locally with no
 * model call (AC-3.3) — which is why prices are kept apart from quantities.
 */

import { z } from 'zod';
import type {
  EstimateCategory,
  EstimateDTO,
  EstimateLineDTO,
  EstimatePricesDTO,
  MeasurementSystem,
} from '@api/_lib/types';

// ─── Context ──────────────────────────────────────────────────────────────────

/** What the arithmetic needs to know about the layout — all engine figures. */
export interface EstimateContext {
  system: MeasurementSystem;
  /** The engine's order quantity, including 10%. */
  orderQuantity: number;
  /** The engine's floor area in the user's area unit (ft² or m²), as shown on the stats card. */
  roomArea: number;
  areaUnit: 'ft²' | 'm²';
  /** Floor area in m², for the per-m² sanity bounds. */
  roomAreaM2: number;
  /** One tile's face area in the user's area unit — for a per-area tile price. */
  tileFaceArea: number;
  /** The `PatternType` value: labour bounds depend on it. */
  pattern: string;
}

const KG_PER_LB = 0.45359237;

// ─── Shape ────────────────────────────────────────────────────────────────────

/**
 * The response shape, checked again in the browser. The route has already
 * validated it with its own mirror; this is the second line, so that whatever
 * reaches the arithmetic — from the route, a proxy, or a test stub — has the
 * fields it reads. Deliberately as loose as the server's: per-line judgement
 * is `sanityFilter`'s job, where one bad line drops alone (AC-5.1, AC-5.2).
 */
const EstimateShape = z.object({
  lineItems: z.array(z.object({
    item: z.string(), category: z.enum(['tile', 'adhesive', 'grout', 'labour', 'other']),
    quantity: z.number(), unit: z.string(), unitCost: z.number(), basis: z.string(),
    source: z.enum(['engine', 'estimated']),
  })).min(1).max(20),
  assumptions: z.array(z.string()).max(12),
  confidence: z.number().min(0).max(1),
  notes: z.string(),
  demoMode: z.literal(true).optional(),
});

/** The estimate if it has the right shape, else null — never a partial one. */
export function parseEstimate(raw: unknown): EstimateDTO | null {
  const r = EstimateShape.safeParse(raw);
  return r.success ? r.data : null;
}

// ─── Prices ───────────────────────────────────────────────────────────────────

/**
 * Placeholder unit prices, per measurement system. Marked as placeholders
 * wherever shown (AC-3.2): they make a first estimate readable, and nothing
 * more — no regional pricing, no live data (out of scope).
 */
export const PLACEHOLDER_PRICES: Record<MeasurementSystem, { tileArea: number; tileEach: number; adhesive: number; grout: number; labour: number }> = {
  imperial: { tileArea: 4, tileEach: 5, adhesive: 0.6, grout: 1.5, labour: 50 }, // per ft², per tile, per lb, per lb, per hour
  metric: { tileArea: 40, tileEach: 5, adhesive: 1.2, grout: 3, labour: 50 },    // per m², per tile, per kg, per kg, per hour
};

/** The unit each price is in, for labels: "per ft²", "per lb", "per hour". */
export function priceUnits(system: MeasurementSystem, tileUnit: 'tile' | 'area') {
  const weight = system === 'imperial' ? 'lb' : 'kg';
  return {
    tile: tileUnit === 'tile' ? 'per tile' : `per ${system === 'imperial' ? 'ft²' : 'm²'}`,
    adhesive: `per ${weight}`,
    grout: `per ${weight}`,
    labour: 'per hour',
  };
}

/**
 * The prices in effect: what the user typed, or the placeholder — and which
 * is which, so the panel can mark placeholders.
 */
export function effectivePrices(
  system: MeasurementSystem,
  typed: Partial<Record<'tile' | 'adhesive' | 'grout' | 'labour', number>>,
  tileUnit: 'tile' | 'area'
): { prices: EstimatePricesDTO; placeholder: Record<'tile' | 'adhesive' | 'grout' | 'labour', boolean> } {
  const d = PLACEHOLDER_PRICES[system];
  return {
    prices: {
      tile: typed.tile ?? (tileUnit === 'tile' ? d.tileEach : d.tileArea),
      tileUnit,
      adhesive: typed.adhesive ?? d.adhesive,
      grout: typed.grout ?? d.grout,
      labour: typed.labour ?? d.labour,
    },
    placeholder: {
      tile: typed.tile === undefined,
      adhesive: typed.adhesive === undefined,
      grout: typed.grout === undefined,
      labour: typed.labour === undefined,
    },
  };
}

// ─── 1. Sanity ────────────────────────────────────────────────────────────────

export interface DroppedLine {
  line: EstimateLineDTO;
  reason: string;
}

/** Units a line of each kind may sensibly be counted in, mapped to kg where weight. */
const WEIGHT_UNITS: Record<string, number> = { kg: 1, kgs: 1, lb: KG_PER_LB, lbs: KG_PER_LB };
const HOUR_UNITS = new Set(['h', 'hr', 'hrs', 'hour', 'hours']);
const AREA_UNITS = new Set(['ft²', 'ft2', 'sq ft', 'sqft', 'm²', 'm2', 'sq m', 'sqm']);
const norm = (unit: string) => unit.trim().toLowerCase().replace(/\.$/, '');

/**
 * Upper bounds per m² of floor, from the design's table. Generous on purpose:
 * they exist to catch a decimal in the wrong place, not to second-guess a rate.
 */
const MAX_PER_M2: Partial<Record<EstimateCategory, number>> = { adhesive: 15, grout: 5, labour: 2 };

/**
 * Herringbone and 45° diagonal are laid at 2–4 ft²/hour where a grid goes at
 * 6–10 — the very difference the estimate is meant to show (005 item 9). A
 * pattern-blind 2 h/m² cap (≈ 5.4 ft²/h) dropped the model's herringbone
 * labour line for a 128 ft² kitchen in testing, so these get 5 h/m².
 */
const SLOW_PATTERN_LABOUR_PER_M2 = 5;
const SLOW_PATTERNS = new Set(['herringbone', 'diagonal-45']);
const MIN_LABOUR_PER_M2 = 0.05;

/**
 * Labour does not scale to zero with the room: setting out, mixing and
 * clean-up take a day whatever the size. A pure 2 h/m² cap dropped the
 * model's (sensible) 8 h for a 40 ft² bathroom in testing — 2.15 h/m² — so
 * the cap carries a fixed day on top. It still catches 80 h for a bathroom.
 */
const LABOUR_FIXED_HOURS = 8;

/**
 * Drop lines that would put an untrustworthy number on screen. Every drop has
 * a reason, and the caller shows how many — a silently dropped line is how a
 * wrong total hides (AC-5.2).
 */
export function sanityFilter(lines: EstimateLineDTO[], ctx: EstimateContext) {
  const kept: EstimateLineDTO[] = [];
  const dropped: DroppedLine[] = [];
  const drop = (line: EstimateLineDTO, reason: string) => dropped.push({ line, reason });

  for (const line of lines) {
    if (!line.basis.trim()) { drop(line, 'no basis given'); continue; }
    if (!line.item.trim()) { drop(line, 'no item name'); continue; }
    if (!Number.isFinite(line.quantity) || line.quantity < 0) { drop(line, 'impossible quantity'); continue; }
    if (!Number.isFinite(line.unitCost) || line.unitCost < 0) { drop(line, 'impossible unit cost'); continue; }

    const unit = norm(line.unit);
    if (line.category === 'adhesive' || line.category === 'grout') {
      const toKg = WEIGHT_UNITS[unit];
      if (toKg === undefined) { drop(line, `"${line.unit}" is not a unit of weight`); continue; }
      const perM2 = ctx.roomAreaM2 > 0 ? (line.quantity * toKg) / ctx.roomAreaM2 : 0;
      if (perM2 > MAX_PER_M2[line.category]!) { drop(line, `implausibly large for the floor area (${line.quantity} ${line.unit})`); continue; }
    }
    if (line.category === 'labour') {
      if (!HOUR_UNITS.has(unit)) { drop(line, `"${line.unit}" is not a unit of time`); continue; }
      const perM2 = SLOW_PATTERNS.has(ctx.pattern) ? SLOW_PATTERN_LABOUR_PER_M2 : MAX_PER_M2.labour!;
      const max = perM2 * ctx.roomAreaM2 + LABOUR_FIXED_HOURS;
      const min = MIN_LABOUR_PER_M2 * ctx.roomAreaM2;
      if (line.quantity > max || line.quantity < min) { drop(line, `implausible hours for the floor area (${line.quantity} ${line.unit})`); continue; }
    }
    kept.push(line);
  }
  return { kept, dropped };
}

// ─── 2. Engine quantities ─────────────────────────────────────────────────────

/**
 * The tile quantity and the floor area belong to the engine. Whatever the
 * model put there is replaced (AC-1.1, AC-1.2); a missing tile line is added,
 * because a takeoff without the tiles is not one.
 */
export function overrideEngineQuantities(lines: EstimateLineDTO[], ctx: EstimateContext): EstimateLineDTO[] {
  const out = lines.map((line): EstimateLineDTO => {
    if (line.category === 'tile') {
      return { ...line, quantity: ctx.orderQuantity, unit: 'tiles', source: 'engine' };
    }
    if (line.source === 'engine' && AREA_UNITS.has(norm(line.unit))) {
      return { ...line, quantity: ctx.roomArea, unit: ctx.areaUnit };
    }
    // Weights in the user's system, so the price per kg / per lb applies as-is.
    const toKg = WEIGHT_UNITS[norm(line.unit)];
    if ((line.category === 'adhesive' || line.category === 'grout') && toKg !== undefined) {
      const wantLb = ctx.system === 'imperial';
      const isLb = toKg !== 1;
      if (wantLb !== isLb) {
        const kg = line.quantity * toKg;
        return { ...line, quantity: round(wantLb ? kg / KG_PER_LB : kg, 1), unit: wantLb ? 'lb' : 'kg' };
      }
    }
    return line;
  });
  if (!out.some((l) => l.category === 'tile')) {
    out.unshift({
      item: 'Tile', category: 'tile', quantity: ctx.orderQuantity, unit: 'tiles', unitCost: 0,
      basis: 'Order quantity from the layout engine, including 10%.', source: 'engine',
    });
  }
  return out;
}

// ─── 3. Prices ────────────────────────────────────────────────────────────────

export interface PricedLine extends EstimateLineDTO {
  /** Whose unit cost this is: the user's price, or the model's placeholder. */
  priced: 'user' | 'model';
  /** For a per-area tile price: the price as typed, shown beside the per-tile cost. */
  perArea?: number;
}

/**
 * Cost each line with the user's price where they gave one. A per-area tile
 * price becomes a per-tile cost here, by the tile's face area — arithmetic
 * the model must not do, and in testing did wrongly (it put a per-ft² price
 * on a line counted in tiles). Unit costs are rounded to the cent, so the
 * figure shown × the quantity shown reproduces the subtotal shown.
 */
export function applyPrices(lines: EstimateLineDTO[], prices: EstimatePricesDTO, ctx: EstimateContext): PricedLine[] {
  return lines.map((line): PricedLine => {
    const user =
      line.category === 'adhesive' ? prices.adhesive
      : line.category === 'grout' ? prices.grout
      : line.category === 'labour' ? prices.labour
      : line.category === 'tile' ? prices.tile
      : null;
    if (user === null) return { ...line, unitCost: round(line.unitCost, 2), priced: 'model' };
    if (line.category === 'tile' && prices.tileUnit === 'area') {
      return { ...line, unitCost: round(user * ctx.tileFaceArea, 2), priced: 'user', perArea: user };
    }
    return { ...line, unitCost: round(user, 2), priced: 'user' };
  });
}

// ─── 4. Totals ────────────────────────────────────────────────────────────────

export interface CostedLine extends PricedLine {
  subtotal: number;
}

/** Subtotals and the total, in integer cents so the column adds up exactly. */
export function computeTotals(lines: PricedLine[]): { lines: CostedLine[]; total: number } {
  let cents = 0;
  const costed = lines.map((line) => {
    const c = Math.round(line.quantity * line.unitCost * 100);
    cents += c;
    return { ...line, subtotal: c / 100 };
  });
  return { lines: costed, total: cents / 100 };
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

// ─── Discrepancies ────────────────────────────────────────────────────────────

/**
 * Figures in free text that read as a whole-job amount: a currency amount, or
 * a number in a sentence about a total. Loose on purpose — this only decides
 * what gets logged, never what gets shown.
 */
export function totalClaims(text: string): number[] {
  const out: number[] = [];
  for (const sentence of text.split(/(?<=[.!?;])\s+/)) {
    const aboutTotal = /\b(total|sum|overall|altogether|in all|grand)\b/i.test(sentence);
    for (const m of sentence.matchAll(/([$€£¥])?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/g)) {
      if (aboutTotal || m[1]) out.push(Number((m[2] + (m[3] ?? '')).replace(/,/g, '')));
    }
  }
  return out;
}

/**
 * The schema has no total field, but `notes` is free text, and a model that
 * volunteers "about $700 in total" there has done arithmetic we did not ask
 * for. It is never displayed — `notes` is not rendered at all — and when it
 * disagrees with the client's total by more than rounding, it is logged for
 * debugging (AC-2.3). Returns what it logged, for tests.
 */
export function logTotalDiscrepancy(notes: string, total: number): number[] {
  const wrong = totalClaims(notes).filter((n) => Math.abs(n - total) > 0.01);
  if (wrong.length > 0) {
    console.warn('[estimate] the model volunteered a total-like figure that differs from the computed total', {
      volunteered: wrong,
      computed: total,
      notes,
    });
  }
  return wrong;
}

// ─── The whole pipeline ───────────────────────────────────────────────────────

export interface EstimateView {
  lines: CostedLine[];
  dropped: DroppedLine[];
  total: number;
  assumptions: string[];
  confidence: number;
  demoMode: boolean;
}

/**
 * Model response → what is displayed. Re-run on every price edit with the same
 * response, so editing a price never calls the network (AC-3.3). Returns null
 * when every line was dropped: an estimate with nothing trustworthy in it is a
 * failed estimate (design failure table).
 */
export function buildEstimateView(dto: EstimateDTO, prices: EstimatePricesDTO, ctx: EstimateContext): EstimateView | null {
  const { kept, dropped } = sanityFilter(dto.lineItems, ctx);
  if (kept.length === 0) return null;
  const { lines, total } = computeTotals(applyPrices(overrideEngineQuantities(kept, ctx), prices, ctx));
  return { lines, dropped, total, assumptions: dto.assumptions, confidence: dto.confidence, demoMode: Boolean(dto.demoMode) };
}
