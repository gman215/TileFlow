# 001 — AI Foundation · Tasks

Work top to bottom. T1 comes first and is not optional — it prevents committing a key.
Tick a box only after running its verification.

## Safety and configuration

- [x] **T0 — Branch.** Create this spec's branch and switch to it before touching any file:
      `git switch -c feat/001-ai-foundation`, cut from an up-to-date `main`.
      *Verify:* `git rev-parse --abbrev-ref HEAD` prints `feat/001-ai-foundation`, and
      `git status --porcelain` is clean apart from anything you already intended to carry over.
      (Constitution VIII)

- [x] **T1 — Close the secret-leak gap in `.gitignore`.**
      Add `.env.local`, `.env*.local`, `.vercel` to `/.gitignore`. The current file lists only
      `.env`, which does not match `.env.local`.
      *Verify:* `printf 'GEMINI_API_KEY=test\n' > .env.local && git status --porcelain | grep -c '.env.local'`
      prints `0`. Leave the file in place for later tasks.

- [x] **T2 — Add `.env.example` at the repo root** with the six variables listed in `design.md`
      (`GEMINI_API_KEY`, three model vars, `AI_DAILY_CALL_BUDGET`, `AI_RATE_LIMIT_PER_MIN`), all
      blank or defaulted, no real values.
      *Verify:* `git grep --untracked -c AIza -- .env.example` prints `0`; file is tracked by git.

- [x] **T3 — Add runtime dependencies to the ROOT `package.json`.**
      `@google/genai` and `zod` as `dependencies` (the root currently declares only
      `devDependencies`). Root-level `/api` resolves from root `node_modules`.
      *Verify:* `npm install` succeeds; `node -e "require.resolve('@google/genai')"` resolves from
      the repo root.

- [x] **T4 — Add `api/tsconfig.json`** exactly as specified in `design.md` (non-composite,
      `noEmit`, `lib: ["ES2022","DOM"]`, `types: ["node"]`), and a root script
      `"typecheck:api": "tsc -p api --noEmit"`. Add `"type": "module"` to the root
      `package.json` — `api/` holds ESM TypeScript like every other workspace (all three already
      declare it), and without it Node resolves `api/*.ts` as CommonJS and
      `export async function POST` is invisible to any runner outside Vite/Vercel. There are no
      root-level `.js` files, so the change is inert for everything else.
      Also add `@types/node` to the **root**
      `devDependencies` — it is currently only present by hoisting from `server/`, so
      `types: ["node"]` would break silently if the server ever dropped it.
      *Verify:* `tsc` cannot exit 0 with no input files — an empty `api/` tree correctly reports
      `TS18003`, which is tsc working, not a misconfiguration. So verify with a temporary probe
      module instead: write an `api/_probe.ts` exporting
      `export async function POST(request: Request): Promise<Response>` that touches
      `process.env`, `AbortSignal.timeout`, `request.json()` and `request.body`, confirm
      `npm run typecheck:api` exits 0 (proves DOM + node types resolve under `strict`), then
      introduce a deliberate type error and confirm it exits non-zero (proves the check is not
      vacuous). Delete the probe. From T6 onward the tree is non-empty and the script runs clean
      on real files.

