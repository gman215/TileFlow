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

/** What a fixed layout is set out from (011): a cut-out's centre or edge, or a point. */
const PointAnchorSchema = z.object({ kind: z.literal('point'), at: PointSchema });
export const AnchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hole-centre'), hole: z.number().int().min(0).max(49) }),
  z.object({
    kind: z.literal('hole-edge'),
    hole: z.number().int().min(0).max(49),
    edge: z.number().int().min(0).max(499),
    fullTilesFromEdge: z.boolean().optional(),
  }),
  PointAnchorSchema,
]);

export const RoomShapeSchema = z.object({
  boundary: PolygonSchema,
  holes: z.array(PolygonSchema).max(50).default([]),
  referenceWall: z.number().int().min(0).max(499).optional(),
  anchor: AnchorSchema.optional(),
});

export const RoomSchema = z.object({
  width: z.number().positive().max(100000),
  height: z.number().positive().max(100000),
  unit: z.enum(['mm', 'cm', 'm', 'inches', 'feet']).default('mm'),
  /** Omitted for a plain rectangular room */
  shape: RoomShapeSchema.nullish(),
  /** A point anchor on a plain rectangle (011); null clears it */
  anchor: PointAnchorSchema.nullish(),
});

export const TileConfigSchema = z.object({
  width: z.number().positive().max(10000),
  height: z.number().positive().max(10000),
  grout: z.number().min(0).max(100).default(3.0),
  pattern: PatternSchema.default('grid'),
  alpha: z.number().min(0).max(1).default(0.7),
  beta: z.number().min(0).max(1).default(0.3),
  alignment: z.enum(['optimize', 'center-tile', 'center-grout']).default('optimize'),
});

// ─── Floor plan (008) ─────────────────────────────────────────────────────────

const Id = z.string().min(1).max(40);

const PlanTileSchema = z.object({
  width: z.number().positive().max(10000),
  height: z.number().positive().max(10000),
  grout: z.number().min(0).max(100),
  pattern: PatternSchema,
});

const AlignmentSchema = z.enum(['optimize', 'center-tile', 'center-grout']);
const WeightsSchema = z.object({ alpha: z.number().min(0).max(1), beta: z.number().min(0).max(1) });

const LayerSchema = z.object({
  material: z.string().max(60),
  thickness: z.number().finite().min(0).max(1000),
  function: z.enum(['finish', 'substrate', 'core', 'sheathing', 'air']),
});

const AssemblySchema = z
  .object({
    id: Id,
    name: z.string().min(1).max(60),
    layers: z.array(LayerSchema).min(1).max(12),
    framing: z
      .object({ studWidth: z.number().positive().max(1000), studDepth: z.number().positive().max(1000) })
      .optional(),
  })
  .refine((a) => a.layers.filter((l) => l.function === 'core').length === 1, {
    message: 'An assembly needs exactly one core layer',
  });

/**
 * A floor plan. Only the inputs are stored — rooms are derived from the walls
 * on load, so there is no geometry here that could disagree with them.
 * Every reference is checked, so a plan that names a missing node or
 * build-up is a 400 rather than a project that cannot be opened.
 */
const FramingSchema = z.object({
  framedHeight: z.number().positive().max(10000),
  spacing: z.number().positive().max(2000),
  layoutFrom: z.enum(['a', 'b']),
  topPlates: z.union([z.literal(1), z.literal(2)]),
  loadBearing: z.boolean().optional(),
});

const OpeningSchema = z.object({
  id: Id,
  wallId: Id,
  kind: z.enum(['door', 'window', 'cased-opening']),
  center: z.number().finite().min(-100000).max(100000),
  roughWidth: z.number().positive().max(10000),
  roughHeight: z.number().positive().max(10000),
  sillHeight: z.number().min(0).max(10000).optional(),
  floorTransition: z.enum(['centerline', 'through', 'room-side']).optional(),
  side: z.enum(['left', 'right']).optional(),
});

