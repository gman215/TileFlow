import React, { useState } from 'react';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { ORDER_BUFFER } from '../../api/ai';
import { formatArea, formatWaste } from '../../utils/measurements';
import { useAiAvailability } from '../../hooks/useAiAvailability';
import BriefPanel from '../AI/BriefPanel';


// Shared translucent-dark surface for canvas-floating chrome (the brief drawer
// uses it too, so the two read as one family).
export const CARD_STYLE: React.CSSProperties = {
  background: 'rgba(36,35,33,.86)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,.08)',
};

const COLLAPSE_KEY = 'tileflow.statsCollapsed';

/** Per-browser preference; storage can be unavailable (private mode), so never required. */
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function StatsPanel() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      /* preference only */
    }
  };
  const layout = useTileFlowStore((s) => s.layout);
  const system = useTileFlowStore((s) => s.system);
  const isComputing = useTileFlowStore((s) => s.isComputing);
  const computeTimeMs = useTileFlowStore((s) => s.computeTimeMs);
  const [briefOpen, setBriefOpen] = useState(false);
  const { configured, loading, reason } = useAiAvailability();

  // Why the Brief button is off, or null when it is on (004 AC-4.1, AC-4.5). A
  // brief of a layout that does not exist yet, or is about to change, would
  // describe something that is not on screen.
  const briefBlocked = !layout
    ? 'No layout to describe yet.'
    : isComputing
      ? 'Wait for the layout to finish computing.'
      : loading
        ? 'Checking whether AI is available…'
        : !configured
          ? reason
          : null;

  const briefButton = (
    <button
      onClick={() => setBriefOpen(true)}
      disabled={briefBlocked !== null}
      title={briefBlocked ?? 'A setting-out brief for the installer, from these figures'}
      className="rounded-md border border-white/15 px-2 py-0.5 text-[11px] font-medium text-white/85 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      Brief
    </button>
  );
  const drawer = briefOpen && <BriefPanel onClose={() => setBriefOpen(false)} />;

  if (!layout) {
    return (
      <>
        <div
          className="absolute bottom-3 left-3 z-10 flex items-center gap-3 rounded-xl px-4 py-3 text-xs text-white/70"
          style={CARD_STYLE}
        >
          {isComputing ? 'Computing…' : 'No layout computed yet.'}
          {briefButton}
        </div>
        {drawer}
      </>
    );
  }

  const totalTiles = layout.fullTileCount + layout.cutTileCount;
  // Shared with statsDto() so the figure shown here and the figure a model is
  // told are the same number.
  const buyCount = Math.ceil(totalTiles * ORDER_BUFFER);
  // Shared with statsDto() for the same reason.
  const roomAreaDisplay = formatArea(layout.roomArea, system);

  const waste = layout.wastePercentage;
  const wasteColor = waste > 10 ? '#F87171' : '#4ADE80';

  const secondary: { label: string; value: string }[] = [
    { label: 'Full', value: layout.fullTileCount.toString() },
    { label: 'Cut', value: layout.cutTileCount.toString() },
    { label: 'Total', value: totalTiles.toString() },
    { label: 'Area', value: roomAreaDisplay },
    { label: 'Compute', value: `${computeTimeMs.toFixed(1)} ms` },
  ];

  if (collapsed) {
    return (
      <>
      <button
        onClick={toggle}
        title="Show the full stats"
        className="absolute bottom-3 left-3 z-10 flex items-center gap-3 rounded-full px-3.5 py-1.5 text-[12px] text-white"
        style={CARD_STYLE}
      >
        <span>
          <span className="font-mono font-medium">{buyCount}</span> to buy
        </span>
        <span style={{ color: wasteColor }}>
          <span className="font-mono">{formatWaste(waste)}</span> waste
        </span>
        <span className="text-white/50">▴</span>
      </button>
      {drawer}
      </>
    );
  }

  return (
    <>
    <div
      className="absolute bottom-3 left-3 z-10 rounded-xl p-4 text-white"
      style={CARD_STYLE}
    >
      <button
        onClick={toggle}
        title="Shrink to one line"
        aria-label="Collapse stats"
        className="absolute right-2 top-2 rounded px-1.5 text-[12px] text-white/45 hover:text-white"
      >
        ▾
      </button>
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
            {formatWaste(waste)}
          </div>
          <div className="mt-1.5 text-[11px] text-white/55" title="Tile you pay for but cut away, as a share of the floor">
            Waste %
          </div>
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
        <span className="ml-auto pl-2">{briefButton}</span>
      </div>
    </div>
    {drawer}
    </>
  );
}
