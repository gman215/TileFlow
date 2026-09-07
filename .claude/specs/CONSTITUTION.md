# TileFlow AI Constitution

The rules every AI feature in this repo is held to. They are not style preferences — a feature
that violates one of these is not done, regardless of whether it works.

Read this before writing any code under `api/` or `client/src/components/AI/`.

---

## I. The engine computes. Gemini narrates.

`packages/geometry` is the single source of truth for every number in this application: tile
counts, areas, waste percentages, cut sizes, offsets, scores. It is deterministic, unit-tested,
and it runs in a Web Worker in the user's browser.

**No number rendered to the user may originate from a language model.**

Concretely:

- The installation brief *quotes* figures handed to it in its prompt. It never derives new ones.
- The cost estimator returns **quantities and unit rates**; the client multiplies and sums. If the
  model says "24 tiles at $3.50", the client computes `84.00` — the model's own arithmetic is
  discarded even when it is correct.
- The photo-to-room feature returns **geometry** (vertices), which then goes through the existing
  `normalizeShape()` / `computeLayout()` path like any hand-drawn outline. Its area and tile count
  come from the engine, not from the vision model.

*Why:* this is the whole architectural argument of the project. An LLM that does arithmetic is a
liability; an LLM that reads a photo and hands the result to a solver is an interface. The
distinction is the thing worth defending in a code review or an interview.

## II. Model output is untrusted input.

Everything that comes back from Gemini is parsed with Zod before it reaches application state.
A response that fails to parse is an error, not a warning — the feature reports it and changes
nothing.

Assistant tool calls execute **client-side against a fixed whitelist** of existing store actions.
There is no dynamic dispatch, no `eval`, no name-to-function lookup that accepts an arbitrary
string. A tool name that is not in the whitelist is dropped and logged.

*Why:* an uploaded floor-plan image is attacker-controlled content, and it is fed to a model whose
output can request actions. The blast radius must stay at "the tile pattern changed unexpectedly".
It must never reach the network, the API key, or the project database.

## III. The API key never leaves the server.

- `GEMINI_API_KEY` is read only inside `api/` handlers, from `process.env`.
- It is never sent to the client, never embedded in a bundle, never logged, and never included in
  an error message or a stack trace returned over HTTP.
- No `VITE_`-prefixed variable may ever hold a provider credential — Vite inlines those into the
  browser bundle by design.
- Local secrets live in `.env.local`, which must be listed in `.gitignore` before the first key is
  written to disk.

Provider errors are mapped to our own taxonomy before they cross the wire. Raw upstream error text
is logged server-side and replaced with a generic message in the response.

## IV. Every AI surface degrades to a working app.

The planner — draw a room, pick a tile, get an optimized layout — must keep working perfectly when:

- `GEMINI_API_KEY` is unset (local contributor without a key, or a fork),
- the rate limiter or the daily budget cap has tripped,
- the model returns garbage, times out, or 5xxs,
- the user is offline.

In each case the AI panel shows a plain, non-alarming message and every other feature is untouched.
No AI failure may leave the UI in a spinning or wedged state — the same discipline the layout worker
already applies with its `WorkerErrorResponse` path.

## V. No AI call sits on the render path.

Gemini is never called during layout computation, during a drag, on a store subscription, or in a
`useEffect` that fires on config change. Every AI call is explicitly user-initiated (a button, a
submitted message, an uploaded file) and runs outside the debounced worker pipeline in
`useLayoutWorker.ts`.

*Why:* the app's core promise is a live canvas at 150ms debounce. A network call in that loop
destroys it.

## VI. Prompts are versioned constants.

All system prompts live in `api/_lib/prompts.ts` as exported constants with a version suffix
(`ROOM_FROM_IMAGE_V1`). Never inline a prompt string at a call site. When a prompt changes
behaviour, bump the version rather than editing in place, so a regression can be bisected.

Response JSON Schemas live in `api/_lib/schemas.ts`, each paired with the Zod mirror used to
validate what actually comes back. The two are edited together, always.

## VII. Cost is a design constraint, not an afterthought.

This is a public demo funded by a personal API key. Every route is behind a per-IP token bucket and
a global daily counter. When the cap trips, the route returns canned demo content with a visible
"demo mode" label rather than an error — a visiting recruiter sees the feature, not a 429.

Image uploads are downscaled client-side before they are sent. Cheap models are used for cheap
work.

## VIII. Every feature is built on its own branch.

No spec's work happens on `main`. Before the first task of a spec is started, create its branch and
switch to it:

```bash
git switch -c feat/002-photo-to-room     # branch name == spec directory name
```

- **Naming:** `feat/<spec-directory-name>` — `feat/001-ai-foundation`, `feat/002-photo-to-room`,
  `feat/003-layout-assistant`, `feat/004-installation-brief`, `feat/005-cost-estimator`,
  `feat/006-demo-narrative`. The branch name matches the spec folder exactly, so a branch, a spec
  and a set of commits are trivially traceable to each other.
- **One branch per spec, not per task.** All of a spec's tasks land on the same branch; the spec is
  the unit of work.
- **Branch from an up-to-date `main`.** Since 001 blocks 002–005, a feature branch is cut only once
  001 is merged. If 001 is not merged yet, that is the signal not to start the feature — not a
  reason to branch off a branch.
- **Confirm before editing.** `git rev-parse --abbrev-ref HEAD` must print the expected branch
  before the first file is touched. Discovering three commits later that the work went to `main` is
  a bad afternoon.
- **Do not merge, push or open a PR unless asked.** Creating and switching to the branch is part of
  the workflow; publishing it is a decision the author makes.

*Why:* `main` auto-deploys to the live demo at `tile-flow-client.vercel.app`. A half-finished AI
route on `main` is a broken page in front of whoever is looking at it right now — which, for a
portfolio project, is the entire audience. Branching also keeps each feature's diff reviewable on
its own, which is the thing a recruiter reading the commit history actually sees.

---

## Review gate

A feature spec is complete when **all** of the following hold:

1. Every checkbox in its `tasks.md` is ticked.
2. Its verification block passes end-to-end in a browser against `npm run dev`.
3. It passes with `GEMINI_API_KEY` unset — the app works, the feature explains itself.
4. It passes with the network throttled to slow 3G — no wedged spinners, no unhandled rejection.
5. `npm run typecheck:api` and `npm test` are clean.
6. `git grep --untracked -i "AIza" -- . ':!*.lock' ':!.claude/'` returns nothing.
7. The work is on the spec's own branch (`feat/<spec-directory-name>`), not on `main`.

**On that grep:** `--untracked` is not optional. Plain `git grep` searches only tracked files, and
new work under `api/`, `client/src/ai/` and `client/src/components/AI/` is untracked until it is
committed — so the leak check would pass on a file that contains a live key. `--untracked` searches
exactly the set of files that could be committed, and still skips `.gitignore`d ones, so a key in
`.env.local` is correctly not a finding. Note also that `-u` is **not** a valid short form: git
prints a usage error, and `git grep -u … 2>/dev/null | wc -l` then reports `0` for an invalid
command exactly as it would for a clean repo. Never pipe a security check through `2>/dev/null`.

Do not tick a task you have not verified. An unticked box is information; a wrongly ticked one is a
lie that costs someone an afternoon.
