import { z } from 'zod';

export const PatternSchema = z.enum([
  'grid',
  'offset-1/2',
  'offset-1/3',
  'herringbone',
  'diagonal-45',
]);

/** A drawn outline. Vertex counts are capped so a bad payload can't blow up. */
const PointSchema = z.object({
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
});

const PolygonSchema = z.object({
  vertices: z.array(PointSchema).min(3).max(500),
});

export const RoomShapeSchema = z.object({
  boundary: PolygonSchema,
  holes: z.array(PolygonSchema).max(50).default([]),
  referenceWall: z.number().int().min(0).max(499).optional(),
});

export const RoomSchema = z.object({
  width: z.number().positive().max(100000),
  height: z.number().positive().max(100000),
  unit: z.enum(['mm', 'cm', 'm', 'inches', 'feet']).default('mm'),
  /** Omitted for a plain rectangular room */
  shape: RoomShapeSchema.nullish(),
});

export const TileConfigSchema = z.object({
  width: z.number().positive().max(10000),
  height: z.number().positive().max(10000),
  grout: z.number().min(0).max(100).default(3.0),
  pattern: PatternSchema.default('grid'),
  alpha: z.number().min(0).max(1).default(0.7),
  beta: z.number().min(0).max(1).default(0.3),
});

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  room: RoomSchema,
  tileConfig: TileConfigSchema,
});

export const UpdateProjectSchema = CreateProjectSchema.partial();

export const SaveLayoutSchema = z.object({
  layoutData: z.any(),
  configData: z.any(),
  score: z.number(),
  label: z.string().optional(),
});
