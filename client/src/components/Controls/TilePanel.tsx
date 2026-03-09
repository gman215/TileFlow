import React from 'react';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { fromMM, UNIT_LABELS, type PatternType, type Unit } from '@tileflow/geometry';

const PATTERNS: { value: PatternType; label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'offset-1/2', label: '½ Offset' },
  { value: 'offset-1/3', label: '⅓ Offset' },
  { value: 'herringbone', label: 'Herringbone' },
  { value: 'diagonal-45', label: '45° Diagonal' },
];

export default function TilePanel() {
  const tileConfig = useTileFlowStore((s) => s.tileConfig);
  const unit = useTileFlowStore((s) => s.unit);
  const setTileWidth = useTileFlowStore((s) => s.setTileWidth);
  const setTileHeight = useTileFlowStore((s) => s.setTileHeight);
  const setGrout = useTileFlowStore((s) => s.setGrout);
  const setPattern = useTileFlowStore((s) => s.setPattern);

  const displayW = fromMM(tileConfig.width, unit);
  const displayH = fromMM(tileConfig.height, unit);
  const displayG = fromMM(tileConfig.grout, unit);

  const stepMap: Record<Unit, number> = { mm: 5, cm: 0.5, m: 0.01, inches: 0.125, feet: 0.05 };
  const precisionMap: Record<Unit, number> = { mm: 0, cm: 1, m: 3, inches: 3, feet: 3 };
  const step = stepMap[unit];
  const precision = precisionMap[unit];
  const label = UNIT_LABELS[unit];

  return (
    <div className="panel space-y-3">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
        Tile Configuration
      </h3>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="input-label">Width ({label})</label>
          <input
            type="number"
            className="input-field"
            value={Number(displayW.toFixed(precision))}
            onChange={(e) => setTileWidth(parseFloat(e.target.value) || 0)}
            step={step}
            min={0}
          />
        </div>
        <div>
          <label className="input-label">Height ({label})</label>
          <input
            type="number"
            className="input-field"
            value={Number(displayH.toFixed(precision))}
            onChange={(e) => setTileHeight(parseFloat(e.target.value) || 0)}
            step={step}
            min={0}
          />
        </div>
      </div>

      <div>
        <label className="input-label">Grout Width ({label})</label>
        <input
          type="number"
          className="input-field"
          value={Number(displayG.toFixed(precision))}
          onChange={(e) => setGrout(parseFloat(e.target.value) || 0)}
          step={unit === 'mm' ? 0.5 : unit === 'cm' ? 0.1 : step / 10}
          min={0}
        />
      </div>

      <div>
        <label className="input-label">Pattern</label>
        <div className="grid grid-cols-1 gap-1.5 mt-1">
          {PATTERNS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setPattern(value)}
              className={`py-2 px-3 text-xs font-medium rounded transition-colors text-left ${
                tileConfig.pattern === value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
