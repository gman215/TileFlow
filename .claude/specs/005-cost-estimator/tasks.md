# 005 — Cost & Material Estimator · Tasks

**Prerequisite:** 001-ai-foundation complete and its verification block passing.

- [ ] **T0 — Branch.** Create this spec's branch and switch to it before touching any file:
      `git switch -c feat/005-cost-estimator`, cut from an up-to-date `main`.
      If `001-ai-foundation` is not yet merged to `main`, stop — the dependency rule says this
      spec has not started yet. Do not branch off 001's branch.
      *Verify:* `git rev-parse --abbrev-ref HEAD` prints `feat/005-cost-estimator`, and
      `git status --porcelain` is clean apart from anything you already intended to carry over.
      (Constitution VIII)

- [ ] **T1 — Schemas.** Add `ESTIMATE_JSON_SCHEMA` and the `EstimateOut` Zod mirror to
      `api/_lib/schemas.ts`, plus `EstimateIn` for the request. The schema must contain **no**
      `subtotal` and **no** `total` field.
      *Verify:* `git grep --untracked -n "subtotal\|total" api/_lib/schemas.ts` shows no occurrence inside the
      estimate schema. (AC-2.1, AC-2.3)

- [ ] **T2 — Prompt.** `ESTIMATE_V1` in `api/_lib/prompts.ts` covering every bullet in `design.md`,
      leading with the no-arithmetic rule and the echo-the-engine-values rule.
      *Verify:* read against the bullet list; all present.

- [ ] **T3 — Route.** `api/ai/estimate.ts`: `POST`, 32 KB cap, rate limit, demo short-circuit,
      structured-output call, `EstimateOut.parse`, `toResponse` error mapping.
      *Verify:* `curl` with a fixture returns line items each carrying a non-empty `basis` and a
      `source`. (AC-1.3, AC-1.5)

- [ ] **T4 — Client estimate module.** `client/src/ai/estimate.ts` with `sanityFilter()`,
      `overrideEngineQuantities()` and `computeTotals()`. Engine-sourced tile and area quantities
      are forced to the engine's values regardless of what the model returned; every subtotal and
      the total are computed here.
      *Verify:* unit-test with a fixture where the model returns a wrong tile count and a bogus
      unit — the displayed quantity is the engine's and the bad line is dropped. (AC-1.1, AC-1.2,
      AC-2.1, AC-2.2, AC-5.2)

- [ ] **T5 — Discrepancy logging** (`client/src/ai/estimate.ts`).
      If the model volunteers a total-like value anywhere in `notes`
      that contradicts the computed total, log it to the console. The computed total is always what
      is displayed.
      *Verify:* console shows the note; the UI shows only the client's total. (AC-2.3)

- [ ] **T6 — Price state** (`client/src/store/tileFlowStore.ts`). Session-only price inputs (tile,
      adhesive, grout, labour rate, currency) with system-appropriate defaults marked as
      placeholders. The currency is a user-selectable display symbol only — no conversion is
      performed anywhere in the codebase. Never included in any payload to the Express API.
      *Verify:* `git grep --untracked -n "prices" client/src/hooks/useProjectActions.ts` returns nothing;
      `git grep --untracked -niE "exchange|convertCurrency|fx" -- client/src/ai/ client/src/components/AI/`
      returns nothing. (AC-3.1, AC-3.2, AC-3.4, AC-3.5)

- [ ] **T7 — Local recompute** (`client/src/ai/estimate.ts`). Editing a price recomputes subtotals
      and the total without a network call.
      *Verify:* with the network tab open, edit a price — zero requests, table updates instantly.
      (AC-3.3)

- [ ] **T8 — Panel UI.** `client/src/components/AI/EstimatePanel.tsx` below `OptimizationPanel`,
      collapsed by default: price inputs, the line-item table with engine-sourced rows badged,
      assumptions list, confidence with a low-confidence caution, and the always-visible
      "planning aid, not a quote" disclaimer. `font-mono` for figures, matching `StatsPanel`.
      *Verify:* every column in AC-4.1 is present and the badge distinguishes engine rows.
      (AC-4.1–4.5)

- [ ] **T9 — Failure and disabled states** (`client/src/components/AI/EstimatePanel.tsx`).
      Zod failure keeps the previous estimate; dropped lines
      are surfaced with a count; disabled when `layout === null` or `isComputing`; unconfigured and
      demo-mode handled.
      *Verify:* verification block below. (AC-5.1, AC-5.3–5.5)

- [ ] **T10 — Full spec verification.** Run the block below and record the result.

---

## Verification block

Requires `npm run dev` and a `GEMINI_API_KEY`.

0. **On the right branch** — `git rev-parse --abbrev-ref HEAD` prints
   `feat/005-cost-estimator`, not `main`. (Constitution VIII)
1. **Tile quantity is the engine's** — the tile line's quantity equals `Order to buy` in
   `StatsPanel`, exactly. (AC-1.1)
2. **Area is the engine's** — any area-based line uses the room area `StatsPanel` shows. (AC-1.2)
3. **Arithmetic is ours** — pick a line; `quantity × unitCost` equals the displayed subtotal to the
   cent, and the total equals the sum of the visible subtotals. (AC-2.1, AC-2.2)
4. **Injected wrong quantity** — with a stub returning a tile line of `quantity: 9999`, confirm the
   engine's value is displayed instead. (AC-1.1)
5. **Basis required** — with a stub returning a line with `basis: ""`, confirm the line is dropped
   and the drop is surfaced. (AC-1.5, AC-5.2)
6. **Sanity bounds** — with a stub returning 500 kg of adhesive for a small room, confirm it is
   dropped and counted. (AC-5.2)
7. **Price editing** — change the tile price; the total updates immediately with no network request.
   (AC-3.3)
8. **System switch** — toggle metric/imperial; price units and defaults switch appropriately.
   (AC-3.2)
8b. **Currency is display-only** — change the currency selector; every figure is unchanged and only
   the symbol differs. No conversion occurs. (AC-2.4, AC-3.5)
9. **Pattern affects labour** — estimate a grid layout, then herringbone; labour hours increase and
   the basis says why. (R1, AC-1.4)
10. **Transparency** — every line shows a basis; assumptions are listed; confidence is shown; the
    disclaimer is visible; engine rows are badged. (AC-4.1–4.5)
11. **Zod failure** — with a stub returning malformed JSON, confirm the previous estimate survives
    and an error is shown. (AC-5.1, AC-5.5)
12. **Disabled** — no layout or mid-compute: the panel is disabled with a reason. (AC-5.3)
13. **Unconfigured / demo mode** — disabled with a reason / canned and labelled. (AC-5.4)
14. **Not persisted** — save a project and inspect the payload; no prices, no estimate. (AC-3.4)
15. **Types and tests** — `npm run typecheck:api`, `cd client && npx tsc --noEmit`,
    `npm test --workspace @tileflow/geometry` all clean.
