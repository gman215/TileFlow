/**
 * The layout assistant's whitelist — the only code that turns a model's tool
 * call into a store change (003 AC-3.2, Constitution II).
 *
 * Each entry pairs a Zod schema with a `run` that calls one existing store
 * action. Three rules hold for every entry:
 *
 * 1. **Validated here, again.** `api/_lib/tools.ts` declares a JSON Schema for
 *    each tool, but a declaration constrains the model, it does not bind it. The
 *    arguments are parsed here, immediately before the store is touched, with
 *    the bounds the sidebar enforces (AC-3.3). A call that fails touches nothing.
 *
 * 2. **Read back, never echoed.** A result reports what is in effect *after*
 *    the call, read out of the store (AC-4.5). Store actions can decline:
 *    `setTileOrientation` swaps only when the orientation differs, and in plan
 *    mode a setter with no active room does nothing at all. Echoing the
 *    arguments would let the model announce a change that never happened.
 *
 * 3. **No dynamic dispatch.** `runToolCall` checks `Object.hasOwn` before it
 *    reads the map, so a name like `__proto__` or `constructor` can never reach
 *    `Object.prototype` (AC-6.5). The map is the entire capability surface.
 *
 * Reading back from `getState()` is right in plan mode too: the store mirrors
 * the active room's settings into the top-level `tileConfig`, `alignment` and
 * `optimizationConfig` (`activeView` in tileFlowStore.ts), which is what the
 * sidebar itself reads.
 */

import { z, type ZodType } from 'zod';
import type { AssistantCallDTO } from '@api/_lib/types';
import { summarizeShape } from '@tileflow/geometry';
import { statsDto } from '../api/ai';
import { useTileFlowStore } from '../store/tileFlowStore';

// ─── Bounds ───────────────────────────────────────────────────────────────────

// The sidebar's own minimums (TilePanel's and RoomPanel's `minMM`), plus upper
// bounds it does not need: a person cannot type a 2 km tile by accident, but a
// model can produce one, and the worker would dutifully try to lay it.
const TILE_MM = z.number().finite().min(10).max(3600);
const ROOM_MM = z.number().finite().min(100).max(100_000);
const GROUT_MM = z.number().finite().min(0).max(100);
const WEIGHT = z.number().finite().min(0).max(1);

// Kept identical to `PatternType` / `AlignmentMode`; a value outside these is a
// Zod failure rather than a store write the engine does not understand.
const PATTERN = z.enum(['grid', 'offset-1/2', 'offset-1/3', 'herringbone', 'diagonal-45']);
const ALIGNMENT = z.enum(['optimize', 'center-tile', 'center-grout']);

// ─── Map ──────────────────────────────────────────────────────────────────────

/** What a tool reports back to the model. Always says whether it worked. */
export type ToolResult = { ok: boolean } & Record<string, unknown>;

interface ToolImpl<A> {
  args: ZodType<A>;
  run: (args: A) => ToolResult;
}

/**
 * The shape every entry must have, without fixing its argument type: any
 * schema, and a `run` that accepts *something*. `never` is the bottom of
 * parameter types, so every `run` is assignable to it.
 */
type AnyToolImpl = { args: ZodType<unknown>; run: (args: never) => ToolResult };

/** Ties each `run` to its schema's inferred type, so the two cannot disagree. */
function tool<A>(args: ZodType<A>, run: (args: A) => ToolResult): ToolImpl<A> {
  return { args, run };
}

const store = () => useTileFlowStore.getState();

/** A store wall index as the wall table labels it: 2 → "W3". */
function wallLabel(index: number | undefined | null): string | null {
  return index == null ? null : `W${index + 1}`;
}

/** The current room's extents. For an outline, its bounding box. */
function roomNow() {
  const { width, height } = store().room;
  return { width_mm: width, height_mm: height };
}

/**
 * In a floor plan every room is bounded by walls, and the single-room geometry
 * actions act on a derived view of the active room that the next plan commit
 * rebuilds from those walls. A change made through them would appear to work
 * and then silently revert, so the geometry tools refuse there instead, and
 * say where the change is actually made.
 */
