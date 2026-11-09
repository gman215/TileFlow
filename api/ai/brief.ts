/**
 * POST /api/ai/brief
 *
 * Engine figures in, a streamed setting-out brief out (004). The model receives
 * numbers and returns prose; it never returns a number that was not in its
 * input (Constitution I). Every figure arrives pre-formatted from the client,
 * and every yes/no judgement that rests on arithmetic — sliver, herringbone fit
 * — arrives already decided, so the model has nothing to compute.
 *
 * The response is UTF-8 text streamed as the model writes it (AC-3.1). Errors
 * before the first byte are ordinary JSON errors with a status; a failure after
 * it aborts the stream rather than splicing an error message into the brief, so
 * the client keeps what arrived and labels it incomplete (AC-3.4).
 */

import type { Interactions } from '@google/genai';
import { ApiError, methodGuard, readJson, toResponse } from '../_lib/http.js';
import { getClient, isProviderExhausted, modelFor, timeoutSignal, TIMEOUT_MS } from '../_lib/genai.js';
import {
  budgetExhausted,
  checkRateLimit,
  noteModelCall,
  noteProviderExhausted,
} from '../_lib/guard.js';
import { systemInstruction } from '../_lib/prompts.js';
import { BriefIn, type BriefInput } from '../_lib/schemas.js';

const ROUTE = 'brief';

/** Stats plus formatted strings are a couple of KB; 32 KB is generous. */
const MAX_BODY_BYTES = 32 * 1024;

/** Set on a canned brief, so the client can label it (AC-4.6). */
export const DEMO_HEADER = 'X-Demo-Mode';

/**
 * Served when a real call cannot be made — budget spent, or the provider has
 * refused (Constitution VII). It contains **no figures**: any number in a canned
 * brief would be a number the engine did not compute for this layout, which is
 * exactly what this feature exists to rule out. It shows the shape of a brief,
 * labelled, and points at the stats card for the numbers.
 */
export const DEMO_BRIEF = `## Setting out
Example brief — live AI is unavailable right now, so this one was not written for your layout.
Strike a first line from the anchor the layout uses — the room centre, or the midpoint of the
reference wall when one is set — and lay out from it towards the walls.

## Cut list
Full tiles fill the middle; cut tiles run around the perimeter and any cut-outs. Your counts are
on the stats card.

## Watch out for
- Dry-lay the first rows before mixing adhesive, and check the cuts at the walls.
- Keep the grout joint consistent with spacers.

## Ordering
The order figure on the stats card already includes 10% for breakage, future repairs and matching
the dye lot.
`;

function textResponse(body: BodyInit, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      // Stops a buffering proxy holding the stream back until it completes.
      'X-Accel-Buffering': 'no',
      ...extra,
    },
  });
}

/**
 * Same test as the amber warning in `TilePanel.tsx`: herringbone fits when the
 * long side plus grout is twice the short side plus grout, within 5%. Decided
 * here, by code, so the brief and the sidebar cannot disagree and the model is
 * never asked to judge a ratio (Constitution I).
 */
export function herringboneMismatch(tile: BriefInput['stats']['tile']): boolean {
  if (tile.pattern !== 'herringbone') return false;
  const effLong = Math.max(tile.widthMm, tile.heightMm) + tile.groutMm;
  const effShort = Math.min(tile.widthMm, tile.heightMm) + tile.groutMm;
  return Math.abs(effLong - 2 * effShort) > effShort * 0.05;
}

/**
 * What the model reads: display strings and decided facts. Raw millimetre
 * fields are deliberately left out — a model that can see 609.6 will sooner
 * or later say it (the lesson of 003's ASSISTANT_V1).
 */
export function briefFacts(body: BriefInput) {
  return {
    figures: body.formatted,
    alignmentMode: body.stats.tile.alignment,
    sliverRisk: body.sliverRisk,
    sliverThreshold: body.sliverThreshold,
    herringboneMismatch: herringboneMismatch(body.stats.tile),
    isDrawn: body.stats.room.isDrawn,
  };
}

/** Text deltas only — thought summaries and other step kinds are not the brief. */
function textOf(event: Interactions.InteractionSSEEvent): string | null {
  if (event.event_type !== 'step.delta') return null;
  return event.delta.type === 'text' ? event.delta.text : null;
}

export async function POST(request: Request): Promise<Response> {
  const wrongMethod = methodGuard(request, 'POST');
  if (wrongMethod) return wrongMethod;

  try {
    const body = await readJson(request, BriefIn, MAX_BODY_BYTES);
    checkRateLimit(request, ROUTE);
    if (budgetExhausted()) return textResponse(DEMO_BRIEF, { [DEMO_HEADER]: 'true' });

    // Before budget is spent, and outside the try below: an unwritten prompt is
    // a `config` failure (503), not an upstream one (see 003's assistant route).
    const instruction = systemInstruction(ROUTE);
    const client = getClient();
    noteModelCall();

    // One controller for the upstream call: the timeout, and the client going
    // away (the drawer closed) both stop it, so an abandoned brief stops
    // spending tokens.
    const upstream = new AbortController();
    const timeout = timeoutSignal(TIMEOUT_MS.streaming);
    const stop = () => upstream.abort();
    timeout.addEventListener('abort', stop, { once: true });
    request.signal?.addEventListener('abort', stop, { once: true });

    let events: AsyncIterable<Interactions.InteractionSSEEvent>;
    try {
      events = await client.interactions.create(
        {
          model: modelFor('fast'),
          system_instruction: instruction,
          input: JSON.stringify(briefFacts(body)),
          stream: true,
        },
        { fetchOptions: { signal: upstream.signal } }
      );
    } catch (err) {
      if (isProviderExhausted(err)) {
        console.error(`[api/ai] ${ROUTE}: provider refused, serving demo content:`, err);
        noteProviderExhausted();
        return textResponse(DEMO_BRIEF, { [DEMO_HEADER]: 'true' });
      }
      throw new ApiError('upstream', `Gemini call failed for ${ROUTE}`, err);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let completed = false;
        try {
          for await (const event of events) {
            const text = textOf(event);
            if (text) controller.enqueue(encoder.encode(text));
            if (event.event_type === 'interaction.completed') completed = true;
            if (event.event_type === 'error') throw new Error('Gemini stream reported an error');
          }
          // An iterator that simply runs out without completing is a broken
          // stream too; closing it cleanly would pass a truncated brief off as
          // a finished one.
          if (!completed) throw new Error('Gemini stream ended without completing');
          controller.close();
        } catch (err) {
          // Logged in full here, never written into the brief (Constitution III).
          console.error(`[api/ai] ${ROUTE}: stream failed after first byte:`, err);
          controller.error(err);
        } finally {
          timeout.removeEventListener('abort', stop);
          request.signal?.removeEventListener('abort', stop);
        }
      },
      cancel() {
        upstream.abort();
      },
    });

    return textResponse(stream);
  } catch (err) {
    return toResponse(err);
  }
}

