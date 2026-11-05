# 009 — Wall Framing: Studs, Openings & Takeoff · Tasks

**Prerequisite:** 008-floor-plan merged to `main`.

- [x] **T0 — Branch.** `git switch -c feat/009-wall-framing` from an up-to-date `main`.
      *Verify:* `git rev-parse --abbrev-ref HEAD` prints `feat/009-wall-framing`. (Constitution VIII)

### Engine (packages/geometry/src/framing/)

- [x] **T1 — Types, defaults, v1→v2 upgrade.** Types from `design.md`; imperial and metric
      `framingDefaults`; default `headerRules`; `upgradePlan()`.
      *Verify:* test: a v1 fixture upgrades with defaults and derives the same floors as before;
      stud length for 97⅛″ / 2 top plates = 92⅝″. (AC-1.1–1.3, AC-9.1)

- [x] **T2 — Plate extents.** Through/butt resolution and plate start/length per wall.
      *Verify:* on 008's 12 × 10 ft centreline rectangle (Interior 2×4, core faces ±1¾″), with the
      12 ft walls running through: through plates = 144 + 2 × 1¾ = 147½″, butting plates =
      120 − 2 × 1¾ = 116½″. Toggling a node's through wall swaps them.
      (AC-3.1, AC-3.2)

- [x] **T3 — Stud layout.** `layoutStuds()`.
      *Verify:* 144″ @ 16″ → 10 studs; first intermediate near edge at 15¼″; layout from `b`
      mirrors it; 24″ o.c. → 7 studs; metric 3 600 mm @ 600 → 7. (AC-2.1–2.4)

- [x] **T4 — Openings.** `frameOpenings()` for door, window, cased opening; overlap / outside
      issues; header rule lookup and the "needs engineered header" flag.
      *Verify:* AC-4.5 fixture exactly (8 commons, 2 kings, 2 jacks, 2 cripples, 41″ header, 106″
      bottom plate); a 36″ window at 36″ sill adds sill + lower cripples; a 100″ bearing opening
      raises the issue. (AC-4.1–4.4)

- [x] **T5 — Junction extras.** Corner and partition framing on through walls.
      *Verify:* 3-stud L adds 2, California adds 1, post T adds 2, ladder on a 92⅝″ stud adds 4
      blocks (ceil(2352.7 / 600)). (AC-3.3, AC-3.4)

- [x] **T6 — Doors into floors.** Extend `deriveFloors` per R5.
      *Verify:* two rooms joined by a 36″ door in a 4½″ wall: each gains 36 × 2¼ = 81 in² with
      `centerline`; `room-side` + `through` keeps the combined area equal; windows change nothing.
      (AC-5.1–5.3)

- [x] **T7 — Takeoff.** `takeoff()` with grouping, FFD plate packing, sheet goods per material,
      separate exterior sheathing.
      *Verify:* fixture plan's drywall sheet count matches a hand calculation written in the test;
      changing waste from 10% to 15% changes only the sheet counts. (AC-6.1–6.3, AC-7.1, AC-7.2)

### Client

- [x] **T8 — Store & persistence.** v2 plan in the store; openings, framing and junction actions;
      Zod `PlanSchema` v2 with caps on the server.
      *Verify:* `curl` a v2 plan → 201; 21 openings on one wall → 400; a v1 save loads and upgrades.
      (AC-9.1, AC-9.2)

- [x] **T9 — Wall panel: framing + openings.** Framing group, openings list, add door / window,
      node through/butt and corner style controls.
      *Verify:* each control changes the derived members (log or elevation) and is one undo step.
      (AC-1.1, AC-1.2, AC-3.1, AC-4.1)

- [x] **T10 — Plan stud overlay.** Zoom-gated member drawing in `PlanLayer.tsx`; draggable openings.
      *Verify:* visible at high zoom, hidden when a stud would be < 4 px; dragging a door re-lays
      studs live. (AC-8.1, AC-8.3)

- [x] **T11 — Elevation view.** Modal Konva elevation with left/right toggle, layout-mark dimension
      string, draggable openings.
      *Verify:* AC-4.5 fixture wall renders the expected members and marks at 16, 32, 48 … from the
      layout start. (AC-8.2, AC-8.3)

- [x] **T12 — Takeoff panel.** Scope toggle, waste %, sheet size, stock length, Copy as CSV,
      planning-estimate disclaimer.
      *Verify:* pasted CSV opens cleanly in a spreadsheet and its totals equal the panel's.
      (AC-4.4, AC-7.1–7.4)

### Close-out

- [x] **T13 — Docs & review gate.** README "Framing & takeoff" section; ROADMAP row; review gate
      items 5–7.
      *Verify:* `npm test`, `npm run typecheck:api`, `cd client && npx tsc --noEmit` clean.

## Verification block

1. Load the 008 verification plan. Set framed height 97⅛″, 16″ o.c.
2. Add a 38″ × 82½″ door centred in the partition. Elevation shows kings, jacks, header, two
   cripples; bottom plate is split. Both rooms' tile now runs to the wall centreline in the doorway; if the two rooms share a pattern group, the grout lines run through the doorway unbroken (008 AC-11.7).
3. Switch the door's floor transition to `through` from the bathroom side: the bathroom tile runs
   through, the other room's stops at its finish face; combined tiled area unchanged.
4. Toggle a corner to California; stud count in Takeoff drops by one.
5. Takeoff → Copy as CSV → paste into a spreadsheet.
6. Save, reload, load: identical framing and takeoff.
