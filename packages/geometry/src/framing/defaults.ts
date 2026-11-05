/**
 * Framing defaults and the v1 → v2 plan upgrade.
 *
 * These are standard light wood-frame planning numbers, not an engineered
 * design: a 97⅛″ framed wall under three 1½″ plates takes a 92⅝″ precut stud,
 * and header sizes come from an editable table, not a span calculation.
 */

import {
  HeaderRule,
  MM_PER_INCH,
  Plan,
  PlanWall,
  WallAssembly,
  WallFraming,
} from '../types';

const inch = (n: number) => n * MM_PER_INCH;

export const IMPERIAL_FRAMING: WallFraming = {
  framedHeight: inch(97 + 1 / 8),
  spacing: inch(16),
  layoutFrom: 'a',
  topPlates: 2,
};

export const METRIC_FRAMING: WallFraming = {
  framedHeight: 2467,
  spacing: 400,
  layoutFrom: 'a',
  topPlates: 2,
};

/** "Covers any span" without putting Infinity into JSON. */
const ANY_SPAN = 1_000_000;

/**
 * Header rule table. Non-bearing: a single flat 2×4. Bearing: doubled
 * dimension lumber by span (rough opening + both jacks). Past the last
 * bearing rule the opening is flagged for an engineered header.
 */
export const DEFAULT_HEADER_RULES: HeaderRule[] = [
  { loadBearing: false, maxSpan: ANY_SPAN, member: '2×4 flat', plies: 1, depth: inch(1.5) },
  { loadBearing: true, maxSpan: inch(36), member: '2×6', plies: 2, depth: inch(5.5) },
  { loadBearing: true, maxSpan: inch(48), member: '2×8', plies: 2, depth: inch(7.25) },
  { loadBearing: true, maxSpan: inch(72), member: '2×10', plies: 2, depth: inch(9.25) },
  { loadBearing: true, maxSpan: inch(96), member: '2×12', plies: 2, depth: inch(11.25) },
];

/**
 * Bring any saved plan up to the current version. A v1 plan (008) gains
 * framing defaults for its measurement system and empty openings; a v2 plan
 * is returned as is. Anything else is refused with null.
 */
export function upgradePlan(raw: unknown, system: 'imperial' | 'metric' = 'imperial'): Plan | null {
  const p = raw as Partial<Plan> & { version?: unknown };
  if (!p || typeof p !== 'object') return null;
  if (p.version === 2) return { ...(p as Plan), groups: p.groups ?? [] };
  if (p.version !== 1) return null;
  return {
    ...(p as unknown as Omit<Plan, 'version'>),
    version: 2,
    groups: p.groups ?? [],
    framingDefaults: { ...(system === 'metric' ? METRIC_FRAMING : IMPERIAL_FRAMING) },
    openings: [],
    junctions: [],
    headerRules: DEFAULT_HEADER_RULES.map((r) => ({ ...r })),
  };
}

/** A wall is taken as bearing unless told otherwise when its build-up has sheathing. */
export function defaultLoadBearing(assembly: WallAssembly | undefined): boolean {
  return Boolean(assembly?.layers.some((l) => l.function === 'sheathing'));
}

/** The framing a wall actually uses: its overrides over the plan's defaults. */
export function effectiveFraming(
  plan: Plan,
  wall: PlanWall,
  assembly: WallAssembly | undefined
): Required<WallFraming> {
  const d = plan.framingDefaults;
  const o = wall.framing ?? {};
  return {
    framedHeight: o.framedHeight ?? d.framedHeight,
    spacing: o.spacing ?? d.spacing,
    layoutFrom: o.layoutFrom ?? d.layoutFrom,
    topPlates: o.topPlates ?? d.topPlates,
    loadBearing: o.loadBearing ?? d.loadBearing ?? defaultLoadBearing(assembly),
  };
}

/** Stud length under the plates: framed height less one bottom plate and the top plates. */
export function studLength(framing: Required<WallFraming>, plateThickness: number): number {
  return framing.framedHeight - (1 + framing.topPlates) * plateThickness;
}
