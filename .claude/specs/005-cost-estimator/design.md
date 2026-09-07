# 005 — Cost & Material Estimator · Design

## The grounding rule, restated

Constitution I, in the form it takes here: **the model returns quantities and unit rates. The
client does every multiplication and every sum.**

This is not pedantry. Language models produce plausible arithmetic, and plausible arithmetic in a
column labelled "Total" is worse than no total at all — it is wrong in a way that looks right. The
split also happens to be the correct division of labour: "5 kg of adhesive per m² at a 6 mm notch"
is domain knowledge worth asking for; `96 × 5` is not.

So:

| Quantity | Source | Enforcement |
|---|---|---|
| Tile order quantity | engine (`orderQuantity`) | echoed from input; a model value is ignored (AC-1.1) |
| Room area | engine (`roomAreaMm2`) | echoed from input; a model value is ignored (AC-1.2) |
| Adhesive / grout / spacers / trim | model, from a stated coverage basis | `basis` required, else the line is dropped (AC-1.5) |
| Labour hours | model, labelled an estimate | `basis` required |
| **Every subtotal** | **client** | `quantity × unitCost`, computed in `client/src/ai/estimate.ts` |
| **Total** | **client** | sum of client subtotals; a model total is discarded (AC-2.3) |

## Data flow

```
EstimatePanel  ──▶ statsDto() + user unit prices
                        │
                        ▼
              POST /api/ai/estimate  { stats, prices, currency, system }
                        │
                 methodGuard · readJson(32KB) · rate limit · demo short-circuit
                        │
                 interactions.create({
                   model: fast,
                   response_format: { type:'text', mime_type:'application/json',
                                      schema: ESTIMATE_JSON_SCHEMA } })
                        │
                 EstimateOut.parse(...)          ← untrusted until here
                        │
                        ▼
              { lineItems: [{ item, quantity, unit, unitCost, basis, source }],
                assumptions: string[], confidence, notes }
                        │
                        ▼  client — client/src/ai/estimate.ts
                 sanityFilter()   drop non-finite / negative / absurd / basis-less
                 overrideEngineQuantities()   tile + area lines forced to engine values
                 computeTotals()  subtotal = quantity × unitCost ; total = Σ subtotals
                        │
                        ▼
                 table render, engine-sourced rows badged
```

Price edits re-run only the last three steps — no model call (AC-3.3). This makes the price inputs
feel instant and costs nothing, which is the whole reason prices are separated from quantities in
the response shape.

## Schema and Zod mirror

In `api/_lib/schemas.ts`, edited together as always.

```ts
export const ESTIMATE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    lineItems: { type: 'array', items: { type: 'object', properties: {
      item:     { type: 'string' },
      quantity: { type: 'number' },
      unit:     { type: 'string' },
      unitCost: { type: 'number' },
      basis:    { type: 'string' },
      source:   { type: 'string', enum: ['engine','estimated'] },
    }, required: ['item','quantity','unit','unitCost','basis','source'] } },
    assumptions: { type: 'array', items: { type: 'string' } },
    confidence:  { type: 'number' },
    notes:       { type: 'string' },
  },
  required: ['lineItems','assumptions','confidence','notes'],
};

export const EstimateOut = z.object({
  lineItems: z.array(z.object({
    item:     z.string().min(1).max(80),
    quantity: z.number().finite().nonnegative(),
    unit:     z.string().min(1).max(24),
    unitCost: z.number().finite().nonnegative(),
    basis:    z.string().min(1).max(200),          // empty basis ⇒ line dropped (AC-1.5)
    source:   z.enum(['engine','estimated']),
  })).min(1).max(20),
  assumptions: z.array(z.string().max(200)).max(12),
  confidence:  z.number().min(0).max(1),
  notes:       z.string().max(400),
});
```

Note there is deliberately **no `subtotal` and no `total` field**. The model cannot supply what the
schema does not ask for, which is a stronger guarantee than instructing it not to (AC-2.1, AC-2.3).

## Sanity bounds

Applied client-side in `sanityFilter()`, per unit family, scaled to room area:

| Line kind | Bound |
|---|---|
| Tiles | forced to the engine's `orderQuantity` |
| Adhesive | ≤ 15 kg per m² of room area |
| Grout | ≤ 5 kg per m² |
| Labour | ≤ 2 hours per m², and ≥ 0.05 |
| Any line | finite, non-negative, `basis` non-empty |

A line outside its bound is dropped and surfaced in the UI as "1 line was discarded as
implausible" — visible, not silent, because a silently dropped line is how a wrong total hides
(AC-5.2).

## Prompt — `ESTIMATE_V1`

- You produce a materials takeoff for a tile installation. Output only the schema.
- **You never perform arithmetic.** Give quantities and unit rates; the application multiplies and
  sums. There is no subtotal or total field — do not attempt to provide one.
- Tile quantity and room area are given to you. Echo them exactly with `source: "engine"`. Do not
  recompute or adjust them; the given tile quantity already includes a 10% buffer.
- Everything else is `source: "estimated"`.
- Every line needs a `basis` naming the coverage rate or rule of thumb used
  ("thinset at 5 kg/m², 6 mm notch trowel"). A line without a real basis must be omitted.
- Consider: thinset/adhesive by notch size, grout by joint width and tile size, spacers, edge trim
  by perimeter, underlayment/backer board if implied, sealer for the tile type, and labour hours by
  pattern (herringbone and 45° diagonal take materially longer than a grid).
- Use the given unit prices where provided. Where none is given, use a plausible placeholder and say
  so in `assumptions`.
- Keep to at most 10 line items. State genuine uncertainty in `confidence`.
- Never mention a total, a quote or a guaranteed price.

## UI

`client/src/components/AI/EstimatePanel.tsx` — a sidebar section below `OptimizationPanel`
(collapsed by default so it does not crowd the existing controls).

- **Price inputs** — tile, adhesive, grout, labour rate, currency selector. Reuse `input-field` and
  the `DimensionField` nudge pattern where sensible; defaults marked as placeholders and switching
  per-ft²/per-m² with `system` (AC-3.2).
- **Table** — item · qty · unit · unit cost · subtotal, with a small badge on engine-sourced rows
  (AC-4.5). Subtotals and total in `font-mono`, matching `StatsPanel`'s numeric treatment.
- **Assumptions** — a plain list under the table (AC-4.2).
- **Confidence** — shown, with a caution below ~0.5 (AC-4.3).
- **Disclaimer** — "Planning aid, not a quote" always visible (AC-4.4).
- Prices live in the store for the session only, never sent to the Express API (AC-3.4).

## Failure behaviour

| Condition | Result |
|---|---|
| Zod failure | Nothing displayed; error message; previous estimate kept (AC-5.1, AC-5.5) |
| A line fails sanity bounds | Line dropped, drop count shown (AC-5.2) |
| All lines dropped | Treated as a failed estimate |
| `layout === null` / computing | Panel disabled with a reason (AC-5.3) |
| 429 / 502 / offline | Plain message; previous estimate intact |
| Unconfigured / demo mode | Disabled with a reason / canned and labelled (AC-5.4) |
