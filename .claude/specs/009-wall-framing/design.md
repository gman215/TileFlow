# 009 — Wall Framing: Studs, Openings & Takeoff · Design

## Data flow

```
Plan v2 (008 plan + openings + framing params + junction choices + header rules)
        │
        ├─ deriveFloors(plan)        008, extended: door openings extend tile boundaries (R5)
        │
        └─ frameWalls(plan)          packages/geometry/src/framing/   (new, pure)
              per wall:
                1. plate extents      from 008 joins + through/butt (R3)
                2. layout positions   o.c. from layout start (R2)
                3. openings           remove commons, add king/jack/header/cripples/sill (R4)
                4. junction extras    corner / partition studs on the through wall (R3)
              ▼
           FramedWall[]  ── elevation view, plan stud overlay
              │
              └─ takeoff(framed, derivedFloors, layouts)   (R6, R7)
                     ▼
                 Takeoff  ── table, CSV
```

Same rule as 008: everything right of `Plan` is derived and never stored.

## Types

```ts
export interface WallFraming {
  framedHeight: number;            // mm
  spacing: number;                 // mm o.c.
  layoutFrom: 'a' | 'b';
  topPlates: 1 | 2;
  loadBearing: boolean;
}

export interface Opening {
  id: string;
  wallId: string;
  kind: 'door' | 'window' | 'cased-opening';
  center: number;                  // mm from wall end a, along the location line
  roughWidth: number;
  roughHeight: number;             // door: floor to underside of header; window: top of RO
  sillHeight?: number;             // window only
  floorTransition?: 'centerline' | 'room-side' | 'through';  // door / cased only
  /** For 'room-side' / 'through': which side's room the setting is written from */
  side?: 'left' | 'right';
}

export interface JunctionChoice {
  nodeId: string;
  throughWallId: string;
  corner?: 'three-stud' | 'california';
  partition?: 'post' | 'ladder';
}

export interface HeaderRule {
  loadBearing: boolean;
  maxSpan: number;                 // mm, rough opening + 2 jacks
  member: string;                  // "2×6", "2×4 flat"
  plies: number;
  depth: number;                   // mm, drives cripple length
}

// Plan v2 = Plan v1 + these:
//   walls[i].framing?: Partial<WallFraming>   (overrides project default)
//   framingDefaults: WallFraming
//   openings: Opening[]
//   junctions: JunctionChoice[]
//   headerRules: HeaderRule[]

export type MemberKind =
  | 'stud' | 'king' | 'jack' | 'cripple' | 'header' | 'sill'
  | 'bottom-plate' | 'top-plate' | 'block' | 'corner' | 'partition';

export interface FramingMember {
  kind: MemberKind;
  /** Elevation rectangle in wall-local mm: x along the wall from plate start, y up from floor */
  x: number; y: number; width: number; height: number;
  /** Cut length of the piece (for a plate: its length; for a stud: its height) */
  length: number;
}

export interface FramedWall {
  wallId: string;
  plateStart: number;              // mm along the location line where the plate begins
  plateLength: number;
  members: FramingMember[];
  issues: { kind: 'opening-overlap' | 'opening-outside' | 'needs-engineered-header'; message: string }[];
}
```

## Wall-local coordinates

Each wall is framed in its own 1D-along / 1D-up space: `x` runs along the core from the plate start
toward the far end, `y` up from the floor. Plan rendering maps `x` back to plan space along the wall
direction and draws each vertical member as a `studWidth × studDepth` rectangle centred in the core.
The elevation view draws the members directly.

## Plate extents (R3)

From 008's join corner points at the core level: for a through wall, the plate runs between the
**far** core faces of the walls it passes; for a butting wall, between the **near** core faces.
Concretely, at each end node of wall W:

```
if W is through at node:  plateEnd = max over incident walls of (core intersection distance along W)
else:                     plateEnd = core face of the through wall nearest W
```

Free ends: plate ends at the core end (square end from 008).

## Layout (R2)

```
start  = layoutFrom === 'a' ? 0 : plateLength
marks  = [start ± k·spacing for k = 1.. while strictly inside the plate]
studs  = endStud(0) + marks.map(centered) + endStud(plateLength)
```

