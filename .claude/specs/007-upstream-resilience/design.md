# 007 — Upstream Resilience · Design

## The gap in one picture

```
                    ┌── our counter says spent ──▶ 200 + canned content  ✅ Constitution VII
request ──▶ guard ──┤
                    └── our counter says fine ───▶ call Gemini ──┬── ok ──▶ 200 + real content
                                                                 │
                                                                 └── provider refuses ──▶ 502  ❌
```

Both branches end in "this deployment cannot answer with a real model call right now". Only one of
them honours the constitution. 007 routes the second branch into the first.

## Classifying a provider failure

### What the SDK actually throws

Verified at runtime against `@google/genai@2.21.0`, not assumed:

```
constructor.name : BadRequestError
name             : BadRequestError
status           : 400          (number)
own keys         : status, headers, error, statusCode, body, contentType, rawResponse, cause, name
proto chain      : BadRequestError -> APIError -> GeminiNextGenAPIClientError -> Error -> Object
```

Two traps, both of which rule out the obvious implementations:

1. **`instanceof` is unavailable.** `RateLimitError`, `PermissionDeniedError` and friends extend an
   internal `APIError` base that the package does not export. The only exported error is a
   *different* class, also spelled `ApiError`, and `err instanceof ApiError` is `false` for a real
   thrown error. Testing identity against unexported classes is not an option.
2. **The exported name collides with ours.** `api/_lib/http.ts` already exports `ApiError`. Any
   import of the SDK's would need aliasing — and per (1) it would buy nothing anyway.

So the classifier is **structural**: read a numeric `status` off an unknown value. That survives an
SDK refactor of the class hierarchy, which an `instanceof` or a `name === 'RateLimitError'` check
would not.

### The rule

| Provider status | Meaning | Response |
|---|---|---|
| `429` | quota, rate limit, depleted prepay balance | canned content, `demoMode: true` |
| `403` | key restricted, revoked, or lacking the API | canned content, `demoMode: true` |
| `400` | **our** request was malformed | `502 upstream` — this is a bug, stay loud |
| `5xx` | provider fault | `502 upstream` — transient, an error is honest |
| timeout / transport | network | `502 upstream` |
| Zod mirror fails | model returned junk | `502 upstream` (002 AC-2.6, unchanged) |

**`401` is deliberately excluded.** An outright invalid key means the deployment is broken, and that
should stay loud rather than being quietly papered over with a plausible-looking room. `403` is
included because the case we actually hit — a key restricted to the wrong API list — presents as a
*policy* refusal that a visitor can do nothing about, and there is no value in showing them a 502.

### The trade-off this accepts

Serving canned content on `403` can mask a genuinely misconfigured production deploy: the demo looks
like it works and nobody notices the key is dead. Three things keep that visible:

- `toResponse`-style logging still records the provider's real message server-side, at error level.
- `/api/ai/health` reports `demoMode: true` for the cooldown's duration (AC-2.3), so the state is
  queryable without reading logs.
- The client already labels demo content in the UI (002 T8).

That is the right balance for a portfolio demo whose audience is a visitor, not an on-call engineer.
A production service with a pager would choose differently, and should.

## Remembering exhaustion

A refusal for these reasons will not clear in the next second, so re-attempting on every request
burns latency (~7s per failed vision call, measured) and, on a metered key, potentially money.

`guard.ts` gains one more piece of module state beside the daily counter:

```ts
let upstreamCooldownUntil = 0;

export function noteProviderExhausted(nowMs = Date.now()): void;   // called on an AC-1.1 refusal
export function budgetExhausted(nowMs = Date.now()): boolean;      // now also true during cooldown
```

`budgetExhausted()` is the existing seam every route already checks before calling the model, and
`/api/ai/health` already reports it. Folding the cooldown into it means **no route and no client
code changes shape** — the new behaviour arrives through the function they all already call. That is
the whole reason to put it here rather than in a new module.

**Window:** `AI_UPSTREAM_COOLDOWN_MIN`, default 15 minutes. Long enough that a depleted balance is
not retried hundreds of times; short enough that topping up credits brings the demo back without a
redeploy. `0` disables the memory — every request retries — which is the escape hatch for local
debugging and the behaviour a test wants when it is asserting the per-call path.

