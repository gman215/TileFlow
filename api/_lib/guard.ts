/**
 * Spend protection for a public demo funded by a personal API key
 * (Constitution VII): a per-IP token bucket and a global daily call budget.
 *
 * ── Known limitation ─────────────────────────────────────────────────────────
 * This state lives in module scope, and serverless instances are ephemeral and
 * concurrent: counters are per-instance, several instances may serve the same
 * caller, and everything resets on a cold start. Real limits are therefore
 * looser than configured — sometimes by the number of live instances.
 *
 * That is deliberate. This stops runaway client loops, a stuck retry, and casual
 * abuse, which is what actually threatens the bill. It does not stop a
 * determined attacker, and it is not represented as doing so.
 *
 * The upgrade path, when it matters, is Vercel KV or Upstash Redis behind these
 * same three function signatures — only the bodies change.
 */

import { ApiError } from './http.js';

// ─── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_RATE_PER_MIN = 10;
const DEFAULT_DAILY_BUDGET = 500;
const WINDOW_MS = 60_000;

/**
 * Read at call time, not module load, so a deployment can change limits without
 * a redeploy — and so tests can vary them.
 *
 * `0` is a meaningful value (it means "closed"), so it must survive; only an
 * unset, blank or malformed variable falls back to the default. `Number('')`
 * is `0`, which is exactly the trap this avoids.
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

const ratePerMin = () => envInt('AI_RATE_LIMIT_PER_MIN', DEFAULT_RATE_PER_MIN);
const dailyBudget = () => envInt('AI_DAILY_CALL_BUDGET', DEFAULT_DAILY_BUDGET);

// ─── Caller identity ──────────────────────────────────────────────────────────

/**
 * `x-forwarded-for` is a list — "client, proxy1, proxy2" — and the client is the
 * first entry. Vercel sets this header itself at the edge; the value is only as
 * trustworthy as that, which is enough for spend protection and not enough for
 * anything security-bearing.
 *
 * Locally there is no such header, so every caller shares the `local` bucket.
 * That keeps the limiter exercised in development instead of silently disabled.
 */
export function callerKey(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip')?.trim() || 'local';
}

// ─── Per-IP token bucket ──────────────────────────────────────────────────────

interface Bucket {
  /** Fractional tokens available. */
  tokens: number;
  /** When `tokens` was last brought up to date. */
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

/** Keep the map from growing without bound across a long-lived warm instance. */
function sweep(now: number, capacity: number): void {
  if (buckets.size < 1000) return;
  for (const [key, b] of buckets) {
    const refilled = b.tokens + ((now - b.updatedAt) / WINDOW_MS) * capacity;
    // A fully refilled bucket is indistinguishable from a new one.
    if (refilled >= capacity) buckets.delete(key);
  }
}

/**
 * Consume one token for this caller and route, or throw.
 *
 * The thrown error carries `retryAfterSeconds`, which `toResponse` turns into a
 * `Retry-After` header, so the client waits the right amount rather than
 * guessing.
 *
 * @param nowMs test seam — defaults to the wall clock.
 */
export function checkRateLimit(request: Request, route: string, nowMs = Date.now()): void {
  const capacity = ratePerMin();
  const key = `${callerKey(request)}:${route}`;

  // A configured limit of 0 means the route is closed, not unlimited.
  if (capacity === 0) {
    throw new ApiError('rate_limited', `Rate limit is 0 for ${route}`, { retryAfterSeconds: 60 });
  }

  sweep(nowMs, capacity);

  const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: nowMs };
  const elapsed = Math.max(0, nowMs - bucket.updatedAt);
  const tokens = Math.min(capacity, bucket.tokens + (elapsed / WINDOW_MS) * capacity);

  if (tokens < 1) {
    // Time until one whole token exists again.
    const seconds = ((1 - tokens) / capacity) * (WINDOW_MS / 1000);
    buckets.set(key, { tokens, updatedAt: nowMs });
    throw new ApiError('rate_limited', `Rate limit hit for ${key}`, {
      retryAfterSeconds: Math.max(1, Math.ceil(seconds)),
    });
  }

  buckets.set(key, { tokens: tokens - 1, updatedAt: nowMs });
}

// ─── Global daily budget ──────────────────────────────────────────────────────

let day = '';
let callsToday = 0;

/** UTC day, so the reset point does not move with the server's locale. */
function today(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function rollDay(nowMs: number): void {
  const d = today(nowMs);
  if (d !== day) {
    day = d;
    callsToday = 0;
  }
}

/**
 * True when today's budget is spent. Routes check this *before* calling the
 * model and serve canned demo content instead of an error (AC-4.3) — a visiting
 * recruiter should see the feature, labelled, not a 429.
 */
export function budgetExhausted(nowMs = Date.now()): boolean {
  rollDay(nowMs);
  return callsToday >= dailyBudget();
}

/** Call once per actual model call, after deciding to make it. */
export function noteModelCall(nowMs = Date.now()): void {
  rollDay(nowMs);
  callsToday++;
}

/** For /api/ai/health and diagnostics. */
export function budgetStatus(nowMs = Date.now()): { used: number; limit: number; day: string } {
  rollDay(nowMs);
  return { used: callsToday, limit: dailyBudget(), day };
}

/** Test seam — clears all limiter state. */
export function resetGuardForTest(): void {
  buckets.clear();
  day = '';
  callsToday = 0;
}
