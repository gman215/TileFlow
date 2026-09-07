# 005 — Cost & Material Estimator · Requirements

**Status:** Not started
**Depends on:** 001-ai-foundation (complete and verified)
**Gemini capability:** structured JSON output

## Purpose

A tile count is not a shopping list. A real takeoff needs adhesive by coverage rate, grout by joint
volume, spacers, trim, underlayment and labour hours — each with a defensible basis. That domain
knowledge is exactly what a language model is good for, and exactly the kind of thing you would
otherwise hard-code as a table of guesses.

The arithmetic, however, is not the model's business. It returns **quantities and unit rates with a
stated basis**; the client multiplies and sums. If the model's own subtotal disagrees with ours,
ours is displayed and the discrepancy is logged.

---

## R1 — Quantities from the engine, rates from the model

**WHEN** an estimate is produced
**THE SYSTEM SHALL** take tile counts and areas from the layout, never from the model.

- **AC-1.1** Tile quantity is the engine's order quantity (total tiles + 10%), passed in and echoed
  back unchanged. A model-supplied tile count is ignored.
- **AC-1.2** Room area is the engine's `roomArea`. A model-supplied area is ignored.
- **AC-1.3** Consumable quantities (adhesive, grout, spacers, trim, underlayment) are derived by the
  model from coverage rates, and each line states the `basis` it used
  ("5 kg per m² at 6 mm notch").
- **AC-1.4** Labour hours are the model's estimate and are labelled as such, with the basis stated.
- **AC-1.5** Any line item whose `basis` is missing or empty is rejected — a number without a
  justification is not shown to the user.

## R2 — The client does the arithmetic

**WHEN** an estimate is displayed
**THE SYSTEM SHALL** compute every subtotal and total itself.

- **AC-2.1** Each line's subtotal is computed client-side as `quantity × unitCost`, rounded to
  currency precision. The model is not asked for a subtotal.
- **AC-2.2** The total is the client's sum of client-computed subtotals.
- **AC-2.3** If the model volunteers a total, it is discarded; when it differs from ours by more
  than rounding, the discrepancy is logged to the console for debugging.
- **AC-2.4** No currency conversion is performed anywhere. One currency, chosen by the user, is a
  display symbol only.

## R3 — User-controlled prices

**WHEN** a user has real prices
**THE SYSTEM SHALL** use them rather than invented ones.

- **AC-3.1** Unit prices are editable: tile (per tile or per area), adhesive, grout, and an hourly
  labour rate.
- **AC-3.2** Defaults are provided, clearly marked as placeholders, and adjust with the measurement
  system (per ft² / per m²).
- **AC-3.3** Editing a price recomputes the estimate **locally**, with no new model call.
- **AC-3.4** Prices persist for the session; they are not saved to the database.
- **AC-3.5** The currency symbol is user-selectable and display-only.

## R4 — Transparency

- **AC-4.1** Every line shows item, quantity, unit, unit cost, subtotal, and its basis.
- **AC-4.2** Assumptions the model made are listed separately and plainly.
- **AC-4.3** A confidence value is shown, with a caution when it is low.
- **AC-4.4** The estimate carries a visible disclaimer that it is a planning aid, not a quote.
- **AC-4.5** Lines whose quantity comes from the engine are visually distinguished from lines the
  model estimated, so the user can see which numbers are computed and which are judged.

## R5 — Validation and failure

- **AC-5.1** The response is constrained by `response_format` and validated against a Zod mirror;
  a failure shows nothing and reports an error.
- **AC-5.2** Negative, non-finite or absurd quantities (beyond a per-item sanity bound) are rejected
  and the line is dropped, with the drop surfaced.
- **AC-5.3** The estimator is disabled when `layout === null` or `isComputing`.
- **AC-5.4** Unconfigured and demo-mode behave as elsewhere: disabled with a reason, or canned and
  labelled.
- **AC-5.5** A failed estimate leaves any previous estimate intact.

## Out of scope

- Persisting estimates (the `SavedLayout` model is untouched by this spec).
- Regional pricing lookups or any live price data.
- Tax, delivery, margin, or anything resembling a real quote.
