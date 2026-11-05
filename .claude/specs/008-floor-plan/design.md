# 008 — Floor Plan: Multiple Rooms & Wall Assemblies · Design

## The one idea

The engine already tiles any `RoomShape`. This spec adds a **pure derivation step** in front of it:

```
Plan (nodes, walls, assemblies, rooms)          ← the only thing the user edits
        │
        │  deriveFloors(plan)                    packages/geometry/src/plan/  (new, pure)
        │    1. wall solids (mitred joins)
        │    2. union → rings
        │    3. room = ring containing its placement point
        ▼
Map<roomId, DerivedRoom>                         ← never stored, always recomputed
   { finishBoundary, coreBoundary, tileBoundary, holes, status, origin }
        │
        │  toLayoutRoom(derived)  → { room: Room, origin: Vec2 }   (normalized, bbox at 0,0)
        ▼
computeLayout() / optimize()                     ← UNCHANGED
        │
        ▼
LayoutResult per room, drawn translated by `origin`
```

Nothing derived is persisted. Room geometry is a function of the walls, so it cannot drift from them.

## Types (packages/geometry/src/types/index.ts)

```ts
export type LayerFunction = 'finish' | 'substrate' | 'core' | 'sheathing' | 'air';

export interface WallLayer {
  material: string;      // "Drywall ½″", "2×4 stud", "Cement board"
  thickness: number;     // mm
  function: LayerFunction;
}

export interface WallAssembly {
  id: string;
  name: string;
  /** Left → right relative to the wall's a→b direction. Exactly one 'core'. */
  layers: WallLayer[];
  /** Core framing, used by 009. Absent for a non-framed core (masonry). */
  framing?: { studWidth: number; studDepth: number };
}

export type LocationLine =
  | 'centerline' | 'core-center'
  | 'finish-left' | 'finish-right'
  | 'core-left' | 'core-right';

export interface PlanNode { id: string; position: Vec2 }   // mm, plan space, y down

export interface PlanWall {
  id: string;
  a: string;             // node id
  b: string;             // node id
  assemblyId: string;
  locationLine: LocationLine;
  /** Swap left/right without moving the location line (AC-3.4) */
  flipped?: boolean;
}

export interface PlanRoom {
  id: string;
  name: string;
  /** Placement point — the room is the enclosed region containing it */
  seed: Vec2;
  /** Hand-drawn cut-outs (islands, tubs), plan space */
  holes: Polygon[];
  expansionGap: number;  // mm
  /** A wall id, not an edge index: edge order changes on every wall edit */
  referenceWallId?: string;
  tileConfig: TileConfig;
  alignment: AlignmentMode;
  weights: OptimizationWeights;
}

export interface Plan {
  version: 1;
  nodes: PlanNode[];
  walls: PlanWall[];
  assemblies: WallAssembly[];
  rooms: PlanRoom[];
}

export type RoomStatus = 'ok' | 'not-enclosed' | 'redundant';

export interface DerivedRoom {
  roomId: string;
  status: RoomStatus;
  /** Room-side finish faces — the clear room */
  finishBoundary?: Polygon;
  /** Stud faces — the framed room (009 hangs drywall from this) */
  coreBoundary?: Polygon;
  /** finishBoundary inset by expansionGap — what is tiled */
  tileBoundary?: Polygon;
  /** Free-standing walls inside the room + hand-drawn holes, at tile level */
  holes: Polygon[];
  /** Which wall each finish-boundary edge came from (for ⌗ and wall labels) */
  edgeWalls: (string | null)[];
}
```

`Plan.version` is a literal; a loader that sees anything else refuses (AC-8.3).

## Wall geometry

### Face offsets

For a wall with total thickness `T` and layers `L0..Ln` left→right, compute every layer boundary's
signed offset from the **location line** (left = negative normal side). E.g. Interior 2×4 on
`centerline`: boundaries at −57.15, −44.45, +44.45, +57.15 mm. On `finish-right` the same wall's
boundaries are at −114.3, −101.6, −12.7, 0.

`faceOffsets(wall, level)` returns `{ left, right }` for `level ∈ 'finish' | 'core' | 'tile'`:

- `finish`: outermost layer faces.
- `core`: core layer faces.
- `tile`: finish faces pushed outward by the room's expansion gap (applied per room, see below).

`flipped` mirrors the layer list before offsets are computed; the location line keyword is
mirrored too (`finish-left` ↔ `finish-right`) so the line stays physically put.

### Joins (AC-5.2)

At each node, incident walls are sorted by the angle of their direction *away* from the node. For
each angularly adjacent pair (w_i, w_{i+1}), the **left face of one is intersected with the right
face of the next** (as offset lines). That intersection is the shared corner point; each wall's
end is the quad between its two corner points at that node. Rules:

