# 012 — Installer Output · Requirements

**Status:** Complete — verified 2026-11-12 (see tasks.md)
**Depends on:** 011-layout-control (anchors — the set-out point), 008-floor-plan (plan rooms,
project totals), 004-installation-brief (the brief text on the sheet)

## Purpose

TileFlow produces nothing an installer can take to the job (COMPETITIVE-ANALYSIS §4). Every simple
competitor prints. Three gaps, in the order an installer hits them:

1. **What do I cut?** The stats card says "38 cut" and the smallest cut's area. An installer needs
   every cut piece measured and labelled — on the plan and as a list — so the cuts can be made in
   a batch at the saw.
2. **What do I take to the job?** A printable set-out sheet: the layout drawn to scale, where to
   strike the first lines and how far they are from the walls, the cut list, and the order.
3. **What do I buy?** Tile is sold by the box. "63 tiles" is not an order; "8 boxes" is.

Every figure on the sheet and in the cut list comes from the engine (Constitution I). No model call
is added by this spec.

---

## R1 — A dimensioned cut list

**WHEN** a layout has cut tiles
**THE SYSTEM SHALL** list every cut piece with its size, grouped into labelled sizes.

- **AC-1.1** Each cut piece is measured in the tile's own frame — along the tile's width and height
  edges — so the size is what is marked on the tile, for every pattern (herringbone and 45°
  diagonal included).
- **AC-1.2** Each piece is classed as **straight** (one cut, one side full), **corner** (cut on
  two sides, still a rectangle), **notched** (an L or U around a corner or cut-out — square cuts
  only) or **angled** (a cut that is not square to the tile). Notched and angled pieces show their
  overall size and say what they are; an L-shaped notched piece also gives its notch (the
  rectangle cut out of it), so it can be marked. A piece within ½ mm of full on both sides is a
  **shave** — counted as cut by the engine, set as it is on site — so it never reads as a
  full-size "straight cut".
- **AC-1.3** Pieces of the same class and size, to the nearest 1 mm (metric) or 1/16 in
  (imperial), share a label — A, B, C … — ordered by count, most first. The list shows label,
  size, class and count, and how many tiles are cut to make them.
- **AC-1.4** A tile cut into two disjoint pieces (a narrow doorway) contributes both pieces.
- **AC-1.5** A **Cuts** button on the stats card opens the list for the layout on screen (in a
  floor plan, the active room). It can be copied as CSV.
- **AC-1.6** **Cut labels** on the canvas: a toggle shows each cut piece's letter on the plan,
  sized to the piece; off by default.
- **AC-1.7** Counts reconcile: the pieces listed come from exactly the tiles the stats card counts
  as cut.

## R2 — A printable set-out sheet

**WHEN** the user asks for the set-out sheet
**THE SYSTEM SHALL** show a print-ready sheet and let the browser print it or save it as PDF.

- **AC-2.1** A **Print** button (stats card; `Ctrl+P` is left to the browser) opens a preview of
  the sheet over the app; **Print / Save PDF** calls the browser's print dialog; Esc or ✕ closes.
- **AC-2.2** The sheet draws the room to scale: outline, cut-outs, every tile (cuts tinted and
  labelled with their cut-list letter), each wall's length, and a scale bar. Paper is A4 landscape
  for metric and US Letter landscape for imperial.
- **AC-2.3** **Start lines.** Two perpendicular lines on a grout joint nearest the set-out point
  (the anchor when there is one, else the room centre), each dimensioned from the walls on both
  sides — "strike line A 1 234 mm from the left wall". For herringbone, which has no straight
  joint, the lines run through the set-out point on the pattern's axes and the sheet says so.
- **AC-2.4** The sheet carries the settings (room area, tile, grout, pattern, alignment, set-out
  from), the order (tiles incl. 10 % and boxes when known), and the full cut list.
- **AC-2.5** When an installation brief was generated for exactly this layout, it is printed on the
  sheet; a brief for an earlier layout is not.
- **AC-2.6** In a floor plan, the sheet has one page per tiled room plus a project order page.
- **AC-2.7** The sheet prints with no app chrome, no dark background, and no page cut through the
  drawing.
- **AC-2.8** When tiles have been moved by hand (edit mode), the sheet says the hand moves are not
  reflected — it shows the computed layout.

## R3 — Order by the box

**WHEN** the user enters how many tiles come in a box
**THE SYSTEM SHALL** show the order in boxes as well as tiles.

- **AC-3.1** The tile step has a **Per box** field (pieces). Typing an area per box instead
  (`15.5 ft²`, `1.44 m²`) is converted to pieces from the tile size and rounded to the nearest
  whole piece, and the field says so.
- **AC-3.2** Boxes = ⌈order quantity ÷ pieces per box⌉, where order quantity is the stats card's
  (incl. 10 %). The card shows "8 boxes · 64 tiles", and the spare beyond the order.
- **AC-3.3** Box size belongs to the tile product (its size), not the room: in a floor plan the
  project totals, the takeoff and its CSV give boxes per product.
- **AC-3.4** The box size is saved with the project and survives undo/redo of other edits; an old
  project without it loads unchanged and shows tiles only.

## R4 — Nothing else regresses

- **AC-4.1** The engine's layout, counts and optimizer are unchanged; cut analysis is a pure
  function of a `LayoutResult`.
- **AC-4.2** No AI request changes shape and no prompt changes version.
- **AC-4.3** The cut list and sheet work with `GEMINI_API_KEY` unset (only the brief section is
  absent).

## Out of scope

- Offcut reuse in the count (015 — every cut still costs a whole tile).
- A choosable order buffer (015 — fixed 10 %).
- Wall elevations on the sheet (014).
- A branded customer quote (019).
- Generating the PDF without the browser's print dialog (a PDF library is a new dependency for no
  installer gain — every browser saves to PDF).
