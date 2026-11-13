/**
 * The layout assistant's tool declarations — the entire capability surface the
 * model is offered (003, AC-2.1).
 *
 * Every tool here is backed 1:1 by a store action that already exists in
 * `client/src/store/tileFlowStore.ts`; none introduces a new one (AC-2.3). The
 * server never executes these: it forwards the model's calls to the browser,
 * where `client/src/ai/tools.ts` validates them again and dispatches against a
 * whitelist. Declaring a schema constrains the model, it does not bind it.
 *
 * Descriptions carry the domain knowledge the sidebar already encodes — the
 * herringbone 2:1 rule from `TilePanel.tsx`, that fixed alignment pauses the
 * optimizer, and that the store works in millimetres — because the model only
 * knows what it is told here and in the snapshot.
 *
 * Shape follows the verified SDK table in `001-ai-foundation/design.md`:
 * `{ type: 'function', name, description, parameters: <JSON Schema> }`.
 */

// Duplicated from `@tileflow/geometry` (`PatternType`, `AlignmentMode`) rather
// than imported — `api/` takes nothing from the geometry package, not even
// types (see `types.ts`). A typo here would fail silently at runtime: the model
// would be offered a value the store does not understand. Keep these in step
// with `packages/geometry/src/types/index.ts` by hand.
const PATTERNS = [
  'grid',
  'offset-1/2',
  'offset-1/3',
  'herringbone',
  'diagonal-45',
  // 013
  'offset-1/4',
  'basketweave',
  'checkerboard',
  'hexagon',
] as const;
const ALIGNMENTS = ['optimize', 'center-tile', 'center-grout'] as const;

// Every length the model passes must already be in the store's unit (AC-2.4).
// Stated on each dimensional parameter, not once at the top, because the model
// reads parameter descriptions at the point it fills them in.
const MM = 'Millimetres. Convert from whatever unit the user gave (1 in = 25.4 mm, 1 ft = 304.8 mm, 1 cm = 10 mm).';

