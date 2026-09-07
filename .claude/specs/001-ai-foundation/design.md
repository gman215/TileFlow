# 001 — AI Foundation · Design

## Verified API surface

Confirmed twice: against live documentation during planning (September 2026), and against the
**type definitions of the installed package** (`@google/genai@2.21.0`,
`node_modules/@google/genai/dist/genai.d.ts`, type `CreateModelInteraction` at ~line 2769) during
001/T3. Every field name below is snake_case in the SDK, not camelCase.

The SDK changed shape from the older `generateContent`/`config.responseSchema` form — **do not
write code from memory of the old API.** Re-verify against the installed `.d.ts` if the dependency
is ever bumped; that file is the ground truth, ahead of any documentation.

| Fact | Value |
|---|---|
| SDK package | `@google/genai` (the legacy `@google/generative-ai` is a different, older package) |
| Client | `new GoogleGenAI({})` — reads `GEMINI_API_KEY` from the environment |
| Call | `ai.interactions.create({ model, input, response_format, tools, stream, previous_interaction_id })` |
| Text out | `interaction.output_text` |
| Tool calls out | `interaction.steps[]`, entries with `step.type === 'function_call'` carrying `step.name`, `step.arguments`, `step.id` |
| Tool result in | input part `{ type: 'function_result', name, call_id, result: [{ type: 'text', text }] }`, sent with `previous_interaction_id` |
| Structured out | `response_format: { type: 'text', mime_type: 'application/json', schema: <JSON Schema> }` |
| System prompt | `system_instruction: string` — a **dedicated top-level field**. Put prompts here, not in `input` |
| Multi-turn retention | `store?: boolean` — "whether to store the response and request for later retrieval". See the note below |
| Text input part | `{ type: 'text', text: '...' }` |
| Image input part | `{ type: 'image', data: <base64>, mime_type: 'image/jpeg' }` (or `{ type:'image', uri, mime_type }` via the Files API) |
| Gemini request cap | 20 MB total for inline data + prompt |
| Streaming | `stream: true` returns an async iterable of events |
| Tool declaration | `{ type: 'function', name, description, parameters: <JSON Schema> }` |

### Models

| Env var | Default | Used by |
|---|---|---|
| `GEMINI_MODEL_FAST` | `gemini-3.8-flash` | assistant, brief, estimate |
| `GEMINI_MODEL_VISION` | `gemini-3.8-flash` | photo-to-room |
| `GEMINI_MODEL_CHEAP` | `gemini-3.5-flash-lite` | reserved for low-value calls |

All three are env-overridable so a model change is a deployment setting, not a code change.
`gemini-3.1-pro-preview` exists for harder reasoning but is not used by default — none of these
features need it, and it costs more.

### Vercel platform limits

| Limit | Value | Consequence |
|---|---|---|
| Request **and** response body | **4.5 MB** | Binding constraint for image upload — tighter than Gemini's 20 MB. Client-side downscaling is mandatory, not an optimization. Exceeding it yields `413 FUNCTION_PAYLOAD_TOO_LARGE`. |
| Max duration (Hobby) | 300s default and maximum | Comfortable for streaming; still set `maxDuration` explicitly so an unbounded call cannot burn the budget. |
| Streaming | Enabled by default for Node functions | Return a Web `Response` wrapping a `ReadableStream`. |
| Memory (Hobby) | 2 GB / 1 vCPU | Irrelevant here; these handlers are I/O bound. |

---

## Architecture

```
client (browser)                     /api/ai/*  (Vercel Node function)      Google AI Studio
────────────────                     ──────────────────────────────        ────────────────
Zustand store                        1. method + size guard
geometry Web Worker  ──── DTO ─────▶ 2. Zod validate inbound
  (owns every number)                3. rate limit / budget check
                                     4. build prompt + JSON schema  ──────▶  gemini-3.8-flash
                                     5. Zod validate model output   ◀──────
     typed result  ◀──── JSON ────── 6. shape response, map errors
apply via whitelist only
```

