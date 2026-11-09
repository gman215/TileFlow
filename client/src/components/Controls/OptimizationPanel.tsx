import React from 'react';
import type { AlignmentMode } from '@tileflow/geometry';
import { useTileFlowStore } from '../../store/tileFlowStore';
import InfoTip from './InfoTip';

export const ALIGNMENTS: { value: AlignmentMode; label: string; blurb: string }[] = [
  { value: 'optimize', label: 'Least waste', blurb: 'Slides the pattern to the position that wastes least and avoids slivers.' },
  { value: 'center-tile', label: 'Centre a tile', blurb: 'A full tile sits in the middle of the room (or on the squaring wall).' },
  { value: 'center-grout', label: 'Centre a joint', blurb: 'A grout line runs through the middle — symmetric cuts at both walls.' },
];

/**
 * Step 3: where the pattern sits. The common choice is up front; the
 * optimizer's weights are for people who want them (010 R6).
 */
export default function OptimizationPanel() {
  const optimizationConfig = useTileFlowStore((s) => s.optimizationConfig);
  const setAlpha = useTileFlowStore((s) => s.setAlpha);
  const setBeta = useTileFlowStore((s) => s.setBeta);
  const alignment = useTileFlowStore((s) => s.alignment);
  const setAlignment = useTileFlowStore((s) => s.setAlignment);

  const { alpha, beta } = optimizationConfig.weights;
  const current = ALIGNMENTS.find((a) => a.value === alignment) ?? ALIGNMENTS[0];

  return (
    <div className="px-4 py-4 space-y-3">
      <h3 className="section-header">
        <span className="step">3</span>Layout
        <InfoTip text="Where the tile pattern starts in the room. It decides how big the cut pieces at each wall are." />
      </h3>

      <div className="grid grid-cols-3 gap-1">
        {ALIGNMENTS.map(({ value, label, blurb }) => (
          <button
            key={value}
            onClick={() => setAlignment(value)}
            title={blurb}
            className={`seg py-1.5 text-[11px] ${alignment === value ? 'seg-active' : 'seg-idle'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-ink-muted">{current.blurb}</p>

      <details className="group">
        <summary className="cursor-pointer text-[11px] font-medium text-ink-secondary hover:text-ink">
          Fine-tune (advanced)
        </summary>
        <div className="mt-2 space-y-3">
          <div>
            <div className="flex justify-between">
              <label className="input-label">Prefer larger cuts</label>
              <span className="text-xs text-ink-secondary font-mono">{alpha.toFixed(2)}</span>
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
            <p className="text-[10px] text-ink-muted mt-0.5">Higher = avoid thin slivers, even at some extra waste</p>
          </div>

          <div>
            <div className="flex justify-between">
              <label className="input-label">Penalize waste</label>
              <span className="text-xs text-ink-secondary font-mono">{beta.toFixed(2)}</span>
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
            <p className="text-[10px] text-ink-muted mt-0.5">Higher = buy less tile, even with smaller cuts</p>
          </div>

          <p className="font-mono text-[10px] text-ink-muted">score = (α × minCutNorm) − (β × waste%)</p>
        </div>
      </details>
    </div>
  );
}
