# 004 — Installation Brief · Tasks

**Prerequisite:** 001-ai-foundation complete and verified — in particular T13's dev adapter must
**pipe** streaming responses, not buffer them, or this cannot be developed locally.

- [x] **T0 — Branch.** Create this spec's branch and switch to it before touching any file:
      `git switch -c feat/004-installation-brief`, cut from an up-to-date `main`.
      If `001-ai-foundation` is not yet merged to `main`, stop — the dependency rule says this
      spec has not started yet. Do not branch off 001's branch.
      *Verify:* `git rev-parse --abbrev-ref HEAD` prints `feat/004-installation-brief`, and
      `git status --porcelain` is clean apart from anything you already intended to carry over.
      (Constitution VIII)

- [x] **T1 — Formatting layer.** Add `formatForBrief()` to `client/src/api/ai.ts`, building the
      `formatted` block from store state using the existing `formatDisplayFromMM()`,
      `roomDisplay()`, `tileDisplay()`, `groutDisplay()` and the `MM2_PER_FT2` / `MM2_PER_M2`
      constants. Pattern and alignment must be the UI's display labels, not the enum values.
      The block must be complete — every field listed in `design.md`'s request shape, covering all
      the figures AC-1.1 enumerates.
      *Verify:* every string in `formatted` is character-identical to what `StatsPanel` renders for
      the same layout, and no listed field is absent. (AC-1.1, AC-1.3, AC-1.5)

- [x] **T2 — Sliver flag** (`client/src/api/ai.ts`). Compute `sliverRisk` client-side as
      `smallestCutPiece < (tile.width * tile.height) / 3` with `cutTileCount > 0`, and include it
      plus the formatted smallest-cut figure in the request.
      *Verify:* a 10×8 ft room with 24 in tiles produces a sliver at some alignment; toggling
      alignment flips the flag. The model is never asked to decide it. (AC-2.3)
      *Verified 2026-11-08 in the live app. The stated example does not hold: 10×8 ft with a 24 in
      grid has no sliver at any alignment (10 ft ≈ 4.97 tiles; smallest cut 276–279 in² vs a
      192 in² threshold) — the engine is right. At **10 ft 2 in × 8 ft**, Centre a tile leaves a
      7.3 in² sliver (flag on) while Least waste / Centre a joint give ~300 in² (flag off). The flag
      matched the engine's own figures in all 12 configurations tried. Use this room for item 6.*

- [x] **T3 — Prompt.** `BRIEF_V1` in `api/_lib/prompts.ts` covering every bullet in `design.md`,
      with the never-compute rule stated first and the no-costs rule explicit.
      *Verify:* read against the bullet list; all present — including the four required sections
      (Setting out, Cut list, Watch out for, Ordering), the cut-list content, and the instruction
      to explain the existing 10% buffer rather than propose a different one. (AC-1.2, AC-1.4,
      AC-2.2, AC-2.5)

- [x] **T4 — Streaming route.** `api/ai/brief.ts`: `POST`, 32 KB cap, rate limit, demo short-circuit,
      `interactions.create({ stream: true })`, returning a `Response` wrapping a `ReadableStream` of
      UTF-8 text with `Content-Type: text/plain; charset=utf-8`, `Cache-Control: no-store` and
      `X-Accel-Buffering: no`. Upstream errors after the first byte end the stream cleanly rather
      than emitting an error body into the middle of the text.
      *Verify:* `curl -N localhost:5173/api/ai/brief -d @fixture.json` prints text progressively,
      not in one block. (AC-3.1)
      *Verified 2026-11-08: `curl -N` on a real `buildBriefRequest()` fixture printed lines at 10+
      distinct times (1.37–1.91 s, chunked, all three headers). A failure after the first byte
      **errors** the stream (`controller.error`) rather than closing it cleanly — a clean close is
      indistinguishable from success, and the client must label it incomplete (AC-3.4). Tested in
      Node with scripted SDK streams: thrown mid-stream, ran out without `interaction.completed`,
      `error` event — each delivers the partial text, then errors, with no error text in the brief.*

