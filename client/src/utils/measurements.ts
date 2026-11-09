import { fromMM, toMM, type Unit } from '@tileflow/geometry';

type ImperialFormat = 'decimal' | 'feet-inches' | 'fraction-inches';

/**
 * Two industry-standard measurement systems. Each field picks the unit
 * a pro would actually use within the system (rooms in ft+in / metres,
 * tiles in inches / cm, grout in fractional inches / mm).
 */
export type MeasurementSystem = 'metric' | 'imperial';

export interface FieldDisplay {
  unit: Unit;
  imperialFormat: ImperialFormat;
}

export function roomDisplay(system: MeasurementSystem): FieldDisplay {
  return system === 'imperial'
    ? { unit: 'feet', imperialFormat: 'feet-inches' }
    : { unit: 'm', imperialFormat: 'decimal' };
}

export function tileDisplay(system: MeasurementSystem): FieldDisplay {
  return system === 'imperial'
    ? { unit: 'inches', imperialFormat: 'decimal' }
    : { unit: 'cm', imperialFormat: 'decimal' };
}

export function groutDisplay(system: MeasurementSystem): FieldDisplay {
  return system === 'imperial'
    ? { unit: 'inches', imperialFormat: 'fraction-inches' }
    : { unit: 'mm', imperialFormat: 'decimal' };
}

export function systemForUnit(unit: Unit): MeasurementSystem {
  return isImperialUnit(unit) ? 'imperial' : 'metric';
}

