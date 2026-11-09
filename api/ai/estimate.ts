/**
 * POST /api/ai/estimate
 *
 * A materials and labour takeoff as **quantities and unit rates** (005). The
 * model supplies domain knowledge — coverage rates, rules of thumb, labour by
 * pattern — and nothing else: the response schema has no subtotal and no total
 * field, and the client multiplies and sums (Constitution I). The two quantities
 * the engine owns, tile order and room area, are echoed by the model and
 * overridden client-side whatever comes back.
 *
 * Nothing here touches application state or the project database: prices are
 * session-only, and the estimate is never persisted (AC-3.4).
 */

import { ApiError, json, methodGuard, readJson, toResponse } from '../_lib/http.js';
import { getClient, isProviderExhausted, modelFor, timeoutSignal, TIMEOUT_MS } from '../_lib/genai.js';
import {
  budgetExhausted,
  checkRateLimit,
  noteModelCall,
  noteProviderExhausted,
} from '../_lib/guard.js';
import { systemInstruction } from '../_lib/prompts.js';
import { ESTIMATE, EstimateIn, parseModelJson, responseFormat, type EstimateInput } from '../_lib/schemas.js';
import type { EstimateDTO } from '../_lib/types.js';

const ROUTE = 'estimate';

/** Stats, display strings and five prices: a few KB. */
const MAX_BODY_BYTES = 32 * 1024;

/**
 * Served when a real call cannot be made (Constitution VII). It holds only the
 * lines whose quantities the engine owns and the request already carries — an
 * invented adhesive weight or labour figure, for a layout no model looked at,
 * would put a made-up number on screen. Unit costs are the user's, or zero.
 */
export function demoEstimate(body: EstimateInput): EstimateDTO {
  const { engine, prices } = body;
  return {
    lineItems: [
      {
        item: 'Tile',
        category: 'tile',
        quantity: engine.orderQuantity,
        unit: 'tiles',
        unitCost: prices.tileUnit === 'tile' ? prices.tile ?? 0 : 0,
        basis: 'Order quantity from the layout engine, including 10%.',
        source: 'engine',
      },
      {
        item: 'Underlayment',
        category: 'other',
        quantity: engine.roomArea,
        unit: engine.areaUnit,
        unitCost: 0,
        basis: 'Floor area from the layout engine.',
        source: 'engine',
      },
    ],
    assumptions: [
      'Example estimate — live AI is unavailable right now, so adhesive, grout and labour were not estimated.',
    ],
    confidence: 0.3,
    notes: '',
    demoMode: true,
  };
}

/** What the model reads: display strings, the engine quantities to echo, and the user's prices. */
export function estimateFacts(body: EstimateInput) {
  return {
    figures: body.formatted,
    engine: body.engine,
    holeCount: body.stats.room.holeCount,
    isDrawn: body.stats.room.isDrawn,
    prices: body.prices,
    currency: body.currency,
    system: body.system,
  };
}

export async function POST(request: Request): Promise<Response> {
  const wrongMethod = methodGuard(request, 'POST');
  if (wrongMethod) return wrongMethod;

  try {
    const body = await readJson(request, EstimateIn, MAX_BODY_BYTES);
    checkRateLimit(request, ROUTE);
    if (budgetExhausted()) return json(demoEstimate(body));

    // Before budget is spent and outside the try below: an unwritten prompt is
    // a `config` failure, not an upstream one.
    const instruction = systemInstruction(ROUTE);
    const client = getClient();
    noteModelCall();

    let outputText: string | undefined;
    try {
      const interaction = await client.interactions.create(
        {
          model: modelFor('fast'),
          system_instruction: instruction,
          input: JSON.stringify(estimateFacts(body)),
          response_format: responseFormat(ESTIMATE),
        },
        { fetchOptions: { signal: timeoutSignal(TIMEOUT_MS.standard) } }
      );
      outputText = interaction.output_text;
    } catch (err) {
      if (isProviderExhausted(err)) {
        console.error(`[api/ai] ${ROUTE}: provider refused, serving demo content:`, err);
        noteProviderExhausted();
        return json(demoEstimate(body));
      }
      throw new ApiError('upstream', `Gemini call failed for ${ROUTE}`, err);
    }

    // Untrusted until here (Constitution II). A failure is a 502, never a
    // partial estimate.
    const result: EstimateDTO = parseModelJson(ESTIMATE, outputText);
    return json(result);
  } catch (err) {
    return toResponse(err);
  }
}