export interface ToolDeclaration {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const TOOL_DECLARATIONS: readonly ToolDeclaration[] = [
  {
    type: 'function',
    name: 'set_tile_size',
    description:
      'Set the tile width and height. Applies to the selected room (or its pattern group) ' +
      'when a floor plan is open. Width is the horizontal edge as laid; use ' +
      'set_tile_orientation to rotate an existing tile instead of swapping these.',
    parameters: {
      type: 'object',
      properties: {
        width_mm: { type: 'number', minimum: 10, description: `Tile width, at least 10. ${MM}` },
        height_mm: { type: 'number', minimum: 10, description: `Tile height, at least 10. ${MM}` },
      },
      required: ['width_mm', 'height_mm'],
    },
  },
  {
    type: 'function',
    name: 'set_grout',
    description: 'Set the grout joint width between tiles.',
    parameters: {
      type: 'object',
      properties: {
        grout_mm: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          description: `Joint width, 0 to 100. ${MM} (1/8 in = 3.175 mm, 1/16 in = 1.5875 mm.)`,
        },
      },
      required: ['grout_mm'],
    },
  },
  {
    type: 'function',
    name: 'set_pattern',
    description:
      'Set the tile laying pattern. Herringbone only fits exactly when the tile length plus ' +
      'grout is twice the tile width plus grout (a 2:1 tile, e.g. 6×12 in or 7.5×15 cm); with ' +
      'any other tile it leaves gaps, so suggest a 2:1 size alongside it. offset-1/2 is a ' +
      'running/brick bond, offset-1/3 a third offset, offset-1/4 a quarter offset, diagonal-45 a ' +
      'grid turned 45°. For a tile with a side over 18 in (457 mm) laid in running bond, prefer ' +
      'offset-1/3 or offset-1/4: ANSI A108.02 recommends at most a 33% offset. basketweave lays ' +
      'square blocks of two (or three) tiles, alternate blocks turned — it needs a 2:1 or 3:1 tile. ' +
      'checkerboard is a grid in two colours of the same tile. hexagon lays hexagonal tiles; their ' +
      'size is across the flats, so set width and height to that one size.',
    parameters: {
      type: 'object',
      properties: { pattern: { type: 'string', enum: [...PATTERNS] } },
      required: ['pattern'],
    },
  },
  {
    type: 'function',
    name: 'set_alignment',
    description:
      'Set how the tile grid is positioned. "optimize" searches for the offset with the best ' +
      'balance of cut size and waste. "center-tile" centres a full tile on the anchor, and ' +
      '"center-grout" runs a grout joint through it; both are fixed and pause the optimizer, ' +
      'so the optimization weights have no effect while they are set. The anchor is the room ' +
      'centre, or the reference wall when one is set.',
    parameters: {
      type: 'object',
      properties: { alignment: { type: 'string', enum: [...ALIGNMENTS] } },
      required: ['alignment'],
    },
  },
  {
    type: 'function',
    name: 'set_tile_orientation',
    description:
      'Lay the current tile landscape ("horizontal": long edge across) or portrait ' +
      '("vertical": long edge up). Swaps width and height only if the tile is not already in ' +
      'that orientation; a square tile is unaffected.',
    parameters: {
      type: 'object',
      properties: { orientation: { type: 'string', enum: ['horizontal', 'vertical'] } },
      required: ['orientation'],
    },
  },
  {
    type: 'function',
    name: 'set_optimization_weights',
    description:
      'Tune what the optimizer prefers. alpha ("Prefer larger cuts") rewards a larger smallest ' +
      'cut piece, which is easier to install; beta ("Penalize waste") punishes wasted tile. ' +
      'Pass only the weight you are changing. Has no effect unless alignment is "optimize".',
    parameters: {
      type: 'object',
      properties: {
        alpha: { type: 'number', minimum: 0, maximum: 1, description: 'Prefer larger cuts, 0 to 1.' },
        beta: { type: 'number', minimum: 0, maximum: 1, description: 'Penalize waste, 0 to 1.' },
      },
    },
  },
  {
    type: 'function',
    name: 'set_room_size',
    description:
      'Set the width and height of a plain rectangular room. Has no effect while a drawn ' +
      'outline exists — the outline governs, and the result will say so; offer a reset ' +
      '(reset_to_rectangle, which asks the user to confirm) rather than claiming the change.',
    parameters: {
      type: 'object',
      properties: {
        width_mm: { type: 'number', exclusiveMinimum: 0, description: `Room width. ${MM}` },
        height_mm: { type: 'number', exclusiveMinimum: 0, description: `Room depth. ${MM}` },
      },
      required: ['width_mm', 'height_mm'],
    },
  },
  {
    type: 'function',
    name: 'set_reference_wall',
    description:
      'Square the tile grid to one wall of a drawn outline, anchored on its midpoint — how a ' +
      'floor is actually set out. Walls are named W1, W2, W3… in the wall table, exactly as the ' +
      'user sees them; pass the number from that label, so "wall 2" or "W2" is 2. Pass null to ' +
      'go back to squaring to the room. Only works when a drawn outline exists.',
    parameters: {
      type: 'object',
      properties: {
        wall_number: {
          type: ['integer', 'null'],
          minimum: 1,
          description: 'The number in the wall\'s label: 2 for W2. Or null to clear it.',
        },
      },
      required: ['wall_number'],
    },
  },
  {
    type: 'function',
    name: 'reset_to_rectangle',
    description:
      'Offer to discard the drawn outline and return to a plain rectangle of its bounding ' +
      'size. This tool never changes the room by itself: it shows the user a confirmation ' +
      'button, and only their click resets the outline. Call it when the user asks for a reset ' +
      'or agrees to one, then tell them to click the button. Never call it twice in a turn.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'read_layout_stats',
    description:
      'Read the current, freshly computed layout figures — tile counts, area, waste, cut ' +
      'sizes. Call this before quoting any number, and after making changes, rather than ' +
      'relying on an earlier snapshot. Quote figures from its `display` block, which is ' +
      'formatted exactly as the user sees it on screen.',
    parameters: { type: 'object', properties: {} },
  },
];
