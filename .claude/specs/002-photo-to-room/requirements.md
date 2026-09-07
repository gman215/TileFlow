# 002 — Photo/Sketch → Room Outline · Requirements

**Status:** Not started
**Depends on:** 001-ai-foundation (complete and verified)
**Gemini capability:** vision + structured JSON output

## Purpose

Drawing an L-shaped room corner by corner is the highest-friction thing in TileFlow. This feature
lets a user photograph a floor plan, a builder's drawing or a napkin sketch and get the outline
proposed for them.

It lands on machinery that already exists and is already tested: `setRoomShape()` normalizes the
outline, pushes an undo entry and re-triggers the worker; `validateShape()` already detects
self-crossing boundaries and cut-outs that escape the room; `wallsOf()` already reports wall
lengths. The model's only job is *image → vertices*. Everything downstream is the existing app.

---

## R1 — Upload

**WHEN** a user selects an image in the Shape panel
**THE SYSTEM SHALL** accept it, downscale it, and send it for interpretation.

- **AC-1.1** Accepts PNG, JPEG, WEBP, HEIC and HEIF — the formats Gemini supports.
- **AC-1.2** The image is downscaled client-side before upload: longest edge ≤ 1600px, re-encoded
  as JPEG at quality 0.85.
- **AC-1.3** The encoded request body never exceeds 4 MB, staying under Vercel's 4.5 MB cap. If it
  would, the client reduces quality/size further before sending, and only fails if it still cannot.
- **AC-1.4** A non-image file, or an image that fails to decode, is rejected client-side with a
  plain message and no network request.
- **AC-1.5** The user may add an optional note ("the long wall is 14 ft") that is passed to the
  model as additional context.

## R2 — Interpretation

**WHEN** the route receives a valid image
**THE SYSTEM SHALL** return a structured outline in millimetres or an explicit failure.

- **AC-2.1** The response is constrained with `response_format` to the room JSON Schema in
  `api/_lib/schemas.ts`.
- **AC-2.2** All coordinates are millimetres, origin top-left, x right, y down — the same
  coordinate space `RoomShape` already uses.
- **AC-2.3** The boundary is returned in clockwise order with at least 3 and at most 60 vertices.
- **AC-2.4** The model returns a `confidence` in `[0,1]` and a short `notes` string explaining what
  it read (e.g. "dimensions taken from the printed 3.6m and 4.2m labels").
- **AC-2.5** When the image contains no readable floor plan, the model returns `confidence: 0` with
  an explanatory note rather than inventing a rectangle.
- **AC-2.6** A response that fails the Zod mirror is treated as an upstream failure; nothing is
  proposed.

## R3 — Propose, never apply

**WHEN** an outline is returned
**THE SYSTEM SHALL** show it as a reviewable proposal and change nothing until the user accepts.

- **AC-3.1** The proposed outline is drawn ghosted over the existing room on the Konva stage,
  visually distinct from the committed outline.
- **AC-3.2** The proposal is run through the existing `validateShape()` before it is offered;
  any issues are listed in the panel exactly as hand-drawn outline issues already are.
- **AC-3.3** A summary is shown before accepting: wall count, computed area, perimeter and the
  model's confidence and note.
- **AC-3.4** **Apply** calls the existing `setRoomShape()`, so normalization, undo history and
  worker recompute all happen through the established path — no new state path is introduced.
- **AC-3.5** **Discard** clears the proposal and leaves the room untouched.
- **AC-3.6** After applying, the existing outline undo (`undoShape`) reverts it in one step.
- **AC-3.7** A proposal with `confidence < 0.4` is still shown, but with an explicit low-confidence
  warning advising the user to check the wall lengths.

## R4 — Scale correction

**WHEN** the model's absolute scale is wrong but its shape is right
**THE SYSTEM SHALL** let the user fix the scale without redrawing.

- **AC-4.1** After applying, the existing wall table in `ShapePanel` lets the user retype any wall
  length, and `setWallLength()` keeps the room square — this is the correction path, and no new UI
  is built for it.
- **AC-4.2** The proposal summary explicitly tells the user to check one known wall length against
  the drawing, because a photo without a dimension label has no absolute scale.

## R5 — Failure behaviour

**WHEN** anything goes wrong
**THE SYSTEM SHALL** leave the current room exactly as it was.

- **AC-5.1** Network failure, `429`, `502`, `503` and Zod failure each show a plain message; the
  room is unchanged in every case.
- **AC-5.2** Navigating away or unmounting mid-request aborts it via `AbortSignal` with no state
  update after unmount.
- **AC-5.3** With AI unconfigured, the upload control renders disabled with a one-line explanation;
  drawing by hand is unaffected.
- **AC-5.4** In demo mode, a canned example outline is returned and clearly labelled as such.

## R6 — Cut-outs

**WHEN** the plan shows an island, column or other untiled area
**THE SYSTEM SHALL** return it as a hole.

- **AC-6.1** `holes` are returned in the same coordinate space and applied via the existing
  `RoomShape.holes`.
- **AC-6.2** A hole that is not fully inside the boundary is reported by the existing
  `validateShape()` and shown before the user accepts.

## Out of scope

- Reading room *labels* ("Kitchen", "Bath") or producing multi-room plans. One outline per upload.
- Detecting doors, windows or fixtures.
- Photogrammetry from a photo of an actual room. This reads *plans and sketches*, not perspective
  photographs of physical spaces — the prompt says so explicitly and low confidence is the correct
  answer for such an image.
