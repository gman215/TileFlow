# 003 — Layout Assistant · Requirements

**Status:** Not started
**Depends on:** 001-ai-foundation (complete and verified)
**Gemini capability:** function calling, multi-turn

## Purpose

TileFlow's sidebar assumes you already know what a ⅓ offset is, what α and β trade off, and that
"squaring to a wall" is how a floor is actually set out. The assistant is the plain-English way in:
*"12×24 herringbone, squared to the window wall, and I'd rather not have thin slivers at the door."*

Its tools are the store's own actions. Nothing new is invented for the model to call — every tool
maps 1:1 onto a function a button already calls. That is what makes this a real integration rather
than a demo: the model drives the same API the UI does.

---

## R1 — Conversation

**WHEN** a user sends a message
**THE SYSTEM SHALL** answer with reference to the current layout, and carry context across turns.

- **AC-1.1** Each request includes a `LayoutStatsDTO` snapshot of the current room, tile config and
  computed layout, so answers are grounded in what is actually on screen.
- **AC-1.2** Multi-turn context is carried with `previous_interaction_id`; the client never resends
  prior message text.
- **AC-1.3** Conversation state is in-memory only. A page reload starts a new conversation, and
  this is stated in the UI rather than silently lost.
- **AC-1.4** The assistant answers questions without acting when no change is requested
  ("what does alpha do?" changes nothing).

## R2 — Tools map to existing store actions

**WHEN** the model requests a change
**THE SYSTEM SHALL** express it as a call to one of a fixed set of tools, each backed by a store
action that already exists.

- **AC-2.1** The tool set is exactly: `set_tile_size`, `set_grout`, `set_pattern`,
  `set_alignment`, `set_tile_orientation`, `set_optimization_weights`, `set_room_size`,
  `set_reference_wall`, `reset_to_rectangle`, `read_layout_stats`.
- **AC-2.2** Every tool's parameters are declared with a JSON Schema, with enums for
  `pattern` (the five `PatternType` values) and `alignment` (the three `AlignmentMode` values).
- **AC-2.3** No tool introduces a new store action; each calls one that exists today.
- **AC-2.4** All dimensional tool arguments are in **millimetres**, matching the store's internal
  unit. Conversion from what the user typed is the model's job, and the tool description says so.

## R3 — The server never mutates

**WHEN** the model returns tool calls
**THE SYSTEM SHALL** return them to the client for execution and apply nothing itself.

- **AC-3.1** The route is stateless with respect to application state; it holds no store and
  performs no mutation.
- **AC-3.2** The client executes calls against a **whitelist**: a tool name not in the map is
  dropped and logged, never dispatched dynamically.
- **AC-3.3** Every tool's arguments are Zod-validated client-side before the store is touched, with
  the same bounds the UI enforces (tile ≥10mm, grout 0–100mm, α/β 0–1).
- **AC-3.4** Tool results are returned to the model with `previous_interaction_id` so it can
  confirm or correct.
- **AC-3.5** The request/response loop is capped at 4 round-trips per user message; on exceeding it
  the assistant reports what it managed to do and stops.

## R4 — Honest tool results

**WHEN** a tool cannot do what was asked
**THE SYSTEM SHALL** report that back to the model rather than silently succeeding.

- **AC-4.1** `set_room_size` is a no-op while a drawn outline exists — `setRoomWidthMM` and
  `setRoomHeightMM` early-return in that case. The tool result must say so, and the assistant must
  then explain that the outline governs and offer `reset_to_rectangle`.
- **AC-4.2** `set_reference_wall` is a no-op without a drawn outline (`setReferenceWall` returns
  early when `room.shape` is undefined) and must report that.
- **AC-4.3** `set_reference_wall` with an out-of-range index is rejected with the valid range in
  the result.
- **AC-4.4** `read_layout_stats` returns a freshly read snapshot, not the one sent with the
  original message.
- **AC-4.5** Every tool result states the value actually in effect after the call.

## R5 — Visible, reversible actions

**WHEN** the assistant changes the layout
**THE SYSTEM SHALL** show what changed and let the user undo it in one action.

- **AC-5.1** Each applied call renders as a chip in the transcript ("Pattern → Herringbone").
- **AC-5.2** A snapshot of the affected state is taken before each tool batch, and an
  "Undo AI change" control restores it. Today only outline edits are undoable; this extends
  reversibility to tile config, alignment and weights.
- **AC-5.3** Rejected or no-op calls are shown distinctly from applied ones.
- **AC-5.4** The canvas recomputes after a batch through the existing worker subscription — no new
  recompute path is added.

## R6 — Failure and safety

- **AC-6.1** Model output that fails validation applies nothing; the transcript says the request
  was not understood.
- **AC-6.2** A tool name outside the whitelist is dropped, counted and logged; the user is told an
  unsupported action was requested.
- **AC-6.3** With AI unconfigured the panel renders a disabled state with a reason; the rest of the
  app is unaffected.
- **AC-6.4** 429 / 502 / offline each leave the layout untouched and report plainly.
- **AC-6.5** The assistant cannot save, load or delete a project, call the network, or read
  anything outside the snapshot it was given. The whitelist is the entire capability surface.

## Out of scope

- Drawing or editing an outline vertex-by-vertex via chat (that is 002's job, via an image).
- Persisting conversations.
- Streaming assistant replies — replies are short; 004 covers streaming.
