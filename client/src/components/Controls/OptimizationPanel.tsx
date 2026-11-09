import React from 'react';
import type { AlignmentMode } from '@tileflow/geometry';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { anchorIssue, fullTilesFromEdgeAxis } from '@tileflow/geometry';
import { anchorLabel } from '../Canvas/anchorPick';
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

  const anchored = useTileFlowStore((s) => Boolean(s.room.shape?.anchor ?? s.room.anchor));
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
      <p className="text-[11px] leading-snug text-ink-muted">
        {anchored && alignment !== 'optimize'
          ? alignment === 'center-tile'
            ? 'A full tile sits on the anchor below — the feature, not the room.'
            : 'A grout joint runs through the anchor below — the feature, not the room.'
          : current.blurb}
      </p>

      <CentreOn />

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

/**
 * What the layout is set out from (011 R3): the room, the reference wall, or a
 * feature — a cut-out's centre or edge, or a point. Picking a feature starts
 * the canvas Anchor tool; ✕ clears it; an edge anchor offers "Full tiles from
 * this edge" with the reason when the pattern cannot do it (AC-3.6).
 */
function CentreOn() {
  const room = useTileFlowStore((s) => s.room);
  const pattern = useTileFlowStore((s) => s.tileConfig.pattern);
  const picking = useTileFlowStore((s) => s.anchorPicking);
  const setPicking = useTileFlowStore((s) => s.setAnchorPicking);
  const setLayoutAnchor = useTileFlowStore((s) => s.setLayoutAnchor);
  const setFullTiles = useTileFlowStore((s) => s.setFullTilesFromEdge);
  const notice = useTileFlowStore((s) => s.anchorNotice);
  const setNotice = useTileFlowStore((s) => s.setAnchorNotice);

  const islands = useTileFlowStore((s) => {
    if (!s.plan || !s.activeRoomId) return 0;
    const pr = s.plan.rooms.find((r) => r.id === s.activeRoomId);
    const d = s.derived?.rooms.get(s.activeRoomId);
    return pr && d ? d.holes.length - pr.holes.length : 0;
  });
  const anchor = room.shape?.anchor ?? room.anchor;
  const label = anchorLabel(room, islands);
  const ref = room.shape?.referenceWall;
  const base = ref != null ? `Wall W${ref + 1} (reference wall)` : 'The room';
  const issue = room.shape ? anchorIssue(room.shape) : null;
  const edgeRule = anchor?.kind === 'hole-edge' ? fullTilesFromEdgeAxis(room.shape, pattern) : null;

  return (
    <div className="space-y-1.5 rounded-lg bg-[#F7F6F3] px-2.5 py-2" aria-label="Centre on">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 text-[11px]">
          <span className="text-ink-muted">Centre on </span>
          <span className="font-medium text-ink">{label ?? base}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {anchor && (
            <button onClick={() => setLayoutAnchor(null)} aria-label="Clear anchor" title="Back to the room" className="rounded px-1.5 text-[12px] text-ink-muted hover:bg-hairline hover:text-ink">
              ✕
            </button>
          )}
          <button
            onClick={() => setPicking(!picking)}
            aria-pressed={picking}
            title="Click a cut-out, its edge, or a spot on the canvas (A)"
            className={`seg px-2 py-0.5 text-[10px] ${picking ? 'seg-active' : 'seg-idle'}`}
          >
            {picking ? 'Click on the canvas…' : anchor ? 'Change' : 'Pick a feature'}
          </button>
        </div>
      </div>
      {anchor?.kind === 'hole-edge' && edgeRule && (
        <label
          className={`flex items-center gap-1.5 text-[11px] ${edgeRule.along ? 'text-ink-secondary' : 'cursor-not-allowed text-ink-muted'}`}
          title={edgeRule.along ? 'A grout joint along the edge, so the first full row starts there' : 'reason' in edgeRule ? edgeRule.reason : undefined}
        >
          <input
            type="checkbox"
            checked={Boolean(anchor.fullTilesFromEdge) && Boolean(edgeRule.along)}
            disabled={!edgeRule.along}
            onChange={(e) => setFullTiles(e.target.checked)}
          />
          Full tiles from this edge
        </label>
      )}
      {anchor?.kind === 'hole-edge' && edgeRule && !edgeRule.along && 'reason' in edgeRule && (
        <p className="text-[10px] leading-snug text-ink-muted">{edgeRule.reason}</p>
      )}
      {issue && <p className="text-[10px] leading-snug text-red-700">{issue}</p>}
      {notice && (
        <p className="flex items-start justify-between gap-2 text-[10px] leading-snug text-amber-800">
          {notice}
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="text-amber-800/70 hover:text-amber-900">✕</button>
        </p>
      )}
    </div>
  );
}
