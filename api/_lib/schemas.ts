/**
 * Structured-output schemas: the shape we ASK the model for, paired with the
 * shape we actually TRUST.
 *
 * `response_format.schema` constrains the model; it does not bind it. So every
 * structured route declares a pair — a JSON Schema sent to Gemini, and a Zod
 * mirror that validates what actually came back. The two are always edited
 * together (Constitution VI), and the mirror is deliberately the stricter of
 * the two: the JSON Schema asks for "an array of points", the mirror caps it at
 * 60 so a runaway generation cannot become a room with 5,000 corners.
 *
 * Feature specs add their own pairs here. This file owns the convention and the
 * shared parsing path, so all four features fail identically on bad output.
 *
 * ── The convention, worked ───────────────────────────────────────────────────
 *
 *   const OUT = z.object({ confidence: z.number().min(0).max(1) });
 *
 *   export const EXAMPLE = schemaPair('example', {
 *     type: 'object',
 *     properties: { confidence: { type: 'number' } },
 *     required: ['confidence'],
 *   }, OUT);
 *
 *   // in the handler
 *   const interaction = await getClient().interactions.create({
 *     model: modelFor('fast'),
 *     system_instruction: systemInstruction('brief'),
 *     input: facts,
 *     response_format: responseFormat(EXAMPLE),
 *   });
 *   const result = parseModelJson(EXAMPLE, interaction.output_text);
 */

import { z, ZodError, type ZodType } from 'zod';
import { ApiError } from './http.js';
import type {
  AssistantMessageRequestDTO,
  AssistantResultsRequestDTO,
  LayoutStatsDTO,
  RoomFromImageDTO,
  RoomFromImageRequestDTO,
} from './types.js';

// ─── Pairing ──────────────────────────────────────────────────────────────────

export interface SchemaPair<T> {
  /** Used in server-side logs to say which schema rejected the output. */
  name: string;
  /** Sent as `response_format.schema` — what the model is asked for. */
  jsonSchema: Record<string, unknown>;
  /** What we trust. Stricter than `jsonSchema` on purpose. */
  out: ZodType<T>;
}

export function schemaPair<T>(
  name: string,
  jsonSchema: Record<string, unknown>,
  out: ZodType<T>
): SchemaPair<T> {
  return { name, jsonSchema, out };
}

/**
 * The `response_format` argument for `interactions.create`.
 *
 * Field names verified against @google/genai@2.21.0 (`TextResponseFormat`):
 * `{ type: 'text', mime_type, schema }`. Note the SDK also exposes a top-level
 * `response_mime_type`, which is deprecated — the mime type belongs inside
 * `response_format`.
 */
export function responseFormat<T>(pair: SchemaPair<T>) {
  return {
    type: 'text' as const,
    mime_type: 'application/json',
    schema: pair.jsonSchema,
  };
}

// ─── Parsing model output ─────────────────────────────────────────────────────

/**
 * Turn `interaction.output_text` into a trusted value, or fail.
 *
 * Every failure here is `upstream` (502), never `internal` (500): the model
 * returning something unusable is an expected condition, not a bug in us, and
 * the client's retry affordance is the right response. The offending text is
 * logged and never returned — it can quote our own prompt back at us.
 */