- Degree 1 node: square end (the face lines are capped perpendicular to the wall).
- Degree 2, collinear: corner points are simply the face endpoints; no join needed.
- Mitre limit: if the angle between a pair is < 15°, or the intersection lies more than 4·T from
  the node, fall back to a **bevel** (each wall's own face endpoint + the node). This stops a
  near-parallel join from throwing a spike across the plan.
- Different thicknesses meeting (2×6 exterior with a 2×4 partition) work without special-casing:
  each face line has its own offset.

The wall solid at a level is the polygon `[startLeft, endLeft, endRight, startRight]` using these
corner points. Each wall solid is valid by construction (simple, non-self-intersecting) unless the
wall is shorter than its joins — AC-2.6 rejects that at commit.

### Rooms from the union

```
solids  = walls.map(w => wallSolid(w, 'finish'))
union   = polygonClipping.union(...solids)          // existing dependency
rings   = every interior ring (hole) of every union polygon
```

Each interior ring is an enclosed region bounded by finish faces. For each `PlanRoom`:

1. Find rings containing `room.seed` (`pointInPolygon`, existing). Take the smallest by area
   (nested enclosures).
2. None → `status: 'not-enclosed'`.
3. Ring already claimed by another room → both `'redundant'`.
4. Any union polygon lying inside the ring → a free-standing wall → becomes a room hole.
5. Repeat with `level = 'core'` to get `coreBoundary` (the ring containing the seed).
6. `tileBoundary`: repeat once more with every wall's finish faces pushed out by this room's
   `expansionGap`. Done by re-running the union rather than by offsetting the polygon — no polygon
   offset routine is introduced, and mitred corners stay exact.

The seed is re-centred after every successful derivation to the room's pole of inaccessibility
(or centroid when the centroid lies inside), so a room follows its walls when they are dragged and
does not fall out of its own region.

Hand-drawn holes are stored in plan space and clipped to the room's tile boundary before being
handed to the engine. A hole whose vertices leave the room is reported through the existing
`validateShape()` `hole-outside` issue.

### Precision

Corner coordinates are rounded to 1 µm (the `clean()` rule already in `snapping.ts`) before the
union. polygon-clipping is robust to collinear input but not to near-coincident vertices from trig
dust; rounding makes a mitred inside corner of two square walls land on exactly one point.

## Engine adapter

```ts
export function toLayoutRoom(d: DerivedRoom, room: PlanRoom): { room: Room; origin: Vec2 }
```

Builds a `RoomShape { boundary: tileBoundary, holes, referenceWall }`, runs the existing
`normalizeShape()`, and returns the shift as `origin`. The worker receives a plain `Room` and never
learns that walls exist. The canvas draws a room's tiles inside a `Group` translated by `origin`.

## Pattern groups (R11)

```ts
export interface PatternGroup {
  id: string;
  roomIds: string[];          // ≥ 2
  tileConfig: TileConfig;
  alignment: AlignmentMode;
  weights: OptimizationWeights;
  /** Optional reference: a wall id + which room's side it is measured on */
  referenceWallId?: string;
}
// Plan gains: groups: PatternGroup[]; PlanRoom gains: groupId?: string
```

A room in a group ignores its own tile settings and reads the group's instead.

**The one engine change.** `computeLayout()` currently derives its pattern frame internally from
`patternFrameFor(room)`. It gains an optional `frame` argument that, when given, overrides that.
When the argument is omitted the behaviour is byte-identical, so every existing test keeps passing.

**Shared frame.** The group's frame lives in plan space: origin = midpoint of the reference wall's
finish face (or the plan origin `(0,0)` when there is none), angle = that wall's folded angle (the
existing ±45° fold). For each room, the frame passed to `computeLayout` is that same frame
translated into the room's local coordinates (`frame.origin − room.origin`). Because every room
uses the same plan-space frame and the same offset, tiles from different rooms sit on one lattice.

**Group optimization.** New `optimizeGroup(rooms, tileConfig, config, frame)` in
`plan/group.ts`. It reuses the existing two-phase candidate generation from `optimize()` and, at
each candidate offset, calls `computeLayout` for every room in the group with a shared prepared
`ClipShape` per room. The combined score uses the same formula as today, but over the whole group:
waste ratio is computed from the summed areas, and the min-cut term uses the smallest cut in any
room. The clipping budget that bounds `optimize()` is divided across the group's rooms, so a group
search costs about the same as one room's search does today.

**Worker.** One new request type, `optimize-group`, carrying the rooms, settings and frame; the
response carries one `LayoutResult` per room id. The dirty-room diff in `useLayoutWorker` treats
any change to one grouped room as a change to its whole group.

