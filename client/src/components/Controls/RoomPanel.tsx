import React from 'react';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { roomDisplay, type MeasurementSystem } from '../../utils/measurements';
import DimensionField from './DimensionField';

const SYSTEMS: { value: MeasurementSystem; label: string }[] = [
  { value: 'metric', label: 'Metric' },
  { value: 'imperial', label: 'Imperial' },
];

export default function RoomPanel() {
  const room = useTileFlowStore((s) => s.room);
  const system = useTileFlowStore((s) => s.system);
  const setSystem = useTileFlowStore((s) => s.setSystem);
  const setRoomWidthMM = useTileFlowStore((s) => s.setRoomWidthMM);
  const setRoomHeightMM = useTileFlowStore((s) => s.setRoomHeightMM);

  const display = roomDisplay(system);
  const imperial = system === 'imperial';

  return (
    <div className="panel space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          Room
        </h3>
        {/* System toggle — controls how every measurement is shown */}
        <div className="flex rounded overflow-hidden border border-gray-700">
          {SYSTEMS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setSystem(value)}
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                system === value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

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
        <span className="text-gray-600 text-xs select-none">×</span>
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

      <p className="text-[10px] text-gray-600">
        {imperial
          ? 'Type like 12 ft 6 in · ↑↓ nudges by 1 in (Shift ×10)'
          : '↑↓ nudges by 10 cm (Shift ×10) · or drag the room edges'}
      </p>
    </div>
  );
}
