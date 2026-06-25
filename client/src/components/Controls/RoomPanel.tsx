import React from 'react';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { roomDisplay } from '../../utils/measurements';
import DimensionField from './DimensionField';

export default function RoomPanel() {
  const room = useTileFlowStore((s) => s.room);
  const system = useTileFlowStore((s) => s.system);
  const setRoomWidthMM = useTileFlowStore((s) => s.setRoomWidthMM);
  const setRoomHeightMM = useTileFlowStore((s) => s.setRoomHeightMM);

  const display = roomDisplay(system);
  const imperial = system === 'imperial';

  return (
    <div className="px-4 py-4 space-y-2.5">
      <h3 className="section-header">Room</h3>

      <div className="flex items-center gap-1.5">
        <DimensionField
          label="W"
          mm={room.width}
          unit={display.unit}
          imperialFormat={display.imperialFormat}
          onChangeMM={setRoomWidthMM}
          minMM={100}
          className="flex-1"
          title={imperial ? 'Width — e.g. 12 ft 6 in' : 'Width in metres'}
        />
        <span className="text-ink-muted text-xs select-none">×</span>
        <DimensionField
          label="H"
          mm={room.height}
          unit={display.unit}
          imperialFormat={display.imperialFormat}
          onChangeMM={setRoomHeightMM}
          minMM={100}
          className="flex-1"
          title={imperial ? 'Depth — e.g. 10 ft 0 in' : 'Depth in metres'}
        />
      </div>

      <p className="text-[10px] text-ink-muted">
        {imperial
          ? 'Type like 12 ft 6 in · ↑↓ nudges by 1 in (Shift ×10)'
          : '↑↓ nudges by 10 cm (Shift ×10) · or drag the room edges'}
      </p>
    </div>
  );
}
