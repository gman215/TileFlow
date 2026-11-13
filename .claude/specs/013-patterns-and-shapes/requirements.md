# 013 — Patterns & Tile Shapes · Requirements

**Status:** Complete — verified 2026-11-12 (see tasks.md)
**Depends on:** 012-installer-output (cut list and set-out sheet must understand every new pattern)

## Purpose

TileFlow lays five patterns; free web calculators lay 10–13 (COMPETITIVE-ANALYSIS §3). The engine's
frame + lattice design makes each new pattern a generator — this spec adds the ones a single tile
product can lay, and the one installation rule nobody enforces.

**In scope:** ¼ offset, basketweave, checkerboard (two colours of one tile), hexagon, and the
ANSI A108.02 33 % offset warning for long tiles.

**Deferred to 017 (borders & mixed materials):** windmill/pinwheel, Versailles, chevron and random
plank — each needs two or more tile sizes or shapes (or handed parallelograms) in one room, which is
017's "several tiles per room". "Stacked vertical" is already grid with the tile laid ↕.

---

## R1 — New patterns

- **AC-1.1 ¼ offset.** Alternate rows shifted a quarter of the tile length — the same family as
  ½ and ⅓ offset (each row offset from the one before by a quarter).
- **AC-1.2 Basketweave.** Square blocks of *k* tiles side by side, alternate blocks turned a
  quarter, where *k* = (long + grout) ÷ (short + grout) — 2 for a 2:1 tile, 3 for 3:1. When the
  ratio is not a whole number (within 5 %), the tile step warns and offers the nearest fitting
  size, as herringbone does; the layout leaves gaps rather than overlapping.
- **AC-1.3 Checkerboard.** A grid in two colours of the same tile, alternating. The stats card,
  cut list, set-out sheet and order give each colour its own count, cuts and order.
- **AC-1.4 Hexagon.** Regular hexagonal tiles; the size is **across the flats** (how hex tile is
  sold), shown as one field. Grout is even between every pair of edges. Area, waste, smallest cut,
  boxes-from-area and the cost estimate use the hexagon's own area, not width × height.
- **AC-1.5** Every new pattern: has a live preview button in the Tile step; works with Least waste,
  Centre a tile and Centre a joint (for hexagon, a joint = the point where three tiles meet); works
  with a reference wall, a feature anchor, floor plans and pattern groups; and is saved and loaded.

## R2 — Downstream understands them

- **AC-2.1** The cut list measures hexagon pieces across the flats × point to point; checkerboard
  cuts carry their colour, and the same size in two colours is two labels.
- **AC-2.2** Start lines prefer a joint that runs unbroken across the room: block boundaries in
  basketweave, every joint in grid and checkerboard. Hexagon, like herringbone, has no straight
  joint — the sheet sets it out from the point.
- **AC-2.3** "Full tiles from this edge" works for grid, checkerboard, basketweave and every offset
  bond (edge along the rows); hexagon is refused with the reason.
- **AC-2.4** The layout assistant can set every pattern, the server accepts it, and the brief and
  estimate name it; labour treats basketweave and hexagon as slow patterns, like herringbone.

## R3 — The 33 % offset rule

**WHEN** the pattern is ½ offset and the rows stagger along a tile side over 18 in (457 mm) — the
tile's width, i.e. a long tile laid ↔
**THE SYSTEM SHALL** warn that ANSI A108.02 recommends at most a 33 % offset for such tiles (warpage
causes lippage at the joints), and offer ⅓ or ¼ offset in one click.

- **AC-3.1** The warning shows in the Tile step and on the set-out sheet; it never blocks.

## R4 — Nothing else regresses

- **AC-4.1** The five existing patterns produce exactly the same tiles as before.
- **AC-4.2** Old projects load unchanged.

## Out of scope

- Hexagon orientation choice (flat sides vertical only), elongated/irregular hexagons.
- More than two colours, or a colour for a non-checkerboard pattern (017).
