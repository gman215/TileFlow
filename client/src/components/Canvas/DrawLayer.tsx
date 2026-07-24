import React from 'react';
import { Line, Circle, Text, Group } from 'react-konva';
import type { Vec2 } from '@tileflow/geometry';
import type { ShapeDraft } from '../../store/tileFlowStore';
import { formatDisplayFromMM, type FieldDisplay } from '../../utils/measurements';

const DRAFT_COLOR = '#F59E0B';
const RUBBER_COLOR = 'rgba(245,158,11,0.75)';
const CLOSE_HINT_COLOR = 'rgba(74,222,128,0.55)';
const LABEL_BG = 'rgba(27,26,24,0.85)';

interface Props {
  draft: ShapeDraft;
  /** Snapped cursor position in mm, or null when the pointer is off-canvas */
  cursor: Vec2 | null;
  /** True when clicking now would close the outline */
  willClose: boolean;
  scale: number;
  display: FieldDisplay;
}

/**
 * The outline being drawn: the walls placed so far, a rubber band to the
 * cursor with its live length, and — once three corners are down — a hint
 * line showing where the outline would close.
 */
export default function DrawLayer({ draft, cursor, willClose, scale, display }: Props) {
  const points = draft.points;
  const last = points[points.length - 1] ?? null;
  const first = points[0] ?? null;

  const placed: number[] = [];
  for (const p of points) placed.push(p.x, p.y);

  const rubberLength =
    last && cursor ? Math.hypot(cursor.x - last.x, cursor.y - last.y) : 0;

  const gapToStart =
    first && cursor ? Math.hypot(cursor.x - first.x, cursor.y - first.y) : 0;

  const fontSize = 13 / scale;

  return (
    <Group listening={false}>
      {/* Walls placed so far */}
      {points.length >= 2 && (
        <Line
          points={placed}
          stroke={DRAFT_COLOR}
          strokeWidth={2.5 / scale}
          lineJoin="round"
          perfectDrawEnabled={false}
        />
      )}

      {/* Hint line back to the start once the outline could close */}
      {points.length >= 3 && cursor && first && (
        <Line
          points={[cursor.x, cursor.y, first.x, first.y]}
          stroke={CLOSE_HINT_COLOR}
          strokeWidth={1.5 / scale}
          dash={[10 / scale, 8 / scale]}
          perfectDrawEnabled={false}
        />
      )}

      {/* Rubber band to the cursor */}
      {last && cursor && (
        <Line
          points={[last.x, last.y, cursor.x, cursor.y]}
          stroke={RUBBER_COLOR}
          strokeWidth={2 / scale}
          dash={[6 / scale, 5 / scale]}
          perfectDrawEnabled={false}
        />
      )}

      {/* Corners already placed */}
      {points.map((p, i) => (
        <Circle
          key={i}
          x={p.x}
          y={p.y}
          radius={(i === 0 && willClose ? 8 : 4.5) / scale}
          fill={i === 0 && willClose ? CLOSE_HINT_COLOR : DRAFT_COLOR}
          perfectDrawEnabled={false}
        />
      ))}

      {/* Live length of the wall being drawn */}
      {last && cursor && rubberLength > 0 && (
        <Text
          x={(last.x + cursor.x) / 2 + 10 / scale}
          y={(last.y + cursor.y) / 2 - 20 / scale}
          text={formatDisplayFromMM(rubberLength, display.unit, display.imperialFormat)}
          fontSize={fontSize}
          fill={DRAFT_COLOR}
          padding={3 / scale}
          perfectDrawEnabled={false}
        />
      )}

      {/* How far the outline still is from closing */}
      {points.length >= 2 && cursor && first && !willClose && (
        <Text
          x={first.x + 10 / scale}
          y={first.y - 24 / scale}
          text={`back to start: ${formatDisplayFromMM(
            gapToStart,
            display.unit,
            display.imperialFormat
          )}`}
          fontSize={fontSize * 0.92}
          fill={CLOSE_HINT_COLOR}
          padding={3 / scale}
          perfectDrawEnabled={false}
        />
      )}

      {willClose && first && (
        <Text
          x={first.x + 12 / scale}
          y={first.y + 10 / scale}
          text="click to close"
          fontSize={fontSize * 0.92}
          fill={CLOSE_HINT_COLOR}
          padding={3 / scale}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
}

export { LABEL_BG };
