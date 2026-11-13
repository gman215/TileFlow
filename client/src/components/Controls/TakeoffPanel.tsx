import React, { useMemo, useState } from 'react';
import { frameWalls, takeoff, MM_PER_FOOT } from '@tileflow/geometry';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { tileTotals } from '../../store/planHelpers';
import { formatDisplayFromMM, roomDisplay, tileDisplay } from '../../utils/measurements';
import { orderQuantity } from '../../api/ai';
import { productBoxes } from '../../utils/boxes';

const SHEETS_IMPERIAL = [
  { label: '4×8 ft', width: 4 * MM_PER_FOOT, height: 8 * MM_PER_FOOT },
  { label: '4×10 ft', width: 4 * MM_PER_FOOT, height: 10 * MM_PER_FOOT },
  { label: '4×12 ft', width: 4 * MM_PER_FOOT, height: 12 * MM_PER_FOOT },
];
const SHEETS_METRIC = [
  { label: '1200×2400', width: 1200, height: 2400 },
  { label: '1200×2700', width: 1200, height: 2700 },
];
const STOCK_IMPERIAL = [8, 10, 12, 16].map((ft) => ({ label: `${ft} ft`, mm: ft * MM_PER_FOOT }));
const STOCK_METRIC = [2400, 3000, 3600, 4800].map((mm) => ({ label: `${mm / 1000} m`, mm }));

const MM2_PER_FT2 = 92_903.04;
const MM2_PER_M2 = 1_000_000;

/**
 * What to order (009 R7): framing lumber, plates in stock lengths, sheet goods
 * per material, and tile. Every figure comes from `takeoff()` and the room
 * layouts; this panel picks options and formats.
 */