The handlers are **pure LLM adapters**. They contain no geometry: the client sends
already-computed statistics, and the client applies whatever comes back. This is why
`api/_lib/types.ts` defines its own narrow DTOs instead of importing `@tileflow/geometry` — the
functions need nothing from it at runtime, and keeping the workspace package out of the bundle
avoids a TypeScript-resolution failure mode in the Vercel builder (the package's `main` points at
raw `.ts` source).

`import type` from the geometry package is still forbidden in `api/` for the same reason: keep the
boundary total and obvious.

---

## Handler convention

Web-standard handlers, Vercel's documented convention for non-framework projects:

```ts
// api/ai/health.ts
export async function GET(request: Request): Promise<Response> { ... }

// api/ai/brief.ts
export async function POST(request: Request): Promise<Response> { ... }
```

Chosen over the older `(req: VercelRequest, res: VercelResponse)` signature because streaming falls
straight out of returning a `Response` wrapping a `ReadableStream`, and because the same function
signature is what the Vite dev adapter can call directly.

**Handler shape.** Vercel's own quickstart shows `export default { async fetch(request) {…} }` as
the recommended form for a non-framework project, and notes that named HTTP-method exports
(`export async function GET/POST`) still work — the streaming docs use the named form. We use named
exports: they make method routing explicit, they pair with `methodGuard`, and the dev adapter can
dispatch on `mod[request.method]`. If Vercel ever drops the named form, the adapter and the
handlers change together; nothing else does.

**Helper modules must not become routes.** `api/_lib/*.ts` are libraries, not endpoints. Two
defences, because one of them rests on a convention this project has not verified:

1. The `functions` glob in `vercel.json` is `api/ai/*.ts`, not `api/**/*.ts`. The broad glob also
   matched every helper in `_lib`, which is not what the config is for.
2. Vercel skips `_`-prefixed files and directories when detecting routes — which is why the
   directory is named `_lib`. The docs consulted here never stated it, so it was **verified against
   a real preview deployment** (2026-09-07): `/api/_lib/http` returns `404: NOT_FOUND`. Re-check
   this if the directory is ever renamed without the underscore.

Publishing `_lib` would expose the shape of the prompts and the guard logic. It would not expose
the key — that is only ever read inside a handler and never returned (Constitution III) — but it is
not something to leave to an unverified assumption.

**Location: repo-root `/api`, not `client/api`.** Functions are discovered at
`<Root Directory>/api/**`, so this depends on a deployment setting:

> ⚠️ **Deployment prerequisite.** The Vercel project's **Root Directory must be blank** (the repo
> root). It was originally set to `client` with all four build overrides OFF — meaning the live
> site was really built by the Vite preset's defaults *relative to `client/`* (`npm run build`,
> output `dist`), and the settings the README documented were never actually applied. Under that
> configuration a repo-root `vercel.json` is outside the project root and is **silently ignored**,
> and functions would be looked for at `client/api/`.
>
> If anyone re-points Root Directory at a subdirectory later, `vercel.json` stops being read and
> the AI routes 404 with no build error. That failure is invisible — check this setting first when
> the routes are missing in production but work locally.

With Root Directory blank, `vercel.json` supplies everything: framework preset, build command,
output directory, install command (npm workspaces installs `@tileflow/geometry` for the client),
and the functions config. The deployment is then fully described by the repo.

**Dependencies go in the root `package.json`.** Root-level `/api` resolves from root
`node_modules`. `@google/genai` and `zod` are therefore *runtime* dependencies of the root package,
which currently declares only `devDependencies`.

---

## Modules

### `api/_lib/genai.ts`
```ts
export type ModelRole = 'fast' | 'vision' | 'cheap';
export function getClient(): GoogleGenAI;      // memoized; throws ApiError('config') with no key
export function modelFor(role: ModelRole): string;
export const TIMEOUT_MS = { standard: 30_000, streaming: 55_000 };
export function timeoutSignal(ms: number): AbortSignal;
export function isConfigured(): boolean;   // key present — drives /api/ai/health
```
Memoized in module scope so a warm invocation reuses the client across requests. The cache is
keyed on the API key rather than on mere presence, so a changed environment yields a new client
instead of a stale one.

