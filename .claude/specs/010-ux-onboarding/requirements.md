# 010 — Easier to Use: Onboarding, Tools & Guidance · Requirements

**Status:** Complete (10/10) — verified 2026-11-05
**Depends on:** 008, 009 (merged)
**Gemini capability:** none. No AI route or prompt changes.

## Purpose

A first-time user said it plainly: *"I don't know how to use it."* An audit of the first-run screen
against comparable tools (RoomSketcher, Floorplanner, tile-layout planners) and general editor UX
guidance found the problems below. This spec fixes them without removing any capability.

| Problem found | What comparable tools / guidance do |
|---|---|
| The app opens on a tiled rectangle and nine sidebar sections with no starting point. | A first-use empty state that teaches the next step, with a heading, a line of motivation and clear choices. |
| Floor plans are behind "Convert to floor plan" in the middle of the Shape panel. | A visible choice of how to start; templates. |
| Making a room takes two tools: draw walls, then place a room inside them. | RoomSketcher/Floorplanner draw a room as one rectangle — click, drag, done — and rooms appear on their own. |
| The floating toolbars cover the top of the room; the stats card covers its bottom-left corner. | The fitted view leaves room for the chrome. |
| Undo is a faint ↺ in one panel header; no keyboard shortcuts. | Undo/redo where the tools are, platform shortcuts, and "Action (Shortcut)" tooltips. |
| α/β weights and a scoring formula are always on screen; jargon (location line, centreline) is unexplained. | Progressive disclosure for expert settings; short info tips where intent is ambiguous. |
| Studs are drawn even at "fit" zoom, which makes the plan busy. | Detail appears as you zoom in. |

---

## R1 — A clear way to start

- **AC-1.1** On first visit a **Start** card over the canvas offers: **Tile one room** (the rectangle
  as today), **Draw a floor plan** (walls and rooms, Room tool selected), and **Start from an
  example** (templates). One sentence explains each.
- **AC-1.2** Examples: *Bathroom* (5 × 8 ft, one room), *L-shaped kitchen* (drawn outline), *Two
  rooms with a door* (floor plan, pattern continues through the doorway), *Small apartment*
  (three rooms, doors). Metric users get round metric sizes.
- **AC-1.3** The card is dismissed by choosing anything or by ×, and does not return on reload
  (per-browser preference; the app works identically if storage is unavailable).
- **AC-1.4** A **?** button in the header reopens it, together with the keyboard shortcuts.

## R2 — Tell the user what to do next

- **AC-2.1** One instruction line under the toolbar always says what the current tool does and what
  to do next, e.g. *"Room: drag a rectangle to add a room · click inside closed walls to add one
  there"*, *"Wall: click to start · type a length · Enter or Esc ends"*, *"Wall W3 selected: drag to
  move · Delete removes it · edit it in the panel"*.
- **AC-2.2** State nudges: a plan with no rooms says how to add one; a room flagged *not enclosed*
  says which walls are open.

## R3 — Draw a room in one gesture

- **AC-3.1** In a floor plan, the **Room** tool drags (or clicks two corners for) a rectangle of
  walls, snapped to the grid and existing corners, with live width × depth shown.
- **AC-3.2** A rectangle drawn against existing walls shares them (no doubled walls), using the
  existing join/split rules.
- **AC-3.3** A plain click inside closed walls with no room still adds a room there.

## R4 — Rooms appear by themselves

- **AC-4.1** After walls are added (wall tool, room rectangle, template), every newly enclosed region
  without a room gets one automatically, named *Room N*, with the active room's tile.
- **AC-4.2** Deleting a wall never auto-creates or auto-deletes rooms (existing *redundant* / *not
  enclosed* behaviour stands).

## R5 — Tools, undo and shortcuts where people look

- **AC-5.1** One toolbar at the top centre holds the tools with icon + label: single room —
  *Select*, *Draw shape*, *Cut-out*, *Make floor plan*; floor plan — *Select*, *Room*, *Wall*,
  *Cut-out* — plus **Undo** and **Redo**.
- **AC-5.2** Every tool and button tooltip is "Action (Shortcut)".
- **AC-5.3** Shortcuts: V select, R room, W wall, C cut-out, D draw shape, F fit, Ctrl/⌘+Z undo,
  Ctrl/⌘+Shift+Z and Ctrl+Y redo, Delete removes the selection, Esc cancels, ? help. None fire while
  typing in a field.

## R6 — A sidebar that reads top to bottom

- **AC-6.1** Sections are numbered steps: **1 Room** (or **1 Floor plan**), **2 Tile**, **3 Layout**;
  then Takeoff and Project.
- **AC-6.2** A selected wall or junction shows first, under a **Selected** heading, not at the bottom
  of the plan section.
- **AC-6.3** The optimizer weights and formula move into a collapsed **Fine-tune (advanced)**
  disclosure; Alignment stays visible under Layout.
- **AC-6.4** The single-room Shape actions each carry one line of explanation; the AI photo upload
  sits in its own disclosure (*Have a floor-plan photo?*).
- **AC-6.5** Jargon gets an ⓘ info tip (hover and keyboard focus): location line, expansion gap,
  alignment, waste, inside vs centre dimensions, load-bearing.

## R7 — Nothing covers the drawing

- **AC-7.1** **Fit** frames the room or plan clear of the toolbar and the stats card.
- **AC-7.2** The stats card can be collapsed to one line, and remembers that per browser.
- **AC-7.3** Studs appear in plan from 8 px per stud, not 4.

## Out of scope

- A 3D view, furniture, mobile/touch-first layout, guided multi-step tours.
