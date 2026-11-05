# 008 — Floor Plan: Multiple Rooms & Wall Assemblies · Requirements

**Status:** Complete (21/21) — verified 2026-11-05
**Depends on:** nothing unmerged (builds on the shape engine already on `main`)
**Blocks:** 009-wall-framing
**Gemini capability:** none — this is an engine + editor feature. Constitution I (the engine computes)
and VIII (own branch) apply; the AI rules apply only where this spec touches 002's upload path.

## Purpose

TileFlow models exactly one floor outline, and that outline is a zero-thickness line. Real floors
are bounded by walls that have thickness, and the tiler's number — the clear dimension, finish face
to finish face — depends on what those walls are built from: a 2×4 partition with ½″ drywall each
side is 4½″ thick, a wet wall with ½″ cement board on the tile side is different again, and a
dimension taken on a wall centreline is 2¼″ larger than the floor you can actually tile.

This spec makes the plan the source of truth the way a real CAD tool does:

- **Walls** are a graph of segments joined at nodes. Each wall has a **layered assembly**
  (finish / substrate / core / sheathing layers with real thicknesses) and a **location line** that
  says which plane of the wall the user drew.
- **Rooms** are not drawn — they are **derived**: a room is the region enclosed by the walls'
  room-side finish faces, identified by a placement point (as Revit and ArchiCAD do it).
- Each room gets its **own tile layout**, computed by the existing engine, unchanged.

The engine keeps owning every number. `computeLayout()` / `optimize()` do not change; a new pure
module turns walls into the `RoomShape` they already accept.

---

## R1 — Plan mode is opt-in; the single-room app is untouched

**WHEN** a user has not created a floor plan
**THE SYSTEM SHALL** behave exactly as it does today.

- **AC-1.1** A new project opens on the same 10 ft × 8 ft rectangle with the same panels. Every
  existing test passes without modification.
- **AC-1.2** **Convert to floor plan** turns the current room (rectangle or drawn outline, with its
  cut-outs) into a plan: one wall per outline edge, default interior assembly, location line =
  *interior finish face*, so the tileable floor polygon and its tile count are **identical** before
  and after conversion.
- **AC-1.3** Converting is one undo step. Undo returns to the single-room project exactly.
- **AC-1.4** A saved single-room project loads as a single-room project. A saved plan loads as a
  plan.

## R2 — Wall graph

**WHEN** the user draws or edits walls
**THE SYSTEM SHALL** keep a connected wall graph whose junctions are explicit.

- **AC-2.1** **Wall tool**: click-to-click chain drawing, reusing the existing snapping (90°/45°,
  round increment, typed lengths such as `12 ft 6 in` or `3.6`, Shift for free angle). Esc ends
  the chain; clicking the chain's first node closes it.
- **AC-2.2** A click within the snap radius of an existing **node** joins to it. A click on an
  existing **wall's span** splits that wall at the point and joins there (a T-junction).
- **AC-2.3** Two walls crossing mid-span are split at the crossing and joined (an X-junction) when
  the second is committed.
- **AC-2.4** Dragging a node moves every wall that meets there. Dragging a wall's body moves it
  parallel to itself, carrying its two end nodes (and so stretching its neighbours).
- **AC-2.5** A wall can be deleted. Nodes left with no walls are removed; two collinear walls left
  meeting at a degree-2 node with identical assemblies are merged back into one.
- **AC-2.6** Zero-length walls, walls shorter than their own thickness, and collinear overlapping
  walls are rejected at commit with a plain message, not silently stored.
- **AC-2.7** Every wall edit is one undo step (a drag is one step for the whole gesture, as corner
  drags are today).

## R3 — Wall assemblies

**WHEN** a wall is created or selected
**THE SYSTEM SHALL** give it a layered assembly with real thicknesses.

- **AC-3.1** An assembly is an ordered list of layers from the wall's **left** side to its **right**
  side (relative to drawing direction). Each layer has a material name, a thickness in mm, and a
  function: `finish`, `substrate`, `core`, `sheathing`, or `air`. Exactly one layer is `core`.
