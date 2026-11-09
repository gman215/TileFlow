# 011 — Layout Control · Tasks

Ordered so each task is shippable on its own: the sidebar first (smallest, independent), then
inline wall lengths, then anchors from the engine outwards.

- [x] **T0 — Branch.** `feat/011-layout-control` from an up-to-date `main`. (Constitution VIII)

### Sidebar (R1)

- [x] **T1 — Resizable sidebar.** `useSidebarWidth` + `SidebarResizer`; `App.tsx` uses the width;
      persisted with try/catch; double-click resets; ←/→ resize; `[` toggles via the 010 shortcut
      hook; reopen tab on the canvas.
      *Verify:* in the browser, drag 312 → 480 → 260 px; the canvas re-fits and the room stays in
      view; the width survives a reload; double-click restores 312; `[` hides and shows; the
      canvas never drops below 480 px. (AC-1.1–1.5)
      *Verified 2026-11-08 in headless Chromium, 14 checks: 312 → 480 → clamped 260; canvas
      narrows by the same amount; 400 px survives a reload; double-click → 312; ←/→ ±16 px; `[` and
      the canvas tab hide/show (not when typing); a 900 px window keeps the canvas at 483 px.
      Also fixed: the toolbar wrapped and ran under the zoom pill on narrower canvases — now
      icon-only below 1060 px and on its own row below 800 px (900 px in a plan), measured at
      12 widths in both modes with no overlap.*

### Inline wall length (R2)

- [x] **T2 — Editor component.** `WallLengthEditor.tsx` positioned at the wall midpoint along the
      outward normal, reusing `DimensionField`; follows pan and zoom; closes on Esc, outside click,
      drag or draw.
      *Verify:* click each wall of the L-shaped kitchen — the field opens at that wall, focused, with
      the wall table's value; pan and zoom keep it attached. (AC-2.1)
- [x] **T3 — Live preview.** Ghost outline from `setWallLength` on each keystroke; absorbing wall
      highlighted; `validateShape` reason shown for a self-crossing result.
      *Verify:* typing a longer W1 on the kitchen previews the opposite wall moving, before Enter;
      a length that crosses the outline shows the reason and Enter does nothing. (AC-2.2, AC-2.4)
- [x] **T4 — Commit paths.** Rectangle → width/height; outline → `setShapeWallLength`; plan wall →
      `setPlanWallLengthMM`; Tab/Shift+Tab walk walls; dimension-label double-click opens it.
      *Verify:* each room kind commits, is one Ctrl+Z, and the wall table shows the same value.
      (AC-2.3, AC-2.5)
      *Verified 2026-11-09 in headless Chromium: outline (6 walls), plain rectangle (4 edges, stays a
      rectangle) and plan wall each commit through their action, read back in the sidebar, and undo
      in one Ctrl+Z; Tab/Shift+Tab walk walls; a dimension label opens its field; a self-crossing
      outline and an overlapping plan wall are refused with the store's own reason. Found and fixed
      along the way: `setClearLength` (008) landed 2–8 mm off on a wall side where another wall tees
      in — it now converges exactly; new unit test fails on the old code.*

### Anchors (R3)

- [x] **T5 — Engine: anchor type and frame.** `LayoutAnchor` on `RoomShape`; `patternFrameFor`
      resolves `hole-centre`, `hole-edge`, `point`.
      *Verify:* unit tests — for each pattern and both fixed modes, a tile centre (or joint
      crossing) lands on the cut-out centroid / edge midpoint / point to 0.01 mm; no anchor gives
      today's offsets exactly. (AC-3.1, AC-4.1)
- [x] **T6 — Engine: full tiles from an edge.** Per-axis override in `computeAlignmentOffset`;
      rejected for herringbone and 45° diagonal.
      *Verify:* unit test — a 1.60 × 0.80 m tub cut-out, front-edge anchor, grid: a grout line lies
      on the front edge and the layout is mirror-symmetric about the tub's centreline (cut widths
      equal at both ends of the tub). (AC-3.3, AC-3.6)
      *Verified 2026-11-09 (T5 + T6): 48 new unit tests in `anchor.test.ts` — every pattern, both
      fixed modes, on a cut-out centre, a cut-out edge and a point; a joint on the tub front with
      cuts mirror-symmetric about its centreline for grid and both offset bonds; refused with the
      reason for herringbone/diagonal and for offset rows across the edge. Found and fixed an
      existing engine bug: with any frame off the area centre (the reference wall since it
      shipped), herringbone and 45° diagonal "Centre a tile" missed by 200+ mm — `generateTiles`
      now generates over a box centred on the frame origin. Suite: 230/230.*
