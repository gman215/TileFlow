# 003 — Layout Assistant · Tasks

**Prerequisite:** 001-ai-foundation complete and its verification block passing.

- [x] **T0 — Branch.** Create this spec's branch and switch to it before touching any file:
      `git switch -c feat/003-layout-assistant`, cut from an up-to-date `main`.
      If `001-ai-foundation` is not yet merged to `main`, stop — the dependency rule says this
      spec has not started yet. Do not branch off 001's branch.
      *Verify:* `git rev-parse --abbrev-ref HEAD` prints `feat/003-layout-assistant`, and
      `git status --porcelain` is clean apart from anything you already intended to carry over.
      (Constitution VIII)

- [x] **T1 — Tool declarations.** `api/_lib/tools.ts` exporting `TOOL_DECLARATIONS` for all ten
      tools in the `design.md` table, with enums for `pattern` and `alignment`, millimetre units
      stated in every dimensional description, and the herringbone 2:1 constraint noted on
      `set_pattern`.
      *Verify:* every enum value matches `PatternType` / `AlignmentMode` in
      `packages/geometry/src/types/index.ts` exactly — a typo here fails silently at runtime.
      Cross-check the table's Store-action column against `client/src/store/tileFlowStore.ts`:
      every tool must map to an action that already exists, and no new action may be added for a
      tool. (AC-2.1, AC-2.2, AC-2.3)

- [x] **T2 — Route.** `api/ai/assistant.ts`: `POST` only, 32 KB cap, accepts either the `message`
      or the `results` request shape, calls `interactions.create` with `tools` and
      `previous_interaction_id`, filters `interaction.steps` to `function_call`, **drops calls whose
      name is not declared**, returns `{ reply, calls, interactionId, roundTrip }`.
      Every request carries the `LayoutStatsDTO` snapshot so replies are grounded in what is on
      screen.
      Prompts go in `system_instruction`, never concatenated into `input`.
      **Verify `store` empirically here:** make one call, then a second with
      `previous_interaction_id` and no `store: true` on the first. If the second fails, set
      `store: true` on assistant calls and record the finding in `001-ai-foundation/design.md`
      under "Multi-turn and `store`". Do not set it speculatively — it is a data-retention choice.
      *Verify:* "make it herringbone" returns a `set_pattern` call; "what does alpha do?" returns a
      reply with `calls: []`; "how big is this room?" answers with the snapshot's area. Server logs
      show unknown names dropped. A two-turn exchange carries context. (AC-1.1, AC-1.2, AC-1.4,
      AC-3.1)
      *Verified 2026-11-06 against `gemini-3.5-flash-lite` (`GEMINI_MODEL_FAST` override): the
      default `gemini-3.8-flash` was returning 503 "high demand" / timing out. Re-run on the
      default once it recovers. `store` finding recorded in 001's design: chaining works unset.*

- [x] **T3 — Prompt.** `ASSISTANT_V1` in `api/_lib/prompts.ts` covering every bullet in `design.md`,
      including the unit-conversion constants and the never-claim-an-unconfirmed-change rule.
      *Verify:* ask "make the tiles a foot square" → a `set_tile_size` call with `304.8` mm, not
      `12`. (AC-2.4)
      *Verified 2026-11-06 against `gemini-3.5-flash-lite` — see T2's note.*

- [x] **T4 — Client tool map.** `client/src/ai/tools.ts` with `TOOL_MAP`: per-tool Zod schema plus a
      `run` that calls the existing store action and returns the value **read back from the store**.
      Dispatch via `Object.hasOwn` then direct property access — no dynamic lookup on an unchecked
      string.
      *Verify:* a scratch test asserts that `__proto__` and `constructor` as tool names are
      rejected, and that a `set_grout` call with `grout_mm: 500` is rejected by Zod before the store
      is touched. Confirm each `run` reads its return value back out of the store rather than
      echoing its arguments — `set_tile_orientation` is the clearest case, since it swaps W/H only
      when the orientation actually differs. (AC-3.2, AC-3.3, AC-4.5)

- [x] **T5 — Honest no-op results** (`client/src/ai/tools.ts`). Implement the two early-return
      cases explicitly:
      `set_room_size` returns `ok:false, reason:'room_has_outline'` when `room.shape` exists;
      `set_reference_wall` returns `ok:false, reason:'no_outline'` when it does not, and validates
      the index against the boundary's wall count.
      *Verify:* draw an L-shaped room, then ask the assistant to make the room 10×10 ft. It must
      report that the outline governs and offer to reset — not claim success. (AC-4.1–4.3)
      *Verified 2026-11-06 in Node, not a browser (no panel until T8): real store with an L-shaped
      outline, `statsDto()` snapshot, real route, `gemini-3.5-flash-lite` (3.8-flash still timing
      out), calls run through `runToolCall`. Also added: the geometry tools refuse with
      `reason:'floor_plan'` in plan mode, where their store actions edit a derived view.*

