import React from 'react';
import { useTileFlowStore } from '../../store/tileFlowStore';

/**
 * One line that always says what the current tool does and what to do next
 * (010 R2) — the status-line prompt CAD tools use, so nobody has to guess.
 */
export function useHint(rectActive: boolean): string {
  const plan = useTileFlowStore((s) => s.plan);
  const derived = useTileFlowStore((s) => s.derived);
  const planTool = useTileFlowStore((s) => s.planTool);
  const draft = useTileFlowStore((s) => s.draft);
  const editMode = useTileFlowStore((s) => s.editMode);
  const room = useTileFlowStore((s) => s.room);
  const selectedWallId = useTileFlowStore((s) => s.selectedWallId);
  const selectedNodeId = useTileFlowStore((s) => s.selectedNodeId);
  const activeRoomId = useTileFlowStore((s) => s.activeRoomId);

  if (editMode) return 'Drag any tile to nudge it · click Edit tiles again when done';

  if (!plan) {
    if (draft?.kind === 'boundary')
      return 'Click each corner · type a length to place it exactly · click the first corner to finish';
    if (draft?.kind === 'hole')
      return "Cut-out: click the corners of an area that isn't tiled · click the first corner to finish";
    return room.shape
      ? 'Drag a corner to reshape · retype wall lengths in step 1 · C adds a cut-out'
      : 'Type the room size in step 1, or drag its edges · D draws an L-shape · then pick a tile';
  }

  const activeName = plan.rooms.find((r) => r.id === activeRoomId)?.name ?? 'the room';
  if (draft?.kind === 'walls')
    return 'Wall: click each corner · type a length to place it exactly · Enter or Esc ends';
  if (draft?.kind === 'hole')
    return `Cut-out in ${activeName}: click the corners · click the first corner to finish · Esc cancels`;
  if (planTool === 'room')
    return rectActive
      ? 'Release (or click) at the opposite corner · Esc cancels'
      : 'Room: drag a rectangle to add a room · or click inside closed walls';
  if (planTool === 'wall') return 'Wall: click to start a wall';

  if (selectedWallId)
    return 'Wall selected: drag to slide it · Delete removes it · doors, windows and build-up are in the panel';
  if (selectedNodeId) return 'Corner selected: drag to move it · framing choices are in the panel';

  if (plan.rooms.length === 0) return 'No rooms yet — press R and drag a rectangle to add one';
  const open = plan.rooms.find((r) => derived?.rooms.get(r.id)?.status === 'not-enclosed');
  if (open) return `${open.name} isn't enclosed — press R and click it to see the open wall ends`;
  return 'Click a room to pick its tile · click a wall to change it · R adds a room';
}

export default function HintBar({ text }: { text: string }) {
  return (
    <div
      role="status"
      title={text}
      className="max-w-[min(640px,90vw)] truncate rounded-full px-3.5 py-1.5 text-[12px] text-white/80 shadow-lg"
      style={{
        background: 'rgba(36,35,33,.86)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,.08)',
      }}
    >
      {text}
    </div>
  );
}