function inFloorPlan(): ToolResult | null {
  if (!store().plan) return null;
  return {
    ok: false,
    reason: 'floor_plan',
    message:
      'This room is part of a floor plan and is bounded by its walls. Move the walls, ' +
      'or type a clear length in the room panel; the reference wall is set there too.',
  };
}

/** The current tile, in the units and names the tool declarations use. */
function tileNow() {
  const { width, height, grout, pattern } = store().tileConfig;
  return { width_mm: width, height_mm: height, grout_mm: grout, pattern };
}

export const TOOL_MAP = {
  set_tile_size: tool(
    z.object({ width_mm: TILE_MM, height_mm: TILE_MM }).strict(),
    (a) => {
      store().setTileSizeMM(a.width_mm, a.height_mm);
      const { width_mm, height_mm } = tileNow();
      return { ok: width_mm === a.width_mm && height_mm === a.height_mm, width_mm, height_mm };
    }
  ),

  set_grout: tool(z.object({ grout_mm: GROUT_MM }).strict(), (a) => {
    store().setGroutMM(a.grout_mm);
    const { grout_mm } = tileNow();
    return { ok: grout_mm === a.grout_mm, grout_mm };
  }),

  set_pattern: tool(z.object({ pattern: PATTERN }).strict(), (a) => {
    store().setPattern(a.pattern);
    const { pattern } = tileNow();
    return { ok: pattern === a.pattern, pattern };
  }),

  set_alignment: tool(z.object({ alignment: ALIGNMENT }).strict(), (a) => {
    store().setAlignment(a.alignment);
    const { alignment } = store();
    return { ok: alignment === a.alignment, alignment };
  }),

  set_tile_orientation: tool(
    z.object({ orientation: z.enum(['horizontal', 'vertical']) }).strict(),
    (a) => {
      store().setTileOrientation(a.orientation);
      // The store swaps W/H only when the orientation differs, so the truth is
      // the resulting size. A square tile is both, and reports as such.
      const { width_mm, height_mm } = tileNow();
      const orientation =
        width_mm === height_mm ? 'square' : width_mm > height_mm ? 'horizontal' : 'vertical';
      return {
        ok: orientation === 'square' || orientation === a.orientation,
        orientation,
        width_mm,
        height_mm,
      };
    }
  ),

  set_optimization_weights: tool(
    z
      .object({ alpha: WEIGHT.optional(), beta: WEIGHT.optional() })
      .strict()
      .refine((a) => a.alpha !== undefined || a.beta !== undefined, {
        message: 'Pass alpha, beta, or both.',
      }),
    (a) => {
      if (a.alpha !== undefined) store().setAlpha(a.alpha);
      if (a.beta !== undefined) store().setBeta(a.beta);
      const { alpha, beta } = store().optimizationConfig.weights;
      return {
        ok: (a.alpha === undefined || alpha === a.alpha) && (a.beta === undefined || beta === a.beta),
        alpha,
        beta,
        // Said in the result, not left to the prompt: with a fixed alignment
        // the change is real but has no visible effect, and the model should
        // tell the user why nothing moved.
        optimizer_active: store().alignment === 'optimize',
      };
    }
  ),

  set_room_size: tool(
    z.object({ width_mm: ROOM_MM, height_mm: ROOM_MM }).strict(),
    (a) => {
      // `setRoomWidthMM` / `setRoomHeightMM` early-return while an outline
      // exists, so without this the model would announce a resize that did not
      // happen (AC-4.1). Said explicitly, with the way out, so the assistant
      // can offer it instead of retrying.
      const plan = inFloorPlan();
      if (plan) return plan;
      if (store().room.shape) {
        return {
          ok: false,
          reason: 'room_has_outline',
          message:
            'The room is a drawn outline, so width/height are read-only. ' +
            'Edit wall lengths, or call reset_to_rectangle first.',
          ...roomNow(),
        };
      }
      store().setRoomWidthMM(a.width_mm);
      store().setRoomHeightMM(a.height_mm);
      const { width_mm, height_mm } = roomNow();
      return { ok: width_mm === a.width_mm && height_mm === a.height_mm, width_mm, height_mm };
    }
  ),

  set_reference_wall: tool(
    z.object({ wall_number: z.number().int().min(1).max(1000).nullable() }).strict(),
    (a) => {
      // `setReferenceWall` early-returns without an outline (AC-4.2): a plain
      // rectangle is squared to its own bounding box, and has no walls to pick.
      const plan = inFloorPlan();
      if (plan) return plan;
      const { shape } = store().room;
      if (!shape) {
        return {
          ok: false,
          reason: 'no_outline',
          message:
            'The room is a plain rectangle, so the grid is already square to it. ' +
            'A reference wall needs a drawn outline.',
          reference_wall: null,
        };
      }
      // Checked here rather than left to the store, which would accept any
      // index and square the grid to a wall that does not exist (AC-4.3).
      const { wallCount } = summarizeShape(shape);
      if (a.wall_number !== null && a.wall_number > wallCount) {
        return {
          ok: false,
          reason: 'wall_out_of_range',
          message: `This outline has ${wallCount} walls, W1 to W${wallCount}.`,
          valid_range: ['W1', `W${wallCount}`],
          reference_wall: wallLabel(shape.referenceWall),
        };
      }
      // The one place a wall label becomes a store index. Everything the model
      // sees — this tool, its result, the snapshot — speaks in the wall table's
      // labels, because "wall 2" to a user is W2, not index 2.
      store().setReferenceWall(a.wall_number === null ? null : a.wall_number - 1);
      const reference_wall = wallLabel(store().room.shape?.referenceWall);
      const asked = a.wall_number === null ? null : `W${a.wall_number}`;
      return { ok: reference_wall === asked, reference_wall, wall_count: wallCount };
    }
  ),

  reset_to_rectangle: tool(z.object({}).strict(), () => {
    // The alternative `set_room_size` offers — so it must not be the call that
    // breaks a floor plan, where `resetToRect` would only rewrite a view the
    // next plan commit rebuilds from the walls.
    const plan = inFloorPlan();
    if (plan) return plan;
    store().resetToRect();
    const { room } = store();
    return { ok: !room.shape, is_drawn: Boolean(room.shape), width_mm: room.width, height_mm: room.height };
  }),

  read_layout_stats: tool(z.object({}).strict(), () => {
    // Read at call time, not taken from the request's snapshot (AC-4.4).
    const stats = statsDto();
    return stats ? { ok: true, stats } : { ok: false, reason: 'no_layout' };
  }),
} satisfies Record<string, AnyToolImpl>;

