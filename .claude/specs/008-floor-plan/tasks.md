# 008 — Floor Plan: Multiple Rooms & Wall Assemblies · Tasks

**Prerequisite:** spec approved.

- [x] **T0 — Branch.** `git switch -c feat/008-floor-plan` from an up-to-date `main`.
      *Verify:* `git rev-parse --abbrev-ref HEAD` prints `feat/008-floor-plan`. (Constitution VIII)

### Engine (packages/geometry) — pure, tested before any UI

- [x] **T1 — Types & presets.** Add the plan types from `design.md` to
      `packages/geometry/src/types/index.ts`; add `packages/geometry/src/plan/assemblies.ts` with the
      seven presets from AC-3.2 and `totalThickness()`.
      *Verify:* test: Interior 2×4 = 114.3 mm, Exterior 2×6 = 163.5125 mm (to 1e-6), every preset
      has exactly one `core` layer. (AC-3.1, AC-3.2)

- [x] **T2 — Face offsets.** `faceOffsets(wall, assembly, level)` in `plan/walls.ts`, all six
      location lines, plus `flipped`.
      *Verify:* table test of Interior 2×4 boundaries on `centerline` (±57.15, ±44.45) and
      `finish-right` (−114.3, −101.6, −12.7, 0); flipping a Wet wall keeps the location line fixed
      and moves cement board to the other side. (AC-3.4, AC-4.1)

- [x] **T3 — Joins and wall solids.** `wallSolids(plan, level)` with mitre/bevel rules from
      `design.md`.
      *Verify:* tests for L (90° and 135°), T, X, and a 2×6/2×4 mixed L — the inside finish-face
      corner of a square L lies exactly at the expected point; a 10° join bevels instead of spiking;
      every solid is non-self-intersecting (`isSelfIntersecting`). (AC-5.2)

- [x] **T4 — Room derivation.** `deriveFloors(plan)` → `Map<roomId, DerivedRoom>` in
      `plan/derive.ts`.
      *Verify:* fixture: a 12 ft × 10 ft rectangle on centreline, Interior 2×4 →
      finish boundary 139½″ × 115½″ (111.89 ft²), core boundary 140½″ × 116½″, tile boundary with
      ¼″ gap 139″ × 115″. Two rooms sharing a partition each get the correct clear size. A
      free-standing wall inside a room becomes a hole. Removing one wall → `not-enclosed`; deleting
      the partition → both `redundant`. (AC-5.1, AC-5.3, AC-5.5, AC-5.6, AC-5.7, AC-6.1)

- [x] **T5 — Graph edits.** `plan/edit.ts`: `addWallChain`, `splitWallAt`, `moveNode`,
      `moveWallParallel`, `deleteWall` (with node clean-up and collinear merge), `setLocationLine`
      (preserves faces), `setAssembly` (preserves location line), `setClearLength`, and commit-time
      validation.
      *Verify:* tests for each, including: crossing walls produce an X node; setLocationLine leaves
      `wallSolids` byte-identical; setClearLength on a 2×4 rectangle wall makes the clear length
      exactly the typed value; a wall shorter than its thickness is rejected. (AC-2.2–2.6, AC-4.2,
      AC-6.3)

- [x] **T6 — Adapter & convert.** `toLayoutRoom()` and `planFromRoom()`.
      *Verify:* for a rectangle, an L, and an L with an island, `computeLayout` on the converted
      plan's room returns the same `fullTileCount`, `cutTileCount` and `roomArea` as on the original
      room. (AC-1.2, AC-4.3)

- [x] **T6a — Pattern groups (engine).** Optional `frame` argument on `computeLayout()`;
      `optimizeGroup()` in `plan/group.ts`.
      *Verify:* every existing geometry test passes unchanged; AC-11.6 fixture holds (grout lines
      line up across the two rooms to 1 µm); a group search stays inside the same fixed clip budget
      that bounds a single-room `optimize()` (≤ 2 × `CANDIDATE_BUDGET_TILE_CLIPS` + one probe). (AC-11.1–11.3, AC-11.6)

- [x] **T7 — Benchmark.** vitest bench: 40 walls / 8 rooms `deriveFloors` < 8 ms (median).
      *Verify:* `npm test -w packages/geometry` green incl. bench. If it fails, add a T7a moving
      derivation into the worker before continuing. (AC-9.2)

### Client

- [x] **T8 — Store.** Add plan state, write-through setters for the active room, `{room, plan}`
      undo snapshots, `convertToPlan`, and the per-room `layouts` map.
      *Verify:* `cd client && npx tsc --noEmit` clean; in the browser with no plan, every existing
      interaction behaves as on `main`; convert → undo restores the single room. (AC-1.1, AC-1.3,
      AC-2.7, AC-7.1, AC-7.2)

