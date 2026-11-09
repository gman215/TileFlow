# 011 — Layout Control · Tasks

Ordered so each task is shippable on its own: the sidebar first (smallest, independent), then
inline wall lengths, then anchors from the engine outwards.

- [x] **T0 — Branch.** `feat/011-layout-control` from an up-to-date `main`. (Constitution VIII)

### Sidebar (R1)

- [ ] **T1 — Resizable sidebar.** `useSidebarWidth` + `SidebarResizer`; `App.tsx` uses the width;
      persisted with try/catch; double-click resets; ←/→ resize; `[` toggles via the 010 shortcut
      hook; reopen tab on the canvas.
      *Verify:* in the browser, drag 312 → 480 → 260 px; the canvas re-fits and the room stays in
      view; the width survives a reload; double-click restores 312; `[` hides and shows; the
      canvas never drops below 480 px. (AC-1.1–1.5)

### Inline wall length (R2)

- [ ] **T2 — Editor component.** `WallLengthEditor.tsx` positioned at the wall midpoint along the
      outward normal, reusing `DimensionField`; follows pan and zoom; closes on Esc, outside click,
      drag or draw.
      *Verify:* click each wall of the L-shaped kitchen — the field opens at that wall, focused, with
      the wall table's value; pan and zoom keep it attached. (AC-2.1)
- [ ] **T3 — Live preview.** Ghost outline from `setWallLength` on each keystroke; absorbing wall
      highlighted; `validateShape` reason shown for a self-crossing result.
      *Verify:* typing a longer W1 on the kitchen previews the opposite wall moving, before Enter;
      a length that crosses the outline shows the reason and Enter does nothing. (AC-2.2, AC-2.4)
- [ ] **T4 — Commit paths.** Rectangle → width/height; outline → `setShapeWallLength`; plan wall →
      `setPlanWallLengthMM`; Tab/Shift+Tab walk walls; dimension-label double-click opens it.
      *Verify:* each room kind commits, is one Ctrl+Z, and the wall table shows the same value.
      (AC-2.3, AC-2.5)

### Anchors (R3)

- [ ] **T5 — Engine: anchor type and frame.** `LayoutAnchor` on `RoomShape`; `patternFrameFor`
      resolves `hole-centre`, `hole-edge`, `point`.
      *Verify:* unit tests — for each pattern and both fixed modes, a tile centre (or joint
      crossing) lands on the cut-out centroid / edge midpoint / point to 0.01 mm; no anchor gives
      today's offsets exactly. (AC-3.1, AC-4.1)
- [ ] **T6 — Engine: full tiles from an edge.** Per-axis override in `computeAlignmentOffset`;
      rejected for herringbone and 45° diagonal.
      *Verify:* unit test — a 1.60 × 0.80 m tub cut-out, front-edge anchor, grid: a grout line lies
      on the front edge and the layout is mirror-symmetric about the tub's centreline (cut widths
      equal at both ends of the tub). (AC-3.3, AC-3.6)
- [ ] **T7 — Engine: anchors follow edits.** Deleting / renumbering holes and vertices updates or
      clears the anchor in the same edit; `validateShape` flags a point outside the floor.
      *Verify:* unit tests for delete-hole, delete-vertex, move-hole. (AC-3.5)
- [ ] **T8 — Anchor tool and marker.** Toolbar tool `A`, click resolution, `AnchorLayer` marker with
      drag + snap, HintBar line, auto-switch from *Least waste* with notice.
      *Verify:* in the browser on the bathroom: click inside the tub → centred on it; click its
      front edge → full-tile option appears; drag the marker → it snaps to the tub centre. (AC-3.2,
      AC-3.4)
- [ ] **T9 — Sidebar "Centre on" row.** Under step 3's alignment buttons; shows the current anchor,
      ✕ clears, "Full tiles from this edge" checkbox with the disabled reason.
      *Verify:* screenshot review against the design; clearing returns the exact pre-anchor layout.
      (AC-3.1, AC-3.6)
- [ ] **T10 — Persistence.** Server Zod schemas accept `anchor` on room shapes, plan rooms and
      groups; plan frame code resolves it.
      *Verify:* save and reload a project with each anchor kind against Postgres — identical
      layout; an old project without `anchor` loads unchanged. (AC-3.7, AC-4.2)
- [ ] **T11 — AI awareness.** `statsDto().room.anchor` display string; `BRIEF_V3` setting-out rule
      for anchors.
      *Verify:* brief for the tub-front anchor says the layout is set out from the tub's front edge
      with full tiles there — and never "room centre". (AC-3.8)

### Close-out

- [ ] **T12 — Full verification.** Browser run of every AC; 008/009/010 regression scripts; 003–005
      AI checks; `npm test`, both typechecks, production build. README: features + shortcuts.
