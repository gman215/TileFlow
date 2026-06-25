import React from 'react';
import { useTileFlowStore } from '../../store/tileFlowStore';

export default function OptimizationPanel() {
  const optimizationConfig = useTileFlowStore((s) => s.optimizationConfig);
  const setAlpha = useTileFlowStore((s) => s.setAlpha);
  const setBeta = useTileFlowStore((s) => s.setBeta);

  const { alpha, beta } = optimizationConfig.weights;

  return (
    <div className="px-4 py-4 space-y-3">
      <h3 className="section-header">Optimization</h3>

      <div>
        <div className="flex justify-between">
          <label className="input-label">Prefer larger cuts</label>
          <span className="text-xs text-ink-secondary font-mono">
            {alpha.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={alpha}
          onChange={(e) => setAlpha(parseFloat(e.target.value))}
          className="w-full h-1.5 bg-hairline rounded-lg appearance-none cursor-pointer accent-accent"
        />
        <p className="text-[10px] text-ink-muted mt-0.5">
          Higher = prefer larger minimum cut pieces
        </p>
      </div>

      <div>
        <div className="flex justify-between">
          <label className="input-label">Penalize waste</label>
          <span className="text-xs text-ink-secondary font-mono">
            {beta.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={beta}
          onChange={(e) => setBeta(parseFloat(e.target.value))}
          className="w-full h-1.5 bg-hairline rounded-lg appearance-none cursor-pointer accent-accent"
        />
        <p className="text-[10px] text-ink-muted mt-0.5">
          Higher = penalize waste more heavily
        </p>
      </div>

      <div className="text-xs text-ink-muted border-t border-divider pt-2 mt-2">
        <p className="font-mono text-[10px]">
          score = (α × minCutNorm) − (β × waste%)
        </p>
      </div>
    </div>
  );
}