- **AC-3.2** Built-in presets, shown in the user's measurement system:

  | Preset | Layers (left → right) | Total |
  |---|---|---|
  | Interior 2×4 | ½″ drywall · 2×4 stud (3½″) · ½″ drywall | 4½″ (114.3 mm) |
  | Interior 2×6 (plumbing) | ½″ drywall · 2×6 stud (5½″) · ½″ drywall | 6½″ (165.1 mm) |
  | Wet wall 2×4 | ½″ cement board · 2×4 stud · ½″ drywall | 4½″ (114.3 mm) |
  | Exterior 2×6 | ½″ drywall · 2×6 stud · 7⁄16″ OSB | 6 7⁄16″ (163.5 mm) |
  | Interior 89 mm (metric) | 12.5 mm plasterboard · 89 mm stud · 12.5 mm plasterboard | 114 mm |
  | Interior 140 mm (metric) | 12.5 · 140 · 12.5 | 165 mm |
  | Wet wall 89 mm (metric) | 12.5 mm cement board · 89 · 12.5 plasterboard | 114 mm |

  Nominal lumber is always stored at actual dressed size (2×4 = 1½″ × 3½″ = 38.1 × 88.9 mm).
- **AC-3.3** The user can edit any wall's layers (add, remove, reorder, retype thickness) and save
  the result as a named project assembly that other walls can use.
- **AC-3.4** **Flip** swaps a wall's left and right sides without moving its location line —
  needed so a wet wall's cement board faces the shower.
- **AC-3.5** Changing a wall's assembly or thickness re-derives every room it bounds and recomputes
  those rooms' tile layouts.

## R4 — Location line

**WHEN** a wall is drawn
**THE SYSTEM SHALL** know which plane of the wall the drawn line represents.

- **AC-4.1** Location line options: `centerline` (whole assembly), `core-center`,
  `finish-left`, `finish-right`, `core-left`, `core-right`. Default for new walls: `centerline`.
- **AC-4.2** Changing the location line of an existing wall keeps the wall's **physical position**
  (its faces do not move); only the reference line moves. Changing the *assembly* keeps the
  location line fixed and lets the faces move — the same distinction Revit makes.
- **AC-4.3** Walls generated by **Convert to floor plan** use the finish face on the room side, so
  the measured floor is preserved (AC-1.2).

## R5 — Rooms are derived from walls

**WHEN** walls enclose a region
**THE SYSTEM SHALL** let the user place a room in it, and keep that room bound to its walls.