## Convert to floor plan (AC-1.2)

For each boundary edge of the current outline, create a wall on that edge with
`locationLine = finish-left|right` chosen so the finish face lies on the edge and the wall body lies
**outside** the room (the outline's winding decides which). One room is created with its seed at
the outline's interior point, its holes copied, its tile settings copied, and `expansionGap = 0`
— so the tileable polygon is the old outline exactly and the tile count is identical. A test
asserts this for a rectangle, an L and an L with an island.

## Clear-length retype (AC-6.3)

For a wall bounding a room on its left side, `clearLeft = locationLength − (trim at a) − (trim at b)`
where the trims come from the joins at each end. Given a target clear length, solve for the
location-line length by moving node `b` along the wall direction by `target − clearLeft`, using the
existing `setWallLength` rules so square plans stay square.

## Store (client/src/store/tileFlowStore.ts)

Adds:

```ts
plan: Plan | null;                     // null = single-room mode, today's app
activeRoomId: string | null;
tool: 'select' | 'wall' | 'room';
selectedWallId: string | null;
selectedNodeId: string | null;
layouts: Record<string, LayoutResult>; // per room
dimensionMode: 'clear' | 'centerline';
```

**Compatibility seam:** in plan mode, the existing `room`, `tileConfig`, `alignment`,
`optimizationConfig`, `layout` and `manualOffsets` fields are kept **as the active room's view**.
Every existing setter (`setTileSizeMM`, `setPattern`, `setAlpha`, …) is changed to write through to
`plan.rooms[active]` when a plan exists. This is what lets TilePanel, OptimizationPanel and
StatsPanel stay untouched (AC-7.2). The derived floors are memoised by a selector keyed on
`plan` identity.

Undo: `shapePast/shapeFuture` become snapshots of `{ room, plan }`. History depth stays 50; a plan
of 1 500 walls is ~150 KB, so 50 snapshots are well within budget. Structural sharing via immutable
updates keeps it cheaper than that in practice.

## Worker (client/src/hooks/useLayoutWorker.ts)

One worker, requests keyed by room: `requestId = "<roomId>:<n>"`, and the stale-response check
becomes per room (`latestRequestIdRef: Map<roomId, string>`). On a store change, the hook diffs the
previous and new `(tileBoundary, holes, tile settings)` per room and dispatches only changed rooms
(AC-7.5). The worker message types do not change.

## Persistence

- `server/prisma/schema.prisma`: `Project.plan Json?`. The existing `Room`/`TileConfig` rows
  continue to be written from the active room so the list view and old clients still work.
- `server/src/validation.ts`: `PlanSchema` mirroring the types above, with the caps in AC-8.2.
  Ids are `z.string().max(40)`; wall `a`/`b` must reference existing node ids and `assemblyId` an
  existing assembly (`superRefine`), so a dangling reference is a `400`.
- `useProjectActions`: save sends `plan`; load restores it when present and otherwise takes
  today's path.

## UI

- **Toolbar** (floating, over the stage, existing pill style): `Select · Wall · Room`, and the
  `Clear | Centreline` dimension toggle.
- **Sidebar**, plan mode: a **Plan** section at the top (rooms list with name / area / status,
  add-room hint, project totals), then a **Wall** section when a wall is selected (assembly picker,
  layer table with editable thicknesses, location line, flip, lengths), then the existing Tile /
  Optimization panels editing the active room. `ShapePanel` is replaced in plan mode by the room's
  cut-out tools and reference-wall picker.
- **Canvas layers**, bottom to top: room tiles (inactive dimmed) → wall poché → layer lines /
  core hatch (zoom-gated) → room labels → dimension strings → selection handles → drafting preview.

## Decisions and why

- **Walls are primary, rooms derived.** The alternative — draw room polygons and grow walls around
  them — cannot represent a shared partition (one wall, two rooms) without two overlapping walls,
  and any thickness change has to be pushed into two polygons by hand. Deriving rooms is what every
  serious BIM tool does, and it makes "change the wall, every room updates" free.
- **Union, not a planar-graph face walk.** A face walk needs exact intersection handling, mitre
  bookkeeping and hole detection; the boolean union of wall solids gets all three from the
  dependency the engine already trusts.
- **Rooms are found by a seed point,** not by a stored ring, so a room survives arbitrary edits to
  its walls and can explicitly report "not enclosed" instead of silently vanishing.
- **Expansion gap via re-union, not polygon offset.** Avoids writing a robust inward offset; costs
  one extra union per room, which the benchmark in AC-9.2 bounds.
- **The engine does not change.** Every guarantee its tests already make keeps holding.
