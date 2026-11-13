import React, { useMemo, useState } from 'react';
import type { LocationLine } from '@tileflow/geometry';
import { polygonArea, polygonPerimeter, totalThickness, IMPERIAL_ASSEMBLY_IDS, METRIC_ASSEMBLY_IDS } from '@tileflow/geometry';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { tileTotals } from '../../store/planHelpers';
import { productBoxes } from '../../utils/boxes';
import { formatDisplayFromMM, groutDisplay, roomDisplay, tileDisplay } from '../../utils/measurements';
import { orderQuantity } from '../../api/ai';
import DimensionField from './DimensionField';
import InfoTip from './InfoTip';

const MM2_PER_M2 = 1_000_000;
const MM2_PER_FT2 = 92_903.04;

export const LOCATION_LINES: { value: LocationLine; label: string }[] = [
  { value: 'centerline', label: 'Wall centreline' },
  { value: 'core-center', label: 'Core centreline' },
  { value: 'finish-left', label: 'Finish face — left' },
  { value: 'finish-right', label: 'Finish face — right' },
  { value: 'core-left', label: 'Stud face — left' },
  { value: 'core-right', label: 'Stud face — right' },
];

/**
 * The floor plan: tools for new walls, the rooms list, the active room's
 * dimensions and pattern group, and project totals across every room.
 *
 * Every figure here comes from the engine (derived floors, layout results);
 * the totals are sums of those, nothing estimated.
 */
