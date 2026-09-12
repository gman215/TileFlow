# 007 — Upstream Resilience · Tasks

**Prerequisite:** 002 complete (12/12) and merged to `main`.

- [x] **T0 — Branch.** `git switch -c feat/007-upstream-resilience`, cut from a `main` that already
      contains 002. Do not branch off `feat/002-photo-to-room`.
      *Verify:* `git rev-parse --abbrev-ref HEAD` prints `feat/007-upstream-resilience`, and
      `git log --oneline -1 main` is the 002 merge. (Constitution VIII)

- [x] **T1 — Classifier.** Add `isProviderExhausted(err: unknown): boolean` to `api/_lib/genai.ts`.
      Structural only: read a numeric `status` (falling back to `statusCode`) off an unknown value
      and return true for `429` and `403`. No `instanceof`, no constructor-name matching — the SDK
      does not export the subclasses and the exported `ApiError` is a different class.
      *Verify:* a scratch script proves `{status:429}` and `{status:403}` are true; `{status:400}`,
      `{status:500}`, a `TypeError`, `null`, `undefined` and `{}` are all false. (AC-1.2, AC-1.3)

- [x] **T2 — Cooldown state.** In `api/_lib/guard.ts`: `noteProviderExhausted(nowMs?)`, module-scope
      `upstreamCooldownUntil`, `budgetExhausted()` returns true while the window is open,
      `budgetStatus()` reports it, `resetGuardForTest()` clears it. Window from
      `AI_UPSTREAM_COOLDOWN_MIN` via the existing `envInt` (default 15); `0` disables the memory.
      Document the per-instance caveat beside the limiter's.
      *Verify:* with injected clocks, `budgetExhausted()` is false, true immediately after
      `noteProviderExhausted()`, and false again one second past the window. With the var set to
      `0`, it stays false throughout. (AC-2.1, AC-2.2, AC-2.4)

- [x] **T3 — Route wiring.** In `api/ai/room-from-image.ts`, the upstream catch block calls
      `isProviderExhausted(err)`; when true it logs the real cause, calls `noteProviderExhausted()`
      and returns the canned outline, otherwise it throws `ApiError('upstream', …)` as today. Make
      `DEMO_ROOM_OUTLINE.notes` cause-neutral so it is true for both paths.
      *Verify:* forced-error runs return `200` + `demoMode:true` for 429/403 and `502` for 400/500;
      the provider's message appears in the server log and in no response body. (AC-1.1, AC-1.4)

- [x] **T4 — Health honesty.** Confirm `GET /api/ai/health` reports `demoMode: true` during a
      cooldown. No code change expected — it already calls `budgetExhausted()`; this task is to
      prove the seam works rather than to assume it.
      *Verify:* trip a cooldown, then `curl` health and see `demoMode:true`; wait it out and see it
      return to false. (AC-2.3)

- [x] **T5 — Model default.** `api/_lib/genai.ts`: vision fallback → `gemini-3.1-flash-lite`. Record
      the default and its evidence in `.env.example`, and add `AI_UPSTREAM_COOLDOWN_MIN` there and
      to the `AI_ENV_KEYS` allow-list in `client/vite.config.ts`.
      *Verify:* health reports the new vision model; the 002 ground-truth plan still returns
      bit-exact through the route; `GEMINI_MODEL_VISION=gemini-3.8-flash` still overrides.
      (AC-3.1, AC-3.2, AC-3.3)

- [x] **T6 — Gate 6.** Update the leak-check command in `.claude/specs/CONSTITUTION.md` to
      `-iE "AIza|AQ\.Ab"`, in both the review-gate list and the explanatory note beneath it.
      *Verify:* the new command returns nothing on the clean tree, and catches a planted string of
      **each** format in an untracked file (delete it afterwards). (AC-4.1, AC-4.2)

- [x] **T7 — Full spec verification.** Run the block below and record the result.

---

## Verification block

0. **On the right branch** — `git rev-parse --abbrev-ref HEAD` prints
   `feat/007-upstream-resilience`. (Constitution VIII)
1. **429 degrades** — force a provider 429; the route returns `200`, the canned outline and
   `demoMode: true`. (AC-1.1)
2. **403 degrades** — force a provider 403; same result. (AC-1.1)
3. **400 still errors** — force a provider 400; the route returns `502 upstream`, not canned
   content. (AC-1.2)
4. **5xx still errors** — force a provider 500; `502 upstream`. (AC-1.2)
5. **No leakage** — in items 1–4, no response body contains the provider's message, a key, or a
   stack trace; the real cause is in the server log. (AC-1.4)
6. **Cooldown holds** — after item 1, a second request serves canned content **without** a further
   provider call (visible as a fast response rather than a ~7s one). (AC-2.1)
