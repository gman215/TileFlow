import React from 'react';
import { Group, Text } from 'react-konva';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { useCutList } from '../../hooks/useCutList';

/** Never larger than this on screen, px — a label, not a watermark. */
const MAX_PX = 22;
/** Below this on screen a letter is noise; leave it out (it is still in the list). */
const MIN_PX = 7;

/**
 * 012 AC-1.6 — each cut piece's cut-list letter, at the point deepest inside
 * the piece, sized to fit it. Same list as the drawer (`useCutList`), so a
 * letter on the plan is always the row of that letter. Follows hand-moved
 * tiles; in a floor plan, the active room's pieces.
 */
export default function CutLabels({ scale }: { scale: number }) {
  const show = useTileFlowStore((s) => s.showCutLabels);
  const manualOffsets = useTileFlowStore((s) => s.manualOffsets);
  const origin = useTileFlowStore((s) => (s.plan && s.activeRoomId ? s.roomOrigins[s.activeRoomId] : null));
  const list = useCutList();
  if (!show || !list) return null;

  const labels: React.ReactNode[] = [];
  for (const g of list.groups) {
    for (const p of g.pieces) {
      const size = Math.min(p.labelSize * 0.75, MAX_PX / scale);
      if (size * scale < MIN_PX) continue;
      const off = manualOffsets[p.tileId];
      const box = size * g.label.length;
      labels.push(
        <Text
          key={`${p.tileId}:${p.piece}`}
          x={p.labelAt.x + (off?.dx ?? 0)}
          y={p.labelAt.y + (off?.dy ?? 0)}
          width={box * 1.4}
          offsetX={(box * 1.4) / 2}
          offsetY={size / 2}
          align="center"
          text={g.label}
          fontSize={size}
          fontStyle="bold"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fill="#5B2A0E"
          listening={false}
          perfectDrawEnabled={false}
        />
      );
    }
  }
  return (
    <Group x={origin?.x ?? 0} y={origin?.y ?? 0} listening={false}>
      {labels}
    </Group>
  );
}