- **AC-5.1** **Room tool**: clicking inside an enclosed region places a room there. The room's
  floor boundary is the closed ring of **room-side finish faces** of the walls around it. Clicking
  in an unenclosed region places nothing and says why ("these walls don't close — the gap is
  highlighted").
- **AC-5.2** Wall joins are mitred, so an L, T or X junction produces a clean inside corner at the
  finish face, at any angle (see `design.md` — Joins).
- **AC-5.3** A free-standing wall or pier inside a room becomes a cut-out of that room's floor.
  Hand-drawn cut-outs (island, tub, column) still work per room exactly as they do today.
- **AC-5.4** A room has a name (default "Room 1", "Room 2", …), and is labelled on the plan with its
  name, clear area, and clear dimensions when it is rectangular.
- **AC-5.5** When a wall edit opens a room's enclosure, the room is kept but flagged
  **Not enclosed**, its layout is cleared, and its label turns to a warning. Closing the walls again
  restores it with its settings intact.
- **AC-5.6** When a wall is deleted so two rooms now share one region, both are kept and flagged
  **Redundant room**; the user deletes one. Nothing is merged silently.
- **AC-5.7** Each room has an optional **perimeter expansion gap** (default ¼″ / 6 mm, range 0–20 mm).
  The tileable boundary is the finish-face boundary inset by this gap. This is the industry
  movement joint hidden under the baseboard and is what the tile count is computed against.

## R6 — Dimensions

**WHEN** a room or wall is shown or edited
**THE SYSTEM SHALL** distinguish the dimensions a tiler, a framer and a designer each use.

- **AC-6.1** The room panel shows, for the selected room: **clear** (finish to finish) area and
  perimeter, **framing** (stud face to stud face) area, and **tileable** area (after expansion gap).
  All three are computed by the engine.
- **AC-6.2** The wall panel shows the selected wall's location-line length, its room-side clear
  length on each side, and its total thickness, formatted in the active measurement system
  (fractional inches to 1⁄16″ in imperial).
- **AC-6.3** Retyping a wall's length offers a **reference**: `location line` (default) or
  `clear (left/right side)`. A clear-length retype computes and applies the equivalent
  location-line length, so typing a measured tape dimension does the right thing.
- **AC-6.4** A canvas toggle switches dimension strings between **Clear** (default — this is a tile
  app) and **Centreline**.

## R7 — Per-room tile layout

**WHEN** a plan has rooms
**THE SYSTEM SHALL** lay each room out independently, with the existing engine.

- **AC-7.1** Each room has its own tile config (size, grout, pattern, orientation), alignment mode,
  reference wall, optimizer weights, and manual tile nudges. New rooms copy the active room's tile
  settings.
- **AC-7.2** Selecting a room makes it **active**: the existing Tile, Optimization and Stats panels
  edit and report that room, with no change to how those panels look.
- **AC-7.3** Every room's tiles are drawn on the plan; inactive rooms are drawn at reduced opacity.
- **AC-7.4** A **Project totals** card sums tiles-to-order, area and cut count per distinct tile
  product across all rooms. The sums are done by the client from engine results; nothing is
  estimated.
- **AC-7.5** An edit recomputes only the rooms whose floor polygon or tile settings changed. While a
  node is being dragged, affected rooms re-clip at their last offset (the existing `interacting`
  fast path) and re-optimize on release.
- **AC-7.6** The reference wall (⌗) is chosen from the room's own boundary edges, as today.

## R8 — Persistence

**WHEN** a plan is saved and reloaded
**THE SYSTEM SHALL** restore it exactly.

- **AC-8.1** Walls, nodes, assemblies, rooms (with their placement points, names and all per-room
  settings) round-trip through `POST/PUT /api/projects` and load back identical.
- **AC-8.2** The server validates the plan with Zod, with hard caps (≤ 1 000 nodes, ≤ 1 500 walls,
  ≤ 100 rooms, ≤ 50 assemblies, ≤ 12 layers per assembly, thickness 0–1 000 mm). An over-cap
  payload is a `400`, never a partial save.
- **AC-8.3** The plan carries a schema `version`. Loading an unknown future version shows a plain
  message and changes nothing.

## R9 — Rendering & performance

- **AC-9.1** Walls are drawn as solid poché in plan, with layer boundaries visible from a zoom level
  where a ½″ layer is at least 3 px wide; the core is hatched.
- **AC-9.2** Deriving all rooms for a 40-wall, 8-room plan takes < 8 ms on the main thread
  (vitest benchmark in the geometry package). If the benchmark fails, derivation moves into the
  worker before this spec is considered complete.
- **AC-9.3** Dragging a node in an 8-room plan keeps the canvas interactive (no frame over 50 ms
  attributable to derivation + re-clip of the affected rooms).

## R10 — AI surfaces

- **AC-10.1** In plan mode, **Read a plan** (002) is shown disabled with one line: "Floor-plan mode
  reads one room at a time — coming in a later spec." It continues to work unchanged outside plan
  mode. No AI route or prompt changes in this spec.

## R11 — Continuous patterns across rooms

**WHEN** the same tile runs from one room into the next (kitchen into hallway)
**THE SYSTEM SHALL** keep the grout lines continuous between them.

- **AC-11.1** Rooms can be joined into a **pattern group**. Rooms in a group share one tile config,
  one alignment mode, one optimizer setting and one pattern origin in **plan space**, so a grout
  line that leaves one room continues in the next one exactly.
- **AC-11.2** The group can be squared to a reference wall picked from any of its rooms; every room
  in the group then uses that wall's angle and anchor.
- **AC-11.3** With alignment `optimize`, the search scores **all rooms in the group together** at
  each candidate offset (combined waste and the smallest cut across the group), and every room in
  the group uses the winning offset.
- **AC-11.4** Removing a room from a group gives it a copy of the group's settings, which then
  change independently. Deleting the last-but-one room dissolves the group.
- **AC-11.5** Each room still reports its own tile counts. The project totals count a group's
  rooms under one product row.
- **AC-11.6** Fixture: two rectangular rooms placed side by side, both in one group with a grid
  pattern. The plan-space x-coordinates of the vertical grout lines in room A equal those in room B
  (to 1 µm).
- **AC-11.7** With 009, a door between grouped rooms carries the pattern through the doorway with
  no break at the threshold.

## Out of scope (this spec)

- Studs, plates, openings (doors/windows), framing and drywall takeoff, wall heights and
  elevations — **009-wall-framing**.
- Multi-room photo-to-plan (extending 002 to return walls).
- Curved walls, multiple storeys, ceilings, roofs, DXF/DWG import or export.
