# 007 — Upstream Resilience · Requirements

**Status:** In progress
**Blocks:** nothing
**Depends on:** 002 (owns the first route this applies to), 001 (owns `guard.ts` and the taxonomy)

## Purpose

Constitution VII promises that when the cap trips, a visitor sees the feature in demo mode rather
than an error. That promise is currently only kept for **our own** counter. When the *provider*
refuses first — a spent prepay balance, a restricted key — the visitor gets
"The AI service is unavailable right now."

This is not hypothetical. During the 2026-09-12 verification session it fired three times from two
distinct causes:

| Provider response | Cause | What the visitor saw |
|---|---|---|
| `429 RESOURCE_EXHAUSTED` | AI Studio prepay credits depleted | 502 · "AI service unavailable" |
| `403 API_KEY_SERVICE_BLOCKED` | key restricted to APIs not including Gemini | 502 · "AI service unavailable" |
| `429 RESOURCE_EXHAUSTED` | credits depleted again on a second key | 502 · "AI service unavailable" |

Our own `AI_DAILY_CALL_BUDGET` counter was nowhere near its limit in any of them. The guard was
working perfectly and guarding the wrong thing.

This spec ships **no new user-visible feature**. It closes the gap between what Constitution VII
says and what the code does, in a way the remaining feature specs (003–005) inherit for free. It
also takes two cheap wins the same session turned up: the vision model is over-specified by roughly
10×, and the leak check greps for a key format Google no longer issues.

---

## R1 — A provider refusal degrades, it does not error

**WHEN** the provider refuses a call because this deployment cannot currently use it
**THE SYSTEM SHALL** serve the route's canned demo content, labelled, rather than an error.

- **AC-1.1** A provider response of `429` (quota, rate, billing) or `403` (permission, restricted or
  revoked key) causes the route to return `200` with its canned content and `demoMode: true` — the
  same body and the same path the exhausted-budget case already takes.
- **AC-1.2** Every other provider failure — `400`, `5xx`, a timeout, a transport error, or output
  that fails the Zod mirror — continues to map to `502 upstream`. A billing lapse must not become a
  licence to hide real bugs behind canned content.
- **AC-1.3** The classification lives in one exported helper in `api/_lib/`, not inline in a route,
  so 003–005 inherit it by calling it rather than by re-deriving it.
- **AC-1.4** The provider's own message is still logged server-side in full and still never crosses
  the wire (Constitution III). Degrading changes the status code, not the disclosure rule.

## R2 — Exhaustion is remembered, not rediscovered

**WHEN** the provider has just refused for a reason that will not clear in the next second
**THE SYSTEM SHALL** stop attempting calls for a cooldown window and report itself honestly.

- **AC-2.1** After an AC-1.1 refusal, `budgetExhausted()` returns `true` for a cooldown window, so
  subsequent requests take the canned path **without** spending another call that is known to fail.
- **AC-2.2** The window is env-configurable as `AI_UPSTREAM_COOLDOWN_MIN` (default `15`). A value of
  `0` disables the memory entirely, so every request retries the provider.
- **AC-2.3** `GET /api/ai/health` reports `demoMode: true` while the cooldown is active, so the UI
  labels the feature accurately instead of offering something that cannot work.
- **AC-2.4** The window expires on its own with no restart and no manual reset. Its per-instance,
  best-effort nature on serverless is documented alongside the existing limiter caveat, not glossed.

## R3 — The vision model matches the task

**WHEN** a model is chosen for a route
**THE SYSTEM SHALL** default to the cheapest one verified adequate on that route's own evidence.

- **AC-3.1** The default vision model is one measured **bit-exact** against the 002 ground-truth
  instrument, having also rejected the not-a-plan image and resisted the injection probe.
- **AC-3.2** The change is to the **default only**. `GEMINI_MODEL_VISION` still overrides it, so a
  regression is a deployment setting away from being reverted, never a redeploy (001 AC-1.2).
- **AC-3.3** `.env.example` records the default and the measurement that justifies it, so the next
  person changing it knows what evidence they are overturning.

## R4 — The leak check matches the keys in use

**WHEN** the review gate checks for a committed credential
**THE SYSTEM SHALL** match the key formats the provider actually issues.

- **AC-4.1** Constitution gate 6 matches both the legacy `AIza…` format and the current `AQ.Ab…`
  format. The key in `.env.local` today is the latter, which the current pattern misses entirely.
- **AC-4.2** The updated command is verified to still return nothing on a clean tree, and to
  actually catch a planted string of each format.
