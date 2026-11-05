import React, { useMemo, useState } from 'react';
import type { LayerFunction, LocationLine, WallAssembly, WallLayer } from '@tileflow/geometry';
import { clearLength, totalThickness, wallLength } from '@tileflow/geometry';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { formatDisplayFromMM, groutDisplay, roomDisplay } from '../../utils/measurements';
import DimensionField from './DimensionField';
import { LOCATION_LINES } from './PlanPanel';
import { WallFramingSection } from './WallFraming';
import InfoTip from './InfoTip';

const FUNCTIONS: { value: LayerFunction; label: string }[] = [
  { value: 'finish', label: 'Finish' },
  { value: 'substrate', label: 'Substrate' },
  { value: 'core', label: 'Core (studs)' },
  { value: 'sheathing', label: 'Sheathing' },
  { value: 'air', label: 'Air gap' },
];

/**
 * The selected wall: what it is built from, which plane was drawn, and its
 * lengths — on the drawn line and clear on each side, any of which can be
 * retyped.
 */
export default function WallPanel() {
  const plan = useTileFlowStore((s) => s.plan);
  const system = useTileFlowStore((s) => s.system);
  const selectedWallId = useTileFlowStore((s) => s.selectedWallId);
  const selectWall = useTileFlowStore((s) => s.selectWall);
  const setWallAssembly = useTileFlowStore((s) => s.setWallAssembly);
  const setWallLocationLine = useTileFlowStore((s) => s.setWallLocationLine);
  const flipPlanWall = useTileFlowStore((s) => s.flipPlanWall);
  const setPlanWallLengthMM = useTileFlowStore((s) => s.setPlanWallLengthMM);
  const updateAssembly = useTileFlowStore((s) => s.updateAssembly);
  const saveAssemblyAs = useTileFlowStore((s) => s.saveAssemblyAs);
  const deletePlanWall = useTileFlowStore((s) => s.deletePlanWall);

  const [newName, setNewName] = useState('');

  const display = roomDisplay(system);
  const thick = groutDisplay(system);
  const fmtThick = (mm: number) => formatDisplayFromMM(mm, thick.unit, thick.imperialFormat);

  const wall = plan?.walls.find((w) => w.id === selectedWallId);
  const assembly = wall && plan?.assemblies.find((a) => a.id === wall.assemblyId);
  const lengths = useMemo(() => {
    if (!plan || !wall) return null;
    return {
      location: wallLength(plan, wall),
      left: clearLength(plan, wall.id, 'left'),
      right: clearLength(plan, wall.id, 'right'),
    };
  }, [plan, wall]);

  if (!plan || !wall || !assembly || !lengths) return null;

  const index = plan.walls.findIndex((w) => w.id === wall.id) + 1;
  const sharedBy = plan.walls.filter((w) => w.assemblyId === assembly.id).length;
  // Layers as they physically sit, left → right, after any flip.
  const shown = wall.flipped ? [...assembly.layers].reverse() : assembly.layers;
  const toStored = (i: number) => (wall.flipped ? assembly.layers.length - 1 - i : i);

  const editLayers = (layers: WallLayer[]) => updateAssembly({ ...assembly, layers } as WallAssembly);
  const setLayer = (shownIndex: number, patch: Partial<WallLayer>) => {
    const i = toStored(shownIndex);
    editLayers(assembly.layers.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  };
  const removeLayer = (shownIndex: number) => {
    const i = toStored(shownIndex);
    editLayers(assembly.layers.filter((_, k) => k !== i));
  };
  const moveLayer = (shownIndex: number, dir: -1 | 1) => {
    const i = toStored(shownIndex);
    const j = i + (wall.flipped ? -dir : dir);
    if (j < 0 || j >= assembly.layers.length) return;
    const next = [...assembly.layers];
    [next[i], next[j]] = [next[j], next[i]];
    editLayers(next);
  };

  const lengthRow = (label: string, mm: number, ref: 'location' | 'left' | 'right', title: string) => (
    <label className="flex items-center gap-2 text-[11px] text-ink-muted" title={title}>
      <span className="w-20 shrink-0">{label}</span>
      <DimensionField
        label=""
        mm={mm}
        unit={display.unit}
        imperialFormat={display.imperialFormat}
        onChangeMM={(v) => setPlanWallLengthMM(wall.id, v, ref)}
        minMM={10}
        className="flex-1"
      />
    </label>
  );

  return (
    <div className="px-4 py-4 space-y-3 border-l-4 border-amber-400 bg-amber-50/40">
      <div className="flex items-center justify-between">
        <h3 className="section-header">
          <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">Selected</span>
          Wall W{index}
        </h3>
        <button onClick={() => selectWall(null)} className="text-[12px] text-ink-muted hover:text-ink" title="Deselect">
          ×
        </button>
      </div>

      <select
        className="input-field py-1 text-[12px]"
        value={assembly.id}
        onChange={(e) => setWallAssembly(wall.id, e.target.value)}
      >
        {plan.assemblies.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} — {fmtThick(totalThickness(a))}
          </option>
        ))}
      </select>

      {/* Layer table, left → right */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-ink-muted">
          <span>Layers, left → right</span>
          <span className="font-mono">total {fmtThick(totalThickness(assembly))}</span>
        </div>
        {shown.map((l, i) => (
          <div key={i} className={`flex items-center gap-1 rounded-md px-1 py-0.5 ${l.function === 'core' ? 'bg-[#E8E5DE]' : 'bg-[#F0EFEB]'}`}>
            <input
              className="w-0 flex-1 bg-transparent text-[11px] text-ink outline-none"
              value={l.material}
              onChange={(e) => setLayer(i, { material: e.target.value.slice(0, 60) })}
              title="Material"
            />
            <select
              className="bg-transparent text-[10px] text-ink-muted outline-none"
              value={l.function}
              onChange={(e) => setLayer(i, { function: e.target.value as LayerFunction })}
            >
              {FUNCTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <DimensionField
              label=""
              mm={l.thickness}
              unit={thick.unit}
              imperialFormat={thick.imperialFormat}
              onChangeMM={(mm) => setLayer(i, { thickness: mm })}
              minMM={0}
              className="w-20"
            />
            <button onClick={() => moveLayer(i, -1)} className="text-[10px] text-ink-muted hover:text-ink" title="Move left">
              ◂
            </button>
            <button onClick={() => moveLayer(i, 1)} className="text-[10px] text-ink-muted hover:text-ink" title="Move right">
              ▸
            </button>
            <button onClick={() => removeLayer(i)} className="text-[11px] text-ink-muted hover:text-red-600" title="Remove layer">
              ×
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            editLayers([...assembly.layers, { material: 'Drywall ½″', thickness: 12.7, function: 'finish' }])
          }
          className="text-[11px] text-ink-muted hover:text-ink"
        >
          + Add layer
        </button>
        {sharedBy > 1 && (
          <p className="text-[10px] text-ink-muted">Layer edits apply to all {sharedBy} walls using “{assembly.name}”.</p>
        )}
        <div className="flex gap-1">
          <input
            className="input-field flex-1 py-0.5 text-[11px]"
            placeholder="Save as new build-up…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            disabled={!newName.trim()}
            onClick={() => {
              saveAssemblyAs(wall.id, newName.trim().slice(0, 60));
              setNewName('');
            }}
            className="btn-secondary px-2 py-0.5 text-[11px] disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>

      <div className="flex gap-1.5">
        <InfoTip text="Which line of the wall is the one you drew: its middle, the stud face, or the drywall face on one side. Changing it never moves the wall." />
        <select
          className="input-field flex-1 py-1 text-[11px]"
          value={wall.locationLine}
          onChange={(e) => setWallLocationLine(wall.id, e.target.value as LocationLine)}
          title="Which plane of the wall the line is. Changing it does not move the wall."
        >
          {LOCATION_LINES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => flipPlanWall(wall.id)}
          className="btn-secondary px-2 py-1 text-[11px]"
          title="Swap the wall's sides — e.g. put the cement board toward the shower"
        >
          ⇋ Flip
        </button>
      </div>

      <div className="space-y-1">
        {lengthRow('Drawn line', lengths.location, 'location', 'Length on the location line')}
        {lengthRow('Clear, left', lengths.left, 'left', 'Finish face length on the left side — type a tape measurement')}
        {lengthRow('Clear, right', lengths.right, 'right', 'Finish face length on the right side — type a tape measurement')}
      </div>

      <WallFramingSection wallId={wall.id} />

      <button
        onClick={() => deletePlanWall(wall.id)}
        className="w-full rounded-lg px-2 py-1 text-[12px] text-ink-muted hover:bg-red-50 hover:text-red-600"
      >
        Delete wall (Del)
      </button>
    </div>
  );
}
