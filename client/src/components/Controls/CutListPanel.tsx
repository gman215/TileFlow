import React, { useState } from 'react';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { useCutList, cutLength, cutKindText, CUT_KIND_LABEL } from '../../hooks/useCutList';
import { CARD_STYLE } from './StatsPanel';

/**
 * 012 R1 — the dimensioned cut list for the layout on screen: every cut piece,
 * grouped into labelled sizes, as marked on the tile. A drawer beside the
 * layout, like the brief, so the letters can be found on the plan. Every
 * figure is the engine's (`cutPieces` / `groupCuts`).
 */
export default function CutListPanel({ onClose }: { onClose: () => void }) {
  const list = useCutList();
  const system = useTileFlowStore((s) => s.system);
  const plan = useTileFlowStore((s) => s.plan);
  const activeName = useTileFlowStore((s) => (s.plan && s.activeRoomId ? s.plan.rooms.find((r) => r.id === s.activeRoomId)?.name : null));
  const showCutLabels = useTileFlowStore((s) => s.showCutLabels);
  const setShowCutLabels = useTileFlowStore((s) => s.setShowCutLabels);
  const [copied, setCopied] = useState(false);

  async function copyCsv() {
    if (!list) return;
    const unit = system === 'metric' ? 'mm' : 'in';
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [['Label', `Width (${unit})`, `Height (${unit})`, 'Cut', `Notch (${unit})`, 'Pieces', 'Tiles'].map(q).join(',')];
    for (const g of list.groups) {
      const notch = g.notch ? `${cutLength(g.notch.width, system)} × ${cutLength(g.notch.height, system)}` : '';
      rows.push([g.label, cutLength(g.width, system), cutLength(g.height, system), CUT_KIND_LABEL[g.kind], notch, g.count, g.tiles].map(q).join(','));
    }
    try {
      await navigator.clipboard.writeText(rows.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <aside
      aria-label="Cut list"
      className="absolute bottom-3 right-3 top-16 z-20 flex w-[370px] flex-col rounded-xl text-white"
      style={CARD_STYLE}
    >
      <header className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <h3 className="text-[13px] font-semibold">
          Cut list{plan && activeName ? <span className="font-normal text-white/55"> · {activeName}</span> : null}
        </h3>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={copyCsv}
            disabled={!list || list.groups.length === 0}
            className="rounded px-2 py-1 text-[11px] text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            {copied ? 'Copied' : 'Copy CSV'}
          </button>
          <button onClick={onClose} aria-label="Close cut list" className="rounded px-2 py-1 text-[14px] text-white/50 hover:text-white">
            ×
          </button>
        </div>
      </header>

      <label className="flex cursor-pointer items-center gap-2 border-b border-white/10 px-4 py-2 text-[11px] text-white/75">
        <input type="checkbox" checked={showCutLabels} onChange={(e) => setShowCutLabels(e.target.checked)} />
        Show the letters on the plan
      </label>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {!list ? (
          <p className="px-2 text-[12px] text-white/55">No layout yet.</p>
        ) : list.groups.length === 0 ? (
          <p className="px-2 text-[12px] text-white/55">No cuts — every tile is full.</p>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-white/45">
                <th className="px-2 py-1 font-medium"></th>
                <th className="px-2 py-1 font-medium">Size ({system === 'metric' ? 'mm' : 'in'})</th>
                <th className="px-2 py-1 font-medium">Cut</th>
                <th className="px-2 py-1 text-right font-medium">Pcs</th>
              </tr>
            </thead>
            <tbody>
              {list.groups.map((g) => (
                <tr key={g.label} className="border-t border-white/5">
                  <td className="px-2 py-1 font-mono font-semibold text-amber-300">{g.label}</td>
                  <td className="whitespace-nowrap px-2 py-1 font-mono text-white/90">
                    {cutLength(g.width, system)} × {cutLength(g.height, system)}
                  </td>
                  <td className="px-2 py-1 text-white/60">{cutKindText(g, system)}</td>
                  <td className="px-2 py-1 text-right font-mono" title={g.tiles !== g.count ? `from ${g.tiles} tiles` : undefined}>
                    {g.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <footer className="border-t border-white/10 px-4 py-2 text-[10px] leading-relaxed text-white/45">
        {list && list.groups.length > 0 && (
          <div className="text-white/70">
            {list.pieces} pieces from {list.tiles} cut tiles · {list.groups.length} sizes
          </div>
        )}
        Sizes along the tile's width × height, to the nearest {list?.precision ?? '1 mm'}. Notched and angled pieces show
        their overall size; an L-shaped notch shows the piece cut out of it. Each cut uses a whole tile.
      </footer>
    </aside>
  );
}