export const PlanSchema = z
  .object({
    /** 1 = 008 (no framing), 2 = 009. The client upgrades a v1 plan on load. */
    version: z.union([z.literal(1), z.literal(2)]),
    framingDefaults: FramingSchema.optional(),
    openings: z.array(OpeningSchema).max(500).default([]),
    junctions: z
      .array(
        z.object({
          nodeId: Id,
          throughWallId: Id.optional(),
          corner: z.enum(['three-stud', 'california']).optional(),
          partition: z.enum(['post', 'ladder']).optional(),
        })
      )
      .max(1000)
      .default([]),
    headerRules: z
      .array(
        z.object({
          loadBearing: z.boolean(),
          maxSpan: z.number().positive().max(1_000_000),
          member: z.string().min(1).max(40),
          plies: z.number().int().min(1).max(4),
          depth: z.number().positive().max(1000),
        })
      )
      .max(20)
      .optional(),
    nodes: z.array(z.object({ id: Id, position: PointSchema })).max(1000),
    walls: z
      .array(
        z.object({
          id: Id,
          a: Id,
          b: Id,
          assemblyId: Id,
          locationLine: z.enum(['centerline', 'core-center', 'finish-left', 'finish-right', 'core-left', 'core-right']),
          flipped: z.boolean().optional(),
          framing: FramingSchema.partial().optional(),
        })
      )
      .max(1500),
    assemblies: z.array(AssemblySchema).max(50),
    rooms: z
      .array(
        z.object({
          id: Id,
          name: z.string().min(1).max(60),
          seed: PointSchema,
          holes: z.array(PolygonSchema).max(50),
          expansionGap: z.number().min(0).max(20),
          referenceWallId: Id.optional(),
          anchor: AnchorSchema.optional(),
          tileConfig: PlanTileSchema,
          alignment: AlignmentSchema,
          weights: WeightsSchema,
          groupId: Id.optional(),
        })
      )
      .max(100),
    groups: z
      .array(
        z.object({
          id: Id,
          roomIds: z.array(Id).min(2).max(100),
          tileConfig: PlanTileSchema,
          alignment: AlignmentSchema,
          weights: WeightsSchema,
          referenceWallId: Id.optional(),
        })
      )
      .max(50),
  })
  .superRefine((plan, ctx) => {
    const nodes = new Set(plan.nodes.map((n) => n.id));
    const assemblies = new Set(plan.assemblies.map((a) => a.id));
    const rooms = new Set(plan.rooms.map((r) => r.id));
    const groups = new Set(plan.groups.map((g) => g.id));
    plan.walls.forEach((w, i) => {
      if (!nodes.has(w.a) || !nodes.has(w.b)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['walls', i], message: 'Wall refers to a missing node' });
      }
      if (!assemblies.has(w.assemblyId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['walls', i], message: 'Wall refers to a missing assembly' });
      }
    });
    plan.rooms.forEach((r, i) => {
      if (r.groupId && !groups.has(r.groupId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rooms', i], message: 'Room refers to a missing group' });
      }
    });
    plan.groups.forEach((g, i) => {
      if (g.roomIds.some((id) => !rooms.has(id))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['groups', i], message: 'Group refers to a missing room' });
      }
    });
    const walls = new Set(plan.walls.map((w) => w.id));
    const perWall = new Map<string, number>();
    plan.openings.forEach((o, i) => {
      if (!walls.has(o.wallId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['openings', i], message: 'Opening refers to a missing wall' });
      }
      perWall.set(o.wallId, (perWall.get(o.wallId) ?? 0) + 1);
    });
    for (const [wallId, n] of perWall) {
      if (n > 20) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['openings'], message: `More than 20 openings on wall ${wallId}` });
      }
    }
  });

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  room: RoomSchema,
  tileConfig: TileConfigSchema,
  /** Omitted or null for a single-room project */
  plan: PlanSchema.nullish(),
  /** 012 — pieces per box, keyed by tile product ("300x600"); null clears */
  boxes: z
    .record(z.string().regex(/^\d+(\.\d)?x\d+(\.\d)?$/), z.number().int().min(1).max(10000))
    .refine((r) => Object.keys(r).length <= 50, 'At most 50 box sizes')
    .nullish(),
});

export const UpdateProjectSchema = CreateProjectSchema.partial();

export const SaveLayoutSchema = z.object({
  layoutData: z.any(),
  configData: z.any(),
  score: z.number(),
  label: z.string().optional(),
});
