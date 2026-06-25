import React from 'react';
import { useTileFlowStore } from '../../store/tileFlowStore';

const MM2_PER_M2 = 1_000_000;
const MM2_PER_FT2 = 92_903.04;

// Shared translucent-dark surface for canvas-floating chrome.
const CARD_STYLE: React.CSSProperties = {
  background: 'rgba(36,35,33,.86)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,.08)',
};

export default function StatsPanel() {
  const layout = useTileFlowStore((s) => s.layout);
  const system = useTileFlowStore((s) => s.system);
  const isComputing = useTileFlowStore((s) => s.isComputing);
  const computeTimeMs = useTileFlowStore((s) => s.computeTimeMs);

  if (!layout) {
    return (
      <div
        className="absolute bottom-3 left-3 z-10 rounded-xl px-4 py-3 text-xs text-white/70"
        style={CARD_STYLE}
      >
        {isComputing ? 'Computing…' : 'No layout computed yet.'}
      </div>
    );
  }

  const totalTiles = layout.fullTileCount + layout.cutTileCount;
  const buyCount = Math.ceil(totalTiles * 1.1);
  const imperial = system === 'imperial';
  const roomAreaDisplay = imperial
    ? `${(layout.roomArea / MM2_PER_FT2).toFixed(1)} ft²`
    : `${(layout.roomArea / MM2_PER_M2).toFixed(2)} m²`;

  const waste = layout.wastePercentage;
  const wasteColor = waste > 10 ? '#F87171' : '#4ADE80';

  const secondary: { label: string; value: string }[] = [
    { label: 'Full', value: layout.fullTileCount.toString() },
    { label: 'Cut', value: layout.cutTileCount.toString() },
    { label: 'Total', value: totalTiles.toString() },
    { label: 'Area', value: roomAreaDisplay },
    { label: 'Compute', value: `${computeTimeMs.toFixed(1)} ms` },
  ];

  return (
    <div
      className="absolute bottom-3 left-3 z-10 rounded-xl p-4 text-white"
      style={CARD_STYLE}
    >
      {/* Hero stats */}
      <div className="flex gap-8">
        <div>
          <div className="font-mono text-[32px] leading-none font-medium">
            {buyCount}
          </div>
          <div className="mt-1.5 text-[11px] text-white/55">
            Order to buy (incl. 10%)
          </div>
        </div>
        <div>
          <div
            className="font-mono text-[32px] leading-none font-medium"
            style={{ color: wasteColor }}
          >
            {waste.toFixed(1)}%
          </div>
          <div className="mt-1.5 text-[11px] text-white/55">Waste %</div>
        </div>
      </div>

      {/* Quiet secondary row */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/60">
        {secondary.map((s, i) => (
          <React.Fragment key={s.label}>
            {i > 0 && <span className="text-white/20">·</span>}
            <span>
              {s.label}{' '}
              <span className="font-mono text-white/85">{s.value}</span>
            </span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
