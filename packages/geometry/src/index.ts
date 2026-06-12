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
  analyzeTile,
} from './clipping';

// Patterns
export {
  generateTiles,
  getPatternUnit,
  computeAlignmentOffset,
  type PatternGeneratorParams,
} from './patterns';

// Optimization
export {
  computeLayout,
  optimize,
  type OptimizationResult,
} from './optimization';
