# TileFlow AI — Roadmap

Index, sequencing and status for the Gemini integration. Start here.

## The idea in one paragraph

TileFlow already contains the hard part: a pure-TypeScript geometry engine that generates five tile
patterns, clips them against arbitrary drawn floor outlines with cut-outs, and runs a budgeted
two-phase optimizer to find the lowest-waste grid offset — all off the main thread. What it lacks
is a way in. You have to know what a ⅓ offset is, you have to draw your own L-shaped room corner by
corner, and when you get a result you have to interpret `smallestCutPiece` yourself. Gemini closes
those three gaps: it reads a photo of a floor plan and produces the outline, it turns
"12×24 herringbone squared to the window wall" into store mutations, and it turns a `LayoutResult`
into a brief an installer could work from. The engine keeps owning every number.

## Sequencing

```
001-ai-foundation  ──┬──▶ 002-photo-to-room       (vision → RoomShape)
   (blocks all)      ├──▶ 003-layout-assistant    (tool calling → store)
                     ├──▶ 004-installation-brief  (streamed, grounded)
                     └──▶ 005-cost-estimator      (structured output)
                                  │
                                  └──▶ Milestone 6 — demo narrative
```

001 must be complete and verified before any feature spec starts. 002–005 are independent of each
other and can be built in any order; the order below is by demo impact.

## Status

| # | Spec | Branch | Status | Route | Model call |
|---|---|---|---|---|---|
| 001 | [ai-foundation](001-ai-foundation/) | `feat/001-ai-foundation` | **Complete (17/17)** | `GET /api/ai/health` | — |
| 002 | [photo-to-room](002-photo-to-room/) | `feat/002-photo-to-room` | **In progress (10/12)** — live model calls blocked on API quota | `POST /api/ai/room-from-image` | vision + structured output |
| 003 | [layout-assistant](003-layout-assistant/) | `feat/003-layout-assistant` | Not started | `POST /api/ai/assistant` | tool calling, multi-turn |
| 004 | [installation-brief](004-installation-brief/) | `feat/004-installation-brief` | Not started | `POST /api/ai/brief` | streaming text |
| 005 | [cost-estimator](005-cost-estimator/) | `feat/005-cost-estimator` | Not started | `POST /api/ai/estimate` | structured output |
| 006 | Demo narrative | `feat/006-demo-narrative` | Not started | — | — |

Update the Status column as specs complete. `/spec-status` reports unchecked tasks across all of
them.

Every spec is built on its own branch, never on `main` — see
[Constitution VIII](CONSTITUTION.md#viii-every-feature-is-built-on-its-own-branch). The branch name
matches the spec directory name, and each spec's **T0** creates and switches to it. `main`
auto-deploys the live demo, so it stays clean.

## Feature summaries

**002 — Photo/sketch → room outline.** Upload a phone photo of a floor plan or a napkin sketch.
Gemini vision returns boundary vertices in millimetres; the client ghosts the proposed outline on
the Konva stage, validates it with the existing `validateShape()`, and applies it through
`setRoomShape()` on confirmation — which means undo, normalization and recompute all work for free.
The highest-impact demo, and the one that best shows the engine/model split.

**003 — Layout assistant.** A chat panel whose tools are the store's own actions. The server
returns requested calls; the client executes them against a whitelist and reports results back.
Shows agentic tool-use over a real application API rather than a toy.

**004 — Installation brief.** Streams a plain-English brief from the computed layout: where to
strike the first line, the cut list, a warning when the smallest cut is a sliver, why the order
includes 10%. Every figure is quoted from the input, never derived.

**005 — Cost estimator.** Material takeoff with editable unit prices. The model picks coverage
rates and waste factors and assembles line items; the client does all the arithmetic.

## Milestone 6 — Demo narrative

The engineering is only half of the point. These tasks make the work legible to someone scanning
for 90 seconds.

- [ ] Create the branch first: `git switch -c feat/006-demo-narrative` from an up-to-date `main`.
      (Constitution VIII)
- [ ] Add an **AI** section to `README.md`: the architecture diagram from
      `001-ai-foundation/design.md`, the engine-computes/model-narrates rule, and one line per
      feature with the Gemini capability it uses (vision, tool calling, structured output,
      streaming).
- [ ] Add the four AI routes to the API endpoint table in `README.md`.
- [ ] Update the Tech Stack table with `@google/genai` and Vercel Functions.
- [ ] Record a short screen capture of photo → outline → optimized layout → brief; embed as a GIF
      near the top of `README.md`.
- [ ] Write `docs/DEMO.md`: a 3-minute walkthrough script — what to click, what to say about the
      architecture at each step, and the two questions to expect ("why not let the model do the
      math?", "what stops a malicious image from driving your app?" — the answers are
      Constitution I and II).
- [ ] Confirm the deployed demo works end-to-end with `GEMINI_API_KEY` set in Vercel project
      settings, and that it falls back to demo mode rather than erroring when the cap trips.
- [ ] Confirm the deployed demo still works with the key *removed* — the planner must be fully
      functional for a visitor who arrives after the budget is spent.

## Conventions

- `requirements.md` — EARS phrasing (`WHEN <trigger> THE SYSTEM SHALL <response>`), numbered
  acceptance criteria (`AC-n.n`) that tasks can be traced back to.
- `design.md` — data flow, exact schemas, file paths, error taxonomy, and the decisions with their
  reasons. Anything an implementer would otherwise have to guess.
- `tasks.md` — checkboxes. Every task names the file it touches and how to prove it works.
- All rules in [`CONSTITUTION.md`](CONSTITUTION.md) apply to every spec without restatement, except
  where a spec restates one deliberately for emphasis.
