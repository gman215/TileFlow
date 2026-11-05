import React, { useMemo } from 'react';
import type { Polygon } from '@tileflow/geometry';
import { wallsOf, validateShape, summarizeShape, rectShape } from '@tileflow/geometry';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { formatDisplayFromMM, roomDisplay } from '../../utils/measurements';
import DimensionField from './DimensionField';
import PlanUpload from '../AI/PlanUpload';

const MM2_PER_M2 = 1_000_000;
const MM2_PER_FT2 = 92_903.04;

/** Cut-out area, for the list — the shape helpers work on whole outlines. */
function polygonAreaOf(poly: Polygon): number {
  const v = poly.vertices;
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const j = (i + 1) % v.length;
    sum += v[i].x * v[j].y - v[j].x * v[i].y;
  }
  return Math.abs(sum / 2);
}

/**
 * Room outline controls: draw it, read the walls off it, retype any wall.
 *
 * The wall table is the measured sketch — each row is a wall in drawing order
 * with the length an installer would read off a tape, and editing one keeps
 * the room square (see setWallLength in the geometry package).
 */
export default function ShapePanel() {
  const room = useTileFlowStore((s) => s.room);
  const system = useTileFlowStore((s) => s.system);
  const draft = useTileFlowStore((s) => s.draft);
  const selectedWall = useTileFlowStore((s) => s.selectedWall);
  const startDraw = useTileFlowStore((s) => s.startDraw);
  const cancelDraft = useTileFlowStore((s) => s.cancelDraft);
  const setSelectedWall = useTileFlowStore((s) => s.setSelectedWall);
  const setShapeWallLength = useTileFlowStore((s) => s.setShapeWallLength);
  const resetToRect = useTileFlowStore((s) => s.resetToRect);
  const deleteHole = useTileFlowStore((s) => s.deleteHole);
  const setReferenceWall = useTileFlowStore((s) => s.setReferenceWall);
  const convertToPlan = useTileFlowStore((s) => s.convertToPlan);

  const display = roomDisplay(system);
  const imperial = system === 'imperial';
  const drawing = draft !== null;

  const shape = room.shape;
  const walls = useMemo(
    () => (shape ? wallsOf(shape.boundary) : []),
    [shape]
  );
  const issues = useMemo(() => (shape ? validateShape(shape) : []), [shape]);
  const summary = useMemo(
    () => summarizeShape(shape ?? rectShape(room.width, room.height)),
    [shape, room.width, room.height]
  );

  const areaText = imperial
    ? `${(summary.area / MM2_PER_FT2).toFixed(1)} ft²`
    : `${(summary.area / MM2_PER_M2).toFixed(2)} m²`;

  return (
    <div className="px-4 py-4 space-y-3">
      <h3 className="section-header">Room shape</h3>

      {/* What you can do, each with one line on what it is for */}
      {drawing ? (
        <button
          onClick={cancelDraft}
          className="w-full rounded-lg border border-hairline bg-amber-50 px-2 py-1.5
                     text-[12px] font-medium text-amber-700 hover:bg-amber-100 transition-colors"
        >
          Cancel drawing (Esc)
        </button>
      ) : (
        <div className="space-y-1">
          {[
            {
              label: shape ? 'Redraw shape' : 'Draw shape',
              key: 'D',
              blurb: 'Click corners on the canvas for an L-shape, bay or angled wall.',
              onClick: () => startDraw('boundary'),
            },
            {
              label: 'Add cut-out',
              key: 'C',
              blurb: "Mark an island, tub or column that isn't tiled.",
              onClick: () => startDraw('hole'),
            },
            {
              label: 'Make floor plan',
              key: '',
              blurb: 'Several rooms with real walls (studs, drywall), doors and a materials list.',
              onClick: convertToPlan,
            },
          ].map((a) => (
            <button
              key={a.label}
              onClick={a.onClick}
              title={a.key ? `${a.label} (${a.key})` : a.label}
              className="w-full rounded-lg border border-hairline px-2.5 py-1.5 text-left hover:bg-[#F7F6F3] transition-colors"
            >
              <div className="text-[12px] font-medium text-ink">
                {a.label}
                {a.key && <span className="ml-1.5 font-mono text-[10px] text-ink-muted">{a.key}</span>}
              </div>
              <div className="text-[11px] text-ink-muted">{a.blurb}</div>
            </button>
          ))}
        </div>
      )}

      {shape && !drawing && (
        <button
          onClick={resetToRect}
          className="w-full rounded-lg px-2 py-1.5 text-[12px] text-ink-muted
                     hover:text-ink hover:bg-hairline transition-colors"
          title="Discard the outline and go back to a plain rectangle"
        >
          Reset to rectangle
        </button>
      )}

      {/* Problems worth flagging before they tile it */}
      {issues.length > 0 && (
        <div className="rounded-lg bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
          {issues.map((issue, i) => (
            <div key={i}>{issue.message}</div>
          ))}
        </div>
      )}

      {/* Summary */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted">
        <span>
          Area <span className="font-mono text-ink">{areaText}</span>
        </span>
        <span>
          Perimeter{' '}
          <span className="font-mono text-ink">
            {formatDisplayFromMM(summary.perimeter, display.unit, display.imperialFormat)}
          </span>
        </span>
        <span>
          Walls <span className="font-mono text-ink">{summary.wallCount}</span>
        </span>
        {summary.holeCount > 0 && (
          <span>
            Cut-outs <span className="font-mono text-ink">{summary.holeCount}</span>
          </span>
        )}
      </div>

      {/* Cut-outs */}
      {shape && shape.holes.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-ink-muted">Cut-outs (not tiled)</div>
          {shape.holes.map((hole, i) => {
            const area = polygonAreaOf(hole);
            return (
              <div
                key={i}
                className="flex items-center justify-between rounded-md bg-[#F0EFEB] px-2 py-1"
              >
                <span className="text-[11px] text-ink-secondary">
                  #{i + 1} · {hole.vertices.length} corners ·{' '}
                  <span className="font-mono">
                    {imperial
                      ? `${(area / MM2_PER_FT2).toFixed(1)} ft²`
                      : `${(area / MM2_PER_M2).toFixed(2)} m²`}
                  </span>
                </span>
                <button
                  onClick={() => deleteHole(i)}
                  title="Remove this cut-out"
                  className="px-1 text-[12px] text-ink-muted hover:text-red-600 transition-colors"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Wall table */}
      {shape && walls.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-ink-muted">
            <span>Wall lengths</span>
            <span title="Square the layout to a wall with ⌗">
              {shape.referenceWall != null
                ? `squared to W${shape.referenceWall + 1}`
                : '⌗ squares the layout'}
            </span>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto pr-0.5">
            {walls.map((wall) => {
              const isLast = wall.index === walls.length - 1;
              const selected = selectedWall === wall.index;
              const isReference = shape.referenceWall === wall.index;
              return (
                <div
                  key={wall.index}
                  onMouseEnter={() => setSelectedWall(wall.index)}
                  onMouseLeave={() => selected && setSelectedWall(null)}
                  className={`flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors ${
                    selected ? 'bg-amber-50' : ''
                  }`}
                >
                  <span className="w-7 shrink-0 font-mono text-[11px] text-ink-muted">
                    W{wall.index + 1}
                  </span>
                  <DimensionField
                    label=""
                    mm={wall.length}
                    unit={display.unit}
                    imperialFormat={display.imperialFormat}
                    onChangeMM={(mm) => setShapeWallLength(wall.index, mm)}
                    minMM={10}
                    className="flex-1"
                    title={
                      imperial
                        ? 'Wall length — e.g. 12 ft 6 in'
                        : 'Wall length in metres'
                    }
                  />
                  <button
                    onClick={() =>
                      setReferenceWall(isReference ? null : wall.index)
                    }
                    title={
                      isReference
                        ? 'The layout is squared to this wall — click to clear'
                        : 'Square the tile layout to this wall'
                    }
                    className={`shrink-0 rounded px-1 text-[11px] transition-colors ${
                      isReference
                        ? 'text-green-600'
                        : 'text-ink-muted/50 hover:text-ink'
                    }`}
                  >
                    ⌗
                  </button>
                  {isLast && (
                    <span
                      className="shrink-0 text-[9px] text-ink-muted"
                      title="This wall closes the outline; it absorbs changes that cannot be taken up squarely"
                    >
                      closes
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Read an outline off a photo — the alternative to drawing one */}
      <details>
        <summary className="cursor-pointer text-[11px] font-medium text-ink-secondary hover:text-ink">
          Have a floor-plan photo? Let AI read it
        </summary>
        <div className="mt-2">
          <PlanUpload />
        </div>
      </details>

      <p className="text-[10px] text-ink-muted">
        {drawing
          ? 'Click each corner on the canvas. Type a length to place it exactly.'
          : shape
          ? 'Drag any corner on the canvas, or retype a wall length above.'
          : 'Draw the floor to handle L-shapes, bays and islands.'}
      </p>
    </div>
  );
}
