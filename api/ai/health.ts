/**
 * GET /api/ai/health
 *
 * Says whether this deployment can talk to Gemini, and never anything about the
 * key itself. Lets the UI disable AI entry points with an explanation instead of
 * failing on click (AC-6.4, AC-7.3).
 *
 * Deliberately does not construct a client: `getClient()` throws when the key is
 * missing, and the whole point of this route is to answer that question with a
 * 200 rather than an error.
 */

import { json, methodGuard, toResponse } from '../_lib/http.js';
import { isConfigured, modelFor } from '../_lib/genai.js';
import { budgetExhausted } from '../_lib/guard.js';
import type { AiHealthDTO } from '../_lib/types.js';

export async function GET(request: Request): Promise<Response> {
  const wrongMethod = methodGuard(request, 'GET');
  if (wrongMethod) return wrongMethod;

  try {
    const body: AiHealthDTO = {
      configured: isConfigured(),
      demoMode: budgetExhausted(),
      models: {
        fast: modelFor('fast'),
        vision: modelFor('vision'),
      },
    };
    return json(body);
  } catch (err) {
    // Nothing above should throw; if it ever does, the client still gets a
    // mapped response rather than an unhandled rejection.
    return toResponse(err);
  }
}