**Same caveat as the limiter, restated deliberately:** this is module-scope state on ephemeral,
concurrent serverless instances. A cooldown set on one instance does not bind another, and a cold
start clears it. That makes it an optimisation over the baseline correctness of AC-1.1 — which holds
per-request regardless — rather than a guarantee. The Vercel KV upgrade path in 001's design covers
this state too, behind the same function signatures.

## The canned note has to serve both paths

`DEMO_ROOM_OUTLINE.notes` currently reads *"today's AI budget is spent, so your image was not
read."* Once the same constant serves a provider refusal, that sentence is sometimes false — a
restricted key is not a spent budget. The wording becomes cause-neutral and stays accurate for both:

> "Example outline — live AI is unavailable right now, so your image was not read. This is a
> 4.2 × 3.6 m L-shaped kitchen with a 1.4 × 0.9 m island."

No DTO or schema change: the response still carries `demoMode: true` and nothing else. Reporting
*why* to the client was considered and rejected — the distinction between "we are out of budget" and
"the key is restricted" is operator information, and putting provider failure modes in a public
response body is the beginning of the leak Constitution III forbids.

## Model default

Measured on the 002 ground-truth instrument, through `ROOM_FROM_IMAGE_V1` and the real route:

| Model | Accuracy on ground truth | Cost / call | Verdict |
|---|---|---|---|
| `gemini-3.8-flash` | bit-exact | ~$0.0057 | current default; correct but over-specified |
| **`gemini-3.1-flash-lite`** | **bit-exact, 5/5 runs** | **~$0.0007** | **new default** — ~10× cheaper |
| `gemini-3.5-flash-lite` | **wrong** — returned raw pixel coordinates | ~$0.0009 | rejected |

The winner also returned `confidence: 0` on the not-a-plan image (3/3) and ignored the injection
probe. Note the ordering is not monotonic in version number: `3.5-flash-lite` is both newer and
worse for this task than `3.1-flash-lite`, which is exactly why AC-3.3 requires the evidence to be
written down next to the default.

Two things deliberately **not** changed:

- **`GEMINI_MODEL_CHEAP` stays `gemini-3.5-flash-lite`.** It failed at *vision* scale reasoning; no
  route uses it yet, and 003–005 will exercise it on text where that failure mode does not apply.
  Re-evaluating it is that spec's job, on its own evidence.
- **`thinking_level` stays unset.** Measured across levels on this task, `low` saves ~11% over the
  default and `high` costs ~10× for identical output. The default is already near-optimal, so
  pinning a level adds a knob and a maintenance question in exchange for noise.

## Gate 6

The Constitution's leak check greps for `AIza`. Google now issues keys of the form `AQ.Ab…`, which
is what `.env.local` holds today — so the gate passes on a tree containing a live current-format
key. The pattern becomes `-iE "AIza|AQ\.Ab"`.

001's `AC-3.4` names the old pattern too, but that spec is complete and merged: its acceptance
criteria are a record of what was verified then, not a live rule. The Constitution is the live rule,
and it is the one this spec edits.

## Files

| File | Change |
|---|---|
| `api/_lib/guard.ts` | `noteProviderExhausted()`, cooldown state, `budgetExhausted()` honours it, `budgetStatus()` reports it, test seam clears it |
| `api/_lib/genai.ts` | `isProviderExhausted(err)` classifier; vision default → `gemini-3.1-flash-lite` |
| `api/ai/room-from-image.ts` | catch block routes an AC-1.1 refusal to the canned path; neutral note wording |
| `.env.example` | `AI_UPSTREAM_COOLDOWN_MIN`; model default + its evidence |
| `client/vite.config.ts` | `AI_UPSTREAM_COOLDOWN_MIN` added to the dev-server env allow-list |
| `.claude/specs/CONSTITUTION.md` | gate 6 pattern |

`isProviderExhausted` lives in `genai.ts` rather than `guard.ts` because it is knowledge about the
**provider SDK's** error shape, which is what that module already encapsulates; `guard.ts` owns
policy (how long to back off), not wire formats.
