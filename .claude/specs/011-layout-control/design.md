# 011 — Layout Control · Design

## R1 — Resizable sidebar

`App.tsx` renders `<aside className="w-[312px] …">`. The width becomes state:

- `client/src/hooks/useSidebarWidth.ts` — `{ width, setWidth, hidden, toggle }`. Clamped to
  `[260, min(560, window.innerWidth − 480)]`; persisted in `localStorage` with the same
  try/catch-and-fall-back pattern `StatsPanel` uses for its collapsed state (storage can be
  unavailable in private mode).
- `client/src/components/SidebarResizer.tsx` — a 6 px hit area on the aside's right edge,
  `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow/min/max`, `cursor-col-resize`.
  Pointer capture during the drag; ←/→ move 16 px; double-click resets to 312.
- `[` toggles the sidebar through the existing global shortcut hook (010 T3), which already ignores
  keystrokes in text fields. A small tab on the canvas edge reopens it.

No canvas change is needed: `TileCanvas` already re-fits through a `ResizeObserver` on its
container (TileCanvas.tsx ~L228). During a drag the width is applied with
`requestAnimationFrame` so Konva redraws at most once a frame.

## R2 — Inline wall length

### Where it appears

`client/src/components/Canvas/WallLengthEditor.tsx` — an absolutely positioned HTML element over
the Konva stage (not a Konva node: a real `<input>` gets IME, selection and accessibility for
free). Its position is the wall's midpoint, transformed by the stage's current scale and pan,
pushed outward along the wall's outward normal — the same normal `RoomShapeLayer` already uses to
place dimension labels outside the room.

It reuses `DimensionField` (parsing `12 ft 6 in`, `4.2`, Enter/Esc, ↑↓ nudge) rather than a new
input, so the inline field and the wall table accept exactly the same text.

### Opening it

`RoomShapeLayer` already sets `selectedWall` on click. A new store field `editingWall` (index for an
outline, edge name for a rectangle, wall id in a plan) opens the editor; selecting a wall opens it,
as does double-clicking a dimension label. Clicking the canvas elsewhere, Esc, or starting a drag
closes it. It never opens while drawing (`draft !== null`).

### Live preview (AC-2.2)

`setWallLength(boundary, index, mm)` in `packages/geometry/src/shape/index.ts` is pure, and its
rule is already documented: the adjoining wall stays rigid and the **parallel wall opposite absorbs
the change** (so a rectangle stays a rectangle and an L stays square). The editor calls it on every
keystroke with the parsed value and renders the result as a ghost outline; the absorbing wall is
whichever wall's length differs between the current and preview outline. `validateShape()` on the
preview gives the refusal reason for a self-crossing result (AC-2.4).

Floor plans have their own pure function (`setPlanWallLength` / `setClearLength`) and preview the
same way.

### Committing

| Room kind | Action |
|---|---|
| Plain rectangle | `setRoomWidthMM` / `setRoomHeightMM` (top/bottom → width, sides → height) |
| Drawn outline | `setShapeWallLength(index, mm)` — already one outline-history step |
| Floor-plan wall | `setPlanWallLengthMM(id, mm, ref)` with the same `ref` the WallPanel field uses |

## R3 — Anchors

### Model

```ts
// packages/geometry/src/types — on RoomShape (and on PlanRoom / PatternGroup for plans)
export type LayoutAnchor =
  | { kind: 'hole-centre'; hole: number }
  | { kind: 'hole-edge'; hole: number; edge: number; fullTilesFromEdge: boolean }
  | { kind: 'point'; at: Vec2 };

interface RoomShape {
  boundary: Polygon;
  holes: Polygon[];
  referenceWall?: number;
  anchor?: LayoutAnchor;          // new; absent = today's behaviour
}
```

Anchors refer to features **by index**, not by coordinates, so moving or resizing a cut-out moves
the anchor with it (AC-3.5). Store actions that delete a hole or vertices renumber or clear the
anchor in the same edit, the way `referenceWall` is maintained today.

### Resolving it — one function

`patternFrameFor(room)` in `shape/index.ts` is already the single place that turns room state into
the `PatternFrame { origin, angle }` every generator lays out from. It grows to:

