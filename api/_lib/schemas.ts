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

import { ZodError, type ZodType } from 'zod';
import { ApiError } from './http.js';

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