**Both timeouts must stay under `vercel.json`'s `maxDuration` (60s).** An earlier draft specced
`streaming: 120_000`, which can never fire: the platform would kill the function at 60s and return
its own `504 FUNCTION_INVOCATION_TIMEOUT`, which the client cannot map to our taxonomy. 55s leaves
the timeout ours, so a hung upstream surfaces as a `502 code:upstream` the UI already knows how to
present. If `maxDuration` is ever raised, raise these with it — they are a pair.

### `api/_lib/http.ts`
Mirrors the concerns of the existing `server/src/middleware/index.ts`, adapted to Web handlers.

```ts
export type ErrorCode =
  | 'bad_request' | 'too_large' | 'rate_limited'
  | 'upstream' | 'config' | 'internal';

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string, public detail?: unknown) {}
}

export function json(data: unknown, init?: ResponseInit): Response;
export function methodGuard(request: Request, allowed: 'POST' | 'GET'): Response | null;
export async function readJson<T>(request: Request, schema: ZodSchema<T>, maxBytes: number): Promise<T>;
export function toResponse(err: unknown): Response;   // maps code -> status, strips detail
```

Status mapping (AC-3.1):

| code | status | client meaning |
|---|---|---|
| `bad_request` | 400 | the request was wrong; don't retry unchanged |
| `too_large` | 413 | shrink the payload and retry |
| `rate_limited` | 429 | retry after `Retry-After` |
| `upstream` | 502 | the model failed; retrying may work |
| `config` | 503 | AI is not configured on this deployment |
| `internal` | 500 | a bug |

`toResponse` logs the full error server-side (`console.error`) and returns only
`{ error: <generic message>, code }`. Zod failures additionally return `details`, matching the
existing Express shape so the two APIs feel like one.

### `api/_lib/schemas.ts`
For each structured-output route, a pair:

```ts
export const ROOM_FROM_IMAGE_JSON_SCHEMA = { type: 'object', properties: { ... }, required: [...] };
export const RoomFromImageOut = z.object({ ... });   // the mirror we actually trust
```

The JSON Schema goes to `response_format.schema`; the Zod mirror validates what comes back. They
are always edited together — the model is *asked* for a shape, it is not *guaranteed* to produce it.
The mirror is deliberately the stricter of the two: the JSON Schema asks for "an array of points",
the mirror caps it at 60, so a runaway generation cannot become a room with 5,000 corners.

Three helpers make every structured route fail identically:

```ts
export function schemaPair<T>(name, jsonSchema, out: ZodType<T>): SchemaPair<T>;
export function responseFormat<T>(pair): { type: 'text'; mime_type: string; schema: object };
export function parseModelJson<T>(pair: SchemaPair<T>, text: string | null | undefined): T;
```

`parseModelJson` throws `upstream` (502) — never `internal` (500) — for missing text, non-JSON
text, and schema failure alike. A model returning something unusable is an expected condition, not
a bug in us, and 502 is what gives the client its retry affordance. The offending text is logged
(bounded to 400 characters) and never returned: it can quote our own prompt back at us.

### `api/_lib/prompts.ts`
Versioned exported constants only. Never inline a prompt at a call site.

These are passed as the call's **`system_instruction`**, not concatenated into `input` —
`CreateModelInteraction` has a dedicated top-level field for exactly this, and `input` is reserved
for the turn's actual content (the user's message, the image, the facts block). Compose the common
preamble and the feature prompt into one string:

```ts
system_instruction: `${SYSTEM_COMMON_V1}\n\n${BRIEF_V1}`
```

```ts
export const SYSTEM_COMMON_V1 = `...engine owns the numbers, never invent figures...`;
export const ROOM_FROM_IMAGE_V1 = `...`;
export const ASSISTANT_V1 = `...`;
export const BRIEF_V1 = `...`;
export const ESTIMATE_V1 = `...`;
```

### Multi-turn and `store` — verify before relying on it