- [x] **T6 — Conversation loop.** `client/src/hooks/useAssistant.ts`: send message → execute calls →
      post results with `previousInteractionId` → repeat, capped at 4 round-trips, with an
      `AbortSignal` for unmount.
      *Verify:* a request needing two tools resolves in ≤4 trips; an artificially looping stub stops
      at 4 and reports what it applied. (AC-1.2, AC-3.4, AC-3.5)
      *Verified 2026-11-06 in Node against the real store: a never-ending stub stops at 4 posts
      (3 applied, the 4th trip's call left unrun as unconfirmable); "12 by 24 inch tiles in
      herringbone" resolved live in 3 trips on `gemini-3.5-flash-lite`. The loop also waits for the
      worker before `read_layout_stats` and each snapshot (`waitForLayout`), so stats are not stale.*

- [x] **T7 — Snapshot undo.** Add `aiSnapshot`, `captureAiSnapshot`, `undoAiChange` to
      `client/src/store/tileFlowStore.ts`; capture before each tool batch.
      *Verify:* ask for three changes at once, click "Undo AI change" — tile size, pattern and
      weights all revert, and the canvas recomputes. (AC-5.2)

- [x] **T8 — Panel UI.** `client/src/components/AI/AssistantPanel.tsx` in the sidebar below
      `OptimizationPanel`: transcript, action chips (applied vs rejected styled differently, reason
      in `title`), "Undo AI change" on the latest batch, Enter-to-send input, busy state, and the
      "not saved, resets on reload" note. Reuse existing style classes only.
      *Verify:* chips appear for every applied call and read correctly; a rejected call is visually
      distinct. (AC-1.3, AC-5.1, AC-5.3)
      *Verified 2026-11-06 in headless Chromium against `vite` dev (`gemini-3.5-flash-lite`):
      chips read "Tile size → 12 in × 24 in", "Pattern → Herringbone"; a rejected reference-wall
      call is struck through with its reason in `title`; undo restores the sidebar. The run caught a
      T7 bug — an all-rejected turn replaced the previous turn's snapshot — fixed with a rollback
      in `useAssistant.ts` and a regression case in the T7 test.*

- [x] **T9 — Recompute path.** Confirm changes propagate through the **existing**
      `useLayoutWorker` store subscription with no new recompute trigger added.
      *Verify:* `git diff client/src/hooks/useLayoutWorker.ts` is empty for this spec, and the
      canvas still updates after every assistant change. (AC-5.4)
      *Verified 2026-11-06: the diff is empty, and no new code posts to the worker or writes a
      layout. In headless Chromium (`gemini-3.5-flash-lite`), every assistant change across a plain
      room, the L-shaped kitchen (an outline) and the two-room plan updated the canvas; undo
      restored it pixel-for-pixel with the stats card and toolbar masked (their compute time and
      undo arrow differ by design). Genuine no-ops, e.g. "portrait" on a tile already portrait, left
      it unchanged.*

- [x] **T10 — Failure and disabled states.** Wire `useAiAvailability()`; handle 429/502/offline/
      abort/unknown-tool per the `design.md` table.
      *Verify:* verification block below. (AC-6.1–6.5)
      *Verified 2026-11-06 in headless Chromium, 34/34: items 9–13 of the block below plus demo
      mode, using `page.route` stubs for responses the real route would never send. Also added a
      45 s client-side trip timeout so a hung request cannot wedge the panel (measured: 46 s).*

- [ ] **T11 — Full spec verification.** Run the block below and record the result.

---

## Verification block

Requires `npm run dev` and a `GEMINI_API_KEY`.

0. **On the right branch** — `git rev-parse --abbrev-ref HEAD` prints
   `feat/003-layout-assistant`, not `main`. (Constitution VIII)
1. **Single change** — "use 12 by 24 inch tiles" → tile size becomes 304.8 × 609.6 mm, chip shown,
   canvas recomputes. (AC-2.4)
2. **Compound change** — "12×24 herringbone, penalize waste heavily" → three tools applied in one
   turn, three chips, all reflected in the sidebar.
3. **Question only** — "what does alpha do?" → an explanation, no chips, nothing changed. (AC-1.4)
4. **Grounded answer** — "how much waste am I looking at?" → the assistant calls
   `read_layout_stats` and quotes the figure `StatsPanel` shows. It must match exactly. (AC-4.4)
5. **Honest no-op** — with an L-shaped outline drawn, "make the room 10 by 10 feet" → reports the
   outline governs and offers reset; the room is unchanged. (AC-4.1)
6. **Reference wall without an outline** — "square it to wall 2" on a plain rectangle → reports no
   outline exists. (AC-4.2)
7. **Multi-turn** — "make it herringbone", then "actually, go back to grid" → the second turn
   understands the first without resending it. (AC-1.2)
8. **Undo** — after any change, "Undo AI change" restores the previous state in one click. (AC-5.2)
9. **Whitelist** — with a stub returning `{name:'delete_project'}`, confirm nothing is dispatched,
   it is logged, and the transcript notes an unsupported action. (AC-6.2, AC-6.5)
10. **Bad arguments** — with a stub returning `grout_mm: 9999`, confirm Zod rejects it before the
    store is touched and the model is told why. (AC-3.3)
11. **Round-trip cap** — with a stub that always returns a call, confirm it stops at 4. (AC-3.5)
12. **Unconfigured** — key unset: the panel is disabled with a reason; the rest of the app works.
    (AC-6.3)
13. **429 / offline** — layout untouched, plain message, no wedged spinner. (AC-6.4)
14. **Types and tests** — `npm run typecheck:api`, `cd client && npx tsc --noEmit`,
    `npm test --workspace @tileflow/geometry` all clean.