7. **Cooldown expires** — with `AI_UPSTREAM_COOLDOWN_MIN` short, the route resumes real calls once
   the window passes. (AC-2.2)
8. **Cooldown disabled** — with `AI_UPSTREAM_COOLDOWN_MIN=0`, every request retries the provider.
   (AC-2.2)
9. **Health is honest** — health reports `demoMode: true` during a cooldown and `false` after.
   (AC-2.3)
10. **Model default** — health reports `gemini-3.1-flash-lite` for vision; the 002 ground-truth plan
    returns bit-exact through the route; `GEMINI_MODEL_VISION` still overrides. (AC-3.1, AC-3.2)
11. **Existing behaviour intact** — the 002 error battery still passes: `GET` → 405, malformed JSON
    → 400, `data:` prefix → 400, bad mimeType → 400, over-cap body → 413, limiter → 429 with
    `Retry-After`; `AI_DAILY_CALL_BUDGET=0` still serves canned content; no key → 503.
12. **Gate 6** — the updated command is clean on this tree and catches both planted formats.
    (AC-4.1, AC-4.2)
13. **Types and tests** — `npm run typecheck:api`, `cd client && npx tsc --noEmit`, and
    `npm test --workspace @tileflow/geometry` all clean.

---

## Verification record — 2026-09-12

Route-level items were driven by loading the real handler modules through Vite's own SSR loader and
stubbing `globalThis.fetch`, which is the only way to produce a `403` or a `429` on demand now that
billing is healthy. That exercises the true handler, the true SDK and the true guard — only the
socket is fake. Model-facing items ran against the live API.

| # | Item | Result |
|---|---|---|
| 0 | On the right branch | **Pass** — `feat/007-upstream-resilience`, cut from the `main` holding the 002 merge |
| 1 | 429 degrades | **Pass** — `200`, canned outline, `demoMode: true` |
| 2 | 403 degrades | **Pass** — `200`, canned outline, `demoMode: true` |
| 3 | 400 still errors | **Pass** — `502 upstream`, no canned content |
| 4 | 5xx still errors | **Pass** — `500` and `503` both map to `502 upstream` |
| 5 | No leakage | **Pass** — a planted provider message `SUPER-SECRET-PROVIDER-TEXT-AQ.Ab123` appears in **no** response body across all five cases, and **is** present in the server log |
| 6 | Cooldown holds | **Pass** — the second request served canned content with **zero** provider requests |
| 7 | Cooldown expires | **Pass** — a trip back-dated past a 1-minute window leaves `demoMode: false` |
| 8 | Cooldown disabled | **Pass** — with `AI_UPSTREAM_COOLDOWN_MIN=0` every request retries and `budgetExhausted()` stays false |
| 9 | Health is honest | **Pass** — `demoMode` reads `false → true → false` across a cooldown's life |
| 10 | Model default | **Pass** — health reports `gemini-3.1-flash-lite`; the 002 ground-truth plan returns **bit-exact 3/3** through the route, island included; `GEMINI_MODEL_VISION=gemini-3.8-flash` still overrides |
| 11 | Existing behaviour intact | **Pass** — `GET` → 405, malformed JSON → 400, `data:` prefix → 400, bad mimeType → 400; `AI_DAILY_CALL_BUDGET=0` still serves canned content |
| 12 | Gate 6 | **Pass** — the updated pattern catches a planted key of **each** format and is clean on the real tree. The old pattern caught only the legacy one, confirming the hole was live |
| 13 | Types and tests | **Pass** — `typecheck:api` clean, `client tsc` clean, 114/114 geometry tests |

### What the instrumentation turned up

**The SDK retries a 429 five times before it throws.** A single refused vision call therefore costs
five upstream round trips — which is where the ~7s failure latency measured during 002 came from.
This moves the cooldown from a nice-to-have to the main event: without it, every visitor request
during an outage costs five provider requests to rediscover a refusal we already knew about. With
it, the second request onwards costs zero.

**`instanceof` would have failed silently.** `RateLimitError` and `PermissionDeniedError` extend an
internal `APIError` base that the package does not export, while the `ApiError` it *does* export is
an unrelated class — `err instanceof ApiError` is `false` for a real thrown error. A classifier
written the obvious way would have compiled, passed review, and degraded nothing. The structural
`status` read is not defensive styling; it is the only thing that works.

### Follow-ups not taken here

1. **The canvas still does not fit to a proposal** — carried from 002, still uncovered by any AC.
2. **Only `room-from-image` is wired.** `isProviderExhausted` and `noteProviderExhausted` are
   exported and ready, but 003–005 must each call them in their own catch block, and each needs its
   own canned content to fall back to. That is a line in those specs, not a change here.
3. **The cooldown is per-instance.** Documented, deliberate, and unchanged from the limiter's
   existing trade-off; the Vercel KV path in 001's design covers this state too.
