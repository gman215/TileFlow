# 004 — Installation Brief · Design

## The grounding rule, restated

Constitution I, in the form it takes here: **the model receives numbers and returns prose. It never
returns a number that was not in its input.**

Two mechanisms enforce it, because a prompt alone is not enforcement:

1. The client pre-formats every figure into a display string using the existing
   `formatDisplayFromMM()` and the `MM2_PER_FT2` / `MM2_PER_M2` constants that `StatsPanel` already
   uses. The model is handed `"8.4%"` and `"143 tiles"`, not raw millimetres and a unit flag, so it
   has nothing to convert and no reason to compute.
2. The verification block requires spot-checking generated briefs against `StatsPanel`. A
   mismatch is a spec failure, not a tuning issue.

The second is the one that matters. Prompts drift; a check that compares output to the engine does
not.

## Data flow

```
StatsPanel / brief button
        │  (enabled only when layout != null && !isComputing)
        ▼
  statsDto()  ──▶ formatForBrief()      client/src/api/ai.ts + measurements.ts
        │           pre-formatted display strings, user's unit system
        ▼
  POST /api/ai/brief   { stats, formatted, system }
        │
        ├─ methodGuard · readJson(32KB) · checkRateLimit · demo short-circuit
        │
        ├─▶ interactions.create({ model: fast, stream: true,
        │       system_instruction: SYSTEM_COMMON_V1 + BRIEF_V1,   // NOT concatenated into input
        │       input: facts })
        │
        └─◀ async iterable of events
             │
             ▼  new Response(new ReadableStream({ ... }))    text/plain; charset=utf-8
                                                             Cache-Control: no-store
                                                             X-Accel-Buffering: no
        │
        ▼  client: response.body.getReader() + TextDecoder
   incremental markdown render
```

Vercel enables streaming for Node functions by default, and Hobby's 300s max duration is far more
than this needs. `maxDuration` is still pinned in `vercel.json` so a hung upstream cannot burn the
budget.

The Vite dev adapter from 001 (T13) **must pipe** `response.body` rather than buffering it, or this
feature cannot be developed locally. That is the reason the requirement exists in 001.

## Request

```ts
{
  stats: LayoutStatsDTO;
  formatted: {
    roomArea: string;        // "96.0 ft²"      — matches StatsPanel exactly
    perimeter: string;       // "40 ft 0 in"
    tileSize: string;        // "12 in × 24 in"
    grout: string;           // "1/8 in"
    smallestCut: string;     // "0.4 ft²"
    waste: string;           // "8.4%"
    orderQuantity: string;   // "143"
    fullCount: string; cutCount: string; totalCount: string;
    wallCount: string; holeCount: string;
    pattern: string;         // "Herringbone"  — the UI's label, not the enum
    alignment: string;       // "Center tile"
    referenceWall: string | null;  // "W3"
  };
  system: 'metric' | 'imperial';
}
```

Pattern and alignment arrive as the **display labels** from `PATTERN_LABELS` and the `ALIGNMENTS`
table in `TileCanvas.tsx` / `TilePanel.tsx`, so the brief speaks the same language as the UI rather
than emitting `offset-1/2`.

## Sliver detection

Computed **client-side**, not by the model:

```ts
const tileAreaMm2 = tileConfig.width * tileConfig.height;
const sliver = layout.cutTileCount > 0 &&
               layout.smallestCutPiece > 0 &&
               layout.smallestCutPiece < tileAreaMm2 / 3;
```

The boolean and the formatted threshold are passed in; the prompt says to raise the warning when
`sliverRisk` is true. The model decides *how to say it*, never *whether it is true* (AC-2.3).

## Prompt — `BRIEF_V1`

- You write setting-out briefs for tile installers. Input is a completed layout from a geometry
  engine.
- **Never compute, derive, estimate or adjust a number.** Every figure you use appears verbatim in
  the input. If you want a figure that is not there, omit that sentence.
- No costs, prices or currency (that is a separate feature).
- Sections, in order: **Setting out**, **Cut list**, **Watch out for**, **Ordering**.
- Setting out follows the alignment mode: `optimize` — the engine chose the offset that scored best,
  so strike from the computed grid; `center-tile` — a full tile centres on the anchor;
  `center-grout` — a joint runs through it. When a reference wall is set, lines run parallel to that
  wall and setting out starts from its midpoint — say so, because that is how a floor is really set
  out.
- When `sliverRisk` is true, warn that the smallest cut is thin, fragile to cut and visually
  obvious, and suggest trying a different alignment or nudging the grid.
- Pattern notes: herringbone needs a 2:1 tile including grout or joints drift; a 45° diagonal
  produces more perimeter offcuts and more waste than a grid; offset patterns need the joint
  direction chosen deliberately.
- When `holeCount > 0`, note that cut-outs are excluded from the counts.
- The order quantity already includes 10% — explain it as breakage, future repairs and dye-lot
  matching. Do not suggest a different percentage.
- Markdown, short sections, readable on a phone. Under 400 words. No preamble, no sign-off.

## UI

`client/src/components/AI/BriefPanel.tsx` — opened from a **Brief** button on the floating stats
card (`StatsPanel.tsx`), rendered as a right-hand drawer over the stage so the layout stays visible
beside the text. Styling matches the existing floating chrome: the `CARD_STYLE` translucent dark
surface already defined in `StatsPanel.tsx` and `TileCanvas.tsx`.

- Streaming text renders incrementally with a subtle caret while active.
- **Copy** copies the raw markdown (AC-4.3).
- **Regenerate** aborts any in-flight request first (AC-4.2).
- **Staleness:** on open, record `layout.optimizationScore` + `offsetX/offsetY` + a hash of the tile
  config. If they change while the drawer is open, show a "layout has changed — regenerate" banner
  above the brief (AC-4.4). Cheaper and less jarring than auto-refetching, and it never spends a
  call the user did not ask for.

Markdown rendering: a ~40-line renderer covering headings, bold, lists and paragraphs. **Do not add
a markdown library** for four output shapes we control via the prompt.

## Failure behaviour

| Condition | Result |
|---|---|
| `layout === null` or `isComputing` | Button disabled with a reason (AC-4.1) |
| Stream dies mid-flight | Partial text kept, marked incomplete, retry offered (AC-3.4) |
| Abort / drawer closed | Reader cancelled; no state update after unmount (AC-3.3) |
| 429 / 502 | Plain message; previous brief, if any, left intact |
| Unconfigured | Button disabled with an explanation (AC-4.5) |
| Demo mode | Canned brief, labelled (AC-4.6) |
