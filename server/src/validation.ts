import { z } from 'zod';

export const PatternSchema = z.enum([
  'grid',
  'offset-1/2',
  'offset-1/3',
  'herringbone',
  'diagonal-45',
]);

export const RoomSchema = z.object({
  width: z.number().positive().max(100000),
  height: z.number().positive().max(100000),
  unit: z.enum(['mm', 'cm', 'm', 'inches', 'feet']).default('mm'),
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