| Anchor | origin | angle |
|---|---|---|
| none | room centre (no frame) / reference wall midpoint | 0 / reference wall, folded ±45° |
| `hole-centre` | the cut-out's area centroid | reference wall if set, else 0 |
| `hole-edge` | that edge's midpoint | **that edge's angle**, folded ±45° |
| `point` | the point | reference wall if set, else 0 |

Because every generator already anchors on the frame origin and `computeAlignmentOffset` already
expresses *Centre a tile* / *Centre a joint* relative to it, centre and point anchors need **no
generator changes** — the existing proof in `computeAlignmentOffset`'s comment ("rotation about a
point leaves it fixed") covers them for all five patterns.

### "Full tiles from this edge" (AC-3.3)

This is the one genuinely new rule: the two axes take different alignments. In the frame of the
edge, x runs along the edge and y away from it:

- y (perpendicular): a joint on the edge — `offsetY = g/2`, the *Centre a joint* value for that
  axis alone, so the first full row starts at the tub front;
- x (along): the user's mode — `−w/2` for *Centre a tile*, `g/2` for *Centre a joint* — so the
  layout is symmetric about the tub's centreline.

`computeAlignmentOffset` gains an optional per-axis override. It is only meaningful for patterns
whose joints run parallel to the frame axes — grid, ½ and ⅓ offset — so for herringbone and 45°
diagonal the option is disabled with the reason (AC-3.6) rather than producing a layout that only
looks aligned. The edge's outward side (away from the cut-out, into the tiled floor) is the side
the full tiles start on.

### The worker and the optimizer

The worker receives the room as it does today; `patternFrameFor` runs inside it. *Least waste*
ignores the anchor's origin (it searches offsets) but keeps the frame's angle, exactly as it keeps
the reference wall's today. Picking an anchor while on *Least waste* switches to *Centre a tile*
with a one-line notice (AC-3.4) — otherwise the anchor would do nothing visible and look broken.

### Anchor tool and marker (AC-3.2)

A new tool in the 010 toolbar, **Anchor (A)**, in `TileCanvas`'s tool list. Click resolution, in
order: inside a cut-out → `hole-centre`; within 12 screen px of a cut-out edge → `hole-edge`;
inside the floor → `point`; outside → refused with a hint. A crosshair marker (`AnchorLayer.tsx`)
draws the resolved origin and, for an edge anchor, a short line along the edge; it can be dragged
and snaps to cut-out centres, edge midpoints and wall midpoints. The HintBar (010 T4) gets a line
for the tool.

In the sidebar, step 3 (*Layout*) gains a **Centre on** row under the alignment buttons: *Room* ·
*Reference wall* · the current feature anchor (e.g. "Cut-out 1, front edge") with ✕ to clear, plus
the "Full tiles from this edge" checkbox when it applies.

### Persistence (AC-3.7)

- **Server:** `server/src/validation.ts` validates `RoomShapeSchema` (holes, `referenceWall`) and
  the plan room / group schemas (`referenceWallId`). Each gains an optional `anchor` with the same
  discriminated union in Zod — without this the field would be stripped on save.
- **Undo:** the anchor lives on the shape / plan, so it is captured by the existing outline history
  and by 003's `aiSnapshot` with no extra work.
- **Plans:** `PlanRoom` and `PatternGroup` get `anchor?`, resolved by the group/room frame code in
  `plan/group.ts` next to `referenceWallId`. A group has one anchor, which may sit in any member room.

### AI features (AC-3.8)

The brief and the assistant read `statsDto()`. It gains `room.anchor`: a display string built
client-side — "room centre", "W3 midpoint", "cut-out 1 (1.60 × 0.80 m) centre", "cut-out 1, front
edge, full tiles from the edge", "a point 1.20 m from W1". `BRIEF_V2`'s setting-out rules talk
about the room centre and the reference wall only, so a new **`BRIEF_V3`** adds the anchor case;
the assistant needs no new tool in this spec (setting an anchor by chat is a follow-up).

## Failure behaviour

| Condition | Result |
|---|---|
| Wall length that crosses the outline | Field shows the reason; nothing committed |
| Anchor's cut-out deleted | Anchor cleared, notice "Anchor removed with cut-out 2" |
| Point anchor outside the floor (after an edit) | Marker shown red, notice; layout still uses it |
| Edge anchor with herringbone / diagonal | "Full tiles from this edge" disabled, reason in a tooltip |
| Storage unavailable | Sidebar width falls back to 312 px each load |