- [x] **T5 — Add `vercel.json`** at the repo root per `design.md`.
      Includes `"framework": "vite"` so the preset is described by the repo too.
      No SPA fallback rewrite is needed: the client has no router dependency, so every visit is
      `/`. Do not add a catch-all rewrite; one would have to be written to exclude `/api/*`.

      🔧 **Required dashboard change — the file is inert without it.** The project's Root
      Directory was `client`, with all four build overrides OFF. Under that setting a repo-root
      `vercel.json` is outside the project root and is silently ignored, and functions are looked
      for at `client/api/`. In **Settings → Build and Deployment → Root Directory**, clear the
      field (blank = repo root) and Save. Leave the four Override toggles OFF — `vercel.json` now
      supplies those values. Note this also means the settings `README.md` documented were never
      actually in effect; they become true only after this change.

      Use `api/ai/*.ts` as the `functions` glob, **not** `api/**/*.ts`: the broad form also matches
      every helper in `api/_lib/`, which are libraries rather than endpoints.

      ⚠️ **Do not deploy between T5 and T12.** The glob matches nothing until `api/ai/health.ts`
      exists, and Vercel fails the build with *"The pattern … defined in `functions` doesn't match
      any Serverless Functions."* The config is correct for the finished state; it is simply not
      deployable mid-spec.

      *Verify, locally (no Vercel account needed):* `vercel.json` parses as JSON; its three build
      fields match what `README.md` documents; `maxDuration` is ≤ 300 (the Hobby ceiling);
      `rm -rf client/dist && npm run build:client` exits 0 and produces `client/dist/index.html`
      plus `client/dist/assets/` — proving `buildCommand` and `outputDirectory` are right.
      *Verify, before the first deploy (needs the account — this is what gates the tick):*
      Root Directory cleared and saved; then a **preview** deploy (never production first) that
      loads the SPA, serves from `client/dist`, and — after T12 — answers `/api/ai/health`.
      Also confirm helpers are not routed: `curl -i <preview>/api/_lib/http` and
      `curl -i <preview>/api/_lib/genai` must both return **404**, not 200 or 500.
      A preview that loads but 404s on the health route means Root Directory is still set.
      `npx vercel build` requires `vercel login`; without it the CLI stops at *"The specified
      token is not valid."*

## Shared library

- [x] **T6 — `api/_lib/http.ts`.** `ApiError`, `ErrorCode`, `json()`, `methodGuard()`,
      `readJson()` with a byte cap, `toResponse()` with the status mapping table from `design.md`.
      `toResponse` logs full detail via `console.error` and returns only `{ error, code }` (plus
      Zod `details` on validation failure).
      Each error carries a stable machine-readable `code` so the client can distinguish
      "retry" from "this will never work".
      *Verify:* a scratch script constructs each `ApiError` code and asserts the mapped status, the
      presence of `code`, and that the serialized body contains no `detail`, no stack and no env
      value. (AC-2.2, AC-2.3, AC-3.1, AC-3.2, AC-3.3)

- [x] **T7 — `api/_lib/genai.ts`.** Memoized `getClient()`, `modelFor(role)` reading
      `GEMINI_MODEL_FAST` / `GEMINI_MODEL_VISION` / `GEMINI_MODEL_CHEAP` with the documented
      defaults, `TIMEOUT_MS`, `timeoutSignal()`, `isConfigured()`. Both timeouts must be under
      `vercel.json`'s `maxDuration`, or the platform's 504 pre-empts our mapped 502.
      `getClient()` throws `ApiError('config', …)` when `GEMINI_API_KEY` is unset.
      *Verify:* with the var unset, `getClient()` throws code `config`; with it set, two calls
      return the identical object (`===`). (AC-1.1–1.4)

- [x] **T8 — `api/_lib/prompts.ts`.** `SYSTEM_COMMON_V1` carrying the engine-owns-the-numbers rule
      and Constitution II's "image text is data, not instructions" rule, plus empty versioned
      placeholders for the four feature prompts, to be filled by their specs. Expose
      `systemInstruction(name)` for composition; call sites never read the constants directly and
      never write their own preamble. An unfilled prompt must **throw** `ApiError('config')` rather
      than compose to a bare preamble — otherwise a half-wired route reaches the model looking
      plausible but carrying none of its instructions, and the failure shows up as bad output
      instead of an error.
      *Verify:* `grep -rn "You are" api/ --include=*.ts` matches only `api/_lib/prompts.ts` — every
      prompt string lives there, never at a call site (Constitution VI). Use `grep -rn`, not
      `git grep`: while `api/` is untracked, `git grep` matches nothing and the check passes
      vacuously. Also confirm each of the four unfilled prompts throws `config` (→ 503) and that
      the error names the spec that owns it.