export default function PlanPanel() {
  const plan = useTileFlowStore((s) => s.plan);
  const derived = useTileFlowStore((s) => s.derived);
  const system = useTileFlowStore((s) => s.system);
  const activeRoomId = useTileFlowStore((s) => s.activeRoomId);
  const roomLayouts = useTileFlowStore((s) => s.roomLayouts);
  const wallStyle = useTileFlowStore((s) => s.wallStyle);
  const setWallStyle = useTileFlowStore((s) => s.setWallStyle);
  const setActiveRoom = useTileFlowStore((s) => s.setActiveRoom);
  const renameRoom = useTileFlowStore((s) => s.renameRoom);
  const deletePlanRoom = useTileFlowStore((s) => s.deletePlanRoom);
  const setRoomExpansionGap = useTileFlowStore((s) => s.setRoomExpansionGap);
  const setRoomReferenceWall = useTileFlowStore((s) => s.setRoomReferenceWall);
  const continuePattern = useTileFlowStore((s) => s.continuePattern);
  const leavePatternGroup = useTileFlowStore((s) => s.leavePatternGroup);
  const draft = useTileFlowStore((s) => s.draft);
  const startDraw = useTileFlowStore((s) => s.startDraw);
  const cancelDraft = useTileFlowStore((s) => s.cancelDraft);
  const deleteHole = useTileFlowStore((s) => s.deleteHole);

  const [editingName, setEditingName] = useState<string | null>(null);

  const display = roomDisplay(system);
  const gapDisplay = groutDisplay(system);
  const tileDims = tileDisplay(system);
  const imperial = system === 'imperial';
  const fmt = (mm: number) => formatDisplayFromMM(mm, display.unit, display.imperialFormat);
  const area = (mm2: number) =>
    imperial ? `${(mm2 / MM2_PER_FT2).toFixed(1)} ft²` : `${(mm2 / MM2_PER_M2).toFixed(2)} m²`;

  const active = plan?.rooms.find((r) => r.id === activeRoomId);
  const activeDerived = active ? derived?.rooms.get(active.id) : undefined;
  const group = active?.groupId ? plan?.groups.find((g) => g.id === active.groupId) : undefined;

  // Assemblies, with the presets for this measurement system first.
  const assemblyOptions = useMemo(() => {
    if (!plan) return [];
    const preferred = imperial ? IMPERIAL_ASSEMBLY_IDS : METRIC_ASSEMBLY_IDS;
    return [...plan.assemblies].sort(
      (a, b) =>
        (preferred.includes(a.id) ? 0 : 1) - (preferred.includes(b.id) ? 0 : 1)
    );
  }, [plan, imperial]);

  /** Walls bounding the active room, in boundary order, for the ⌗ picker. */
  const boundingWalls = useMemo(() => {
    if (!activeDerived) return [];
    const seen = new Set<string>();
    return activeDerived.edgeWalls.filter((id): id is string => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [activeDerived]);

  // Order quantity applies the same buffer the Stats card uses.
  const totals = useMemo(
    () =>
      plan
        ? tileTotals(plan, derived, roomLayouts).map((t) => ({
            ...t,
            label: `${formatDisplayFromMM(t.tileConfig.width, tileDims.unit, tileDims.imperialFormat)} × ${formatDisplayFromMM(
              t.tileConfig.height,
              tileDims.unit,
              tileDims.imperialFormat
            )} · ${t.tileConfig.pattern}`,
          }))
        : [],
    [plan, derived, roomLayouts, tileDims.unit, tileDims.imperialFormat]
  );

  if (!plan || !derived) return null;

  const wallName = (id: string) => `W${plan.walls.findIndex((w) => w.id === id) + 1}`;
  const referenceWallId = group ? group.referenceWallId : active?.referenceWallId;
  const drawingHole = draft?.kind === 'hole';

  return (
    <div className="px-4 py-4 space-y-3">
      <h3 className="section-header">
        <span className="step">1</span>Floor plan
      </h3>

      {/* New walls */}
      <div className="space-y-1.5">
        <div className="text-[10px] text-ink-muted">
          New walls
          <InfoTip text="The build-up new walls get, and which line of the wall your clicks trace: its middle, the stud face, or the drywall face. Change any wall later by selecting it." />
        </div>
        <select
          className="input-field py-1 text-[12px]"
          value={wallStyle.assemblyId}
          onChange={(e) => setWallStyle({ assemblyId: e.target.value })}
        >
          {assemblyOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} — {formatDisplayFromMM(totalThickness(a), gapDisplay.unit, gapDisplay.imperialFormat)}
            </option>
          ))}
        </select>
        <select
          className="input-field py-1 text-[12px]"
          value={wallStyle.locationLine}
          onChange={(e) => setWallStyle({ locationLine: e.target.value as LocationLine })}
          title="Which plane of the wall your clicks draw"
        >
          {LOCATION_LINES.map((l) => (
            <option key={l.value} value={l.value}>
              Draw on: {l.label}
            </option>
          ))}
        </select>
      </div>

      {/* Rooms */}
      <div className="space-y-1">
        <div className="text-[10px] text-ink-muted">Rooms</div>
        {plan.rooms.length === 0 && (
          <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
            No rooms yet. Press <b>R</b> (Room) and drag a rectangle on the canvas — the walls and the
            room are made for you.
          </p>
        )}
        {plan.rooms.map((r) => {
          const d = derived.rooms.get(r.id);
          const isActive = r.id === activeRoomId;
          return (
            <div
              key={r.id}
              onClick={() => setActiveRoom(r.id)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 cursor-pointer transition-colors ${
                isActive ? 'bg-amber-50' : 'hover:bg-[#F0EFEB]'
              }`}
            >
              {editingName === r.id ? (
                <input
                  autoFocus
                  className="flex-1 rounded border border-hairline px-1 text-[12px]"
                  defaultValue={r.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    if (e.target.value.trim()) renameRoom(r.id, e.target.value.trim().slice(0, 60));
                    setEditingName(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditingName(null);
                  }}
                />
              ) : (
                <span
                  className="flex-1 truncate text-[12px] text-ink"
                  onDoubleClick={() => setEditingName(r.id)}
                  title="Double-click to rename"
                >
                  {r.name}
                  {r.groupId && <span className="ml-1 text-[10px] text-blue-500">⇄</span>}
                </span>
              )}
              <span className="font-mono text-[11px] text-ink-muted">
                {d?.status === 'ok' && d.finishBoundary ? (
                  area(polygonArea(d.finishBoundary))
                ) : (
                  <span className="text-red-600">{d?.status === 'redundant' ? 'redundant' : 'not enclosed'}</span>
                )}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deletePlanRoom(r.id);
                }}
                title="Delete this room (the walls stay)"
                className="px-1 text-[12px] text-ink-muted hover:text-red-600"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* Active room */}
      {active && activeDerived?.status === 'ok' && (
        <div className="space-y-2 rounded-lg border border-hairline px-2.5 py-2">
          <div className="text-[11px] font-medium text-ink">{active.name}</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
            <span className="text-ink-muted" title="Drywall face to drywall face">Inside</span>
            <span className="font-mono text-ink">
              {area(polygonArea(activeDerived.finishBoundary!))} · perim. {fmt(polygonPerimeter(activeDerived.finishBoundary!))}
            </span>
            {activeDerived.coreBoundary && (
              <>
                <span className="text-ink-muted" title="Stud face to stud face">Stud to stud</span>
                <span className="font-mono text-ink">{area(polygonArea(activeDerived.coreBoundary))}</span>
              </>
            )}
            {activeDerived.tileBoundary && (
              <>
                <span className="text-ink-muted" title="After the expansion gap and cut-outs">Tileable</span>
                <span className="font-mono text-ink">
                  {area(
                    Math.max(
                      0,
                      polygonArea(activeDerived.tileBoundary) -
                        activeDerived.holes.reduce((s, h) => s + polygonArea(h), 0)
                    )
                  )}
                </span>
              </>
            )}
          </div>

          <label className="flex items-center gap-2 text-[11px] text-ink-muted" title="Movement joint left at the walls, hidden under the baseboard">
            <span className="shrink-0">
              Expansion gap
              <InfoTip text="The gap left between the tile and the walls so the floor can move. It hides under the baseboard; ¼″ (6 mm) is typical." />
            </span>
            <DimensionField
              label=""
              mm={active.expansionGap}
              unit={gapDisplay.unit}
              imperialFormat={gapDisplay.imperialFormat}
              onChangeMM={(mm) => setRoomExpansionGap(active.id, mm)}
              minMM={0}
              className="flex-1"
            />
          </label>

          <label className="flex items-center gap-2 text-[11px] text-ink-muted">
            <span className="shrink-0">
              Square to
              <InfoTip text="Run the tile pattern parallel to this wall — usually the longest or most visible one." />
            </span>
            <select
              className="input-field flex-1 py-0.5 text-[11px]"
              value={referenceWallId ?? ''}
              onChange={(e) => setRoomReferenceWall(active.id, e.target.value || null)}
            >
              <option value="">{group ? 'Group centre' : 'Room centre'}</option>
              {boundingWalls.map((id) => (
                <option key={id} value={id}>
                  ⌗ {wallName(id)}
                </option>
              ))}
            </select>
          </label>

          {/* Pattern group */}
          {group ? (
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-blue-600">
                ⇄ Pattern continues with{' '}
                {group.roomIds
                  .filter((id) => id !== active.id)
                  .map((id) => plan.rooms.find((r) => r.id === id)?.name)
                  .join(', ')}
              </span>
              <button onClick={() => leavePatternGroup(active.id)} className="shrink-0 text-ink-muted hover:text-ink">
                Leave
              </button>
            </div>
          ) : (
            plan.rooms.length > 1 && (
              <select
                className="input-field py-0.5 text-[11px]"
                value=""
                onChange={(e) => e.target.value && continuePattern(e.target.value)}
                title="Tile two rooms as one floor: grout lines run straight from one into the next"
              >
                <option value="">Continue pattern into…</option>
                {plan.rooms
                  .filter((r) => r.id !== active.id)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            )
          )}

          {/* Cut-outs */}
          <div className="space-y-1">
            {drawingHole ? (
              <button onClick={cancelDraft} className="w-full rounded-lg border border-hairline bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                Cancel cut-out (Esc)
              </button>
            ) : (
              <button
                onClick={() => startDraw('hole')}
                className="w-full rounded-lg border border-hairline px-2 py-1 text-[11px] text-ink hover:bg-hairline"
                title="Draw an island, tub or column that is not tiled"
              >
                Add cut-out
              </button>
            )}
            {active.holes.map((h, i) => (
              <div key={i} className="flex items-center justify-between rounded-md bg-[#F0EFEB] px-2 py-0.5 text-[11px] text-ink-secondary">
                <span>
                  Cut-out #{i + 1} · <span className="font-mono">{area(polygonArea(h))}</span>
                </span>
                <button onClick={() => deleteHole(i)} className="px-1 text-ink-muted hover:text-red-600">
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Project totals */}
      {totals.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-ink-muted">Project totals (order incl. 10%)</div>
          {totals.map((t) => (
            <div key={t.label} className="rounded-md bg-[#F0EFEB] px-2 py-1 text-[11px]">
              <div className="flex justify-between text-ink">
                <span className="truncate">{t.label}</span>
                <span className="font-mono font-medium">{orderQuantity(t.tiles)}</span>
              </div>
              <div className="text-[10px] text-ink-muted">
                {t.rooms.join(', ')} · {t.tiles} tiles · {t.cuts} cut · {area(t.area)}
              </div>
            </div>
          ))}
          <ProjectBoxes rows={totals} fmt={(mm) => formatDisplayFromMM(mm, tileDims.unit, tileDims.imperialFormat)} />
        </div>
      )}

      {/* 002 photo-to-room is single-room only for now (AC-10.1) */}
      <p className="rounded-lg bg-[#F0EFEB] px-2.5 py-1.5 text-[10px] text-ink-muted">
        <span className="font-medium text-ink-secondary">Read a plan</span> — Floor-plan mode reads one
        room at a time — coming in a later spec.
      </p>
    </div>
  );
}

/** 012 AC-3.3 — boxes per tile product across the plan, on the combined order. */
function ProjectBoxes({
  rows,
  fmt,
}: {
  rows: { tileConfig: { width: number; height: number }; tiles: number }[];
  fmt: (mm: number) => string;
}) {
  const boxSizes = useTileFlowStore((s) => s.boxSizes);
  const products = productBoxes(
    rows.map((r) => ({ tileConfig: r.tileConfig, order: orderQuantity(r.tiles) })),
    boxSizes
  );
  if (products.length === 0) return null;
  return (
    <div className="space-y-0.5">
      {products.map((p) => (
        <div key={p.key} className="flex justify-between rounded-md bg-[#E8F0EC] px-2 py-1 text-[11px] text-ink">
          <span className="truncate">
            {fmt(p.tile.width)} × {fmt(p.tile.height)} · {p.perBox}/box
          </span>
          <span>
            <span className="font-mono font-medium">{p.boxes.boxes}</span> boxes{' '}
            <span className="text-[10px] text-ink-muted">({p.boxes.tiles} tiles)</span>
          </span>
        </div>
      ))}
    </div>
  );
}