- [x] **T5 — Client streaming reader.** Add `brief()` to `client/src/api/ai.ts` returning an
      `AsyncIterable<string>` over `response.body.getReader()` + `TextDecoder`, honouring an
      `AbortSignal` and cancelling the reader on abort.
      *Verify:* a scratch component logs chunks as they arrive; aborting stops them immediately.
      (AC-3.2, AC-3.3)
      *Verified 2026-11-08 in the live app: 8 chunks over ~360 ms; aborting after chunk 3 ended the
      loop in 0 ms with nothing delivered after it. Built on the existing `streamText()`, which
      gained an `onResponse` hook so the demo-mode header is visible before the first chunk.*

- [x] **T6 — Brief drawer.** `client/src/components/AI/BriefPanel.tsx` plus a **Brief** button on
      `StatsPanel.tsx`. Right-hand drawer using the existing `CARD_STYLE` translucent surface,
      incremental rendering with a caret, Copy, Regenerate, and the disabled states.
      *Verify:* text streams into view; the canvas remains visible and usable beside it.
      (AC-2.7, AC-4.1, AC-4.3)
      *Verified 2026-11-08 in headless Chromium, 21 checks: rendered length grew in 8 steps with a
      caret; four headings; Copy gives raw markdown; disabled with a reason while computing / with no
      layout; the canvas redraws with the drawer open. In dev, React StrictMode fires one extra
      request on open that is aborted at once — dev only.*

- [x] **T7 — Minimal markdown renderer** (`client/src/components/AI/markdown.tsx`). ~40 lines
      covering `##` headings, `**bold**`, `- ` lists and paragraphs. No markdown dependency added.
      *Verify:* `git diff client/package.json` shows no new dependency.
      *Verified 2026-11-08: the diff is empty; 8 render checks in Node (headings, bold, lists,
      paragraphs, half-streamed `**`, HTML in model text escaped, never injected).*

- [x] **T8 — Staleness banner** (`client/src/components/AI/BriefPanel.tsx`).
      Record score + offsets + a tile-config hash when a brief is
      generated; show a "layout has changed — regenerate" banner when they diverge while open.
      *Verify:* generate a brief, change the tile size, watch the banner appear without an automatic
      refetch. (AC-4.4)
      *Verified 2026-11-08: a pattern change and a tile-size change each raised the banner with zero
      new brief requests; Regenerate cleared it.*

- [x] **T9 — Failure states.** Partial-stream retention with an incomplete label and retry; abort on
      close/unmount; 429/502/unconfigured/demo-mode handling per the `design.md` table.
      *Verify:* verification block below. (AC-3.4, AC-4.2, AC-4.5, AC-4.6)
      *Verified 2026-11-08, 19 checks: dev server `kill -9`'d mid-stream → partial text kept,
      "Incomplete", Retry; drawer closed mid-stream → request aborted, no console error; 502 on
      regenerate → message, previous brief intact; 429 → "try again in 9s"; Regenerate disabled
      while streaming; unconfigured → Brief disabled with reason; demo → canned brief, labelled,
      no layout figures.*

- [x] **T10 — Full spec verification.** Run the block below and record the result.

---

## Verification block

Requires `npm run dev` and a `GEMINI_API_KEY`.

0. **On the right branch** — `git rev-parse --abbrev-ref HEAD` prints
   `feat/004-installation-brief`, not `main`. (Constitution VIII)
1. **Grounding audit** — generate a brief and check **every** number in it against `StatsPanel` and
   the sidebar. Any figure that appears in the brief but not in the input is a spec failure.
   (AC-1.5)
2. **No costs** — confirm no price, cost or currency symbol appears. (AC-1.4)
2b. **Cut list and ordering** — the brief has all four sections; the cut list describes where cuts
   fall, and the ordering section explains the 10% buffer without proposing a different figure.
   (AC-2.2, AC-2.5)
3. **Units** — switch to metric, regenerate; all figures are metric and match the UI. Switch back;
   same. (AC-1.3)
4. **Setting out varies** — generate at `optimize`, `center-tile` and `center-grout`; the setting-out
   section differs meaningfully between them. (AC-2.1)
