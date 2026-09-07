# 004 — Installation Brief · Requirements

**Status:** Not started
**Depends on:** 001-ai-foundation (complete and verified)
**Gemini capability:** streaming text, grounded on engine output

## Purpose

The stats card gives you `Order to buy 143`, `Waste 8.4%`, `Full 118 · Cut 25`. Those are the right
numbers, and they are useless to anyone who has not laid a floor before. The brief turns them into
the thing a tiler would actually write on the back of the plan: where to strike the first line,
what the cut list looks like, which cuts are going to be awkward, and why you are buying 10% extra.

This is the clearest demonstration of the project's central rule — **every figure in the brief was
computed by the geometry engine and is quoted, never derived.** The model contributes domain
language and structure, nothing numeric.

---

## R1 — Grounding

**WHEN** the brief is generated
**THE SYSTEM SHALL** use only figures supplied in the request.

- **AC-1.1** The request carries a complete `LayoutStatsDTO`: full/cut counts, total, waste %,
  smallest cut piece, room area, perimeter, wall count, hole count, pattern, alignment, reference
  wall, tile size, grout, order quantity, and the measurement system.
- **AC-1.2** The system prompt forbids computing, deriving, estimating or restating any number not
  present in the input.
- **AC-1.3** Figures are presented in the user's active measurement system, pre-formatted by the
  client using the existing `measurements.ts` helpers — the model is never asked to convert units.
- **AC-1.4** The brief never contains a cost, a price or a currency symbol; that is 005's job.
- **AC-1.5** Spot-checking any number in a generated brief against `StatsPanel` finds an exact
  match.

## R2 — Content

**WHEN** a brief is produced
**THE SYSTEM SHALL** cover the decisions an installer actually makes.

- **AC-2.1** **Setting out** — where to strike the first line, derived from the alignment mode in
  use (`optimize` / `center-tile` / `center-grout`) and the reference wall when one is set.
- **AC-2.2** **Cut list** — how many cuts, where they fall, and what to expect at the perimeter.
- **AC-2.3** **Sliver warning** — when `smallestCutPieceMm2` is below roughly a third of a tile,
  the brief flags it and suggests shifting the grid or switching alignment.
- **AC-2.4** **Pattern notes** — pattern-specific guidance, including the herringbone 2:1 fit
  constraint the UI already warns about, and the extra offcuts a 45° diagonal generates.
- **AC-2.5** **Order quantity** — states the 10% buffer already in the figure and why it exists
  (breakage, future repairs, dye-lot matching).
- **AC-2.6** **Cut-outs** — when the room has holes, notes that they are excluded from the counts.
- **AC-2.7** Output is markdown with short sections, readable on a phone at a job site.

## R3 — Streaming

**WHEN** a brief is requested
**THE SYSTEM SHALL** stream it so text appears as it is produced.

- **AC-3.1** The route returns a streaming `Response`; the first visible text appears well before
  the full brief is complete.
- **AC-3.2** The client renders incrementally.
- **AC-3.3** Aborting mid-stream (cancel, close, unmount) stops rendering immediately and makes no
  state update afterwards.
- **AC-3.4** A stream that dies mid-flight leaves the partial text visible, labelled incomplete,
  with a retry offered — it is not discarded.

## R4 — Availability

- **AC-4.1** The control is disabled with a reason when `layout === null` or `isComputing` is true.
- **AC-4.2** Regenerating replaces the previous brief; only one request is in flight at a time.
- **AC-4.3** The brief is copyable to the clipboard as markdown.
- **AC-4.4** The brief is invalidated (or clearly marked stale) when the layout changes underneath
  it, so a brief never describes a layout that is no longer on screen.
- **AC-4.5** With AI unconfigured the control is disabled with an explanation.
- **AC-4.6** In demo mode a canned brief is shown, labelled.

## Out of scope

- Costs and material quantities (005).
- PDF export.
- Persisting briefs.
