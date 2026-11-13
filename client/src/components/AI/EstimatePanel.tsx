import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { EstimateDTO } from '@api/_lib/types';
import { useTileFlowStore, type EstimatePriceKey } from '../../store/tileFlowStore';
import { useAiAvailability } from '../../hooks/useAiAvailability';
import { ai, AiError, buildEstimateRequest, orderQuantity } from '../../api/ai';
import {
  buildEstimateView,
  effectivePrices,
  logTotalDiscrepancy,
  parseEstimate,
  priceUnits,
  type EstimateContext,
} from '../../ai/estimate';

const CURRENCIES = ['$', '€', '£', '¥', '₹', 'R'];
const LOW_CONFIDENCE = 0.5;

/** Engine figures the arithmetic needs, from the snapshot the request was built from. */
function contextFrom(req: NonNullable<ReturnType<typeof buildEstimateRequest>>): EstimateContext {
  const { stats, engine } = req;
  const perUnitArea = stats.system === 'imperial' ? 92_903.04 : 1_000_000;
  return {
    system: stats.system,
    orderQuantity: engine.orderQuantity,
    roomArea: engine.roomArea,
    areaUnit: engine.areaUnit,
    roomAreaM2: stats.layout.roomAreaMm2 / 1_000_000,
    tileFaceArea: (stats.tile.widthMm * stats.tile.heightMm) / perUnitArea,
    pattern: stats.tile.pattern,
  };
}

function messageFor(err: unknown): string {
  if (err instanceof AiError) {
    switch (err.code) {
      case 'rate_limited':
        return err.retryAfterSeconds ? `Too many requests — try again in ${err.retryAfterSeconds}s.` : 'Too many requests. Try again shortly.';
      case 'upstream':
        return 'The estimate could not be produced just now. Try again in a moment.';
      case 'network':
        return 'Could not reach the server. Check your connection and try again.';
      case 'config':
        return 'AI features are not configured on this deployment.';
    }
  }
  return 'The estimate came back in a form that could not be used. Try again.';
}

/**
 * The cost estimator (005): the model supplies quantities and unit rates with
 * a stated basis; every subtotal and the total are computed here, in the
 * browser (Constitution I). Editing a price re-costs the last estimate locally
 * with no network call (AC-3.3). Prices live for the session only (AC-3.4).
 */