- [x] **T7 — Engine: anchors follow edits.** Deleting / renumbering holes and vertices updates or
      clears the anchor in the same edit; `validateShape` flags a point outside the floor.
      *Verify:* unit tests for delete-hole, delete-vertex, move-hole. (AC-3.5)
- [x] **T8 — Anchor tool and marker.** Toolbar tool `A`, click resolution, `AnchorLayer` marker with
      drag + snap, HintBar line, auto-switch from *Least waste* with notice.
      *Verify:* in the browser on the bathroom: click inside the tub → centred on it; click its
      front edge → full-tile option appears; drag the marker → it snaps to the tub centre. (AC-3.2,
      AC-3.4)
- [x] **T9 — Sidebar "Centre on" row.** Under step 3's alignment buttons; shows the current anchor,
      ✕ clears, "Full tiles from this edge" checkbox with the disabled reason.
      *Verify:* screenshot review against the design; clearing returns the exact pre-anchor layout.
      (AC-3.1, AC-3.6)
      *Verified 2026-11-09 (T8 + T9) in headless Chromium, 17 checks on an 8 × 10 ft bathroom with a
      60 × 30 in tub cut-out: click inside → centre; click the front (A key) → edge, with "Full tiles
      from this edge" — 9 tiles start at front + g/2 and the row under the tub is symmetric; a drag
      snaps the marker to the tub centre; herringbone disables the option with the reason; off-floor
      clicks are refused; Esc cancels; ✕ restores the exact room-centred layout.*
- [x] **T10 — Persistence.** Server Zod schemas accept `anchor` on room shapes, plan rooms and
      groups; plan frame code resolves it.
      *Verify:* save and reload a project with each anchor kind against Postgres — identical
      layout; an old project without `anchor` loads unchanged. (AC-3.7, AC-4.2)
      *Verified 2026-11-09 against Postgres: an outline with a tub-front anchor + full tiles +
      Centre a joint, and a plain rectangle with a point anchor (still a rectangle), come back
      identical after save → reload → load; an older project loads as before; a malformed anchor
      gets 400. Alignment was never saved — added (`TileConfig.alignment`) since anchors need it.
      Plan rooms: anchors resolve through `toLayoutRoom` (cut-out index offset past free-standing
      islands), set with the same tool, survive save/load; a room in a pattern group is refused
      with the reason (the group shares one frame).*
- [x] **T11 — AI awareness.** `statsDto().room.anchor` display string; `BRIEF_V3` setting-out rule
      for anchors.
      *Verify:* brief for the tub-front anchor says the layout is set out from the tub's front edge
      with full tiles there — and never "room centre". (AC-3.8)

### Close-out

- [x] **T12 — Full verification.** Browser run of every AC; 008/009/010 regression scripts; 003–005
      AI checks; `npm test`, both typechecks, production build. README: features + shortcuts.

### Result — 2026-11-09

All 13 tasks verified. Engine: geometry 236/236 (54 new). Browser (headless Chromium): sidebar 15,
wall editor 30, anchors 17, plan-room anchors 8, persistence 8 (Postgres), brief with an anchor
3 live runs; regression — 003 assistant (15), 004 brief drawer (20) and figures (91), all four
examples (12, incl. plan takeoff and elevation), the 003–005 unit suites; typechecks (api, client,
server) and the production build clean.

Fixed along the way, each with a test:
- `generateTiles` with a frame off the area centre (the reference wall since it shipped):
  herringbone and 45° diagonal "Centre a tile" missed by 200+ mm.
- `setClearLength` landed 2–8 mm off on a wall side where another wall tees in.
- Alignment was never saved with a single-room project.
- The toolbar wrapped and ran under the zoom pill on narrower canvases.
- The wall-length field popped up when code (the assistant squaring to a wall) selected a wall.

Limits, stated: a room in a pattern group cannot carry its own anchor (the group shares one frame;
refused with the reason); "Full tiles from this edge" needs grid, or an offset bond with the edge
along its rows.

