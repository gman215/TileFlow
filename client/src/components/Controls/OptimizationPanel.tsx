import React from 'react';
import { useTileFlowStore } from '../../store/tileFlowStore';

export default function OptimizationPanel() {
  const optimizationConfig = useTileFlowStore((s) => s.optimizationConfig);
  const setAlpha = useTileFlowStore((s) => s.setAlpha);
  const setBeta = useTileFlowStore((s) => s.setBeta);

  const { alpha, beta } = optimizationConfig.weights;

  return (
    <div className="panel space-y-3">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
        Optimization Weights
      </h3>

      <div>
        <div className="flex justify-between">
          <label className="input-label">
            α — Min Cut Preference
          </label>
          <span className="text-xs text-blue-400 font-mono">
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
          className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
        />
        <p className="text-[10px] text-gray-500 mt-0.5">
          Higher = prefer larger minimum cut pieces
        </p>
      </div>

      <div>
        <div className="flex justify-between">
          <label className="input-label">
            β — Waste Penalty
          </label>
          <span className="text-xs text-orange-400 font-mono">
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
          className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
        />
        <p className="text-[10px] text-gray-500 mt-0.5">
          Higher = penalize waste more heavily
        </p>
      </div>

      <div className="text-xs text-gray-500 border-t border-gray-800 pt-2 mt-2">
        <p className="font-mono text-[10px]">
          score = (α × minCutNorm) − (β × waste%)
        </p>
      </div>
    </div>
  );
}