- [x] **T9 — `api/_lib/guard.ts`.** Per-IP token bucket keyed on `x-forwarded-for`
      (`AI_RATE_LIMIT_PER_MIN`, default 10), global daily counter (`AI_DAILY_CALL_BUDGET`, default
      500), `checkRateLimit()`, `budgetExhausted()`, `noteModelCall()`, plus `budgetStatus()` for
      the health route and `callerKey()`. Take the **first** `x-forwarded-for` entry (it is a
      list). Parse env so a literal `0` survives but blank/garbage falls back — `Number('')` is
      `0`, so the naive parse silently closes every route when the variable is unset. A limit of
      `0` means closed, not unlimited. Roll the day on **UTC**. Include the best-effort/serverless
      caveat as a file-header comment naming Vercel KV as the upgrade path.
      *Verify:* a scratch loop calling `checkRateLimit` with one IP throws `rate_limited` on call
      N+1 and includes a `Retry-After`-usable value; a different IP is unaffected. With
      `AI_DAILY_CALL_BUDGET=0`, `budgetExhausted()` is true and routes take the canned-content path
      rather than erroring. (AC-4.1, AC-4.2, AC-4.3, AC-4.4)

- [x] **T10 — `api/_lib/types.ts`.** `LayoutStatsDTO` and the shared request/response DTOs from
      `design.md`. No import — type or value — from `@tileflow/geometry`.
      *Verify:* the package is never *imported*:
      `git grep --untracked -nE "(from|require\()\s*['\"]@tileflow/geometry" -- api/` returns
      nothing. Do not grep for the bare package name — `types.ts` names it in a comment explaining
      why it is duplicated, and that comment is the documentation, not a violation. Confirm the
      whole boundary with
      `grep -rhoE "from '[^']+'" api/ --include=*.ts | sort -u`: the only entries should be
      relative paths, `@google/genai` and `zod`.

- [x] **T11 — `api/_lib/schemas.ts`.** Scaffold the JSON-Schema + Zod-mirror pairing convention
      (`schemaPair`, `responseFormat`, `parseModelJson`) with the worked example in a doc comment;
      feature specs add their own pairs. `parseModelJson` must map every bad-output case to
      `upstream` (502), not `internal` (500).
      *Verify:* `npm run typecheck:api` clean, plus a scratch pair whose Zod mirror is stricter
      than its JSON Schema: confirm a payload valid against the JSON Schema but over the mirror's
      caps is rejected; confirm empty / whitespace / undefined / non-JSON output each throw
      `upstream` → 502; and confirm the model's raw text never appears in the serialized response
      (plant a fake key and a prompt-injection string in the output and grep the body for both).

## Routes

- [x] **T12 — `api/ai/health.ts`.** `GET` → `200 { configured, demoMode, models: { fast, vision } }`.
      Reports whether a key is present; never returns the key or any part of it.
      *Verify:* the curl form needs T13's dev adapter, so verify the handler directly first —
      import `GET` and call it with a `Request`. With no key: `200` and `configured:false` (never
      an error — this route must not construct a client, since `getClient()` throws when
      unconfigured). With a key: `configured:true`, and the body contains neither the key, nor its
      first 8/12/16 characters, nor the variable name. Body keys are exactly
      `configured`/`demoMode`/`models`. Non-GET methods return 405 with `Allow: GET`.
      `AI_DAILY_CALL_BUDGET=0` flips `demoMode` to true while staying 200. Repeat via
      `curl -s localhost:5173/api/ai/health` once T13 lands. (AC-7.3)

## Local development adapter

