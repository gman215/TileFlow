# 013 — Patterns & Tile Shapes · Tasks

- [x] **T0 — Branch.** `feat/013-patterns-and-shapes` from an up-to-date `main`. (Constitution VIII)
      Also carries a small 012 follow-up: **Download** (.csv) beside Copy CSV in the cut list —
      verified in headless Chromium: `cut-list-<project>.csv`, UTF-8 BOM, content identical to the
      copied CSV.

### Engine

- [x] **T1 — Generators.** Four patterns, `tileFaceArea`, `variant`, hexagon alignment, periods.
      *Verify:* unit tests — with grout 0 every new pattern covers a large rectangle exactly (Σ
      clipped area = room area, no two tiles overlap); with grout, no overlaps; Centre a tile puts a
      tile centre on the anchor and Centre a joint a joint crossing (hexagon: a 3-tile vertex) for
      each, with and without a rotated frame; checkerboard neighbours differ in colour; the five old
      patterns are byte-identical to before. (AC-1.1–1.5, AC-4.1)
      *Verified 2026-11-12: 26 tests in `patterns013.test.ts` — exact cover (raw tiles clipped to a
      2.4 × 1.8 m room sum to its area, zero overlap) for all four; no overlaps with grout in a
      turned frame; 3:1 and portrait basketweave fit; a non-fitting basketweave tile gaps, never
      overlaps; checkerboard neighbours differ and per-colour counts add up; both alignment modes
      with and without a frame (hexagon joint = exactly three tiles at g/√3); hexagon is regular, F
      across flats, waste against its own area; the optimizer runs for each; full-tiles rule; the
      five old patterns hash identically to `main`. Suite 282/282.*
- [x] **T2 — Cuts and set-out.** Hexagon axes, colour in the cut key, continuous-joint start lines,
      full-tiles rule.
      *Verify:* unit tests — hexagon pieces ≤ F × 2F/√3; the same size in two colours = two groups;
      basketweave start lines are block boundaries (no tile straddles them); grid unchanged; hexagon
      → point lines. (AC-2.1–2.3)
      *Verified 2026-11-12: 5 more tests — hexagon pieces within F × 2F/√3 (angled or shave);
      checkerboard's 3 grid sizes become 6 labels (×2 colours); basketweave A and B cross no tile;
      hexagon → point lines; grid/checkerboard lines on the centre joints. One 012 test updated on
      purpose: in a ½ bond no cross joint is unbroken, and B now takes the nearest joint — the one
      through the set-out point — rather than the centre tile's side. Suite 287/287.*

### App

- [x] **T3 — Tile step and canvas.** Pattern buttons + previews, hexagon size field, basketweave and
      33 % warnings, colour tones, legend.
      *Verify:* in the browser — each new pattern lays in the bathroom, the L-kitchen and a plan
      room; the warnings appear and their buttons fix the layout; screenshots reviewed.
      (AC-1.1–1.5, AC-3.1)
      *Verified 2026-11-12 in headless Chromium, 21 checks: all four lay in the bathroom, the
      L-kitchen and the apartment's Bath (checkerboard colours sum to the total; hexagon squares
      the size); hexagon shows one "Across flats" field and no Lay row; basketweave warns on a
      square tile and "Use 12 × 24 in" clears it; the 33 % rule shows for 24 × 12 laid ↔ in ½
      offset, its buttons switch to ⅓ / ¼, and it stays quiet for 12 in tiles and for 12 × 24 laid
      ↕ (rows then stagger the short side — narrowed after the screenshot review). Canvas
      screenshots reviewed.*
- [x] **T4 — Counts, sheet, AI, server.** Per-colour order on card / cut list / sheet / boxes;
      sheet warning; AI enums and descriptions; server schema; slow patterns.
      *Verify:* in the browser — checkerboard light + dark = total; the assistant sets "hexagon"
      live; save → load keeps each pattern (Postgres); sheet PDF for hexagon and checkerboard.
      (AC-1.3, AC-2.1, AC-2.4, AC-3.1, AC-4.2)
      *Verified 2026-11-12 in headless Chromium + Postgres, 15 checks + 5 fit checks: checkerboard
      light 21 + dark 21 = 42 placed; the card orders Light 24 · Dark 24 = 48 (each colour its own
      10 %), and the brief/estimate figure is the same 48; 5/box → 10 boxes, each colour boxed
      apart; cut list has a Colour column with both colours and reconciles (28 from 28); the sheet
      prints order by colour and boxes; hexagon sheet says "across the flats" and sets out from the
      point; a 60 cm tile in ½ offset prints the 33 % warning; save → load keeps all four patterns,
      and a plan room saves with one; the live assistant set "8 inch hexagon" (203 × 203).
      Screenshot review found the cut list running off a checkerboard sheet — the first page now
      measures its side column and moves rows to the continuation page; no page overflows in
      checkerboard (2 tile sizes), hexagon or the apartment.*

### Close-out

- [x] **T5 — Full verification.** Every AC; key unset; regression of 012 scripts and examples;
      tests, typechecks, build; README, ROADMAP.
      *Verified 2026-11-12: see Result.*

### Result — 2026-11-12

All 6 tasks verified. Engine: geometry 287/287 (31 new across `patterns013.test.ts` and
`cuts.test.ts`); the five original patterns hash identically to `main`. Browser (headless
Chromium): Tile step and canvas 21, counts/sheet/AI/save 15, sheet fit 5, no key 6; every 012
script re-run green (boxes 12, persistence 9, cut drawer 12, letters 9, sheet 19, close-out 17,
download 5). The live assistant set "8 inch hexagon". Typechecks (api, client, server), the
production build and the key-leak grep are clean.

Fixed or changed along the way:
- The 33 % rule fires only when the rows stagger along a side over 18 in (24 × 12 laid ↔); laid ↕,
  a ½ offset staggers the short side.
- A checkerboard is two products: each colour is ordered with its own 10 % and boxed apart, and
  every surface (card, brief, estimate, plan totals, takeoff, sheet) reads the order from one
  function, `utils/order.ts`.
- The set-out sheet measures its side column and moves cut rows to the continuation page — a
  checkerboard's colour column and wrapped notch text ran it off the page.
- Start lines prefer a joint no tile crosses; in a ½ bond (none unbroken across the rows) B now
  takes the nearest joint, through the set-out point.

Limits, stated: hexagons lay flat sides vertical only; two colours only, checkerboard only.
