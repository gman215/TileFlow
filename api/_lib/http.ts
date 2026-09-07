/**
 * Request envelope and error taxonomy for the /api/ai/* handlers.
 *
 * Same concerns as the Express server's `server/src/middleware/index.ts`, adapted
 * to the Web-standard handler signature Vercel invokes. The validation-failure
 * body is deliberately identical to the Express one so the two APIs read as one.
 */

import { ZodError, type ZodSchema } from 'zod';

// ─── Error taxonomy ───────────────────────────────────────────────────────────

/**
 * Stable, machine-readable failure kinds. The client branches on these to tell
 * "retry in a moment" (`rate_limited`, `upstream`) from "this will never work
 * on this deployment" (`config`), which a bare status code cannot express.
 */
export type ErrorCode =
  | 'bad_request'
  | 'too_large'
  | 'rate_limited'
  | 'upstream'
  | 'config'
  | 'internal';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  too_large: 413,
  rate_limited: 429,
  upstream: 502,
  config: 503,
  internal: 500,
};

/**
 * What the caller is allowed to see. Never `err.message`: an upstream failure
 * carries the provider's own text, which can quote our prompt back at us, and a
 * config failure can name an environment variable. Specifics that are safe to
 * return travel in `details` instead, and only for validation errors.
 */
const PUBLIC_MESSAGE: Record<ErrorCode, string> = {
  bad_request: 'The request body was not valid JSON or did not match the expected shape.',
  too_large: 'The request body is too large.',
  rate_limited: 'Too many requests. Try again shortly.',
  upstream: 'The AI service is unavailable right now.',
  config: 'AI features are not configured on this deployment.',
  internal: 'Internal server error.',
};

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    /** Server-side only — logged, never serialized, except Zod issues (see toResponse). */
    readonly detail?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Responses ────────────────────────────────────────────────────────────────

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...init.headers,
    },
  });
}

/**
 * Rejects the wrong method before anything else runs — no body read, no model
 * call, no rate-limit budget spent.
 */
export function methodGuard(request: Request, allowed: 'GET' | 'POST'): Response | null {
  if (request.method === allowed) return null;
  return json(
    { error: `Method ${request.method} not allowed.`, code: 'bad_request' satisfies ErrorCode },
    { status: 405, headers: { Allow: allowed } }
  );
}

/**
 * Map any thrown value to a safe response. Full detail goes to the server log;
 * the caller gets a generic message plus the stable code.
 */
export function toResponse(err: unknown): Response {
  const apiError = err instanceof ApiError ? err : null;
  const code: ErrorCode = apiError?.code ?? 'internal';

  // Logged, not returned. This is the only place the real cause is visible.
  console.error(`[api/ai] ${code}:`, apiError?.message ?? err, apiError?.detail ?? '');

  const body: Record<string, unknown> = { error: PUBLIC_MESSAGE[code], code };
  const headers: Record<string, string> = {};

  // Field-level validation detail is safe and useful: Zod issues name the input
  // path and the expected type, nothing about the server.
  if (code === 'bad_request' && isZodIssueList(apiError?.detail)) {
    body.error = 'Validation error';
    body.details = apiError!.detail;
  }

  // Set by the rate limiter so the client can wait the right amount of time.
  const retryAfter = retryAfterOf(apiError?.detail);
  if (code === 'rate_limited' && retryAfter !== null) {
    headers['Retry-After'] = String(retryAfter);
  }

  return json(body, { status: STATUS[code], headers });
}

function isZodIssueList(detail: unknown): boolean {
  return (
    Array.isArray(detail) &&
    detail.every((d) => typeof d === 'object' && d !== null && 'path' in d && 'message' in d)
  );
}

function retryAfterOf(detail: unknown): number | null {
  if (typeof detail !== 'object' || detail === null) return null;
  const value = (detail as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof value === 'number' && Number.isFinite(value) ? Math.ceil(value) : null;
}

// ─── Body reading ─────────────────────────────────────────────────────────────

/**
 * Read, size-check and validate a JSON body.
 *
 * The cap is enforced while streaming rather than after buffering: a client that
 * lies about (or omits) Content-Length should still not get the whole payload
 * into memory before we reject it.
 */
export async function readJson<T>(
  request: Request,
  schema: ZodSchema<T>,
  maxBytes: number
): Promise<T> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError('too_large', `Content-Length ${declared} exceeds ${maxBytes} bytes`);
  }

  const raw = await readCapped(request, maxBytes);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ApiError('bad_request', 'Body is not valid JSON', err);
  }

  try {
    return schema.parse(parsed);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ApiError('bad_request', 'Body failed validation', err.issues);
    }
    throw err;
  }
}

async function readCapped(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) throw new ApiError('bad_request', 'Request has no body');

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new ApiError('too_large', `Body exceeds ${maxBytes} bytes`);
      }
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    // Stop the upload as soon as we have decided, rather than draining it.
    reader.releaseLock();
    if (total > maxBytes) await request.body.cancel().catch(() => {});
  }

  return out + decoder.decode();
}
