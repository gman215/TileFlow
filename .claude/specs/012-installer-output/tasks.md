# 012 — Installer Output · Tasks

Engine first (pure, tested), then the three surfaces that read it, then the sheet that combines them.

- [x] **T0 — Branch.** `feat/012-installer-output` from an up-to-date `main`. (Constitution VIII)

### Engine

- [x] **T1 — Cut pieces and groups.** `packages/geometry/src/cuts/index.ts`: `cutPieces`,
      `groupCuts`; exported from the package index.
      *Verify:* unit tests (`cuts.test.ts`) — a 1000 × 700 room of 300 × 300 grid tiles gives the
      exact straight and corner sizes; an L-room yields a notched piece; a 45° diagonal room yields
      angled pieces whose extents are ≤ the tile; herringbone sizes are product-oriented; a doorway
      split tile gives two pieces; the distinct tile count equals `cutTileCount` for every pattern;
      labels are ordered by count and grouping honours the step. (AC-1.1–1.4, AC-1.7)
- [x] **T2 — Start lines.** `packages/geometry/src/cuts/setout.ts`: `setOutLines`.
      *Verify:* unit tests — grid, centre-a-joint in a 3000 × 2000 room: line A and B lie on the
      joint through the centre and their wall distances sum to the room size; with a reference wall
      the lines are parallel/perpendicular to it; with a hole-edge anchor + full tiles, line A is
      on the tub front; herringbone returns `onJoint: false` through the point. (AC-2.3)
      *Verified 2026-11-12 (T1 + T2): 19 new tests in `cuts.test.ts`, all passing — exact
      200 × 300 / 300 × 50 / 200 × 50 cuts in a 1000 × 700 grid room; a notched L-corner piece with
      its label outside the notch; angled diagonal cuts within the tile; herringbone sizes against
      the product; both halves of a split tile; distinct cut tiles = `cutTileCount` for all five
      patterns in both fixed modes; start lines on the centre joints (distances sum to the room),
      the nearer joint of a centred offset tile, parallel to a slanted reference wall through its
      midpoint, on the tub front with full tiles, herringbone through the point, measured to given
      finish faces. Suite 255/255; geometry typecheck clean.*

### Surfaces

- [x] **T3 — Order by the box.** `utils/boxes.ts`, store `boxSizes`, `TilePanel` field (pieces or
      area), stats card, plan totals, takeoff + CSV; Prisma `Project.boxes`, server Zod, save/load.
      *Verify:* in the browser — 8 per box on a layout ordering 63 → "8 boxes", spare 1; `15.5 ft²`
      on 12 × 24 in → 8 pieces; a plan with two products shows boxes per product; save → reload →
      load against Postgres keeps it; an old project loads with tiles only. (AC-3.1–3.4)
      *Verified 2026-11-12 in headless Chromium + Postgres, 21 checks: 8/box on the bathroom → "4
      boxes · 32 tiles (2 spare)" on the card; `15.5 ft²` on 12 × 24 in → 8 pieces with the
      "rounded" note; garbage refused with the hint; the size follows the product when the tile is
      turned; outline undo leaves it; empty clears to tiles only; the apartment's three products each
      show boxes on the combined order; save → reload → load keeps `{"304.8x609.6": 8}`; a pre-012
      payload saves (201) and loads with tiles only; malformed keys/counts get 400. Found and fixed:
      `Math.ceil(n * 1.1)` over-ordered by one tile for every multiple of ten (100 → 111; 228 of
      0…5000) — now `orderQuantity()` in `api/ai.ts`, used by every order figure.*
- [x] **T4 — Cuts drawer.** `CutListPanel.tsx`, `useCutGroups`, **Cuts** button, CSV copy.
      *Verify:* in the browser on the L-shaped kitchen example: the list's piece/tile totals match
      the stats card's cut count; CSV pastes as the same rows; works for the active plan room.
      (AC-1.3, AC-1.5, AC-1.7)
      *Verified 2026-11-12 in headless Chromium, 12 checks: L-shaped kitchen — 28 pieces from 28
      cut tiles = the card's Cut 28; 16 sizes, A–P by count; rows sum to the pieces; the CSV has a
      header and the same 16 rows; brief and cut list never both open; the apartment's Living,
      Bedroom and Bath each reconcile with their own card. Added after the screenshot review: a
      notched L piece now gives its notch ("Notched 23 3/4 × 11 3/4"), in the engine with a test,
      since "24 × 24, notched" alone cannot be marked on a tile.*
