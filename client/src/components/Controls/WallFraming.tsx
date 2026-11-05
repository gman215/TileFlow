import React, { useMemo } from 'react';
import type { Opening } from '@tileflow/geometry';
import { frameWalls, resolveJunctions, MM_PER_INCH } from '@tileflow/geometry';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { formatDisplayFromMM, roomDisplay } from '../../utils/measurements';
import DimensionField from './DimensionField';

const SPACINGS_IMPERIAL = [16, 24].map((n) => ({ label: `${n}″ o.c.`, mm: n * MM_PER_INCH }));
const SPACINGS_METRIC = [400, 600].map((n) => ({ label: `${n} mm o.c.`, mm: n }));

const TRANSITIONS: { value: NonNullable<Opening['floorTransition']>; label: string }[] = [
  { value: 'centerline', label: 'Tile to wall centre (threshold)' },
  { value: 'through', label: 'Tile runs through from' },
  { value: 'room-side', label: 'Tile stops at the face in' },
];

/**
 * The selected wall's framing (009): height, spacing, layout, plates, bearing,
 * and its doors and windows. Every number shown — stud length, member counts —
 * is read off the framed wall the engine produced.
 */
export function WallFramingSection({ wallId }: { wallId: string }) {
  const plan = useTileFlowStore((s) => s.plan);
  const derived = useTileFlowStore((s) => s.derived);
  const system = useTileFlowStore((s) => s.system);
  const setWallFraming = useTileFlowStore((s) => s.setWallFraming);
  const addOpening = useTileFlowStore((s) => s.addOpening);
  const updateOpening = useTileFlowStore((s) => s.updateOpening);
  const deleteOpening = useTileFlowStore((s) => s.deleteOpening);
  const setElevationWall = useTileFlowStore((s) => s.setElevationWall);

  const display = roomDisplay(system);
  const fmt = (mm: number) => formatDisplayFromMM(mm, display.unit, display.imperialFormat);
  const framed = useMemo(() => (plan ? frameWalls(plan).find((f) => f.wallId === wallId) : undefined), [plan, wallId]);
  const wall = plan?.walls.find((w) => w.id === wallId);

  // Which room is on each side of this wall, so a doorway's floor choice can
  // name rooms rather than a "left" that depends on how the wall was drawn.
  const sideRooms = useMemo(() => {
    const out: Record<'left' | 'right', string> = { left: 'the left side', right: 'the right side' };
    if (!plan || !derived || !wall) return out;
    const a = plan.nodes.find((n) => n.id === wall.a)?.position;
    const b = plan.nodes.find((n) => n.id === wall.b)?.position;
    if (!a || !b) return out;
    for (const r of plan.rooms) {
      const d = derived.rooms.get(r.id);
      if (d?.status !== 'ok' || !d.labelPoint || !d.edgeWalls.includes(wall.id)) continue;
      const p = d.labelPoint;
      out[(b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) > 0 ? 'right' : 'left'] = r.name;
    }
    return out;
  }, [plan, derived, wall]);

  if (!plan || !wall) return null;

  if (!framed) {
    return <p className="text-[11px] text-ink-muted">This build-up has no stud core, so the wall is not framed.</p>;
  }

  const f = framed.framing;
  const spacings = system === 'metric' ? SPACINGS_METRIC : SPACINGS_IMPERIAL;
  const openings = plan.openings.filter((o) => o.wallId === wallId).sort((p, q) => p.center - q.center);
  const counts = framed.members.reduce<Record<string, number>>((acc, m) => {
    acc[m.kind] = (acc[m.kind] ?? 0) + 1;
    return acc;
  }, {});
  const studs = (counts.stud ?? 0) + (counts.corner ?? 0) + (counts.partition ?? 0);

  const field = (label: string, mm: number, onChange: (mm: number) => void, title?: string) => (
    <label className="flex items-center gap-2 text-[11px] text-ink-muted" title={title}>
      <span className="w-20 shrink-0">{label}</span>
      <DimensionField
        label=""
        mm={mm}
        unit={display.unit}
        imperialFormat={display.imperialFormat}
        onChangeMM={onChange}
        minMM={10}
        className="flex-1"
      />
    </label>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-ink-muted">Framing</span>
        <button onClick={() => setElevationWall(wallId)} className="text-[11px] font-medium text-ink hover:underline">
          Elevation ↗
        </button>
      </div>

      {field('Framed height', f.framedHeight, (mm) => setWallFraming(wallId, { framedHeight: mm }), 'Bottom of the bottom plate to the top of the top plate')}

      <div className="flex gap-1.5">
        <select
          className="input-field flex-1 py-0.5 text-[11px]"
          value={spacings.find((s) => Math.abs(s.mm - f.spacing) < 0.01)?.mm ?? ''}
          onChange={(e) => setWallFraming(wallId, { spacing: parseFloat(e.target.value) })}
        >
          {spacings.map((s) => (
            <option key={s.mm} value={s.mm}>
              {s.label}
            </option>
          ))}
          {!spacings.some((s) => Math.abs(s.mm - f.spacing) < 0.01) && <option value="">{fmt(f.spacing)} o.c.</option>}
        </select>
        <select
          className="input-field flex-1 py-0.5 text-[11px]"
          value={f.layoutFrom}
          onChange={(e) => setWallFraming(wallId, { layoutFrom: e.target.value as 'a' | 'b' })}
          title="The end the stud layout is measured from"
        >
          <option value="a">Layout from start</option>
          <option value="b">Layout from end</option>
        </select>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-ink-muted">
        <select
          className="input-field w-auto py-0.5 text-[11px]"
          value={f.topPlates}
          onChange={(e) => setWallFraming(wallId, { topPlates: parseInt(e.target.value, 10) as 1 | 2 })}
        >
          <option value={2}>Double top plate</option>
          <option value={1}>Single top plate</option>
        </select>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={f.loadBearing}
            onChange={(e) => setWallFraming(wallId, { loadBearing: e.target.checked })}
          />
          Load-bearing
        </label>
      </div>

      <div className="rounded-md bg-[#F0EFEB] px-2 py-1 text-[11px] text-ink-secondary">
        Stud <span className="font-mono">{fmt(framed.studLength)}</span> · plate{' '}
        <span className="font-mono">{fmt(framed.plateLength)}</span> · {studs} studs
        {counts.king ? ` · ${counts.king} kings · ${counts.jack} jacks` : ''}
        {counts.cripple ? ` · ${counts.cripple} cripples` : ''}
        {counts.block ? ` · ${counts.block} blocks` : ''}
      </div>

      {/* Openings */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-ink-muted">Openings (rough sizes)</span>
        <div className="flex gap-2">
          <button onClick={() => addOpening(wallId, 'door')} className="text-[11px] text-ink hover:underline">
            + Door
          </button>
          <button onClick={() => addOpening(wallId, 'window')} className="text-[11px] text-ink hover:underline">
            + Window
          </button>
        </div>
      </div>
      {openings.map((o) => {
        const issue = framed.issues.find((i) => i.openingId === o.id);
        return (
          <div key={o.id} className="space-y-1 rounded-md border border-hairline px-2 py-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <select
                className="bg-transparent text-[11px] font-medium text-ink outline-none"
                value={o.kind}
                onChange={(e) => updateOpening(o.id, { kind: e.target.value as Opening['kind'] })}
              >
                <option value="door">Door</option>
                <option value="cased-opening">Cased opening</option>
                <option value="window">Window</option>
              </select>
              <button onClick={() => deleteOpening(o.id)} className="text-ink-muted hover:text-red-600" title="Remove">
                ×
              </button>
            </div>
            {field('Centre at', o.center, (mm) => updateOpening(o.id, { center: mm }), 'Distance from the wall start to the middle of the opening')}
            {field('Width', o.roughWidth, (mm) => updateOpening(o.id, { roughWidth: mm }))}
            {field(o.kind === 'window' ? 'Head height' : 'Height', o.roughHeight, (mm) => updateOpening(o.id, { roughHeight: mm }), 'Floor to the underside of the header')}
            {o.kind === 'window' &&
              field('Sill height', o.sillHeight ?? 0, (mm) => updateOpening(o.id, { sillHeight: mm }), 'Floor to the bottom of the rough opening')}
            {o.kind !== 'window' && (
              <div className="flex gap-1">
                <select
                  className="input-field flex-1 py-0.5 text-[11px]"
                  value={o.floorTransition ?? 'centerline'}
                  onChange={(e) =>
                    updateOpening(o.id, {
                      floorTransition: e.target.value as Opening['floorTransition'],
                      side: o.side ?? 'left',
                    })
                  }
                >
                  {TRANSITIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {(o.floorTransition ?? 'centerline') !== 'centerline' && (
                  <select
                    className="input-field w-auto py-0.5 text-[11px]"
                    value={o.side ?? 'left'}
                    onChange={(e) => updateOpening(o.id, { side: e.target.value as 'left' | 'right' })}
                  >
                    <option value="left">{sideRooms.left}</option>
                    <option value="right">{sideRooms.right}</option>
                  </select>
                )}
              </div>
            )}
            {issue && <p className="text-[10px] text-red-600">{issue.message}</p>}
          </div>
        );
      })}
      {openings.length > 0 && (
        <p className="text-[10px] text-ink-muted">Planning estimate — not an engineered design.</p>
      )}
    </div>
  );
}

/**
 * A wall junction (009 R3): which wall's plates run through, and how the
 * corner or partition is backed.
 */
export function NodePanel() {
  const plan = useTileFlowStore((s) => s.plan);
  const nodeId = useTileFlowStore((s) => s.selectedNodeId);
  const selectNode = useTileFlowStore((s) => s.selectNode);
  const setJunction = useTileFlowStore((s) => s.setJunction);

  const junction = useMemo(() => (plan && nodeId ? resolveJunctions(plan).get(nodeId) : undefined), [plan, nodeId]);
  if (!plan || !nodeId) return null;
  const incident = plan.walls.filter((w) => w.a === nodeId || w.b === nodeId);
  const name = (id: string) => `W${plan.walls.findIndex((w) => w.id === id) + 1}`;

  return (
    <div className="px-4 py-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="section-header">Junction</h3>
        <button onClick={() => selectNode(null)} className="text-[12px] text-ink-muted hover:text-ink">
          ×
        </button>
      </div>
      {!junction ? (
        <p className="text-[11px] text-ink-muted">A free wall end — nothing meets here.</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-[11px] text-ink-muted">
            <span className="shrink-0">Runs through</span>
            <select
              className="input-field flex-1 py-0.5 text-[11px]"
              value={junction.through[0]}
              onChange={(e) => setJunction(nodeId, { throughWallId: e.target.value })}
            >
              {incident.map((w) => (
                <option key={w.id} value={w.id}>
                  {name(w.id)}
                  {junction.through.includes(w.id) && junction.through.length > 1 ? ' (straight run)' : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[10px] text-ink-muted">
            Butting: {junction.butts.map(name).join(', ') || '—'}
          </p>
          {junction.straightRun ? (
            <select
              className="input-field py-0.5 text-[11px]"
              value={junction.partition}
              onChange={(e) => setJunction(nodeId, { partition: e.target.value as 'post' | 'ladder' })}
            >
              <option value="post">Partition post (+2 studs)</option>
              <option value="ladder">Ladder blocking</option>
            </select>
          ) : (
            <select
              className="input-field py-0.5 text-[11px]"
              value={junction.corner}
              onChange={(e) => setJunction(nodeId, { corner: e.target.value as 'three-stud' | 'california' })}
            >
              <option value="three-stud">3-stud corner (+2 studs)</option>
              <option value="california">California corner (+1 stud)</option>
            </select>
          )}
        </>
      )}
    </div>
  );
}