export function parseModelJson<T>(pair: SchemaPair<T>, text: string | undefined | null): T {
  if (!text?.trim()) {
    throw new ApiError('upstream', `Model returned no text for ${pair.name}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError('upstream', `Model output for ${pair.name} was not JSON`, {
      // Bounded: enough to diagnose, not enough to fill a log line with a novel.
      sample: text.slice(0, 400),
    });
  }

  try {
    return pair.out.parse(parsed);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ApiError('upstream', `Model output for ${pair.name} failed its schema`, {
        issues: err.issues,
      });
    }
    throw err;
  }
}

// ─── Feature pairs ────────────────────────────────────────────────────────────
//
// Added by the spec that owns each feature, alongside its prompt:
//   002-photo-to-room / T1   ROOM_FROM_IMAGE
//   003-layout-assistant     (tool calling — no response_format)
//   004-installation-brief   (streamed prose — no response_format)
//   005-cost-estimator / T1  ESTIMATE

// ─── 002 · room-from-image ────────────────────────────────────────────────────

/**
 * The formats Gemini accepts as image input. HEIC/HEIF are listed because a
 * phone photo arrives as one, but the client re-encodes to JPEG before sending
 * (AC-1.2) — so in practice only `image/jpeg` reaches this route.
 */
export const ROOM_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

/**
 * Standard base64, no `data:` URI prefix and no whitespace. Anchored and built
 * from a single character class, so it cannot backtrack on a multi-megabyte
 * string.
 */
const BASE64_ONLY = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Matches the route's `readJson` cap. `readJson` rejects an oversized body
 * before Zod ever runs; this bound is the second line, for a body that is
 * within the cap but spends all of it on one field.
 */
const MAX_IMAGE_BASE64 = 4_000_000;

/** Request body for `POST /api/ai/room-from-image`. */
export const RoomFromImageIn = z.object({
  imageBase64: z
    .string()
    .min(1)
    .max(MAX_IMAGE_BASE64)
    .regex(BASE64_ONLY, 'imageBase64 must be bare base64 with no data: URI prefix'),
  mimeType: z.enum(ROOM_IMAGE_MIME_TYPES),
  /** Only affects how `notes` is phrased — never the units, which are always mm. */
  system: z.enum(['metric', 'imperial']),
  note: z.string().max(300).optional(),
});

export type RoomFromImageInput = z.infer<typeof RoomFromImageIn>;

/**
 * What we ask Gemini for. Kept deliberately loose: `response_format` constrains
 * generation, and over-specifying it buys nothing the mirror below does not
 * enforce properly.
 */
export const ROOM_FROM_IMAGE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    boundary: {
      type: 'array',
      description: 'Room outline, clockwise, in millimetres. 3 to 60 points.',
      items: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' } },
        required: ['x', 'y'],
      },
    },
    holes: {
      type: 'array',
      description: 'Untiled cut-outs (islands, columns, stair openings). Empty when there are none.',
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' } },
          required: ['x', 'y'],
        },
      },
    },
    confidence: { type: 'number', description: '0 to 1. 0 means this is not a floor plan.' },
    notes: { type: 'string', description: 'Which labels or assumptions produced the scale.' },
    detectedSystem: { type: 'string', enum: ['metric', 'imperial', 'unknown'] },
  },
  required: ['boundary', 'holes', 'confidence', 'notes', 'detectedSystem'],
};

/**
 * Coordinate bound, mirroring `PointSchema` in `server/src/validation.ts`. A
 * plan is a room, not a county: anything outside this is a scale blunder by
 * three orders of magnitude, not a big house.
 */
const MAX_COORD_MM = 1_000_000;

/**
 * Largest room the save endpoint will accept (`RoomSchema.width/height` max in
 * `server/src/validation.ts`). Checked against the outline's bounding box below.
 */
const MAX_ROOM_EXTENT_MM = 100_000;

const Pt = z.object({
  x: z.number().finite().min(-MAX_COORD_MM).max(MAX_COORD_MM),
  y: z.number().finite().min(-MAX_COORD_MM).max(MAX_COORD_MM),
});

/**
 * What we trust. Stricter than the JSON Schema in every dimension that matters,
 * and stricter again than `server/src/validation.ts` (≤500 boundary vertices,
 * ≤50 holes) so an accepted proposal can never become a room the save endpoint
 * would later reject.
 */
export const RoomFromImageOut = z
  .object({
    boundary: z.array(Pt).min(3).max(60),
    holes: z.array(z.array(Pt).min(3).max(40)).max(10),
    confidence: z.number().min(0).max(1),
    notes: z.string().max(400),
    detectedSystem: z.enum(['metric', 'imperial', 'unknown']),
  })
  // Per-point bounds do not constrain the outline's *extent*: two in-range
  // points 1.9 km apart would pass and then normalize into an unsaveable room.
  // The bounding box is what `normalizeShape` turns into width/height, so it is
  // the thing to bound (T1).
  .superRefine((value, ctx) => {
    const points = [...value.boundary, ...value.holes.flat()];
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);

    if (width > MAX_ROOM_EXTENT_MM || height > MAX_ROOM_EXTENT_MM) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Outline spans ${Math.round(width)}×${Math.round(height)} mm, over the ${MAX_ROOM_EXTENT_MM} mm limit`,
      });
    }
  });

export const ROOM_FROM_IMAGE = schemaPair(
  'room-from-image',
  ROOM_FROM_IMAGE_JSON_SCHEMA,
  RoomFromImageOut
);

/**
 * Compile-time proof that the mirror and the DTO the client reads cannot drift
 * apart. `types.ts` owns the wire shape; this is the only place that shape and
 * its validator meet, so a field added to one and not the other fails here
 * rather than at runtime in a browser.
 */
type RequestMatchesDto =
  z.infer<typeof RoomFromImageIn> extends RoomFromImageRequestDTO
    ? RoomFromImageRequestDTO extends z.infer<typeof RoomFromImageIn>
      ? true
      : never
    : never;
const REQUEST_MATCHES_DTO: RequestMatchesDto = true;
void REQUEST_MATCHES_DTO;

type MirrorMatchesDto =
  z.infer<typeof RoomFromImageOut> extends Omit<RoomFromImageDTO, 'demoMode'>
    ? Omit<RoomFromImageDTO, 'demoMode'> extends z.infer<typeof RoomFromImageOut>
      ? true
      : never
    : never;
