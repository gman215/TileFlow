# 001 — AI Foundation · Requirements

**Status:** Not started
**Blocks:** 002, 003, 004, 005
**Depends on:** nothing

## Purpose

Every AI feature needs the same things: a configured Gemini client, a request/response envelope
with validation and an error taxonomy, spend protection, a way to run serverless handlers locally,
and a typed client-side fetch layer. Building those once — before any feature — is what keeps the
four features from each inventing their own half of it.

This spec ships **no user-visible feature**. Its acceptance test is that a trivial probe route
answers correctly in dev and in production, and that the app is unchanged when the key is absent.

---

## R1 — Single configured client

**WHEN** a handler needs to call Gemini
**THE SYSTEM SHALL** obtain the client from one shared module rather than constructing its own.

- **AC-1.1** `api/_lib/genai.ts` exports a memoized `getClient()` returning a `GoogleGenAI`
  instance; repeated calls within one warm invocation return the same instance.
- **AC-1.2** Model ids are read from `GEMINI_MODEL_FAST` and `GEMINI_MODEL_VISION`, each with a
  documented default. No model id string appears at any call site.
- **AC-1.3** `getClient()` throws a typed `ApiError('config', ...)` when `GEMINI_API_KEY` is unset,
  which handlers map to `503`, never `500`.
- **AC-1.4** Every model call is given an `AbortSignal` timeout; the default is 30s for non-
  streaming calls and 120s for streaming ones.

## R2 — Uniform request envelope

**WHEN** any `/api/ai/*` route receives a request
**THE SYSTEM SHALL** validate method, size and body shape before calling a model.

- **AC-2.1** A non-`POST` method returns `405` with an `Allow: POST` header and does not call
  Gemini.
- **AC-2.2** A body larger than the route's declared byte cap returns `413` and does not call
  Gemini.
- **AC-2.3** A body that fails its Zod schema returns `400` with field-level detail, in the same
  shape the Express server already uses: `{ error: 'Validation error', details: [...] }`.
- **AC-2.4** Requests are rejected before any model call for all three cases above — verified by
  the fact that a probe with no `GEMINI_API_KEY` set still returns `405`/`413`/`400` rather than
  `503`.

## R3 — Error taxonomy with no leakage

**WHEN** a handler fails for any reason
**THE SYSTEM SHALL** return a mapped status and a generic message, and log the detail server-side.

- **AC-3.1** Statuses map as: bad input `400`, too large `413`, rate limited `429`, upstream model
  failure `502`, missing/invalid configuration `503`, anything else `500`.
- **AC-3.2** No response body contains an API key, an upstream provider message, a stack trace, a
  file path, or an environment variable value.
- **AC-3.3** Every error response carries a stable machine-readable `code` so the client can
  distinguish "try again" from "this will never work".
- **AC-3.4** `git grep --untracked -iE "AIza|GEMINI_API_KEY" -- client/` returns no match that would reach a
  bundle.

## R4 — Spend protection

**WHEN** the demo is exposed publicly on a personal API key
**THE SYSTEM SHALL** cap usage per caller and in aggregate, and degrade rather than fail.

- **AC-4.1** A per-IP token bucket limits requests per route; exceeding it returns `429` with
  `Retry-After`.
- **AC-4.2** A global daily counter caps total model calls across all callers.
- **AC-4.3** When the global cap is exhausted, routes return `200` with canned demo content and
  `demoMode: true` rather than `429` — a visitor sees the feature, labelled, not an error.
- **AC-4.4** The limiter's best-effort nature on serverless (per-instance memory, resets on cold
  start) is documented in `design.md` along with the Vercel KV upgrade path.

## R5 — Local development without the Vercel CLI

**WHEN** a developer runs `npm run dev`
**THE SYSTEM SHALL** serve `/api/ai/*` from the same handler modules that Vercel will run.

- **AC-5.1** `npm run dev` alone is sufficient; installing or running `vercel` is not required.
- **AC-5.2** `/api/ai/*` is handled locally by the Vite dev server; `/api/projects*` continues to
  proxy to the Express server on `:3001`, unchanged.
- **AC-5.3** Editing a handler file is reflected on the next request without restarting the dev
  server.
- **AC-5.4** The dev adapter and the Vercel runtime invoke the *same* exported function — there is
  no second implementation of any handler.

## R6 — Typed client access layer

**WHEN** client code calls an AI route
**THE SYSTEM SHALL** go through one module that mirrors the existing `client/src/api/client.ts`.

- **AC-6.1** `client/src/api/ai.ts` exports one typed function per route plus a streaming reader
  helper.
- **AC-6.2** Failures surface as `Error` with the server's `code` attached, so callers can branch
  on `rate_limited` vs `config` vs `upstream`.
- **AC-6.3** Every request is cancellable via `AbortSignal`, so a component unmounting does not
  leave a pending state update.
- **AC-6.4** A `useAiAvailability()` hook (or equivalent) lets UI disable AI entry points with an
  explanation when the server reports AI is unconfigured, rather than failing on click.

## R7 — The app is unchanged without a key

**WHEN** `GEMINI_API_KEY` is not set
**THE SYSTEM SHALL** leave every existing feature working exactly as before.

- **AC-7.1** With no key, drawing a room, changing tiles, optimizing and saving a project all work.
- **AC-7.2** No console error is produced at page load attributable to AI code.
- **AC-7.3** `GET /api/ai/health` reports `{ configured: false }` with status `200`, and AI entry
  points render disabled with a one-line explanation.

## Out of scope

- Any user-facing AI feature (see 002–005).
- Persisting AI conversations or results to Postgres — the Express server is untouched by this spec.
- Authentication. The demo is public and protected by rate limits, not identity.
