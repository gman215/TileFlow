# 002 — Photo/Sketch → Room Outline · Design

## Data flow

```
ShapePanel "Read a plan" ──▶ file input
                              │
                    downscaleToJpeg()          client/src/utils/image.ts
                    ≤1600px, q0.85, <4MB       (Vercel body cap is 4.5MB — binding)
                              │ base64
                              ▼
              POST /api/ai/room-from-image     api/ai/room-from-image.ts
                              │
                    methodGuard → readJson(4MB) → checkRateLimit
                              │
                    interactions.create({
                      model: modelFor('vision'),
                      system_instruction: SYSTEM_COMMON_V1 + ROOM_FROM_IMAGE_V1,
                      input: [ {type:'text', text: note ?? ''}, {type:'image', data, mime_type} ],
                      response_format: { type:'text', mime_type:'application/json',
                                         schema: ROOM_FROM_IMAGE_JSON_SCHEMA }
                    })
                              │
                    RoomFromImageOut.parse(JSON.parse(output_text))   ← untrusted until here
                              ▼
                    { boundary, holes, confidence, notes, detectedSystem }
                              │
                              ▼
              client: store as `shapeProposal` (NOT the room)
                              │
                    validateShape(proposal)          packages/geometry — existing
                    summarizeShape(proposal)         packages/geometry — existing
                              │
                    RoomShapeLayer renders it ghosted
                              │
                    [Apply] ──▶ setRoomShape(proposal)    store — existing, gives undo + recompute
                    [Discard] ▶ shapeProposal = null
```

The critical property: **the model's output enters the app through exactly one existing function**,
`setRoomShape()`. There is no second path into room state, so normalization, the undo stack and the
worker recompute cannot get out of sync with a hand-drawn outline.

## Coordinate contract

`RoomShape` vertices are millimetres in the room's own space, normalized so the bounding box starts
at `(0,0)` (see the doc comment on `RoomShape` in `packages/geometry/src/types/index.ts`). The model
is told exactly this: **millimetres, origin top-left, x right, y down, boundary clockwise**.

`normalizeShape()` — called inside `roomFromShape()` in the store — re-origins whatever we hand it,
so a model that returns an offset outline is corrected automatically. Scale is the part it cannot
fix, which is why R4 leans on the existing wall table.

## Scale strategy

Three cases, in the order the prompt instructs the model to try them:

1. **Printed dimensions** — the plan has labels ("3.6 m", "12'-6\""). Use them; this is exact.
   Report which labels were used in `notes`.
2. **A scale bar or stated scale** — derive millimetres per pixel from it.
3. **Neither** — assume a plausible domestic scale so the *shape* is usable, set
   `confidence ≤ 0.4`, and say so in `notes`.

In case 3 the proposal summary tells the user to check one wall against reality and retype it in
the wall table; `setWallLength()` then rescales that wall while keeping the room square. This is
why no bespoke scale-correction UI is needed.

## Request / response

```ts
// request
{
  imageBase64: string;      // no data: URI prefix
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif';
  system: 'metric' | 'imperial';   // only affects how notes are phrased
  note?: string;                   // ≤ 300 chars, user hint
}

// response
{
  boundary: { x: number; y: number }[];       // ≥3, ≤60, clockwise, mm
  holes: { x: number; y: number }[][];        // ≤ 10 holes, ≤ 40 vertices each
  confidence: number;                         // 0..1
  notes: string;                              // ≤ 400 chars — what it read and how it scaled
  detectedSystem: 'metric' | 'imperial' | 'unknown';
  demoMode?: true;
}
```

Body cap for this route: **4 MB** (`readJson(request, RoomFromImageIn, 4_000_000)`), leaving
headroom under Vercel's 4.5 MB limit for headers and base64 overhead.

Note that base64 inflates bytes by ~33%: a 3 MB JPEG becomes ~4 MB encoded. The downscale target of
1600px/q0.85 typically lands at 200–500 KB, well clear — the cap is a backstop, not the design.

## JSON Schema and Zod mirror

Both live in `api/_lib/schemas.ts`, edited together (Constitution VI).

```ts
export const ROOM_FROM_IMAGE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    boundary: { type: 'array', items: { type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x','y'] } },
    holes: { type: 'array', items: { type: 'array', items: { type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x','y'] } } },
    confidence: { type: 'number' },
    notes: { type: 'string' },
    detectedSystem: { type: 'string', enum: ['metric','imperial','unknown'] },
  },
  required: ['boundary','holes','confidence','notes','detectedSystem'],
};

const Pt = z.object({ x: z.number().finite(), y: z.number().finite() });
export const RoomFromImageOut = z.object({
  boundary: z.array(Pt).min(3).max(60),
  holes: z.array(z.array(Pt).min(3).max(40)).max(10),
  confidence: z.number().min(0).max(1),
  notes: z.string().max(400),
  detectedSystem: z.enum(['metric','imperial','unknown']),
});
```