`previous_interaction_id` is how 003 carries conversation context without resending prior turns.
The SDK also exposes `store?: boolean` — *"whether to store the response and request for later
retrieval"*. It is plausible that referencing a prior interaction requires that interaction to have
been stored, but **this has not been verified against the live API** — it needs a real key and two
chained calls, which 001 does not have a task for.

So: 003/T2 must confirm empirically whether a second call with `previous_interaction_id` succeeds
when the first was made without `store: true`. If it fails, set `store: true` on assistant calls
and record that here. Do not assume either way, and do not silently set `store: true` "just in
case" — storing prompts server-side is a data-retention decision worth making deliberately.

### `api/_lib/guard.ts`
```ts
export function checkRateLimit(request: Request, route: string, nowMs?: number): void;  // throws 'rate_limited'
export function budgetExhausted(nowMs?: number): boolean;               // global daily cap
export function noteModelCall(nowMs?: number): void;
export function budgetStatus(nowMs?: number): { used: number; limit: number; day: string };
export function callerKey(request: Request): string;
```

Per-IP token bucket keyed on `x-forwarded-for`, plus a global daily counter, both in module-scope
`Map`s. `nowMs` is a test seam: refill and day-rollover are otherwise only testable by waiting.

Four details that are easy to get wrong:

- **`x-forwarded-for` is a list** — `"client, proxy1, proxy2"`. The client is the *first* entry.
  Using the whole string, or the last entry, buckets every caller behind a shared proxy together.
- **`0` is a meaningful configured value, and `Number('')` is `0`.** A blank or malformed variable
  must fall back to the default while a literal `0` survives — otherwise merely unsetting
  `AI_DAILY_CALL_BUDGET` silently closes every route. A configured limit of `0` means *closed*,
  never *unlimited*.
- **There is no `x-forwarded-for` locally**, so all callers share a `local` bucket. That keeps the
  limiter exercised in development, rather than the silent disabling an "allow everything"
  fallback would produce.
- **The day boundary is UTC**, so the reset point does not move with the host's locale. The bucket
  map is swept of fully-refilled entries once it passes 1000, since a fully-refilled bucket is
  indistinguishable from a new one.

**Documented limitation:** serverless instances are ephemeral and concurrent, so these counters are
per-instance and reset on cold start. This is deliberately best-effort — it stops casual abuse and
runaway loops, not a determined attacker. The upgrade path when it matters is Vercel KV or Upstash
Redis with the same function signatures, so only the bodies change.

When `budgetExhausted()` is true, routes return `200` with canned content and `demoMode: true`
(AC-4.3) rather than an error, so the deployed demo always demonstrates something.

### `api/_lib/types.ts`
Narrow DTOs shared by handlers, duplicated intentionally from the geometry types:

```ts
export interface LayoutStatsDTO {
  system: 'metric' | 'imperial';
  room: { widthMm: number; heightMm: number; areaMm2: number; perimeterMm: number;
          wallCount: number; holeCount: number; referenceWall: number | null; isDrawn: boolean };
  tile: { widthMm: number; heightMm: number; groutMm: number; pattern: string; alignment: string };
  layout: { fullTileCount: number; cutTileCount: number; totalTiles: number;
            wastePercentage: number; smallestCutPieceMm2: number; roomAreaMm2: number;
            orderQuantity: number };
}
```

`client/src/api/ai.ts` owns the single mapping from store state to this DTO, so the four features
cannot drift in what they report.

`AiHealthDTO` lives here too — it is the one shape both sides need.

**Sharing these types with the client (T14).** The client must not redeclare them; two copies of a
DTO drift the moment one side gains a field. Add `"@api/*": ["../api/*"]` to `client/tsconfig.json`
`paths`, and client code does `import type { LayoutStatsDTO } from '@api/_lib/types'`.

