/**
 * The one configured Gemini client.
 *
 * Handlers never construct their own, and never name a model: both come from
 * here, so switching model is a deployment setting rather than a code change.
 *
 * API surface verified against @google/genai@2.21.0 — `CreateModelInteraction`
 * in node_modules/@google/genai/dist/genai.d.ts. See 001-ai-foundation/design.md.
 */

import { GoogleGenAI } from '@google/genai';
import { ApiError } from './http.js';

// ─── Models ───────────────────────────────────────────────────────────────────

export type ModelRole = 'fast' | 'vision' | 'cheap';

/**
 * Defaults confirmed at ai.google.dev. Each is overridable by environment so a
 * model change never requires a deploy of new code.
 *
 * The vision default is the cheapest model measured *bit-exact* on 002's
 * ground-truth plan (5/5 runs) while also rejecting the not-a-plan image and
 * ignoring the injection probe — about a tenth the cost of `gemini-3.8-flash`.
 * Note that newer is not better here: `gemini-3.5-flash-lite` failed the same
 * plan by returning raw pixel coordinates instead of applying the printed scale.
 * See 007-upstream-resilience/design.md for the measurements.
 */
const MODEL_ENV: Record<ModelRole, { env: string; fallback: string }> = {
  fast: { env: 'GEMINI_MODEL_FAST', fallback: 'gemini-3.8-flash' },
  vision: { env: 'GEMINI_MODEL_VISION', fallback: 'gemini-3.1-flash-lite' },
  cheap: { env: 'GEMINI_MODEL_CHEAP', fallback: 'gemini-3.5-flash-lite' },
};

export function modelFor(role: ModelRole): string {
  const { env, fallback } = MODEL_ENV[role];
  // An empty or whitespace-only value is a misconfigured deployment, not an
  // instruction to send an empty model id.
  return process.env[env]?.trim() || fallback;
}

// ─── Timeouts ─────────────────────────────────────────────────────────────────

/**
 * Streaming gets longer because the clock covers the whole response, not just
 * time-to-first-byte. Both stay well under the 60s `maxDuration` pinned in
 * vercel.json, so we fail with a mapped 502 rather than a platform 504.
 */
export const TIMEOUT_MS = {
  standard: 30_000,
  streaming: 55_000,
} as const;

export function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

// ─── Client ───────────────────────────────────────────────────────────────────

/** True when this deployment can talk to Gemini at all. Drives /api/ai/health. */
export function isConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

/**
 * Memoised per key. A serverless instance handles many requests, and rebuilding
 * the client per request throws away its connection reuse. Keying the cache on
 * the key itself means a changed environment produces a new client instead of a
 * stale one — which matters far more in tests than in production.
 */
let cached: { key: string; client: GoogleGenAI } | null = null;

export function getClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY?.trim();

  // Typed so handlers map this to 503 ("not configured here"), never 500 ("bug").
  // The message is logged, not returned — it must not name the variable to a caller.
  if (!key) {
    throw new ApiError('config', 'GEMINI_API_KEY is not set');
  }

  if (cached && cached.key === key) return cached.client;

  cached = { key, client: new GoogleGenAI({ apiKey: key }) };
  return cached.client;
}

/** Test seam only — drops the memoised client. */
export function resetClientForTest(): void {
  cached = null;
}

// ─── Provider failures ────────────────────────────────────────────────────────

/**
 * True when the provider refused because this deployment cannot use it right
 * now — a spent balance, a quota cap, a restricted or revoked key — rather than
 * because our request was wrong or the service itself faulted.
 *
 * Routes turn this into canned demo content instead of a 502. That is what
 * Constitution VII promises and what our own daily counter alone cannot deliver:
 * the provider's limits trip independently of ours and, on a personal key,
 * usually trip first.
 *
 * Structural on purpose. `@google/genai` throws `RateLimitError` and
 * `PermissionDeniedError` from an internal `APIError` base it does not export,
 * and the `ApiError` it *does* export is a different class — `instanceof` is
 * `false` for a real thrown error. Reading the numeric status survives a
 * refactor of that hierarchy; matching a constructor name would not.
 *
 * `401` is excluded deliberately: an outright invalid key means this deployment
 * is broken, and that should stay loud rather than be papered over with a
 * plausible-looking room.
 */
export function isProviderExhausted(err: unknown): boolean {
  const status = providerStatus(err);
  return status === 429 || status === 403;
}

/** The HTTP status an SDK error carries, or null when it is not one. */
function providerStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;

  const { status, statusCode } = err as { status?: unknown; statusCode?: unknown };
  for (const value of [status, statusCode]) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
  }
  return null;
}
