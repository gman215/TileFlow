import React from 'react';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { fromMM, ALL_UNITS, UNIT_LABELS, type Unit } from '@tileflow/geometry';

export default function RoomPanel() {
  const room = useTileFlowStore((s) => s.room);
  const unit = useTileFlowStore((s) => s.unit);
  const setRoomWidth = useTileFlowStore((s) => s.setRoomWidth);
  const setRoomHeight = useTileFlowStore((s) => s.setRoomHeight);
  const setUnit = useTileFlowStore((s) => s.setUnit);

  const displayWidth = fromMM(room.width, unit);
  const displayHeight = fromMM(room.height, unit);

  // Step and precision per unit
  const stepMap: Record<Unit, number> = { mm: 10, cm: 1, m: 0.1, inches: 0.25, feet: 0.25 };
  const precisionMap: Record<Unit, number> = { mm: 0, cm: 1, m: 2, inches: 2, feet: 2 };
  const step = stepMap[unit];
  const precision = precisionMap[unit];

  return (
    <div className="panel space-y-3">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
        Room Dimensions
      </h3>

      {/* Unit toggle */}
      <div className="flex flex-wrap gap-1">
        {ALL_UNITS.map((u) => (
          <button
            key={u}
            onClick={() => setUnit(u)}
            className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
              unit === u
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {UNIT_LABELS[u]}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div>
          <label className="input-label">Width ({UNIT_LABELS[unit]})</label>
          <input
            type="number"
            className="input-field"
            value={Number(displayWidth.toFixed(precision))}
            onChange={(e) => setRoomWidth(parseFloat(e.target.value) || 0)}
            step={step}
            min={0}
          />
        </div>
        <div>
          <label className="input-label">Height ({UNIT_LABELS[unit]})</label>
          <input
            type="number"
            className="input-field"
            value={Number(displayHeight.toFixed(precision))}
            onChange={(e) => setRoomHeight(parseFloat(e.target.value) || 0)}
            step={step}
            min={0}
          />
        </div>
      </div>

      <p className="text-xs text-gray-500">
        Drag the room edges on the canvas to resize in real time.
      </p>
    </div>
  );
}
