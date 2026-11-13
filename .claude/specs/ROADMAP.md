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

002 ──▶ 007-upstream-resilience   (hardens the shared failure path; see its requirements.md)

008-floor-plan ──▶ 009-wall-framing   (walls & rooms, then studs, openings and takeoff)
```

001 must be complete and verified before any feature spec starts. 002–005 are independent of each
other and can be built in any order; the order below is by demo impact.

## Status

| # | Spec | Branch | Status | Route | Model call |
|---|---|---|---|---|---|
| 001 | [ai-foundation](001-ai-foundation/) | `feat/001-ai-foundation` | **Complete (17/17)** | `GET /api/ai/health` | — |
| 002 | [photo-to-room](002-photo-to-room/) | `feat/002-photo-to-room` | **Complete (12/12)** — verified against live model calls 2026-09-12 | `POST /api/ai/room-from-image` | vision + structured output |
| 003 | [layout-assistant](003-layout-assistant/) | `feat/003-layout-assistant` | **Complete (12/12)** — verified in the browser 2026-11-08 on `gemini-3.5-flash-lite`, the default since 006 | `POST /api/ai/assistant` | tool calling, multi-turn |
| 004 | [installation-brief](004-installation-brief/) | `feat/004-installation-brief` | **Complete (11/11)** — verified in the browser 2026-11-08 on `gemini-3.5-flash-lite`, the default since 006 | `POST /api/ai/brief` | streaming text |
| 005 | [cost-estimator](005-cost-estimator/) | `feat/005-cost-estimator` | **Complete (11/11)** — verified in the browser 2026-11-08 on `gemini-3.5-flash-lite`, the default since 006 | `POST /api/ai/estimate` | structured output |
| 006 | Demo narrative | `feat/006-demo-narrative` | In progress (6/8) — README, GIF and `docs/DEMO.md` done; the two deployed-demo checks are blocked (see Milestone 6) | — | — |
| 007 | [upstream-resilience](007-upstream-resilience/) | `feat/007-upstream-resilience` | **Complete (8/8)** — provider refusals degrade to demo content | — | — |
| 008 | [floor-plan](008-floor-plan/) | `feat/008-floor-plan` | **Complete (21/21)** — walls, derived rooms, per-room layouts, pattern groups; verified in browser and against Postgres | — | — |
| 010 | [ux-onboarding](010-ux-onboarding/) | `feat/010-ux-onboarding` | **Complete (10/10)** — Start card & examples, one-gesture rooms, auto-rooms, toolbar & shortcuts, instruction line, stepped sidebar | — | — |
| 009 | [wall-framing](009-wall-framing/) | `feat/009-wall-framing` | **Complete (14/14)** — studs, openings, junction backing, takeoff, elevations; verified in browser and against Postgres | — | — |
| 011 | [layout-control](011-layout-control/) | `feat/011-layout-control` | **Complete (13/13)** — resizable sidebar, edit a wall's length on the wall, centre the layout on a feature (cut-out centre or edge, or a point) with full tiles from an edge; verified in the browser and against Postgres | — | — |
| 012 | [installer-output](012-installer-output/) | `feat/012-installer-output` | **Complete (8/8)** — dimensioned cut list (drawer, CSV, letters on the plan), printable set-out sheet with dimensioned start lines (PDF via the browser), order by the box; verified in the browser and against Postgres | — | — |
| 013 | [patterns-and-shapes](013-patterns-and-shapes/) | `feat/013-patterns-and-shapes` | **Complete (6/6)** — ¼ offset, basketweave, checkerboard (two colours, ordered apart), hexagon; the 33 % offset rule (ANSI A108.02); verified in the browser and against Postgres. Windmill, Versailles, chevron and random plank moved to 017 (they need several tiles per room) | — | — |
| 014 | wall-tiling *(proposed)* | — | Proposed — showers, tub surrounds, backsplashes as tiled elevations with openings | — | — |
| 015 | ordering-accuracy *(proposed)* | — | Proposed — choosable buffer, offcut reuse, attic stock, boxes across surfaces | — | — |
| 016 | shower-floors *(proposed)* | — | Proposed — drains, slope, envelope cuts, curbs, niches; movement joints (EJ171) | — | — |
| 017 | borders-and-mixed *(proposed)* | — | Proposed — borders, feature strips, inlays, several tiles per room; windmill/pinwheel, Versailles, chevron and random plank (from 013) | — | — |
| 018 | on-site-use *(proposed)* | — | Proposed — tablet/phone layout, offline PWA | — | — |
| 019 | visuals *(proposed)* | — | Proposed — tile images, grout colour, customer PDF quote, 3D later | — | — |

Update the Status column as specs complete. `/spec-status` reports unchecked tasks across all of
them.

Every spec is built on its own branch, never on `main` — see
[Constitution VIII](CONSTITUTION.md#viii-every-feature-is-built-on-its-own-branch). The branch name
matches the spec directory name, and each spec's **T0** creates and switches to it. `main`
auto-deploys the live demo, so it stays clean.

## Next: from the competitive analysis

See [`COMPETITIVE-ANALYSIS.md`](COMPETITIVE-ANALYSIS.md) — 11 competing tools compared for tile
installation. Recommended order: 011 → 012 → 013 → 014 → 015 → 016 → 017 → 018 → 019. 011, 012 and 013 are done.

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

- [x] Create the branch first: `git switch -c feat/006-demo-narrative` from an up-to-date `main`.
      (Constitution VIII)
- [x] Add an **AI** section to `README.md`: the architecture diagram from
      `001-ai-foundation/design.md`, the engine-computes/model-narrates rule, and one line per
      feature with the Gemini capability it uses (vision, tool calling, structured output,
      streaming).
- [x] Add the four AI routes to the API endpoint table in `README.md`. *(All five are documented:
      health, room-from-image, assistant, brief, estimate — plus the Features and AI sections.)*
- [x] Update the Tech Stack table with `@google/genai` and Vercel Functions.
- [x] Record a short screen capture of photo → outline → optimized layout → brief; embed as a GIF
      near the top of `README.md`. *(`docs/demo.gif`, 0.24 MB, recorded in headless Chromium from
      `docs/kitchen-plan.png` against the dev server.)*
- [x] Write `docs/DEMO.md`: a 3-minute walkthrough script — what to click, what to say about the
      architecture at each step, and the two questions to expect ("why not let the model do the
      math?", "what stops a malicious image from driving your app?" — the answers are
      Constitution I and II).
- [ ] Confirm the deployed demo works end-to-end with `GEMINI_API_KEY` set in Vercel project
      settings, and that it falls back to demo mode rather than erroring when the cap trips.
      *Checked 2026-11-08. First run **failed**: the deployed fast model, `gemini-3.8-flash`, opened
      the brief stream and wrote nothing for 60.8 s. After the default moved to
      `gemini-3.5-flash-lite` (`1bd4995`), the `docs/DEMO.md` walkthrough **passed end to end on
      the live site**: plan photo → 15.70 m² outline → assistant (60 × 30 cm, ½ offset) → brief →
      estimate, no page errors. One defect surfaced: once, the assistant reset the drawn outline
      to a rectangle without being asked (0 of 15 reproductions since) — guard pending.
      Still open: the cap trip on the deployment itself (verified in dev with
      `AI_DAILY_CALL_BUDGET=0`; tripping it live means spending the day's budget).*
- [ ] Confirm the deployed demo still works with the key *removed* — the planner must be fully
      functional for a visitor who arrives after the budget is spent.
      *Needs Vercel project access to remove the key. The equivalent was verified in dev for every
      AI feature (key set to a blank value): controls disabled with a reason, planner untouched.*

## Conventions

- `requirements.md` — EARS phrasing (`WHEN <trigger> THE SYSTEM SHALL <response>`), numbered
  acceptance criteria (`AC-n.n`) that tasks can be traced back to.
- `design.md` — data flow, exact schemas, file paths, error taxonomy, and the decisions with their
  reasons. Anything an implementer would otherwise have to guess.
- `tasks.md` — checkboxes. Every task names the file it touches and how to prove it works.
- All rules in [`CONSTITUTION.md`](CONSTITUTION.md) apply to every spec without restatement, except
  where a spec restates one deliberately for emphasis.