export default function TakeoffPanel() {
  const plan = useTileFlowStore((s) => s.plan);
  const derived = useTileFlowStore((s) => s.derived);
  const system = useTileFlowStore((s) => s.system);
  const activeRoomId = useTileFlowStore((s) => s.activeRoomId);
  const roomLayouts = useTileFlowStore((s) => s.roomLayouts);
  const boxSizes = useTileFlowStore((s) => s.boxSizes);

  const metric = system === 'metric';
  const sheetChoices = metric ? SHEETS_METRIC : SHEETS_IMPERIAL;
  const stockChoices = metric ? STOCK_METRIC : STOCK_IMPERIAL;

  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'plan' | 'room'>('plan');
  const [wastePct, setWastePct] = useState(10);
  const [sheetIndex, setSheetIndex] = useState<Record<string, number>>({});
  const [stockIndex, setStockIndex] = useState(stockChoices.length - 1);
  const [copied, setCopied] = useState(false);

  const len = roomDisplay(system);
  const fmt = (mm: number) => formatDisplayFromMM(mm, len.unit, len.imperialFormat);
  const tileDims = tileDisplay(system);
  const area = (mm2: number) => (metric ? `${(mm2 / MM2_PER_M2).toFixed(1)} m²` : `${(mm2 / MM2_PER_FT2).toFixed(0)} ft²`);

  const framed = useMemo(() => (plan ? frameWalls(plan) : []), [plan]);
  const roomWalls = useMemo(() => {
    const d = activeRoomId ? derived?.rooms.get(activeRoomId) : undefined;
    return new Set((d?.edgeWalls ?? []).filter((id): id is string => Boolean(id)));
  }, [derived, activeRoomId]);

  const result = useMemo(() => {
    if (!plan || !derived) return null;
    const stock = stockChoices[Math.min(stockIndex, stockChoices.length - 1)];
    const sheetSizes: Record<string, { width: number; height: number }> = {};
    for (const [material, i] of Object.entries(sheetIndex)) sheetSizes[material] = sheetChoices[i] ?? sheetChoices[0];
    return takeoff(plan, framed, derived.rooms, {
      waste: Math.max(0, wastePct) / 100,
      stockLength: stock.mm,
      defaultSheet: sheetChoices[0],
      sheetSizes,
      wallIds: scope === 'room' ? roomWalls : undefined,
    });
  }, [plan, derived, framed, scope, roomWalls, wastePct, sheetIndex, stockIndex, sheetChoices, stockChoices]);

  const tiles = useMemo(
    () =>
      plan
        ? tileTotals(plan, derived, roomLayouts, scope === 'room' && activeRoomId ? new Set([activeRoomId]) : undefined)
        : [],
    [plan, derived, roomLayouts, scope, activeRoomId]
  );

  // 012 AC-3.3 — boxes per product, on the combined order of its rows.
  const boxes = productBoxes(
    tiles.map((t) => ({ tileConfig: t.tileConfig, order: orderQuantity(t.tiles) })),
    boxSizes
  );
  const sizeLabel = (t: { width: number; height: number }) =>
    `${formatDisplayFromMM(t.width, tileDims.unit, tileDims.imperialFormat)} × ${formatDisplayFromMM(t.height, tileDims.unit, tileDims.imperialFormat)} tile`;

  if (!plan || !result) return null;
  const stock = stockChoices[Math.min(stockIndex, stockChoices.length - 1)];
  const tileLabel = (t: (typeof tiles)[number]) =>
    `${formatDisplayFromMM(t.tileConfig.width, tileDims.unit, tileDims.imperialFormat)} × ${formatDisplayFromMM(
      t.tileConfig.height,
      tileDims.unit,
      tileDims.imperialFormat
    )} ${t.tileConfig.pattern} tile`;
  const sheetLabel = (w: number, h: number) => sheetChoices.find((c) => c.width === w && c.height === h)?.label ?? '';

  const copyCsv = async () => {
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['Category', 'Item', 'Size / length', 'Quantity', 'Unit'].map(q).join(',')];
    for (const r of result.lumber) lines.push(['Framing', r.item, fmt(r.length), r.count, 'pcs'].map(q).join(','));
    lines.push(['Framing', 'Plate stock', stock.label, result.plates.pieces, 'pcs (approx.)'].map(q).join(','));
    for (const r of result.sheets) lines.push(['Sheet goods', r.material, sheetLabel(r.sheetWidth, r.sheetHeight), r.sheets, 'sheets'].map(q).join(','));
    for (const r of result.sheathing) lines.push(['Exterior', r.material, sheetLabel(r.sheetWidth, r.sheetHeight), r.sheets, 'sheets'].map(q).join(','));
    for (const t of tiles) lines.push(['Tile', tileLabel(t), area(t.area), orderQuantity(t.tiles), 'tiles (incl. 10%)'].map(q).join(','));
    for (const b of boxes) lines.push(['Tile', sizeLabel(b.tile), `${b.perBox} per box`, b.boxes.boxes, `boxes (${b.boxes.tiles} tiles)`].map(q).join(','));
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const sheetTable = (rows: typeof result.sheets, title: string) =>
    rows.length > 0 && (
      <div className="space-y-0.5">
        <div className="text-[10px] text-ink-muted">{title}</div>
        {rows.map((r) => (
          <div key={r.material} className="flex items-center gap-1.5 text-[11px]">
            <span className="flex-1 truncate text-ink">{r.material}</span>
            <span className="font-mono text-[10px] text-ink-muted">{area(r.area)}</span>
            <select
              className="bg-transparent text-[10px] text-ink-muted outline-none"
              value={sheetIndex[r.material] ?? 0}
              onChange={(e) => setSheetIndex({ ...sheetIndex, [r.material]: parseInt(e.target.value, 10) })}
            >
              {sheetChoices.map((c, i) => (
                <option key={c.label} value={i}>
                  {c.label}
                </option>
              ))}
            </select>
            <span className="w-8 text-right font-mono font-medium text-ink">{r.sheets}</span>
          </div>
        ))}
      </div>
    );

  return (
    <div className="px-4 py-4 space-y-2.5">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between">
        <h3 className="section-header">Takeoff</h3>
        <span className="text-[11px] text-ink-muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
            <select className="input-field w-auto py-0.5 text-[11px]" value={scope} onChange={(e) => setScope(e.target.value as 'plan' | 'room')}>
              <option value="plan">Whole plan</option>
              <option value="room">Active room's walls</option>
            </select>
            <label className="flex items-center gap-1">
              Waste
              <input
                type="number"
                min={0}
                max={50}
                className="w-12 rounded border border-hairline px-1 py-0.5 text-[11px]"
                value={wastePct}
                onChange={(e) => setWastePct(Math.max(0, Math.min(50, parseFloat(e.target.value) || 0)))}
              />
              %
            </label>
          </div>

          <div className="space-y-0.5">
            <div className="text-[10px] text-ink-muted">Framing lumber</div>
            {result.lumber.map((r) => (
              <div key={`${r.item}-${r.length}`} className="flex text-[11px]">
                <span className="flex-1 text-ink">{r.item}</span>
                <span className="font-mono text-[10px] text-ink-muted">{fmt(r.length)}</span>
                <span className="w-8 text-right font-mono font-medium text-ink">{r.count}</span>
              </div>
            ))}
            <div className="flex items-center text-[11px]">
              <span className="flex-1 text-ink">
                Plates <span className="text-[10px] text-ink-muted">({fmt(result.plates.totalLength)} total)</span>
              </span>
              <select
                className="bg-transparent text-[10px] text-ink-muted outline-none"
                value={Math.min(stockIndex, stockChoices.length - 1)}
                onChange={(e) => setStockIndex(parseInt(e.target.value, 10))}
              >
                {stockChoices.map((c, i) => (
                  <option key={c.label} value={i}>
                    {c.label}
                  </option>
                ))}
              </select>
              <span className="w-8 text-right font-mono font-medium text-ink" title="Pieces, first-fit — approximate">
                {result.plates.pieces}
              </span>
            </div>
          </div>

          {sheetTable(result.sheets, 'Sheet goods (room faces)')}
          {sheetTable(result.sheathing, 'Exterior faces')}

          {tiles.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-[10px] text-ink-muted">Tile (incl. 10%)</div>
              {tiles.map((t) => (
                <div key={t.key} className="flex text-[11px]">
                  <span className="flex-1 truncate text-ink">{tileLabel(t)}</span>
                  <span className="w-10 text-right font-mono font-medium text-ink">{orderQuantity(t.tiles)}</span>
                </div>
              ))}
              {boxes.map((b) => (
                <div key={b.key} className="flex text-[11px]">
                  <span className="flex-1 truncate text-ink-secondary">
                    {sizeLabel(b.tile)} · {b.perBox}/box
                  </span>
                  <span className="text-right font-mono font-medium text-ink">{b.boxes.boxes} boxes</span>
                </div>
              ))}
            </div>
          )}

          <button onClick={copyCsv} className="btn-secondary w-full py-1 text-[12px]">
            {copied ? 'Copied ✓' : 'Copy as CSV'}
          </button>
          <p className="text-[10px] text-ink-muted">Planning estimate — not an engineered design.</p>
        </>
      )}
    </div>
  );
}