**Add it to `tsconfig` only — deliberately NOT to Vite's `resolve.alias`.** Type imports are erased
at compile time, so Vite never needs to resolve them. Adding the alias there too would make a
*value* import from `@api` succeed silently, bundling `@google/genai` and the key-reading path into
the browser. With tsconfig-only, `tsc` still resolves the types while a value import fails at build
with a Rollup "invalid resolved id" — verified by wiring such an import into `main.tsx` and
confirming `vite build` exits non-zero.

This is the inverse of the usual advice, and the reason is that the alias points at server code.

### `api/ai/health.ts`
`GET` → `{ configured: boolean, demoMode: boolean, models: { fast, vision } }`, status 200 always.
Never reveals the key, only whether one is present. Drives AC-6.4 and AC-7.3.

---

## Local development adapter

`npm run dev` must keep working as the single command (AC-5.1). A Vite plugin mounts the same
handler modules the Vercel runtime will run.

```ts
// client/vite.config.ts
function aiDevServer(): Plugin {
  return {
    name: 'tileflow-ai-dev',
    configureServer(server) {
      // Registered DIRECTLY (not via a returned post-hook) so this middleware is
      // installed ahead of Vite's proxy middleware and wins for /api/ai/*.
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/ai/')) return next();
        // 1. resolve /api/ai/<name> -> ../api/ai/<name>.ts
        // 2. server.ssrLoadModule(path)  <- gives hot reload (AC-5.3)
        // 3. adapt Connect req -> Web Request (method, headers, body stream)
        // 4. call mod[req.method]  <- the same export Vercel calls (AC-5.4)
        // 5. adapt Web Response -> Connect res, piping the body for streaming
      });
    },
  };
}
```

Ordering matters: the existing `server.proxy['/api']` sends everything under `/api` to Express on
`:3001`. Registering this middleware directly inside `configureServer` places it before the proxy,
so `/api/ai/*` is intercepted and `/api/projects*` still proxies untouched (AC-5.2).

### Getting the key into `process.env`

**Vite will not do this for you, and the failure is silent.** Two separate gaps:

1. Vite's `envDir` defaults to the Vite root — `client/` — so a repo-root `.env.local` is never
   read at all.
2. Vite loads env files into `import.meta.env`, not `process.env`. `getClient()` reads
   `process.env.GEMINI_API_KEY`, so it would throw `ApiError('config')` even with the key filled
   in correctly, and the symptom is a `503` that looks like a missing key rather than a missing
   loader.

Fix it in `client/vite.config.ts` using Vite's own `loadEnv` — no new dependency:

```ts
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // '' as the prefix loads EVERY var, not just VITE_ ones. Repo root, not client/.
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  for (const k of ['GEMINI_API_KEY', 'GEMINI_MODEL_FAST', 'GEMINI_MODEL_VISION',
                   'GEMINI_MODEL_CHEAP', 'AI_DAILY_CALL_BUDGET', 'AI_RATE_LIMIT_PER_MIN']) {
    if (env[k] && !process.env[k]) process.env[k] = env[k];
  }
  return { /* ...existing config, plus aiDevServer() */ };
});
```

Copy an explicit allow-list of keys rather than `Object.assign(process.env, env)` — the latter
would splatter every variable in the file into the dev server's environment.

This stays server-side: Vite only ever inlines `VITE_`-prefixed variables into the browser bundle,
and assigning to `process.env` inside the config runs in Node. Constitution III still holds — but
it is now load-bearing that **no AI variable is ever given a `VITE_` prefix**, and that these keys
are never passed to `define:`.

In production none of this applies: Vercel injects the environment into the function directly.

The adapter must handle a streaming `Response` by piping `response.body` to the Node response
rather than buffering, or 004 cannot be developed locally.

`vercel dev` remains a documented fallback if the adapter ever misbehaves; it is not a dependency.

---

## Client layer

`client/src/api/ai.ts` — mirrors the structure of the existing `client/src/api/client.ts`:

```ts
export class AiError extends Error { code: ErrorCode }
export const ai = {
  health(): Promise<AiHealth>;
  roomFromImage(body, signal?): Promise<RoomFromImageResult>;
  assistant(body, signal?): Promise<AssistantResult>;
  brief(body, signal?): AsyncIterable<string>;   // streaming
  estimate(body, signal?): Promise<EstimateResult>;
};
export function statsDto(): LayoutStatsDTO;      // the single store -> DTO mapping
```

