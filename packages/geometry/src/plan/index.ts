/**
 * Floor plans: walls with real build-ups, and the rooms they enclose.
 * Everything here feeds the existing tile engine through `toLayoutRoom`.
 */

export * from './assemblies';
export {
  faceOffsets,
  layerBoundaries,
  locationLineShift,
  isValidAssembly,
  wallGeometry,
  wallLength,
  type FaceLevel,
  type FaceOffsets,
  type WallSolid,
  type WallGeometry,
} from './walls';
export { deriveFloors, regionAt, interiorPoint, type DerivedFloors } from './derive';
export * from './edit';
export { toLayoutRoom, planFromRoom, type LayoutRoom, type RoomTileSettings } from './adapter';
export {
  groupFrame,
  localFrame,
  layoutGroup,
  optimizeGroup,
  type GroupLayoutResult,
} from './group';
