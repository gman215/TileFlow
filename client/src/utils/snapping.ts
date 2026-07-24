import type { Vec2 } from '@tileflow/geometry';
import { MM_PER_INCH } from '@tileflow/geometry';
import type { MeasurementSystem } from './measurements';

/**
 * Drawing aids for the room outline.
 *
 * Rooms are square far more often than not, so the cursor snaps to 90°/45°
 * off the previous corner and to a round increment along that direction —
 * which is what lets someone draw an exact 4.2 m wall with a mouse. Holding
 * Shift drops the angle constraint for genuinely odd walls.
 */

/** How close (on screen) the cursor must get to snap to an existing corner. */
const VERTEX_SNAP_PX = 12;
/** How close (on screen) before the direction locks to 90°/45°. */
const ANGLE_SNAP_PX = 10;

/** Round drawing increment: 10 mm metric, 1 in imperial. */
export function snapGridMM(system: MeasurementSystem): number {
  return system === 'imperial' ? MM_PER_INCH : 10;
}

export type SnapKind = 'corner' | 'angle' | 'grid';

export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
  /** The cursor is on the outline's first corner, so a click closes the ring */
  closesRing: boolean;
  /** Distance from the anchor in mm, for the live length readout */
  lengthMM: number;
}

export interface SnapOptions {
  /** Previous corner, if any — the anchor for angle and length snapping */
  anchor: Vec2 | null;
  /** Corners the cursor can latch onto; index 0 closes the ring */
  vertices: Vec2[];
  gridMM: number;
  /** Shift held: keep the grid, drop the angle constraint */
  freeAngle: boolean;
  /** Canvas scale (px per mm) so pixel thresholds stay constant on screen */
  scale: number;
  /** When set, the segment length is locked and only the direction follows */
  lockedLengthMM?: number | null;
}

const roundTo = (value: number, step: number) =>
  step > 0 ? Math.round(value / step) * step : value;

/**
 * Trig on a snapped 45° angle leaves dust — cos(π/2) is 6e-17, not 0, so a
 * corner comes out at 2999.9999999999995 instead of 3000. Round to a
 * micrometre: far finer than any tile tolerance, and it keeps wall lengths and
 * corner coordinates exact, which is what the clipper wants when a tile edge
 * lands on a wall.
 */
const clean = (value: number) => Math.round(value * 1e6) / 1e6;

/** Snap a raw mm-space cursor position into a drawable point. */
export function snapPoint(raw: Vec2, options: SnapOptions): SnapResult {
  const { anchor, vertices, gridMM, freeAngle, scale, lockedLengthMM } = options;
  const vertexThreshold = VERTEX_SNAP_PX / Math.max(scale, 1e-9);
  const angleThreshold = ANGLE_SNAP_PX / Math.max(scale, 1e-9);

  const lengthFrom = (pt: Vec2) =>
    anchor ? Math.hypot(pt.x - anchor.x, pt.y - anchor.y) : 0;

  // 1. Existing corners win — this is how the outline gets closed cleanly.
  if (!lockedLengthMM) {
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      if (Math.hypot(raw.x - v.x, raw.y - v.y) <= vertexThreshold) {
        return {
          point: { ...v },
          kind: 'corner',
          closesRing: i === 0 && vertices.length >= 3,
          lengthMM: lengthFrom(v),
        };
      }
    }
  }

  // 2. Without an anchor there is no direction to constrain — grid only.
  if (!anchor) {
    const point = { x: clean(roundTo(raw.x, gridMM)), y: clean(roundTo(raw.y, gridMM)) };
    return { point, kind: 'grid', closesRing: false, lengthMM: 0 };
  }

  const dx = raw.x - anchor.x;
  const dy = raw.y - anchor.y;
  const rawLength = Math.hypot(dx, dy);
  const rawAngle = Math.atan2(dy, dx);

  // 3. Lock the direction to the nearest 45° unless Shift says otherwise.
  const step = Math.PI / 4;
  const snappedAngle = Math.round(rawAngle / step) * step;
  const offAxis = Math.abs(
    rawLength * Math.sin(Math.abs(rawAngle - snappedAngle))
  );
  const useAngle = !freeAngle && (offAxis <= angleThreshold || rawLength < 1e-9);
  const angle = useAngle ? snappedAngle : rawAngle;

  // 4. Length: locked by typed input, else the projection rounded to the grid.
  const projected = useAngle ? rawLength * Math.cos(rawAngle - snappedAngle) : rawLength;
  const length =
    lockedLengthMM != null
      ? lockedLengthMM
      : Math.max(0, roundTo(projected, gridMM));

  return {
    point: {
      x: clean(anchor.x + Math.cos(angle) * length),
      y: clean(anchor.y + Math.sin(angle) * length),
    },
    kind: useAngle ? 'angle' : 'grid',
    closesRing: false,
    lengthMM: length,
  };
}