- [x] **T9 — Per-room worker dispatch.** Room-keyed request ids and dirty-room diffing in
      `useLayoutWorker.ts`.
      *Verify:* with 3 rooms, changing room B's pattern sends exactly one request (log count);
      dragging a node shared by A and B sends `compute-layout` for A and B only, then `optimize` on
      release. (AC-7.5)

- [x] **T10 — Wall rendering.** New `client/src/components/Canvas/PlanLayer.tsx`: poché, zoom-gated
      layer lines and core hatch, room labels with name / clear area / clear dims, status warnings.
      *Verify:* visual check at three zoom levels; a not-enclosed room shows its warning label.
      (AC-5.4, AC-9.1)

- [x] **T11 — Wall tool.** Chain drawing with node / span / crossing snaps, typed lengths, Esc /
      close-chain, reusing `utils/snapping.ts`.
      *Verify:* draw a two-room plan with a T-junction entirely from the keyboard-typed lengths;
      the node count and wall count match expectation in the store. (AC-2.1–2.3)

- [x] **T12 — Select & edit.** Node drag, wall parallel drag, delete, room tool placement and the
      "walls don't close" gap highlight.
      *Verify:* each operation is one undo step; placing a room in an open region shows the gap.
      (AC-2.4, AC-2.5, AC-5.1)

- [x] **T13 — Wall panel.** Assembly picker, editable layer table, save-as-assembly, location line,
      flip, lengths (location / clear left / clear right) and clear-length retype.
      *Verify:* change a wall from Interior 2×4 to 2×6: both adjacent rooms' clear areas shrink by
      the expected 1″ × wall length, and both rooms re-tile. (AC-3.3, AC-3.5, AC-6.2, AC-6.3)

- [x] **T14 — Plan panel & totals.** Rooms list, rename, delete, active room selection, expansion
      gap, project totals grouped by tile product, dimension mode toggle, ShapePanel swap.
      *Verify:* two rooms with the same 12×24 tile and one with 3×6 → totals show two product rows
      whose counts equal the sum of the per-room Stats cards. (AC-5.4, AC-6.4, AC-7.3, AC-7.4,
      AC-7.6)

- [x] **T14a — Pattern groups (UI).** "Continue pattern into…" in the Plan panel, group badge on
      room labels, leave-group action, `optimize-group` worker request, totals grouped.
      *Verify:* join kitchen and hall: grout lines line up visually across the shared wall; change
      the tile size in either room, and both update; leave the group, and the room keeps its tile
      while further changes stay local. (AC-11.1–11.5)

- [x] **T15 — AI gate.** Disable Read a plan in plan mode with the one-line explanation.
      *Verify:* works outside plan mode; disabled with the message inside it; `npm run
      typecheck:api` clean. (AC-10.1)

### Persistence

- [x] **T16 — Server.** `Project.plan Json?` migration, `PlanSchema` with caps and reference
      checks, routes pass it through.
      *Verify:* `curl` a valid plan → 201; a plan with 1 501 walls, a wall referencing a missing
      node, and a `version: 2` plan → each 400. (AC-8.2, AC-8.3)
      *Verified 2026-11-05 against local Postgres 16:* valid plan → 201 and reads back deep-equal; the three bad plans → 400.

- [x] **T17 — Save / load.** `useProjectActions` saves and restores the plan.
      *Verify:* save a 3-room plan with a custom assembly and a flipped wet wall, reload the page,
      load — identical walls, rooms, settings and tile counts. A pre-008 saved project still loads
      as a single room. (AC-1.4, AC-8.1)
      *Verified 2026-11-05:* real browser against the real API and Postgres — a two-room plan with a custom assembly, a flipped wet wall and a pattern group reloads with identical rooms and tile counts; a pre-008 project loads as a single room.

### Close-out

- [x] **T18 — Docs & review gate.** README "Floor plans" section; ROADMAP row; drag-performance
      check on an 8-room plan in DevTools Performance (AC-9.3); Constitution review gate items
      5–7.
      *Verify:* `npm test`, `npm run typecheck:api`, `cd client && npx tsc --noEmit` all clean.

## Verification block

1. `npm run dev`. With no plan: draw an L with an island; note tile count. Convert to floor plan →
   same tile count. Undo → single room again. Redo.
2. Wall tool: add a partition splitting the L into two rooms via a T-junction. Room tool: place a
   room on each side. Both tile.
3. Select the partition, switch to Wet wall 2×4, flip it. The cement-board side faces the chosen
   room; both rooms' clear areas are unchanged (same total thickness).
4. Change the partition to Interior 2×6: the wall grows 2″ on its centreline, so each room loses 1″ along it; tiles recompute.
5. Delete an exterior wall → both affected rooms read **Not enclosed**. Undo → restored.
6. Join the two rooms into one pattern group: grout lines continue across the partition.
7. Save, reload, load: identical.