export type ToolName = keyof typeof TOOL_MAP;

// ─── Dispatch ─────────────────────────────────────────────────────────────────

/** How one call went, for the transcript chips and for the model. */
export interface ToolOutcome {
  callId: string;
  name: string;
  /** True only when the store was changed (or read) as asked. */
  applied: boolean;
  result: ToolResult;
}

/**
 * Execute one model-requested call against the whitelist.
 *
 * Never throws for anything the model controls — an unknown name or bad
 * arguments become an `ok: false` result the model is told about, so one bad
 * call in a batch does not stop the others (003 design, failure table).
 */
export function runToolCall(call: AssistantCallDTO): ToolOutcome {
  const { id: callId, name } = call;

  // `Object.hasOwn`, not `in` or a bare lookup: both of those see inherited
  // keys, so `__proto__`, `constructor` or `toString` would resolve.
  if (typeof name !== 'string' || !Object.hasOwn(TOOL_MAP, name)) {
    console.warn('[assistant] unsupported tool call dropped:', String(name).slice(0, 64));
    return { callId, name, applied: false, result: { ok: false, reason: 'unknown_tool' } };
  }

  // Safe now: `name` is one of TOOL_MAP's own keys. Typed as the widest entry
  // so the parse result and `run` line up without a cast per tool.
  const impl = TOOL_MAP[name as ToolName] as ToolImpl<unknown>;
  const parsed = impl.args.safeParse(call.arguments ?? {});
  if (!parsed.success) {
    return {
      callId,
      name,
      applied: false,
      result: {
        ok: false,
        reason: 'invalid_arguments',
        // Zod's messages name the field and the bound, which is exactly what
        // the model needs to correct itself — and nothing about the app.
        issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(arguments)'}: ${i.message}`),
      },
    };
  }

  const result = impl.run(parsed.data);
  return { callId, name, applied: result.ok, result };
}