5. **Reference wall** — draw an outline, square to a wall, regenerate; the brief mentions running
   lines parallel to that wall from its midpoint. (AC-2.1)
6. **Sliver warning** — find a configuration where the smallest cut is under a third of a tile; the
   warning appears. Change alignment so it is not; the warning goes away. (AC-2.3)
7. **Herringbone note** — set a non-2:1 tile with herringbone (the UI shows its own amber warning);
   the brief raises the fit constraint too. (AC-2.4)
8. **Cut-outs** — add a cut-out, regenerate; the brief notes the exclusion. (AC-2.6)
9. **Streaming visible** — text appears progressively, not all at once. (AC-3.1, AC-3.2)
10. **Abort** — close the drawer mid-stream: rendering stops at once, no console error, no state
    update after unmount. (AC-3.3)
11. **Broken stream** — kill the dev server mid-stream; partial text stays, is labelled incomplete,
    and retry is offered. (AC-3.4)
12. **Disabled states** — button disabled while `isComputing` and when no layout exists. (AC-4.1)
13. **Staleness** — brief open, change the tile size → banner appears, no automatic refetch.
    (AC-4.4)
14. **Copy** — clipboard contains the raw markdown. (AC-4.3)
15. **Unconfigured / demo mode** — disabled with a reason; canned brief labelled. (AC-4.5, AC-4.6)
16. **Types and tests** — `npm run typecheck:api`, `cd client && npx tsc --noEmit`,
    `npm test --workspace @tileflow/geometry` all clean.

### Result — 2026-11-08

Headless Chromium against `vite` dev, `gemini-3.5-flash-lite` via `GEMINI_MODEL_FAST` (the default
`gemini-3.8-flash` was timing out; re-run items 1–8 on it, or adopt the lite model).

| # | Result |
|---|---|
| 0 | `feat/004-installation-brief` |
| 1 | Grounding audit automated: every number in every brief generated (12 briefs across items 1–8) is in its input; the only others are the prompt's 10% and 2:1 |
| 2 | No cost, price or currency symbol in any brief |
| 2b | Four sections in order; cut list says cuts fall around the perimeter; ordering quotes the order quantity and explains 10% (breakage, repairs, dye lot), no other percentage |
| 3 | Metric brief: metric figures only ("457 cm²", "30.5 cm × 61 cm"), matching the UI; back to imperial: no metric units |
| 4 | Least waste / Centre a tile / Centre a joint: three different setting-out sections (computed grid · a tile centred · a joint through the centre) |
| 5 | Kitchen squared to W3: "running parallel to wall W3. The anchor is the midpoint of wall W3." |
| 6 | 10 ft 2 in × 8 ft, 24 in grid: Centre a tile → 7.3 in² sliver warned; Least waste → 300 in², "no special hazards" |
| 7 | 12 × 12 herringbone → "with this tile the joints will drift. Suggest a 2:1 tile" (3/3 runs); 12 × 24 herringbone → no drift warning (3/3) |
| 8 | Kitchen with an island: "Cut-outs are excluded from the counts and the area" |
| 9 | Rendered length grew in 8 steps, caret while streaming (T6) |
| 10 | Drawer closed mid-stream: request aborted, no console error, no update after unmount (T9) |
| 11 | Dev server `kill -9` mid-stream: partial kept, "Incomplete", Retry (T9) |
| 12 | Disabled with a reason while computing and with no layout (T6) |
| 13 | Pattern and tile-size changes → banner, zero new requests (T8) |
| 14 | Clipboard holds the raw markdown (T6) |
| 15 | Unconfigured → disabled with reason; demo → canned brief labelled, no layout figures (T9) |
| 16 | `typecheck:api` and client `tsc` clean; geometry 181/181 |

Review gate: slow 3G brief completes with all four sections and no errors; key-leak grep clean;
no new dependency.

Notes: `isComputing` is false during `useLayoutWorker`'s 150 ms debounce, so a Brief clicked within
~100 ms of an edit describes a layout about to be replaced — the staleness banner then flags it,
correctly. The model occasionally adds a pattern note that does not apply (an offset-pattern line on
herringbone); it never states a wrong figure.

