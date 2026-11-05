/**
 * Wall framing (009): studs, plates, openings and junction backing, derived
 * from the plan, plus the takeoff that sums them.
 */
export * from './defaults';
export { frameWalls, resolveJunctions, layoutMarks, openingProblem, type Junction } from './frame';
export {
  takeoff,
  packPlates,
  type Takeoff,
  type TakeoffOptions,
  type LumberRow,
  type PlateStock,
  type SheetRow,
} from './takeoff';
export { openingFootprints, cutOpenings, studFootprints, type OpeningFootprint } from './planView';