- [x] **T5 — Cut labels on the canvas.** `showCutLabels` toggle; Konva text per piece.
      *Verify:* screenshot — every cut piece carries the letter its row in the drawer has; labels
      scale with zoom and vanish when too small; off by default. (AC-1.6)
      *Verified 2026-11-12 in headless Chromium, 9 checks on the L-shaped kitchen: none drawn by
      default; with the drawer's toggle on, 28/28 pieces lettered and every letter's position is its
      own piece's `labelAt` in that letter's group; capped at 22 px on screen; zoomed far out, 2
      too-small letters drop (≥ 7 px kept); zoomed in, all 28 stay ≤ 22 px; the toggle survives a
      reload. Screenshot reviewed; drawer columns tightened (unit in the header) so rows don't wrap.*

### Set-out sheet

- [x] **T6 — The sheet.** `Print/SetOutSheet.tsx`, print CSS, **Print** button, `lastBrief` in the
      store, plan pages + project order page.
      *Verify:* in headless Chromium, `page.pdf()` of the bathroom example (metric A4 and imperial
      Letter) and of the small-apartment plan: one page per room + order page, no app chrome, the
      drawing whole on its page; start-line distances match `setOutLines`; cut-list rows match the
      drawer; a brief generated for this layout prints, and after a tile change it does not;
      hand-moved tiles show the notice. (AC-2.1–2.8)
      *Verified 2026-11-12 in headless Chromium, 19 checks, PDFs from `page.pdf()`: bathroom metric
      → 1 page at A4 landscape (841.9 × 595.0 pt), imperial → Letter landscape (792 × 612 pt) with
      ft/in distances; the four start-line distances printed are `setOutLines`'s; the sheet's cut
      rows equal the drawer's; every one of 16 cut pieces is lettered on the drawing; a live brief
      (`gemini-3.5-flash-lite`) written for this layout prints as page 2, and after a grout change
      it is left off; hand-moved tiles show the notice; app shortcuts do not fire under the sheet,
      Esc closes it; the apartment → 3 room pages + project order page = 4 PDF pages, every drawing
      inside its page. Screenshot review moved the line markers past the wall labels and put A's
      and B's dimensions at opposite ends so they never cross.*

### Close-out

- [x] **T7 — Full verification.** Every AC in the browser; with `GEMINI_API_KEY` unset the sheet
      and cuts work (AC-4.3); regression of the four examples, 003–005 checks; `npm test`, typecheck
      (api, client, server), production build; README features; ROADMAP status.
      *Verified 2026-11-12: see Result.*

### Result — 2026-11-12

All 8 tasks verified. Engine: geometry 256/256 (20 new in `cuts.test.ts`). Browser (headless
Chromium): boxes 12, persistence 9 (Postgres), cut drawer 12, canvas letters 9, set-out sheet 19
(PDFs at A4 and Letter landscape, a live brief), close-out 18 — with `GEMINI_API_KEY` unset the cut
list, boxes and sheet work and Brief is disabled with its reason; herringbone, 45° diagonal and a
tub-front anchor print correctly; the four examples compute; the 003 assistant and 005 estimate
ran live (the estimate quotes the engine's order). Typechecks (api, client, server) and the
production build are clean; the key-leak grep finds nothing. Slow-3G (review gate 4) has nothing to
exercise: this spec adds no network request.

Fixed along the way:
- **Order quantity over by one for every multiple of ten.** `Math.ceil(n * 1.1)` gave 111 for 100
  tiles (100 × 1.1 = 110.00000000000001) — 228 of the counts 0…5000. Now `orderQuantity()` in
  `api/ai.ts`, in integers, used by every order figure (card, plan totals, takeoff, estimate, AI).
- Notched L pieces give their notch; a sub-½ mm "cut" is a **shave**, not a 300 × 300 straight cut
  — both from screenshot review, both with tests.

Limits, stated: offcut reuse and a choosable buffer are 015; walls on the sheet are 014. The sheet
prints the computed layout — hand-moved tiles are flagged, not drawn moved. In a pattern group
the start lines come from the group's shared frame.
