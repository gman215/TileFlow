# 012 — Installer Output · Design

## Shape of the change

```
LayoutResult ──▶ cutPieces() ──▶ groupCuts() ──▶ CutGroup[] ─┬─▶ Cuts drawer (list, CSV)
 (engine, unchanged)  packages/geometry/src/cuts             ├─▶ canvas Cut labels
                                                             └─▶ Set-out sheet
Room + frame + LayoutResult ──▶ setOutLines() ──────────────────▶ Set-out sheet (start lines)
order quantity + piecesPerBox ──▶ boxesFor()  (client) ──▶ stats card · plan totals · takeoff · sheet
```

All new geometry is pure and lives in the engine with unit tests (Constitution I). The client
formats and draws. No AI route, prompt or DTO changes (AC-4.2).

## Engine — `packages/geometry/src/cuts/index.ts`

```ts
export type CutKind = 'straight' | 'corner' | 'notched' | 'angled';

export interface CutPiece {
  tileId: number;
  /** Index into tile.pieces */
  piece: number;
  kind: CutKind;
  /** Extent along the tile's width edge / height edge, mm (AC-1.1) */
  width: number;
  height: number;
  area: number;
  /** A point well inside the piece, layout coords — where its label goes */
  labelAt: Vec2;
  /** Largest label that fits there, mm (≈ the piece's inscribed size) */
  labelSize: number;
}

export interface CutGroup {
  label: string;           // 'A', 'B', … 'Z', 'AA', …
  kind: CutKind;
  width: number;           // rounded to the step
  height: number;
  count: number;           // pieces
  tiles: number;           // distinct tiles cut to make them
  pieces: CutPiece[];
}

export function cutPieces(result: LayoutResult, tile: TileConfig): CutPiece[];
export function groupCuts(pieces: CutPiece[], stepMM: number): CutGroup[];
```

**Tile frame.** `tile.original` is the uncut tile. Its edge 0→1 gives axis *u*, 1→2 gives *v*.
Each piece's vertices are projected on *u* and *v* from `original[0]`; the extents are the piece
size in the tile's frame. Herringbone rotates tiles a quarter-turn on alternate legs, so the edge
lengths are matched to `tile.width` / `tile.height` (whichever is closer) and the extents are
reported against those — a 300 × 600 tile laid on its side still reads "width × height" of the
product, never swapped. Square tiles: *u* is width.

**Classification** (tolerance 0.5 mm, area tolerance 0.5 %):

| kind | test |
|---|---|
| straight | piece area ≈ its local bounding box area, and exactly one extent ≈ the full tile side |
| corner | area ≈ bbox area, both extents short of full |
| notched | area < bbox area, every piece edge parallel to *u* or *v* |
| angled | otherwise (a cut not square to the tile — any diagonal against a wall) |

**Notch.** For a notched piece that is an L (one bbox corner with no vertex, one vertex strictly
inside the bbox, and bbox − notch = area), `notch: { width, height }` is that missing rectangle.
It is part of the grouping key, so two L pieces with different notches get different letters.

**Label point.** The piece's pole of inaccessibility, approximated: the centre of the largest
axis-aligned (in the tile frame) square found on a 12 × 12 sample of the piece's bbox, falling back
to the vertex centroid. Cheap (pieces have ≤ ~12 vertices) and always inside the piece — a centroid
of an L can sit outside it.

**Reconciliation (AC-1.7).** `cutPieces` walks exactly `result.tiles.filter(t => !t.isFull)`, the
tiles `cutTileCount` counts, and every element of `t.pieces` (falling back to `[t.clipped]`), so
`new Set(pieces.map(p => p.tileId)).size === result.cutTileCount`. Pieces with zero area are
skipped (the clipper never emits them; defensive).

**Grouping.** Key = `kind | round(width/step) | round(height/step)`. Groups sorted by count desc,
then area desc. Labels assigned in that order. The client passes `step` = 1 mm (metric) or
25.4/16 mm (imperial) — the precision an installer marks to.

## Engine — `packages/geometry/src/cuts/setout.ts`

```ts
export interface SetOutLine {
  id: 'A' | 'B';
  /** The line across the room's extent, layout coords */
  from: Vec2; to: Vec2;
  dir: Vec2; normal: Vec2;          // normal = dir turned a quarter
  /** Perpendicular distance to the farthest wall on the −normal / +normal side, mm */
  toNeg: number; toPos: number;
  /** True when the line is a real grout joint (centre of the joint) */
  onJoint: boolean;
}

export interface SetOut {
  point: Vec2;             // the anchor, or the room centre
  angle: number;           // pattern axis, radians
  lines: [SetOutLine, SetOutLine];
}

export function setOutLines(room: Room, tile: TileConfig, result: LayoutResult, frame?: PatternFrame, walls?: Polygon): SetOut;
```