`client/src/hooks/useAiAvailability.ts` — fetches `/api/ai/health` once on mount, caches the result
in module scope, and returns `{ configured, demoMode, loading }` so entry points can render
disabled with an explanation rather than failing on click (AC-6.4, AC-7.3).

---

## Configuration files

**`vercel.json`** (new, repo root) — pins function duration and mirrors the settings currently held
only in the Vercel dashboard, so the deployment is reproducible from the repo:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build:client",
  "outputDirectory": "client/dist",
  "installCommand": "npm install",
  "functions": { "api/ai/*.ts": { "maxDuration": 60 } }
}
```

`framework` is pinned deliberately: with the dashboard no longer supplying the Root Directory, the
preset would be the last setting the repo could not describe.

`maxDuration: 60` is well under the Hobby ceiling of 300s — a deliberate cost guard
(Constitution VII), not a platform limit.

No SPA fallback rewrite is included, and none should be added: the client has no router
dependency, so every visit is `/`. A catch-all rewrite would additionally have to be written to
exclude `/api/*`.

⚠️ `vercel.json` **overrides** dashboard settings for the fields it declares, and requires the
Root Directory change above to be read at all. Deploy to a preview URL before production.

**`.gitignore`** — currently lists `.env` only. Vercel's convention is `.env.local`, which the
current pattern does **not** match, so a key written there today would be committed. Add:

```
.env.local
.env*.local
.vercel
```

This task comes before any task that writes a real key to disk.

**`.env.example`** (new, repo root):

```
GEMINI_API_KEY=
GEMINI_MODEL_FAST=gemini-3.8-flash
GEMINI_MODEL_VISION=gemini-3.8-flash
GEMINI_MODEL_CHEAP=gemini-3.5-flash-lite
AI_DAILY_CALL_BUDGET=500
AI_RATE_LIMIT_PER_MIN=10
```

Copied to `.env.local` for local work. Note that **nothing reads `.env.local` by default** — see
[Getting the key into `process.env`](#getting-the-key-into-processenv); the dev server has to be
told to load it.

**`api/tsconfig.json`** (new) — the root `tsconfig.json` is solution-style with `"files": []` and
project references, and references require composite projects that emit. These handlers don't emit
(Vercel bundles them), so `api/` gets a standalone non-composite config and a root
`typecheck:api` script rather than a new reference entry.

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"], "types": ["node"],
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "noEmit": true, "isolatedModules": true
  },
  "include": ["**/*.ts"]
}
```

`"lib": ["DOM"]` supplies `Request`, `Response`, `ReadableStream` and `AbortSignal` types.
`@types/node` must be declared in the **root** `devDependencies` for `types: ["node"]` to resolve;
it is otherwise only present by hoisting from `server/`.

Note that `tsc -p api` reports `TS18003: No inputs were found` while `api/` holds no `.ts` files —
including under `--showConfig`. That is correct behaviour, not a broken config; the script only
runs clean from T6 onward.

---

## Failure behaviour

| Condition | Server | Client |
|---|---|---|
| No `GEMINI_API_KEY` | `503 code:config`; health says `configured:false` | AI entry points disabled with one-line reason; planner untouched |
| Per-IP limit hit | `429` + `Retry-After` | "Too many requests — try again in Ns" |
| Daily budget spent | `200` + canned content + `demoMode:true` | Content shown with a "demo mode" badge |
| Model 5xx / timeout | `502 code:upstream` | "The assistant is unavailable right now"; retry offered |
| Model output fails Zod | `502 code:upstream` | Same as above; **nothing is applied to the store** |
| Client offline | fetch rejects | Message; no state change |

The rule from Constitution IV: no path may leave a spinner running. Every request has a `finally`
that clears its pending state — the same discipline `useLayoutWorker.ts` applies with its
`WorkerErrorResponse` branch.
