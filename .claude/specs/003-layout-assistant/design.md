# 003 — Layout Assistant · Design

## Why the client executes the tools

The obvious design — server calls tools, server returns final answer — cannot work here: the
application state is a Zustand store in the browser. There is nothing on the server to mutate.

So the loop is inverted. The server is a pure translator between prose and tool calls; the client
is the only thing that can act, and it acts against a fixed whitelist.

This is also the safer arrangement, and worth saying out loud in a code review: an injected
instruction (say, in a floor-plan image uploaded via 002) can at most produce a tool call, and the
whitelist bounds what a tool call can do to "change a tile setting". It has no path to the network,
the API key, the project database, or any store action not in the map.

```
 user message
      │
      ▼
 POST /api/ai/assistant  { message, previousInteractionId?, snapshot }
      │
      ├─▶ interactions.create({ model: fast, input, tools: TOOL_DECLARATIONS })
      │
      ◀── interaction.steps[] filtered to type === 'function_call'
      │
      ▼
 { reply, calls: [{ id, name, arguments }], interactionId }
      │
      ▼  client
 for each call:  whitelist lookup → Zod-validate args → invoke store action → record result
      │
      ▼
 POST /api/ai/assistant  { results: [...], previousInteractionId: interactionId, snapshot }
      │                    (input parts: { type:'function_result', name, call_id, result })
      ▼
 ...up to 4 round-trips, then final { reply, calls: [] }
```

## Tool table

Every tool is backed by an action that exists today in `client/src/store/tileFlowStore.ts`.

| Tool | Arguments (all mm) | Store action | Line | Notes |
|---|---|---|---|---|
| `set_tile_size` | `width_mm`, `height_mm` | `setTileSizeMM` | 368 | ≥10mm each |
| `set_grout` | `grout_mm` | `setGroutMM` | 373 | 0–100mm |
| `set_pattern` | `pattern` (enum ×5) | `setPattern` | 378 | `grid`, `offset-1/2`, `offset-1/3`, `herringbone`, `diagonal-45` |
| `set_alignment` | `alignment` (enum ×3) | `setAlignment` | 394 | `optimize`, `center-tile`, `center-grout` |
| `set_tile_orientation` | `orientation` | `setTileOrientation` | 381 | `horizontal` \| `vertical`; swaps W/H |
| `set_optimization_weights` | `alpha?`, `beta?` | `setAlpha` / `setBeta` | 399 / 407 | each 0–1 |
| `set_room_size` | `width_mm`, `height_mm` | `setRoomWidthMM` + `setRoomHeightMM` | 182 / 188 | **no-op when an outline is drawn** |
| `set_reference_wall` | `wall_index \| null` | `setReferenceWall` | 316 | **no-op without an outline** |
| `reset_to_rectangle` | — | `resetToRect` | 329 | discards the outline |
| `read_layout_stats` | — | (read) | — | fresh `statsDto()`; the grounding tool |

Deliberately excluded: `setRoomShape`, `moveShapeVertex`, `deleteShapeVertex`, `deleteHole`,
`setShapeWallLength`, project save/load. Geometry editing belongs to 002 and to direct manipulation;
persistence is never a model's decision.

### Declaration shape

```ts
// api/_lib/tools.ts
export const TOOL_DECLARATIONS = [
  {
    type: 'function',
    name: 'set_pattern',
    description:
      'Set the tile laying pattern. Herringbone only fits exactly when the tile length ' +
      'plus grout is twice the width plus grout (a 2:1 tile).',
    parameters: {
      type: 'object',
      properties: { pattern: { type: 'string',
        enum: ['grid','offset-1/2','offset-1/3','herringbone','diagonal-45'] } },
      required: ['pattern'],
    },
  },
  // ...
];
```

Tool descriptions carry the domain knowledge the UI already encodes: the herringbone 2:1 constraint
(`TilePanel.tsx` warns about it), that fixed alignment pauses the optimizer, that dimensions are
millimetres and the model must convert from whatever the user said.

## Two-sided validation

Declaring a JSON Schema for a tool constrains the model; it does not bind it. So arguments are
validated a second time on the client, immediately before the store call:

```ts
// client/src/ai/tools.ts
const TOOL_MAP = {
  set_pattern: {
    args: z.object({ pattern: z.enum(['grid','offset-1/2','offset-1/3','herringbone','diagonal-45']) }),
    run: (a, s) => { s.setPattern(a.pattern); return { ok: true, pattern: a.pattern }; },
  },
  // ...
} satisfies Record<string, ToolImpl>;
```