const MIRROR_MATCHES_DTO: MirrorMatchesDto = true;
void MIRROR_MATCHES_DTO;

// ─── Shared · the layout snapshot ─────────────────────────────────────────────

/**
 * The grounding payload as it arrives over the wire. It comes from our own
 * client, but on a public route "our own client" is anyone with curl — and every
 * figure in it may be quoted to the user — so it is bounded like any other
 * input: finite, non-negative, and short strings only.
 */
const MM = z.number().finite().min(0).max(1e9);
const COUNT = z.number().int().min(0).max(1e7);

export const LayoutStatsIn = z.object({
  system: z.enum(['metric', 'imperial']),
  room: z.object({
    widthMm: MM,
    heightMm: MM,
    areaMm2: z.number().finite().min(0).max(1e15),
    perimeterMm: MM,
    wallCount: COUNT,
    holeCount: COUNT,
    referenceWall: z.number().int().min(0).nullable(),
    isDrawn: z.boolean(),
  }),
  tile: z.object({
    widthMm: MM,
    heightMm: MM,
    groutMm: MM,
    pattern: z.string().max(32),
    alignment: z.string().max(32),
  }),
  layout: z.object({
    fullTileCount: COUNT,
    cutTileCount: COUNT,
    totalTiles: COUNT,
    wastePercentage: z.number().finite().min(0).max(100),
    smallestCutPieceMm2: z.number().finite().min(0).max(1e15),
    roomAreaMm2: z.number().finite().min(0).max(1e15),
    orderQuantity: COUNT,
  }),
});

type SnapshotMatchesDto =
  z.infer<typeof LayoutStatsIn> extends LayoutStatsDTO
    ? LayoutStatsDTO extends z.infer<typeof LayoutStatsIn>
      ? true
      : never
    : never;
const SNAPSHOT_MATCHES_DTO: SnapshotMatchesDto = true;
void SNAPSHOT_MATCHES_DTO;

// ─── 003 · assistant ──────────────────────────────────────────────────────────
//
// No response pair: the assistant uses tool calling, not `response_format`.
// Its output is free prose plus `function_call` steps, and the calls are
// validated per tool on the client (`client/src/ai/tools.ts`) — the only place
// that knows each tool's bounds as the store enforces them.

/** Most round-trips one user message may take before the loop stops (AC-3.5). */
export const ASSISTANT_MAX_ROUND_TRIPS = 4;

/**
 * Interaction ids are opaque provider tokens. Bounded and charset-limited only
 * so a caller cannot use the field to smuggle a novel into our request.
 */
const INTERACTION_ID = z.string().min(1).max(256).regex(/^[A-Za-z0-9_.:\/-]+$/);

export const AssistantMessageIn = z.object({
  message: z.string().trim().min(1).max(2000),
  snapshot: LayoutStatsIn,
  previousInteractionId: INTERACTION_ID.optional(),
});

/**
 * One tool's outcome. `result` is serialised for the model and never read
 * here; the whole body is capped at 32 KB by `readJson`, which bounds it.
 */
const ToolResultIn = z.object({
  callId: z.string().min(1).max(256),
  name: z.string().min(1).max(64),
  result: z.record(z.unknown()),
});

export const AssistantResultsIn = z.object({
  // A model turn that requests more calls than this is not a turn we serve.
  results: z.array(ToolResultIn).min(1).max(16),
  snapshot: LayoutStatsIn,
  previousInteractionId: INTERACTION_ID,
  roundTrip: z.number().int().min(2).max(ASSISTANT_MAX_ROUND_TRIPS),
});

/**
 * Discriminated by which key is present rather than a tag field, matching the
 * two request shapes in the design. `strict()` on each so a body carrying both
 * `message` and `results` is rejected rather than silently read as one.
 */
export const AssistantIn = z.union([AssistantMessageIn.strict(), AssistantResultsIn.strict()]);

type MessageMatchesDto =
  z.infer<typeof AssistantMessageIn> extends AssistantMessageRequestDTO
    ? AssistantMessageRequestDTO extends z.infer<typeof AssistantMessageIn>
      ? true
      : never
    : never;
const MESSAGE_MATCHES_DTO: MessageMatchesDto = true;
void MESSAGE_MATCHES_DTO;

type ResultsMatchDto =
  z.infer<typeof AssistantResultsIn> extends AssistantResultsRequestDTO
    ? AssistantResultsRequestDTO extends z.infer<typeof AssistantResultsIn>
      ? true
      : never
    : never;
const RESULTS_MATCH_DTO: ResultsMatchDto = true;
void RESULTS_MATCH_DTO;