const METRIC_PRECISION: Record<Unit, number> = {
  mm: 0,
  cm: 1,
  m: 3,
  inches: 3,
  feet: 3,
};

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function parseFractionToken(raw: string): number | null {
  const token = raw.trim();
  if (!token) return null;

  if (token.includes('/')) {
    const [nRaw, dRaw] = token.split('/');
    const n = Number(nRaw);
    const d = Number(dRaw);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
    return n / d;
  }

  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

function parseMixedNumber(raw: string): number | null {
  const normalized = raw.trim().replace(/-/g, ' ');
  if (!normalized) return null;

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parseFractionToken(parts[0]);

  if (parts.length === 2 && parts[1].includes('/')) {
    const whole = Number(parts[0]);
    const frac = parseFractionToken(parts[1]);
    if (!Number.isFinite(whole) || frac === null) return null;
    return whole >= 0 ? whole + frac : whole - frac;
  }

  return null;
}

function toDisplayDecimal(value: number, precision: number): string {
  const fixed = value.toFixed(precision);
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function parseImperialInches(rawInput: string, mode: ImperialFormat): number | null {
  const input = rawInput.trim().toLowerCase();
  if (!input) return null;

  const normalized = input
    .replace(/,/g, ' ')
    .replace(/"/g, ' in ')
    .replace(/\b(inches|inch|in)\b/g, ' in ')
    .replace(/'/g, ' ft ')
    .replace(/\b(feet|foot|ft)\b/g, ' ft ')
    .replace(/\s+/g, ' ')
    .trim();

  const feetMatch = normalized.match(/(-?\d+(?:\.\d+)?)\s*ft/);
  const hasFeetMarker = Boolean(feetMatch);
  const feet = feetMatch ? Number(feetMatch[1]) : 0;

  let inchText = normalized.replace(/-?\d+(?:\.\d+)?\s*ft/, '').replace(/\bin\b/g, '').trim();

  if (mode === 'feet-inches' && !hasFeetMarker && /^-?\d+\s+\d+(?:\s+\d+\/\d+)?$/.test(inchText)) {
    const bits = inchText.split(/\s+/);
    const parsedFeet = Number(bits[0]);
    const inchBits = bits.slice(1).join(' ');
    const parsedInches = parseMixedNumber(inchBits);
    if (Number.isFinite(parsedFeet) && parsedInches !== null) {
      return parsedFeet * 12 + parsedInches;
    }
  }

  if (!inchText) {
    return hasFeetMarker ? feet * 12 : null;
  }

  const inchValue = parseMixedNumber(inchText);
  if (inchValue === null) return null;

  if (hasFeetMarker) {
    return feet * 12 + inchValue;
  }

  return inchValue;
}

export function isImperialUnit(unit: Unit): boolean {
  return unit === 'inches' || unit === 'feet';
}

export function formatImperialFeetInches(totalInches: number): string {
  const sign = totalInches < 0 ? '-' : '';
  const sixteenths = Math.round(Math.abs(totalInches) * 16);
  const totalFeet = Math.floor(sixteenths / (12 * 16));
  const remSixteenths = sixteenths - totalFeet * 12 * 16;
  const wholeInches = Math.floor(remSixteenths / 16);
  const fracSixteenths = remSixteenths % 16;

  if (fracSixteenths === 0) {
    return `${sign}${totalFeet} ft ${wholeInches} in`;
  }

  const d = gcd(fracSixteenths, 16);
  const n = fracSixteenths / d;
  const den = 16 / d;
  const inchPart = wholeInches > 0 ? `${wholeInches} ${n}/${den}` : `${n}/${den}`;
  return `${sign}${totalFeet} ft ${inchPart} in`;
}

/** Format a value in inches as a fractional-inch string, e.g. `1/16 in`, `2 1/2 in`. */
export function formatImperialInchesFraction(totalInches: number): string {
  const sign = totalInches < 0 ? '-' : '';
  const sixteenths = Math.round(Math.abs(totalInches) * 16);
  const wholeInches = Math.floor(sixteenths / 16);
  const fracSixteenths = sixteenths % 16;

  if (fracSixteenths === 0) {
    return `${sign}${wholeInches} in`;
  }

  const d = gcd(fracSixteenths, 16);
  const n = fracSixteenths / d;
  const den = 16 / d;
  const inchPart = wholeInches > 0 ? `${wholeInches} ${n}/${den}` : `${n}/${den}`;
  return `${sign}${inchPart} in`;
}

export function formatDisplayFromMM(
  mm: number,
  unit: Unit,
  imperialFormat: ImperialFormat = 'decimal'
): string {
  if (isImperialUnit(unit)) {
    const inches = fromMM(mm, 'inches');
    if (imperialFormat === 'feet-inches') {
      return formatImperialFeetInches(inches);
    }
    if (imperialFormat === 'fraction-inches') {
      return formatImperialInchesFraction(inches);
    }
    return `${toDisplayDecimal(inches, 3)} in`;
  }

  const precision = METRIC_PRECISION[unit];
  return toDisplayDecimal(fromMM(mm, unit), precision);
}

export function parseDisplayToMM(
  rawInput: string,
  unit: Unit,
  imperialFormat: ImperialFormat = 'decimal'
): number | null {
  const input = rawInput.trim();
  if (!input) return null;

  if (isImperialUnit(unit)) {
    const inches = parseImperialInches(input, imperialFormat);
    if (inches === null) return null;
    return toMM(inches, 'inches');
  }

  const numeric = Number(input);
  if (!Number.isFinite(numeric)) return null;
  return toMM(numeric, unit);
}

export type { ImperialFormat };

// ─── Display strings shared by the UI and the AI snapshot ─────────────────────
//
// The stats card and `statsDto()` format through these, so a figure the layout
// assistant quotes is character-for-character the figure on screen (003). Any
// change to how a figure reads changes it in both places at once.

const MM2_PER_M2 = 1_000_000;
const MM2_PER_FT2 = 92_903.04;

/** Floor area as the stats card shows it: ft² to 0.1, m² to 0.01. */
export function formatArea(mm2: number, system: MeasurementSystem): string {
  return system === 'imperial'
    ? `${(mm2 / MM2_PER_FT2).toFixed(1)} ft²`
    : `${(mm2 / MM2_PER_M2).toFixed(2)} m²`;
}

/**
 * A small area — a cut piece — in in² / cm². Whole units, or one decimal under
 * ten so a genuine sliver never rounds to nothing. Not ft²/m², where a 5 in²
 * offcut would read "0.0 ft²". Nothing on screen shows this figure today, so
 * there is no display to match; it is chosen to be truthful when it is small.
 */
export function formatSmallArea(mm2: number, system: MeasurementSystem): string {
  const v = system === 'imperial' ? mm2 / 645.16 : mm2 / 100;
  const unit = system === 'imperial' ? 'in²' : 'cm²';
  return `${v < 10 ? v.toFixed(1) : Math.round(v).toString()} ${unit}`;
}

/** Waste as the stats card shows it: one decimal, with the percent sign. */
export function formatWaste(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

/**
 * A length in the unit a field uses, always with its unit. Imperial formats
 * carry their own ("12 in", "9 ft 2 in"); metric ones are bare numbers, so the
 * unit is added — a figure read aloud without one is ambiguous.
 */
export function formatWithUnit(mm: number, display: FieldDisplay): string {
  const text = formatDisplayFromMM(mm, display.unit, display.imperialFormat);
  return isImperialUnit(display.unit) ? text : `${text} ${display.unit}`;
}