- **Set-out point / axis:** `frame` (a pattern group's, shifted into room coords) ?? `patternFrameFor(room)`
  ?? `{ origin: room centre, angle: 0 }`.
- **Joint lines (every pattern except herringbone):** take the placed tile whose `original` centroid
  is nearest the point. Of its four edges, the one parallel to *u* nearest the point gives line A,
  the one parallel to *v* gives line B; each is moved out by `grout / 2` to the joint's centre
  line. For a grid and 45° diagonal both are continuous joints; for offset bonds line A (along the
  rows) is continuous and line B is the joint of that row only — still the line a tiler squares
  from. `onJoint = true`.
- **Herringbone:** no straight joint exists; both lines pass through the point on the frame axes,
  `onJoint = false`, and the sheet says the weave is set out from the point.
- **Distances:** project every vertex of `walls` (default: the room outline; in a floor plan the
  finish faces, since the tiled edge sits an expansion gap in) on the line's normal; `toNeg`/`toPos`
  are the extreme distances on each side — the walls the tape is hooked on. For a rectangle these
  are exactly the wall distances.

## Client

### Box ordering — `client/src/utils/boxes.ts`

```ts
export function productKey(t: { width: number; height: number }): string; // "300x600", dims sorted, 0.1 mm
export function boxesFor(orderQty: number, perBox: number | undefined):
  { boxes: number; tiles: number; spare: number } | null;   // null without a box size
export function piecesFromBoxArea(areaMM2: number, tile: { width: number; height: number }): number;
```

Store: `boxSizes: Record<string, number>` (product key → pieces per box) + `setBoxSize(key, n | null)`.
Not part of shape history (it is a product fact, not an edit) — so undo/redo of outline edits
leaves it alone (AC-3.4). Saved as `Project.boxes Json?` (new nullable column — old rows read null,
AC-3.4); server Zod: `z.record(z.string().regex(/^\d+(\.\d)?x\d+(\.\d)?$/), z.number().int().min(1).max(10000))`,
≤ 50 keys.

UI: `TilePanel` gets a **Per box** field under the tile size. It accepts a whole number (pieces) or
an area with a unit (`15.5 ft²`, `15.5 sqft`, `1.44 m²`, `1.44 m2`); an area is converted with
`piecesFromBoxArea` and the hint says "= 8 pieces". `StatsPanel` shows "8 boxes" under the order
when known; `PlanPanel` totals and `TakeoffPanel` (rows + CSV) add a boxes column per product.

### Cuts drawer — `client/src/components/Controls/CutListPanel.tsx`

Opened by a **Cuts** button on the stats card, as a drawer beside it (same `CARD_STYLE` family as
the brief). Table: label · size (`formatDisplayFromMM` in tile units, width × height) · kind ·
pieces · tiles. Footer: "N pieces from M cut tiles · each cut uses a whole tile". **Copy CSV**.
`useCutGroups()` hook memoises `groupCuts(cutPieces(layout, tileConfig), step)` on `layout` +
`tileConfig` + system, shared by the drawer, the canvas labels and the sheet — one source.

### Canvas labels

Store flag `showCutLabels` (per browser, try/catch storage). `TileCanvas` renders a Konva `Text`
per piece at `labelAt`, font = `min(labelSize * 0.7, 40 px / scale)`, skipped when under 6 px on
screen. Single room and the active plan room (shifted by its origin); follows hand-moved tiles.
Toggle in the cuts drawer.

### Set-out sheet — `client/src/components/Print/SetOutSheet.tsx`

- Rendered with `createPortal` into `document.body` as a fixed overlay: grey backdrop, white
  paper-sized pages, a toolbar (**Print / Save PDF**, ✕). `window.print()` prints it.
- Print CSS in `index.css`: `@media print { #root { display: none } .print-root { position: static } … }`;
  `@page { size: A4 landscape; margin: 10mm }` (metric) or `letter landscape` (imperial) set by a
  `<style>` the sheet injects; each page `break-after: page`, the drawing `break-inside: avoid`.
- **Page per room.** Header (project/room name, date, units). Left: SVG drawing fitted to the
  space — outline, holes, tiles (full #F5F5F4 stroke #A8A29E, cuts #FDE7C8), cut letters, wall
  lengths outside each edge, start lines A/B (dashed red) with distance callouts, the set-out
  point, a scale bar (1 m or 3 ft, or 50 cm / 1 ft for small rooms). Right: settings, order
  (tiles, boxes), cut list table. Below: brief text when current (AC-2.5).
- **Brief currency (AC-2.5).** `BriefPanel` writes `lastBrief: { text, layout }` to the store when
  a brief finishes (not on abort/error). The sheet prints it only when `lastBrief.layout === layout`
  (reference identity — the worker produces a new object on every recompute).
- **Floor plan (AC-2.6).** One page per `ok` room with a layout, using `toLayoutRoom`, `settingsOf`
  and `roomLayouts`; a grouped room's frame is `groupFrame(...)` shifted by `−origin`. Brief only for
  the active room. Last page: project order (`tileTotals`, boxes per product).
- Manual offsets non-empty → notice line on the page (AC-2.8).

## Decisions

- **Browser print, not a PDF library.** Every browser saves to PDF from the print dialog; a PDF
  library is ~300 kB and a new client dependency for no gain to the installer.
- **SVG, not a Konva snapshot.** Vector prints crisp at any paper size, and the sheet needs
  different styling (light, dimensioned) from the canvas.
- **Cut sizes from the tile frame.** Measuring pieces in room axes would give nonsense for diagonal
  and herringbone; the installer marks the tile, so the tile's frame is the only right one.
- **Box size keyed by tile size,** not by room: the same 12 × 24 in two rooms is one product with
  one box size.
