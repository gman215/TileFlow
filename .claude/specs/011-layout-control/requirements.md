# 011 — Layout Control · Requirements

**Status:** Complete — verified 2026-11-09 (see tasks.md)
**Depends on:** 010-ux-onboarding (sidebar, toolbar, shortcuts), 008-floor-plan (plan rooms)

## Purpose

Three things a tiler reaches for and cannot do today:

1. **Make the sidebar wider or narrower.** It is fixed at 312 px. On a laptop it crowds the
   drawing; with a long wall table it is too narrow to read.
2. **Change a wall's length where they are looking.** Clicking a wall on the canvas only selects
   it — the length is typed in the wall table, which may be scrolled out of view. People expect to
   click the wall and type.
3. **Set the tile out from a feature, not just from the walls.** Today a fixed layout centres on
   the room, or on the midpoint of a reference wall. But in a bathroom the eye goes to the tub, and
   in a kitchen to the island or the cabinet run. A tiler centres the layout on *that* — a joint
   or a tile on the tub's centreline, full tiles starting at its front edge — and lets the cuts
   fall at the walls, where the vanity and the baseboard hide them. Centring wall to wall can put
   a sliver or an off-centre joint right in front of the bath.

---

## R1 — A sidebar you can resize

**WHEN** the user drags the sidebar's edge
**THE SYSTEM SHALL** resize it and give the room to the canvas.

- **AC-1.1** A drag handle on the sidebar's right edge resizes it between 260 px and 560 px, and
  never leaves the canvas narrower than 480 px.
- **AC-1.2** The canvas re-fits as the sidebar resizes; the room stays in view.
- **AC-1.3** The width persists per browser; double-clicking the handle restores the default.
- **AC-1.4** The sidebar can be hidden and shown (`[` key and a button), giving the canvas the
  full width.
- **AC-1.5** The handle is keyboard-operable (focusable, ←/→ resize) and announced as a separator.

## R2 — Edit a wall's length on the wall

**WHEN** the user clicks a wall, or double-clicks its dimension label
**THE SYSTEM SHALL** open a length field at that wall.

- **AC-2.1** The field appears beside the wall's midpoint, outside the room, focused and
  selected, showing the current length in the user's units (the same format as the wall table).
- **AC-2.2** While typing, a ghost of the resulting outline previews the change, and the wall that
  will absorb it is highlighted — so the user sees which wall moves before committing.
- **AC-2.3** Enter commits through the existing actions (`setShapeWallLength` for an outline,
  room width/height for a plain rectangle, `setPlanWallLengthMM` in a floor plan); Esc cancels;
  Tab / Shift+Tab move to the next / previous wall.
- **AC-2.4** A commit is one undo step. Invalid input (unparseable, below the minimum, or a change
  that makes the outline cross itself) is refused with the reason, and nothing changes.
- **AC-2.5** It works for a plain rectangle, a drawn outline, and walls in a floor plan; the wall
  table in the sidebar keeps working and stays in sync.

## R3 — Centre the layout on a feature

**WHEN** the user picks a feature as the layout's anchor
**THE SYSTEM SHALL** set the tile out from that feature instead of from the room.

- **AC-3.1** The anchor can be: the room (today's default), the reference wall (today), **the
  centre of a cut-out** (tub, island, cabinet, column), **the midpoint of one edge of a cut-out**
  (the tub's front), or **a point the user clicks** (a toilet flange, a doorway, a vanity that sits
  on the tile).
- **AC-3.2** An **Anchor** tool (`A`) on the canvas sets it in one click: inside a cut-out → its
  centre; near a cut-out's edge → that edge's midpoint; elsewhere on the floor → that point. The
  anchor shows as a marker that can be dragged and snaps to cut-out centres and edge midpoints.
- **AC-3.3** With an edge anchor, the grid runs parallel to that edge, and **"Full tiles from this
  edge"** puts a grout joint along the edge while the other axis is centred on the feature —
  *Centre a tile* or *Centre a joint* on its centreline. This is the bathtub case: full tiles at
  the tub front, symmetric about the tub's middle.
- **AC-3.4** The anchor applies to the fixed alignments (*Centre a tile*, *Centre a joint*).
  Picking an anchor while on *Least waste* switches to *Centre a tile* and says so.
- **AC-3.5** The anchor follows its feature: moving or resizing the cut-out moves the anchor.
  Deleting it falls back to the room anchor with a notice. A point anchor outside the floor is
  flagged.
- **AC-3.6** Herringbone and 45° diagonal support centre and point anchors; "Full tiles from this
  edge" is disabled for them with the reason (their joints are not parallel to the edge).
- **AC-3.7** The anchor is saved with the project, survives undo/redo, and works for a room in a
  floor plan (per room, or one per pattern group).
- **AC-3.8** The installation brief and the layout assistant's snapshot name the anchor
  ("centred on cut-out 1, full tiles from its front edge"), so they never describe a room-centre
  setting-out that is no longer true.

## R4 — Nothing else regresses

- **AC-4.1** The optimizer, the five patterns, floor plans, framing and the AI features behave
  exactly as before when no anchor is set.
- **AC-4.2** Existing saved projects load unchanged.

## Out of scope

- Naming cut-outs ("Bathtub") — useful, but separate; cut-outs are referred to by number and size.
- Anchors on walls in elevation (wall tiling).
- Letting the optimizer search around an anchor (*Least waste* with a constraint) — a later spec.
