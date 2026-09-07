# 004 — Installation Brief · Tasks

**Prerequisite:** 001-ai-foundation complete and verified — in particular T13's dev adapter must
**pipe** streaming responses, not buffer them, or this cannot be developed locally.

- [ ] **T0 — Branch.** Create this spec's branch and switch to it before touching any file:
      `git switch -c feat/004-installation-brief`, cut from an up-to-date `main`.
      If `001-ai-foundation` is not yet merged to `main`, stop — the dependency rule says this
      spec has not started yet. Do not branch off 001's branch.
      *Verify:* `git rev-parse --abbrev-ref HEAD` prints `feat/004-installation-brief`, and
      `git status --porcelain` is clean apart from anything you already intended to carry over.
      (Constitution VIII)

- [ ] **T1 — Formatting layer.** Add `formatForBrief()` to `client/src/api/ai.ts`, building the
      `formatted` block from store state using the existing `formatDisplayFromMM()`,
      `roomDisplay()`, `tileDisplay()`, `groutDisplay()` and the `MM2_PER_FT2` / `MM2_PER_M2`
      constants. Pattern and alignment must be the UI's display labels, not the enum values.
      The block must be complete — every field listed in `design.md`'s request shape, covering all
      the figures AC-1.1 enumerates.
      *Verify:* every string in `formatted` is character-identical to what `StatsPanel` renders for
      the same layout, and no listed field is absent. (AC-1.1, AC-1.3, AC-1.5)

- [ ] **T2 — Sliver flag** (`client/src/api/ai.ts`). Compute `sliverRisk` client-side as
      `smallestCutPiece < (tile.width * tile.height) / 3` with `cutTileCount > 0`, and include it
      plus the formatted smallest-cut figure in the request.
      *Verify:* a 10×8 ft room with 24 in tiles produces a sliver at some alignment; toggling
      alignment flips the flag. The model is never asked to decide it. (AC-2.3)

- [ ] **T3 — Prompt.** `BRIEF_V1` in `api/_lib/prompts.ts` covering every bullet in `design.md`,
      with the never-compute rule stated first and the no-costs rule explicit.
      *Verify:* read against the bullet list; all present — including the four required sections
      (Setting out, Cut list, Watch out for, Ordering), the cut-list content, and the instruction
      to explain the existing 10% buffer rather than propose a different one. (AC-1.2, AC-1.4,
      AC-2.2, AC-2.5)

- [ ] **T4 — Streaming route.** `api/ai/brief.ts`: `POST`, 32 KB cap, rate limit, demo short-circuit,
      `interactions.create({ stream: true })`, returning a `Response` wrapping a `ReadableStream` of
      UTF-8 text with `Content-Type: text/plain; charset=utf-8`, `Cache-Control: no-store` and
      `X-Accel-Buffering: no`. Upstream errors after the first byte end the stream cleanly rather
      than emitting an error body into the middle of the text.
      *Verify:* `curl -N localhost:5173/api/ai/brief -d @fixture.json` prints text progressively,
      not in one block. (AC-3.1)

- [ ] **T5 — Client streaming reader.** Add `brief()` to `client/src/api/ai.ts` returning an
      `AsyncIterable<string>` over `response.body.getReader()` + `TextDecoder`, honouring an
      `AbortSignal` and cancelling the reader on abort.
      *Verify:* a scratch component logs chunks as they arrive; aborting stops them immediately.
      (AC-3.2, AC-3.3)

- [ ] **T6 — Brief drawer.** `client/src/components/AI/BriefPanel.tsx` plus a **Brief** button on
      `StatsPanel.tsx`. Right-hand drawer using the existing `CARD_STYLE` translucent surface,
      incremental rendering with a caret, Copy, Regenerate, and the disabled states.
      *Verify:* text streams into view; the canvas remains visible and usable beside it.
      (AC-2.7, AC-4.1, AC-4.3)

- [ ] **T7 — Minimal markdown renderer** (`client/src/components/AI/markdown.tsx`). ~40 lines
      covering `##` headings, `**bold**`, `- ` lists and paragraphs. No markdown dependency added.
      *Verify:* `git diff client/package.json` shows no new dependency.

- [ ] **T8 — Staleness banner** (`client/src/components/AI/BriefPanel.tsx`).
      Record score + offsets + a tile-config hash when a brief is
      generated; show a "layout has changed — regenerate" banner when they diverge while open.
      *Verify:* generate a brief, change the tile size, watch the banner appear without an automatic
      refetch. (AC-4.4)

- [ ] **T9 — Failure states.** Partial-stream retention with an incomplete label and retry; abort on
      close/unmount; 429/502/unconfigured/demo-mode handling per the `design.md` table.
      *Verify:* verification block below. (AC-3.4, AC-4.2, AC-4.5, AC-4.6)

- [ ] **T10 — Full spec verification.** Run the block below and record the result.

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