Dispatch is `Object.hasOwn(TOOL_MAP, name)` then a direct property read — never a dynamic lookup on
an unchecked string, and never anything that could reach `Object.prototype`.

## Honest results

A tool result is a small object reporting **what is actually true after the call**, which is what
lets the assistant correct itself instead of confidently reporting a change that did not happen.

The two no-op cases matter most:

```ts
set_room_size: (a, s) => {
  if (s.room.shape) {
    return { ok: false, reason: 'room_has_outline',
             message: 'The room is a drawn outline, so width/height are read-only. ' +
                      'Edit wall lengths, or call reset_to_rectangle first.' };
  }
  s.setRoomWidthMM(a.width_mm); s.setRoomHeightMM(a.height_mm);
  return { ok: true, width_mm: s.room.width, height_mm: s.room.height };
}
```

`setRoomWidthMM` early-returns when `room.shape` exists (`tileFlowStore.ts:182`), and
`setReferenceWall` early-returns when it does not (`:316`). Without this reporting, the model would
say "done" and the user would watch nothing happen — the single most damaging failure mode for a
feature like this.

Values are read back from the store after the call, not echoed from the arguments (AC-4.5).
`set_tile_orientation` is the clearest case: it swaps W and H only if the orientation actually
differs, so the truthful result is the resulting `width`/`height`.

## Reversibility

Store addition:

```ts
aiSnapshot: Pick<TileFlowState, 'room'|'tileConfig'|'alignment'|'optimizationConfig'> | null;
captureAiSnapshot: () => void;   // before each tool batch
undoAiChange: () => void;        // restore and clear
```

Outline edits already have `shapePast`/`shapeFuture`; tile config, alignment and weights have no
history at all today. Rather than build a general undo system for a chat feature, this takes one
snapshot per batch — enough for "put that back", cheap, and obvious in the UI (AC-5.2).

## Request / response

```ts
// request — one of two shapes
{ message: string; snapshot: LayoutStatsDTO; previousInteractionId?: string }
{ results: ToolResult[]; snapshot: LayoutStatsDTO; previousInteractionId: string }

// response
{
  reply: string;                                        // ≤ 1200 chars
  calls: { id: string; name: string; arguments: unknown }[];
  interactionId: string;
  roundTrip: number;                                    // 1..4
  demoMode?: true;
}
```

Body cap: 32 KB. `message` ≤ 2000 chars.

Server-side, `interaction.steps` is filtered to `step.type === 'function_call'` and each is mapped
to `{ id: step.id, name: step.name, arguments: step.arguments }`. Calls whose `name` is not in
`TOOL_DECLARATIONS` are dropped **server-side too**, so the client whitelist is the second line of
defence rather than the only one.

## Prompt — `ASSISTANT_V1`

- You are the layout assistant for a tile planner. The geometry engine computes every number; you
  never calculate tile counts, areas, waste or costs. Call `read_layout_stats` and quote it.
- All dimensions in tool calls are **millimetres**. Convert from feet/inches/cm yourself.
  (12 in = 304.8 mm; 1 ft = 304.8 mm; 1 cm = 10 mm.)
- Prefer one tool call per distinct change; do not re-set values that already match the snapshot.
- If a tool reports `ok: false`, explain the constraint to the user and offer the alternative it
  names. Never claim a change that a result did not confirm.
- Domain notes to use when advising: herringbone needs a 2:1 tile including grout; fixed alignment
  pauses the optimizer; higher α favours larger cut pieces (easier installs), higher β punishes
  waste; squaring to a reference wall is how a floor is actually set out.
- Keep replies to a few sentences. No markdown headings.

## UI

`client/src/components/AI/AssistantPanel.tsx` — a collapsible panel in the sidebar below
`OptimizationPanel`. Transcript of user/assistant turns, action chips under the turn that produced
them, an "Undo AI change" link on the most recent batch, an input with Enter-to-send, and a busy
state. Styling reuses `section-header`, `input-field`, `btn-primary`, `seg` — no new vocabulary.

Chips: applied `seg-active`; rejected/no-op in the muted style with the reason as a `title`.

A one-line note states that the conversation is not saved and resets on reload (AC-1.3).

## Failure behaviour

| Condition | Result |
|---|---|
| Zod failure on a tool's arguments | That call is skipped, reported to the model as `ok:false, reason:'invalid_arguments'`; others still run |
| Unknown tool name | Dropped, logged, counted; transcript notes an unsupported action |
| Round-trip cap hit | Assistant reports what was applied and stops (AC-3.5) |
| 429 / 502 / offline | Nothing applied; plain message; layout untouched |
| Unconfigured | Panel disabled with a reason |
| Demo mode | A canned scripted exchange, labelled |
