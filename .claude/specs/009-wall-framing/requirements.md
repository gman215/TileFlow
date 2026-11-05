# 009 — Wall Framing: Studs, Openings & Takeoff · Requirements

**Status:** Complete (14/14) — verified 2026-11-05
**Depends on:** 008-floor-plan (complete and merged)
**Gemini capability:** none. Constitution I applies with full force: every stud, plate, header and
sheet count is computed by `packages/geometry`, deterministically and under test.

## Purpose

008 gives walls real thickness. This spec gives them real **construction**: the studs inside the
core, the plates, the door and window openings with their kings, jacks, headers and cripples, the
corner and partition framing where walls meet, and the takeoff a framer and a drywaller would order
from. It also closes the loop back to tile: a door opening decides where the floor tile stops.

All rules here are standard light wood-frame practice as a **planning estimate**. Nothing is an
engineered or code-checked design, and the UI says so.

---

## R1 — Wall height and framing parameters

**WHEN** a wall has a framed core (008 `WallAssembly.framing` present)
**THE SYSTEM SHALL** let the user set how it is framed.

- **AC-1.1** Per wall: **framed height** (bottom of bottom plate to top of top plate; default
  97⅛″ / 2 467 mm, which gives a 92⅝″ precut stud under three 1½″ plates), **stud spacing**
  (16″ or 24″ o.c.; 400 or 600 mm metric; or custom), **layout start** (`a` or `b` end), **top
  plates** (1 or 2), and **load-bearing** (default: true for the Exterior preset, false otherwise).
- **AC-1.2** A project-level default for each parameter; walls inherit it until overridden.
- **AC-1.3** Stud length is derived: `framedHeight − plates × plateThickness`. It is shown, never
  typed.

## R2 — Stud layout

**WHEN** a wall's geometry or framing parameters change
**THE SYSTEM SHALL** lay its studs out the way a framer marks a plate.