export default function EstimatePanel() {
  const system = useTileFlowStore((s) => s.system);
  const layout = useTileFlowStore((s) => s.layout);
  const isComputing = useTileFlowStore((s) => s.isComputing);
  const typed = useTileFlowStore((s) => s.estimatePrices[s.system]);
  const tileUnit = useTileFlowStore((s) => s.estimateTileUnit);
  const currency = useTileFlowStore((s) => s.estimateCurrency);
  const setPrice = useTileFlowStore((s) => s.setEstimatePrice);
  const setTileUnit = useTileFlowStore((s) => s.setEstimateTileUnit);
  const setCurrency = useTileFlowStore((s) => s.setEstimateCurrency);
  const { configured, loading, reason } = useAiAvailability();

  /** The last good response, and the engine figures it was asked about. */
  const [result, setResult] = useState<{ dto: EstimateDTO; ctx: EstimateContext; orderQuantity: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);
  // Set on every mount, not just initialised: React StrictMode (dev) mounts,
  // unmounts and remounts, and a flag only ever cleared would leave the panel
  // ignoring its own responses after the first simulated unmount.
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; abortRef.current?.abort(); };
  }, []);

  const { prices, placeholder } = effectivePrices(system, typed, tileUnit);
  const units = priceUnits(system, tileUnit);

  // Prices → table, locally, every time a price changes (AC-3.3). A response
  // estimated under the other measurement system is re-asked rather than
  // re-costed: its weights and areas are in the other units.
  const view = useMemo(
    () => (result && result.ctx.system === system ? buildEstimateView(result.dto, prices, result.ctx) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, system, prices.tile, prices.tileUnit, prices.adhesive, prices.grout, prices.labour]
  );

  const blocked = !layout
    ? 'No layout to estimate yet.'
    : isComputing
      ? 'Wait for the layout to finish computing.'
      : loading
        ? 'Checking whether AI is available…'
        : !configured
          ? reason
          : null;
  const stale = result !== null && layout !== null && result.orderQuantity !== orderQuantity(layout.fullTileCount + layout.cutTileCount);

  async function estimate() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const req = buildEstimateRequest(prices, currency);
    if (!req) return;
    setBusy(true);
    setError(null);
    try {
      const raw = await ai.estimate(req, controller.signal);
      if (!aliveRef.current || controller.signal.aborted) return;
      const dto = parseEstimate(raw);
      const ctx = contextFrom(req);
      const built = dto && buildEstimateView(dto, prices, ctx);
      // A malformed response, or one with nothing trustworthy left in it, is a
      // failed estimate: the previous one stays (AC-5.1, AC-5.5).
      if (!dto || !built) {
        setError(dto ? 'Every line in that estimate was implausible, so none is shown. Try again.' : messageFor(null));
        return;
      }
      logTotalDiscrepancy(dto.notes, built.total); // never shown — see estimate.ts
      setResult({ dto, ctx, orderQuantity: req.engine.orderQuantity });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (aliveRef.current && !controller.signal.aborted) setError(messageFor(err));
    } finally {
      if (aliveRef.current && abortRef.current === controller) setBusy(false);
    }
  }

  const money = (n: number) => `${currency}${n.toFixed(2)}`;
  const priceField = (key: EstimatePriceKey, label: string) => (
    <label className="block">
      <span className="input-label flex items-center justify-between">
        <span>{label} <span className="font-normal text-ink-muted">{currency} {units[key]}</span></span>
        {placeholder[key] && <span className="text-[9px] uppercase tracking-wide text-ink-muted">placeholder</span>}
      </span>
      <input
        type="number"
        min={0}
        step="0.01"
        value={typed[key] ?? ''}
        placeholder={String(prices[key])}
        aria-label={`${label} price`}
        onChange={(e) => {
          const v = e.target.value === '' ? null : Number(e.target.value);
          setPrice(key, v !== null && Number.isFinite(v) && v >= 0 ? v : null);
        }}
        className="input-field py-1.5 font-mono text-[12px]"
      />
    </label>
  );

  return (
    <details className="group px-4 py-4">
      <summary className="section-header flex cursor-pointer list-none items-center justify-between">
        Cost estimate
        {view?.demoMode && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">demo mode</span>
        )}
      </summary>

      <div className="mt-3 space-y-3">
        {/* AC-4.4: always visible, not a footnote. */}
        <p className="rounded-lg bg-[#F0EFEB] px-2.5 py-1.5 text-[11px] text-ink-secondary">
          Planning aid, not a quote. Quantities for tiles and floor area come from the layout; everything else is estimated.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <div>
            {priceField('tile', 'Tile')}
            <div className="mt-1 grid grid-cols-2 gap-1">
              {(['area', 'tile'] as const).map((u) => (
                <button key={u} onClick={() => setTileUnit(u)} className={`seg py-0.5 text-[10px] ${tileUnit === u ? 'seg-active' : 'seg-idle'}`}>
                  {u === 'tile' ? 'per tile' : system === 'imperial' ? 'per ft²' : 'per m²'}
                </button>
              ))}
            </div>
          </div>
          {priceField('labour', 'Labour')}
          {priceField('adhesive', 'Adhesive')}
          {priceField('grout', 'Grout')}
        </div>
        <label className="flex items-center gap-2 text-[11px] text-ink-secondary">
          Currency
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency symbol" className="rounded border border-hairline bg-[#F7F6F3] px-1.5 py-0.5 text-[12px]">
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <span className="text-[10px] text-ink-muted">display only — nothing is converted</span>
        </label>

        <button onClick={() => void estimate()} disabled={busy || blocked !== null} title={blocked ?? undefined} className="btn-primary w-full py-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? 'Estimating…' : result ? 'Re-estimate' : 'Estimate materials'}
        </button>
        {blocked && !loading && <p className="text-[10px] text-ink-muted">{blocked}</p>}
        {error && <div className="rounded-lg bg-red-50 px-2.5 py-2 text-[11px] text-red-700">{error}{view && ' The previous estimate is kept below.'}</div>}
        {stale && view && (
          <div className="rounded-lg bg-amber-100 px-2.5 py-1.5 text-[11px] text-amber-900">The layout has changed since this estimate. Re-estimate to update it.</div>
        )}

        {view && (
          <div className="space-y-2" aria-label="Estimate">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-[10px] text-ink-muted">
                  <th className="pb-1 font-medium">Item</th>
                  <th className="pb-1 text-right font-medium">Qty</th>
                  <th className="pb-1 pl-1 font-medium">Unit</th>
                  <th className="pb-1 text-right font-medium">Unit cost</th>
                  <th className="pb-1 text-right font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {view.lines.map((l, i) => (
                  <tr key={i} className="border-t border-hairline align-top">
                    <td className="py-1 pr-1">
                      <div className="flex items-center gap-1 text-ink">
                        {l.item}
                        {/* AC-4.5: which numbers are computed, which are judged. */}
                        {l.source === 'engine' ? (
                          <span title="Quantity from the layout engine" className="rounded bg-ink px-1 text-[9px] font-medium text-white">engine</span>
                        ) : (
                          <span title="Quantity estimated by the model" className="rounded border border-hairline px-1 text-[9px] text-ink-muted">est.</span>
                        )}
                      </div>
                      <div className="text-[10px] leading-snug text-ink-muted">{l.basis}</div>
                    </td>
                    <td className="py-1 text-right font-mono">{l.quantity}</td>
                    <td className="py-1 pl-1">{l.unit}</td>
                    <td className="py-1 text-right font-mono" title={l.perArea !== undefined ? `${money(l.perArea)} ${units.tile}` : l.priced === 'model' ? 'Placeholder from the estimate' : 'Your price'}>
                      {money(l.unitCost)}{l.priced === 'model' && <span className="text-ink-muted">*</span>}
                    </td>
                    <td className="py-1 text-right font-mono">{money(l.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-ink/30">
                  <td colSpan={4} className="pt-1.5 font-semibold text-ink">Total</td>
                  <td className="pt-1.5 text-right font-mono font-semibold text-ink" aria-label="Estimate total">{money(view.total)}</td>
                </tr>
              </tfoot>
            </table>
            {view.lines.some((l) => l.priced === 'model') && (
              <p className="text-[10px] text-ink-muted">* placeholder unit cost from the estimate — set your own price above where you can.</p>
            )}
            {/* AC-5.2: a silently dropped line is how a wrong total hides. */}
            {view.dropped.length > 0 && (
              <p className="text-[10px] text-amber-800" title={view.dropped.map((d) => `${d.line.item || 'Unnamed'}: ${d.reason}`).join('\n')}>
                {view.dropped.length === 1 ? '1 line was' : `${view.dropped.length} lines were`} discarded as implausible.
              </p>
            )}
            {view.assumptions.length > 0 && (
              <div>
                <div className="text-[10px] font-medium text-ink-secondary">Assumptions</div>
                <ul className="ml-4 list-disc text-[10px] leading-snug text-ink-muted">
                  {view.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}
            <p className="text-[10px] text-ink-muted">
              Confidence <span className="font-mono text-ink">{Math.round(view.confidence * 100)}%</span>
              {view.confidence < LOW_CONFIDENCE && <span className="ml-1 font-medium text-amber-800">— low: treat these quantities as a rough guide.</span>}
            </p>
          </div>
        )}
      </div>
    </details>
  );
}