The Zod bounds are deliberately stricter than the JSON Schema. The schema *asks*; Zod *enforces*.
A 5000-vertex boundary would survive the former and be rejected by the latter — which is the point.
The vertex caps also mirror the limits the Express server already applies in
`server/src/validation.ts` (`.min(3).max(500)` on polygons), so a proposal can never produce a room
that the save endpoint would later reject.

## Prompt — `ROOM_FROM_IMAGE_V1`

Points the prompt must make, in `api/_lib/prompts.ts`:

- You extract floor-plan geometry. Output only the schema.
- Coordinates in **millimetres**, origin top-left, x right, y down, boundary **clockwise**.
- Prefer printed dimension labels; then a scale bar; otherwise assume a plausible domestic scale and
  set confidence ≤ 0.4.
- Simplify to the structural outline: straight walls, right angles where the plan is orthogonal.
  Do not trace furniture, fixtures, hatching or text.
- Islands, columns, stair openings and other untiled areas are `holes`.
- If the image is not a floor plan or sketch — a perspective photo of a room, a screenshot, a
  document — return `confidence: 0`, an empty-as-possible valid boundary, and say so in `notes`.
- Never explain, apologise or add prose outside the schema.
- `notes` states exactly which labels or assumptions produced the scale.

The common preamble `SYSTEM_COMMON_V1` (engine owns the numbers) is prepended.

## Client modules

**`client/src/utils/image.ts`** (new)
```ts
export async function downscaleToJpeg(
  file: File, maxEdge = 1600, quality = 0.85, maxBytes = 4_000_000
): Promise<{ base64: string; mimeType: 'image/jpeg'; width: number; height: number }>;
```
`createImageBitmap` → `OffscreenCanvas` (fall back to `<canvas>`) → `toBlob('image/jpeg', q)`.
If the result still exceeds `maxBytes`, retry at 0.7 then 1200px before failing (AC-1.3).
HEIC/HEIF that the browser cannot decode fails here with a clear message, not at the API.

**Store additions** — `client/src/store/tileFlowStore.ts`:
```ts
shapeProposal: { shape: RoomShape; confidence: number; notes: string } | null;
setShapeProposal: (p: ShapeProposal | null) => void;
applyShapeProposal: () => void;   // calls the EXISTING setRoomShape, then clears the proposal
```
`applyShapeProposal` must go through `setRoomShape` rather than setting `room` directly — that is
what buys undo, normalization and recompute (AC-3.4, AC-3.6).

**`client/src/components/AI/PlanUpload.tsx`** (new) — rendered inside `ShapePanel`, above the
Draw/Cut-out buttons. File input, optional note field, progress state, error line, and the proposal
summary card with Apply / Discard. Disabled with an explanation when `useAiAvailability()` reports
`configured: false`.

**`client/src/components/Canvas/RoomShapeLayer.tsx`** — extend to render `shapeProposal` ghosted:
dashed stroke in the amber edit colour already used for edit mode (`EDIT_COLOR = '#F59E0B'` in
`TileCanvas.tsx`), ~35% opacity fill, drawn above the committed room. Reuse the existing
polygon-to-flat-points conversion rather than adding another.

## Reused, not rebuilt

| Need | Existing thing to use | Where |
|---|---|---|
| Apply an outline | `setRoomShape()` | `client/src/store/tileFlowStore.ts:244` |
| Normalize to bbox origin | `normalizeShape()` (inside `roomFromShape`) | `packages/geometry/src/utils/math.ts:203` |
| Detect bad outlines | `validateShape()` | `packages/geometry/src/shape/index.ts:174` |
| Area / perimeter / wall count | `summarizeShape()` | `packages/geometry/src/shape/index.ts:263` |
| Per-wall lengths | `wallsOf()` | `packages/geometry/src/shape/index.ts:29` |
| Fix a wall length | `setWallLength()` | `packages/geometry/src/shape/index.ts:61` |
| Undo an applied proposal | `undoShape()` | `client/src/store/tileFlowStore.ts:343` |
| Format lengths for display | `formatDisplayFromMM()` | `client/src/utils/measurements.ts:180` |

## Failure behaviour

| Condition | Result |
|---|---|
| Not an image / decode failure | Client-side message; no request sent |
| Still >4 MB after downscale retries | Client-side message suggesting a smaller photo |
| `429` | "Too many requests" + `Retry-After` seconds; room unchanged |
| `502` (model or Zod failure) | "Could not read that plan"; room unchanged |
| `503` (unconfigured) | Control disabled with explanation |
| `confidence: 0` | Proposal not offered; the model's `notes` shown as the reason |
| `confidence < 0.4` | Proposal offered with a prominent "check your wall lengths" warning |
| Unmount mid-flight | `AbortController.abort()`; no state update |