- **AC-2.1** An end stud sits flush at each end of the wall's plate.
- **AC-2.2** Intermediate studs are placed on centre at multiples of the spacing measured from the
  layout-start end, so that sheet joints at 48″ / 1 200 mm land on a stud centre (first
  intermediate stud's near edge at 15¼″ for 16″ o.c.).
- **AC-2.3** For a 12 ft (144″) wall at 16″ o.c. with no openings and free ends: **10 studs**.
- **AC-2.4** A stud whose position would fall within ¼ of the spacing of an end stud is still placed
  (framers do not skip layout), matching standard practice.

## R3 — Junction framing

**WHEN** walls meet
**THE SYSTEM SHALL** decide which wall runs through and frame the junction.

- **AC-3.1** At every L, T and X node, one wall's plates **run through** and the others **butt**.
  Default: the wall with the deeper core runs through; on a tie, the longer wall (so a rectangle's
  long walls run through both ends rather than framing as a pinwheel); then the wall created first.
  A straight run through a node (two collinear walls, as at a T) always runs through as a pair. The
  user can toggle it per node.
- **AC-3.2** Plate length of a butting wall stops at the through wall's core face; the through
  wall's plate runs to the far core face. Both are reported in the takeoff.
- **AC-3.3** L corner on the through wall: choice of **3-stud corner** (+2 studs) or **California
  corner** (+1 stud, flat). Default: 3-stud.
- **AC-3.4** T / partition on the through wall: choice of **partition post** (+2 studs) or **ladder
  blocking** (one block every 24″ / 600 mm of stud height). Default: partition post.

## R4 — Openings

**WHEN** the user places a door or window in a wall
**THE SYSTEM SHALL** frame the rough opening.

- **AC-4.1** An opening is hosted by one wall: type (`door` | `window` | `cased-opening`),
  position (distance from wall end `a` to the opening centre), **rough opening** width and height,
  and for windows the **sill height**. It moves with its wall and cannot extend past the wall's
  ends or overlap another opening (rejected with a message).
- **AC-4.2** Framing: a **king stud** and a **jack (trimmer) stud** each side, a **header** spanning
  the rough opening plus both jacks, **cripple studs** above the header at layout positions, and for
  windows a **sill** plus cripples below it at layout positions. Common studs that fall inside the
  rough opening are removed.
- **AC-4.3** Doors and cased openings remove the bottom plate across the rough opening.
- **AC-4.4** Header size comes from a user-editable rule table keyed by span and `loadBearing`.
  Defaults: non-bearing → flat 2×4 (single); bearing → doubled 2×6 to 36″, 2×8 to 48″, 2×10 to
  72″, 2×12 to 96″; beyond 96″ the opening is flagged "needs an engineered header".
  The panel shows: "Planning estimate — not an engineered design."
- **AC-4.5** Fixture: the 144″ wall from AC-2.3 with a door, rough opening 38″ × 82½″, centred at
  72″ → **8 common studs + 2 king + 2 jack**, 2 cripples, 1 header 41″ long, bottom plate 106″.

## R5 — Doors and the tiled floor

**WHEN** a door or cased opening sits in a wall that bounds a room
**THE SYSTEM SHALL** extend that room's floor into the opening.

- **AC-5.1** Each door has a **floor transition** setting: `centerline` (default — each room's tile
  runs to the middle of the wall, where a threshold sits), `room-side` (tile stops at this room's
  finish face) or `through` (this room's tile runs through to the far finish face).
- **AC-5.2** The extension is part of the room's tile boundary from 008's derivation, so area, tile
  count, waste and cuts include it — computed by the existing engine.
- **AC-5.3** Windows never change a floor.

## R6 — Sheet goods

**WHEN** a plan has walls with finish or substrate layers
**THE SYSTEM SHALL** compute the sheet goods each wall face needs.

- **AC-6.1** For each wall side, net area = that side's clear length × (framed height) − rough
  openings on that wall. Clear length comes from 008 joins, so inside corners are not double
  counted.
- **AC-6.2** Sheets per material (drywall ½″, drywall ⅝″, cement board ½″, plasterboard 12.5 mm,
  …) = `ceil(net area × (1 + waste) / sheet area)`. Sheet size per material is selectable (4×8,
  4×10, 4×12 ft; 1 200 × 2 400 mm, 1 200 × 2 700 mm). Waste default 10%.
- **AC-6.3** Exterior-side layers of walls that do not bound a room (sheathing outside the
  building) are reported separately as **sheathing**.

## R7 — Takeoff

**WHEN** the user opens **Takeoff**
**THE SYSTEM SHALL** list what to order, every figure from the engine.

- **AC-7.1** Framing: precut studs (count × length), jacks, cripples (grouped by length), headers
  (size × length × count), plates (total linear length and pieces of a chosen stock length,
  packed first-fit decreasing), blocking.
- **AC-7.2** Sheet goods per material from R6; tile per product from 008's project totals.
- **AC-7.3** Scope: whole plan, or the selected room's bounding walls.
- **AC-7.4** **Copy as CSV** puts the table on the clipboard. No server round trip.

## R8 — Views

- **AC-8.1** Plan: studs, kings, jacks and headers are drawn inside the core when zoomed in far
  enough that a 1½″ stud is ≥ 4 px wide.
- **AC-8.2** **Wall elevation**: selecting a wall and pressing **Elevation** opens a framing
  elevation of that wall (viewed from its left or right side, toggle): plates, studs, openings,
  header, cripples, sill, and a running dimension string of layout marks from the layout-start end.
- **AC-8.3** Openings can be dragged along their wall in plan and in elevation; the rough-opening
  size is edited in the wall panel.

## R9 — Persistence & validation

- **AC-9.1** Openings, framing parameters, junction choices and the header rule table round-trip
  in the 008 `plan` JSON, `version` bumped to 2. A v1 plan loads and upgrades with defaults; the
  v2 loader still refuses anything newer.
- **AC-9.2** Caps: ≤ 20 openings per wall, ≤ 500 per plan.

## Out of scope

- Engineering: loads, spans for joists/rafters, shear walls, hold-downs, code compliance.
- Metal-stud framing rules (assemblies may still use a metal stud thickness; layout follows the
  same o.c. rules but corner/header details are wood-only in this spec).
- Ceilings, floor framing, multiple storeys, roof.
- Wall tile (tiling the wet-wall face) — a natural next spec, since the elevation view and the
  cement-board face both exist after this one.
- Door swings, door/window schedules, DXF export.