`endStud(0)` occupies `[0, studWidth]`; a mark `m` occupies `[m − w/2, m + w/2]`. This puts the
first intermediate stud's near edge at 15¼″ for 16″ o.c., so 48″ sheet joints fall on stud centres.

## Openings (R4)

For an opening with rough width `RW` centred at `c` (converted to plate-local `x`):

```
roL = c − RW/2,  roR = c + RW/2
jacks:  [roL − w, roL] and [roR, roR + w], height = roughHeight (door) / RO top (window)
kings:  [roL − 2w, roL − w] and [roR + w, roR + 2w], full stud height
header: x from roL − w to roR + w, y from roughHeight to roughHeight + rule.depth
remove: common studs whose rectangle intersects (roL − 2w, roR + 2w)
cripples (above): at removed marks inside (roL, roR), from header top to underside of top plates
window sill: x roL..roR at y = sillHeight − w (flat); cripples (below) at the same marks, floor plate top to sill
door/cased: bottom plate split at roL and roR
```

Overlapping or out-of-range openings produce an issue and are skipped in framing (still drawn,
red), so a bad edit never throws.

Fixture check (AC-4.5): 144″ wall, marks at 16 … 128; RO 53″–91″; king/jack zone 50″–94″ removes
the studs at 64″ and 80″ → 10 − 2 = 8 commons + 2 kings + 2 jacks; 2 cripples at 64″ and 80″;
header 38 + 2·1.5 = 41″; bottom plate 144 − 38 = 106″ in two pieces (53″ + 53″).

## Junction extras (R3)

Added to the **through** wall at the node's plate-local `x`:

- `three-stud` L: two extra studs positioned so the butting wall's interior finish has nailing.
- `california` L: one extra stud turned flat.
- `post` T: two extra studs flanking the butting wall's core.
- `ladder` T: `ceil(studLength / 600 mm)` blocks between the two nearest commons, `kind: 'block'`.

## Doors into floors (R5)

008's `deriveFloors` gains a step after the room ring is found: for every door/cased opening on a
wall that bounds the room, union the room's tile boundary with the rectangle
`[roL, roR] × [roomFinishFace → target]` where `target` is the wall centreline, the far finish face,
or nothing, per `floorTransition`. Expansion gap is not applied across the opening (the threshold
covers it). A test asserts that two rooms with a 36″ centreline door gain `36 × T/2` each, and that
the sum of their tiled areas is unchanged by flipping both to `room-side` + `through`.

## Takeoff (R6, R7)

- Studs grouped by `(kind, length)` rounded to 1⁄16″ / 1 mm for grouping only; counts are exact.
- Plates: collect all plate piece lengths; pack into the chosen stock length with first-fit
  decreasing; report pieces and offcut total. FFD is not optimal, and the UI says "pieces (approx.)".
- Sheet goods: for each wall side that bounds a room, `clear length × framedHeight − Σ(RO area on
  that wall)`; group by layer material of the outermost finish and substrate on that side.
- Tile: re-uses 008 project totals.

All multiplication happens in `takeoff()`; the panel only formats.

## Persistence

Plan `version: 2`. `upgradePlan(v1)` adds `framingDefaults` (imperial or metric by the project's
measurement system), empty `openings` / `junctions`, and the default `headerRules`. Zod schema gains
the new fields with AC-9.2 caps; `openings[].wallId` must reference an existing wall.

## UI

- Wall panel gains a **Framing** group (height, spacing, layout start, plates, load-bearing,
  derived stud length) and an **Openings** list with add-door / add-window.
- Node selection shows the through/butt toggle and corner/partition style.
- **Elevation** opens a modal Konva stage for the selected wall; same pan/zoom component as the plan.
- **Takeoff** is a sidebar section with scope toggle, waste %, sheet size and stock length pickers,
  and Copy as CSV.

## Decisions and why

- **Framing is derived, never stored.** Moving a wall 2″ re-lays every stud; storing studs would
  make that an edit to dozens of objects and a source of drift.
- **One opening model for floors and framing.** The same rough opening drives the header and the
  floor extension, so they cannot disagree.
- **Header table, not a span calculator.** Sizing a header properly needs loads the app does not
  have. An editable table, labelled as an estimate, is honest; a "calculator" would not be.
