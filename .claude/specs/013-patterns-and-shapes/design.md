# 013 — Patterns & Tile Shapes · Design

## Engine

`PatternType` gains `'offset-1/4' | 'basketweave' | 'checkerboard' | 'hexagon'`.

Every generator keeps the rule `computeAlignmentOffset` is proven against: the tile at the lattice
origin *O* has its box at [O, O + (w, h)], so *Centre a tile* (offset −w/2, −h/2) puts that tile's
centre on the anchor and *Centre a joint* (offset g/2, g/2) puts a joint crossing there.

| pattern | generator | period (`getPatternUnit`) |
|---|---|---|
| offset-1/4 | `generateOffset(params, 1/4)` | (w+g, h+g) |
| checkerboard | grid; `variant = (i + j) mod 2` | (2(w+g), 2(h+g)) — colour is part of the layout |
| basketweave | blocks of side B = max(L, k·S) (L = long+g, S = short+g, k = max(2, round(L/S))); block (i, j) is "as laid" when i + j is even, else turned; tiles step S across the block | (2B, 2B) |
| hexagon | flat sides vertical; F = `width` across flats, d = F + g; centres at O + (w/2, h/2) + (i·d + (j odd ? d/2 : 0), j·d·√3/2) | (d, d√3) |

- **Hexagon joint.** *Centre a joint* puts the anchor on a three-tile vertex, d/√3 above a centre:
  offset = (−w/2, d/√3 − h/2). Special-cased in `computeAlignmentOffset`.
- **Tile face area.** `tileFaceArea(config)` = (√3/2)·F² for hexagon, else w·h. Replaces w·h in
  scoring (`optimization`, `plan/group`), and in the client (`sliverRisk`, boxes, estimate).
- **Colour.** `PlacedTile.variant?: 0 | 1` (checkerboard only). Generators return
  `TilePolygon = Polygon & { variant?: 0 | 1 }`; the frame transform in `generateTiles` and
  `computeLayout` carry it through. `LayoutResult.variantCounts?: [{ full, cut }, { full, cut }]`.

## Cuts and set-out

- `tileAxes`: a 6-vertex original is a hexagon — *u* across the flats (normal to edge 0), *v* along
  edge 0 (point to point); full extents F and 2F/√3. A piece with both extents full is a shave;
  otherwise hex pieces are angled.
- `CutPiece.variant` / `CutGroup.variant`; part of the grouping key.
- `setOutLines`: candidate joints come from the edges of the ~8 tiles nearest the point. A candidate
  is **continuous** when no placed tile's original straddles it (all its vertices on one side, to
  0.5 mm). The nearest continuous candidate wins; else the nearest edge (an offset bond's cross
  joint — the line a tiler still squares from). Herringbone and hexagon keep point lines.
- `fullTilesFromEdgeAxis`: grid, checkerboard, basketweave either axis; offsets along x; hexagon,
  herringbone, diagonal refused.

## Client

- `PATTERNS` gains the four (labels ¼ Offset, Basketweave, Checkerboard, Hexagon); previews render
  through the engine as now; checkerboard previews in two tones.
- Tile step: for hexagon, the size row is one field "Across flats" (H follows W); basketweave ratio
  warning with "Use 2:1"; 33 % warning (½ offset and max side > 457.2 mm) with "Use ⅓" / "Use ¼".
- Canvas: variant 1 drawn in a darker tone of the same full/cut colours; legend adds the two tones.
- Stats card: for checkerboard, a line "Light 31 · Dark 30 to order"; cut list gains a colour
  column; set-out sheet fills dark tiles darker, splits the order by colour, and prints the 33 %
  warning when it applies. Boxes: same product key, but ⌈each colour ÷ per box⌉ summed.
- AI: `api/_lib/tools.ts` `PATTERNS` and the `set_pattern` description, `client/src/ai/tools.ts`
  enum, server `PatternSchema`; `SLOW_PATTERNS` adds basketweave and hexagon.
