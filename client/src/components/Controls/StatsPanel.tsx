import React from 'react';
import { useTileFlowStore } from '../../store/tileFlowStore';

export default function StatsPanel() {
  const layout = useTileFlowStore((s) => s.layout);
  const isComputing = useTileFlowStore((s) => s.isComputing);
  const computeTimeMs = useTileFlowStore((s) => s.computeTimeMs);

  if (!layout) {
    return (
      <div className="panel">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-2">
          Layout Statistics
        </h3>
        <p className="text-xs text-gray-500">
          {isComputing ? 'Computing...' : 'No layout computed yet.'}
        </p>
      </div>
    );
  }

  const stats = [
    {
      label: 'Full Tiles',
      value: layout.fullTileCount.toString(),
      color: 'text-blue-300',
    },
    {
      label: 'Cut Tiles',
      value: layout.cutTileCount.toString(),
      color: 'text-orange-300',
    },
    {
      label: 'Total Tiles',
      value: (layout.fullTileCount + layout.cutTileCount).toString(),
      color: 'text-white',
    },
    {
      label: 'Waste',
      value: `${layout.wastePercentage.toFixed(1)}%`,
      color: layout.wastePercentage > 10 ? 'text-red-400' : 'text-green-400',
    },
    {
      label: 'Min Cut',
      value: `${(layout.smallestCutPiece / 100).toFixed(1)} cm²`,
      color: 'text-yellow-300',
    },
    {
      label: 'Score',
      value: layout.optimizationScore.toFixed(3),
      color: 'text-emerald-400',
    },
  ];

  return (
    <div className="panel space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          Layout Statistics
        </h3>
        {isComputing && (
          <span className="text-[10px] text-blue-400 animate-pulse">
            computing...
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="stat-card">
            <div className={`stat-value ${s.color}`}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="text-[10px] text-gray-600 text-right">
        Computed in {computeTimeMs.toFixed(1)} ms
      </div>
    </div>
  );
}
