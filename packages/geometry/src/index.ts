/**
 * TileFlow Geometry Engine
 *
 * Pure TypeScript geometry library — framework-independent.
 * Can be used in browser, Web Worker, or Node.js.
 */

// Types
export * from './types';

// Utilities
export * from './utils';

// Clipping
export {
  clipPolygon,
  clipTileToRoom,
  clipTileToShape,
  prepareClipShape,
  analyzeTile,
  type ClipShape,
  type ShapeClipResult,
} from './clipping';

// Patterns
export {
  generateTiles,
  getPatternUnit,
  computeAlignmentOffset,
  type PatternGeneratorParams,
} from './patterns';

// Shape editing
export {
  wallsOf,
  setWallLength,
  moveVertex,
  insertVertex,
  deleteVertex,
  isSelfIntersecting,
  validateShape,
  summarizeShape,
  withShapeEdit,
  patternFrameFor,
  type Wall,
  type ShapeIssue,
  type ShapeSummary,
} from './shape';

// Optimization
export {
  computeLayout,
  optimize,
  type OptimizationResult,
} from './optimization';