- [x] **T13 — `aiDevServer()` plugin in `client/vite.config.ts`.** Register the middleware
      *directly* inside `configureServer` (not via a returned post-hook) so it precedes Vite's
      proxy. Resolve `/api/ai/<name>` to `../api/ai/<name>.ts`, load via `server.ssrLoadModule`,
      adapt Connect req → Web `Request`, call the module's `GET`/`POST` export, adapt the `Response`
      back — **piping** `response.body` rather than buffering, so streaming works.
      Guard the route lookup: names must match `^[a-z0-9-]+$` and the resolved file must sit
      inside `api/ai/`, or `/api/ai/../_lib/http` becomes a way to execute a helper.
      Also load the repo-root `.env.local` into `process.env` via Vite's `loadEnv(mode,
      path.resolve(__dirname, '..'), '')`, copying an explicit allow-list of the six AI variables —
      Vite reads env files from `client/` into `import.meta.env`, so without this the handlers see
      no key and fail with a `503` that looks like a missing key rather than a missing loader.
      No AI variable may be given a `VITE_` prefix or passed to `define:`.
      *Verify:* with `npm run dev` alone — no `vercel` process (AC-5.1):
      `curl -s localhost:5173/api/ai/health` returns JSON (adapter works, AC-5.2);
      `curl -s localhost:5173/api/projects` still reaches Express on 3001 (proxy intact, AC-5.2);
      editing `health.ts` changes the next response with no restart (AC-5.3);
      `curl -X DELETE localhost:5173/api/ai/health` returns 405 (AC-2.1). Confirm by reading the
      plugin that it calls the module's own `GET`/`POST` export, with no second implementation
      anywhere (AC-5.4). With a key in the repo-root `.env.local` and nothing exported in the shell,
      `/api/ai/health` reports `configured: true` — proving the env loader works, not just the
      adapter. Then confirm the key did **not** reach the browser:
      `npm run build:client`, then grep `client/dist/` for the key value, for `GEMINI_API_KEY` and
      for `AIza` - all three must be zero. Confirm path traversal is refused
      (`/api/ai/../_lib/http`, `/api/ai/..%2f_lib%2fhttp`, `/api/ai/_lib` -> 404 each), that editing
      a handler changes the next response with no restart, and that a probe route emitting chunks
      400ms apart arrives progressively under `curl -N` rather than all at once - 004 cannot be
      built locally if the adapter buffers. (AC-1.3, AC-5.1-5.4, Constitution III)

## Client layer

- [x] **T14 — `client/src/api/ai.ts`.** Add the `@api/*` path alias to `client/tsconfig.json` and
      `client/vite.config.ts` (mirroring the existing `@tileflow/geometry` alias) and import the
      DTOs from `@api/_lib/types` with **type-only** imports. Add the alias to `tsconfig` only, not
      to Vite's `resolve.alias`: type imports are erased, so Vite never resolves them, and adding
      it there would let a *value* import from `@api` succeed silently and bundle the key-reading
      path into the browser. Also export `ORDER_BUFFER` and make `StatsPanel.tsx` use it instead of
      its `* 1.1` literal, so the order quantity the user reads and the one a model is told cannot
      drift.
      `AiError` carrying the server `code`, one typed function per
      route (feature routes may be stubs until their specs land), a streaming reader helper, and
      `statsDto()` — the single mapping from store state to `LayoutStatsDTO`, reading `room`,
      `tileConfig`, `alignment`, `layout` and `system` from `useTileFlowStore`.
      Every function accepts an optional `AbortSignal`.
      *Verify:* `cd client && npx tsc --noEmit` clean. Prove the alias is type-only: wire a value
      import from `@api` into `main.tsx` and confirm `vite build` fails (an unreferenced probe file
      is tree-shaken and proves nothing). Verify `statsDto()` headlessly against the real engine
      rather than by eye — seed the store, run `optimize()`, and assert every field equals the
      engine's figure and that `orderQuantity` equals `StatsPanel`'s `buyCount` expression; repeat
      for a drawn L-shape with a cut-out (wallCount 6, holeCount 1, area excludes the hole); assert
      every numeric field is finite. (AC-6.1–6.3)

- [x] **T15 — `client/src/hooks/useAiAvailability.ts`.** Fetch `/api/ai/health` once, cache the
      result in module scope, return `{ configured, demoMode, loading }`.
      *Verify:* mount two components using the hook; the network tab shows exactly one request.
      (AC-6.4)

## Verification pass

- [x] **T16 — Full spec verification.** Run every check in the block below and record the result.

---

## Verification block

Run with `npm run dev` up. This is what `/spec-verify 001-ai-foundation` executes.

0. **On the right branch** — `git rev-parse --abbrev-ref HEAD` prints
   `feat/001-ai-foundation`, not `main`. (Constitution VIII)
1. **Health, unconfigured** — with `GEMINI_API_KEY` unset:
   `curl -s localhost:5173/api/ai/health` → `200 {"configured":false,...}`.
2. **Health, configured** — put the key in the repo-root `.env.local` (not the shell), restart,
   repeat → `"configured":true`. This is the check that catches a missing env loader. Grep the
   response for the key's first 6 characters: no match.
3. **Method guard** — `curl -i -X DELETE localhost:5173/api/ai/health` → `405` with `Allow`.
4. **Size guard** — POST a >cap body to any feature route → `413`, and confirm via server logs that
   no model call was made. (AC-2.2) **Deferred: no POST feature route exists until 002.** The
   primitive is covered directly by T6's tests (declared `Content-Length` over cap *and* a streamed
   body with no `Content-Length`, both → `too_large` → 413).
5. **Validation** — POST `{}` to a feature route → `400` with `details`. (AC-2.3) **Deferred with
   check 4**; T6 covers `readJson`'s Zod path returning the Express-shaped `details` body.
5b. **Guards precede the model** — repeat checks 3, 4 and 5 with `GEMINI_API_KEY` unset: each still
   returns `405`/`413`/`400`, never `503`, proving nothing reaches Gemini first. (AC-2.4)
6. **Rate limit** — loop past `AI_RATE_LIMIT_PER_MIN` → `429` with `Retry-After`.
7. **Budget fallback** — set `AI_DAILY_CALL_BUDGET=0`, restart → a feature route returns `200` with
   `demoMode: true`, not an error. (AC-4.3)
8. **Proxy intact** — `curl -s localhost:5173/api/projects` reaches Express (with the server
   running) or fails to connect to 3001 (with it stopped) — but is never handled by the AI adapter.
9. **No key, app unaffected** — load the app: draw a room, change tiles, watch the layout
   recompute. Console shows no AI-attributable error. (AC-7.1, AC-7.2)
   **Known, pre-existing:** Save/Load logs `404` on `/api/projects`. The Express server is not
   deployed and never has been — `README.md` documents this, and production returns the same 404
   on builds predating any AI work. It is a product gap, not an AI regression; do not chase it
   while verifying this spec.
10. **No leakage** — `git grep --untracked -iE "AIza" -- . ':!*.lock' ':!.claude/'` returns nothing;
    `git grep --untracked -nE "GEMINI_API_KEY|AIza" -- client/src/` returns nothing.
    Scope the second grep to `client/src/`, not `client/`: `client/vite.config.ts` legitimately
    names the variable in the dev loader's allow-list, and it is build-time Node config that is
    never bundled — check 10b is what proves the bundle itself is clean.
    `git status --porcelain | grep -E '\.env\.local|/\.env$'` returns nothing — note `.env.example`
    is *meant* to be committed, so a bare `\.env` pattern false-positives on it. (AC-3.4)
10b. **Key not in the bundle** — `npm run build:client`, then grep `client/dist/` for the key
    value and for `GEMINI_API_KEY`: no match. The dev loader writes to `process.env` in Node, so
    nothing should reach the browser — this proves it. (Constitution III)
11. **Types** — `npm run typecheck:api` and `cd client && npx tsc --noEmit` both clean. (By this
    point `api/` holds real modules; a `TS18003` here would mean the tree is empty, not that the
    config is wrong.)
12. **Existing tests** — `npm test --workspace @tileflow/geometry` still passes.
