import React from 'react';
import { useTileFlowStore } from '../../store/tileFlowStore';
import {
  generateTiles,
  toMM,
  type AlignmentMode,
  type PatternType,
  type Polygon,
} from '@tileflow/geometry';
import { groutDisplay, tileDisplay } from '../../utils/measurements';
import DimensionField from './DimensionField';

const PATTERNS: { value: PatternType; label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'offset-1/2', label: '½ Offset' },
  { value: 'offset-1/3', label: '⅓ Offset' },
  { value: 'herringbone', label: 'Herringbone' },
  { value: 'diagonal-45', label: '45° Diagonal' },
];

const ALIGNMENTS: { value: AlignmentMode; label: string; title: string }[] = [
  { value: 'optimize', label: 'Auto', title: 'Optimize offset to minimize waste' },
  { value: 'center-tile', label: 'Center tile', title: 'Center a full tile on the room' },
  { value: 'center-grout', label: 'Center joint', title: 'Run a grout joint through the room center' },
];

interface SizePreset {
  label: string;
  w: number;
  h: number;
}

/** Industry-standard US tile sizes (inches → mm). */
const IMPERIAL_PRESETS: SizePreset[] = [
  { label: '12×12', w: toMM(12, 'inches'), h: toMM(12, 'inches') },
  { label: '12×24', w: toMM(12, 'inches'), h: toMM(24, 'inches') },
  { label: '24×24', w: toMM(24, 'inches'), h: toMM(24, 'inches') },
  { label: '3×6', w: toMM(3, 'inches'), h: toMM(6, 'inches') }, // subway
  { label: '6×24', w: toMM(6, 'inches'), h: toMM(24, 'inches') }, // plank
];

/** Common metric tile sizes (cm → mm). */
const METRIC_PRESETS: SizePreset[] = [
  { label: '30×30', w: 300, h: 300 },
  { label: '60×60', w: 600, h: 600 },
  { label: '60×30', w: 600, h: 300 },
  { label: '7.5×15', w: 75, h: 150 }, // subway
  { label: '20×120', w: 200, h: 1200 }, // plank
];

/** Standard grout joint widths. */
const IMPERIAL_GROUT: { label: string; mm: number }[] = [
  { label: '1/16″', mm: toMM(1 / 16, 'inches') },
  { label: '1/8″', mm: toMM(1 / 8, 'inches') },
  { label: '3/16″', mm: toMM(3 / 16, 'inches') },
  { label: '1/4″', mm: toMM(1 / 4, 'inches') },
];

const METRIC_GROUT: { label: string; mm: number }[] = [
  { label: '1.5', mm: 1.5 },
  { label: '3', mm: 3 },
  { label: '5', mm: 5 },
  { label: '8', mm: 8 },
];

/**
 * Miniature pattern preview rendered with the real geometry engine,
 * so what you pick is exactly what gets laid out.
 */
const PatternPreview = React.memo(
  ({ pattern, active }: { pattern: PatternType; active: boolean }) => {
    const VIEW_W = 64;
    const VIEW_H = 36;

    const polys = React.useMemo<Polygon[]>(
      () =>
        generateTiles({
          // w = 2h + g so the herringbone preview fits exactly
          tileConfig: { width: 17, height: 8, grout: 1, pattern },
          areaWidth: VIEW_W,
          areaHeight: VIEW_H,
          offsetX: pattern === 'diagonal-45' ? 0 : -4,
          offsetY: -2,
        }),
      [pattern]
    );

    return (
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full h-9 rounded-sm"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <rect width={VIEW_W} height={VIEW_H} fill={active ? '#1e3a8a' : '#111827'} />
        {polys.map((p, i) => (
          <polygon
            key={i}
            points={p.vertices.map((v) => `${v.x},${v.y}`).join(' ')}
            fill={active ? '#93c5fd' : '#4b5563'}
          />
        ))}
      </svg>
    );
  }
);

PatternPreview.displayName = 'PatternPreview';

export default function TilePanel() {
  const tileConfig = useTileFlowStore((s) => s.tileConfig);
  const system = useTileFlowStore((s) => s.system);
  const setTileSizeMM = useTileFlowStore((s) => s.setTileSizeMM);
  const setGroutMM = useTileFlowStore((s) => s.setGroutMM);
  const setPattern = useTileFlowStore((s) => s.setPattern);
  const setTileOrientation = useTileFlowStore((s) => s.setTileOrientation);
  const alignment = useTileFlowStore((s) => s.alignment);
  const setAlignment = useTileFlowStore((s) => s.setAlignment);

  const imperial = system === 'imperial';
  const tileFmt = tileDisplay(system);
  const groutFmt = groutDisplay(system);
  const sizePresets = imperial ? IMPERIAL_PRESETS : METRIC_PRESETS;
  const groutPresets = imperial ? IMPERIAL_GROUT : METRIC_GROUT;
  const presetUnitLabel = imperial ? 'in' : 'cm';

  const isPresetActive = (w: number, h: number) =>
    (approx(tileConfig.width, w) && approx(tileConfig.height, h)) ||
    (approx(tileConfig.width, h) && approx(tileConfig.height, w));

  // Herringbone fits exactly only when effective length = 2 × effective width.
  const effLong = Math.max(tileConfig.width, tileConfig.height) + tileConfig.grout;
  const effShort = Math.min(tileConfig.width, tileConfig.height) + tileConfig.grout;
  const herringboneMismatch =
    tileConfig.pattern === 'herringbone' &&
    Math.abs(effLong - 2 * effShort) > effShort * 0.05;

  // Suggested 2:1 herringbone size matching the active system.
  const herringbonePreset = imperial
    ? { label: '12 × 24 in', w: toMM(12, 'inches'), h: toMM(24, 'inches') }
    : { label: '60 × 30 cm', w: 600, h: 300 };

  const isLandscape = tileConfig.width >= tileConfig.height;

  return (
    <div className="panel space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          Tile
        </h3>
        <span className="text-[10px] text-gray-600">sizes in {presetUnitLabel}</span>
      </div>

      {/* Quick size presets */}
      <div className="flex flex-wrap gap-1">
        {sizePresets.map(({ label, w, h }) => (
          <button
            key={label}
            onClick={() => setTileSizeMM(w, h)}
            className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
              isPresetActive(w, h)
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Size */}
      <div className="flex items-center gap-1.5">
        <DimensionField
          label="W"
          mm={tileConfig.width}
          unit={tileFmt.unit}
          imperialFormat={tileFmt.imperialFormat}
          onChangeMM={(wMM) => setTileSizeMM(wMM, tileConfig.height)}
          minMM={10}
          stepMM={imperial ? toMM(1, 'inches') : 10}
          className="flex-1"
          title="Tile width"
        />
        <DimensionField
          label="H"
          mm={tileConfig.height}
          unit={tileFmt.unit}
          imperialFormat={tileFmt.imperialFormat}
          onChangeMM={(hMM) => setTileSizeMM(tileConfig.width, hMM)}
          minMM={10}
          stepMM={imperial ? toMM(1, 'inches') : 10}
          className="flex-1"
          title="Tile height"
        />
      </div>

      {/* Tile orientation — swaps W/H (e.g. 12×24 ↔ 24×12) */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider w-10 shrink-0">
          Lay
        </span>
        <button
          onClick={() => setTileOrientation('horizontal')}
          title="Landscape — long side runs horizontally (e.g. 24 × 12 in)"
          className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
            isLandscape
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          ↔ Horizontal
        </button>
        <button
          onClick={() => setTileOrientation('vertical')}
          title="Portrait — long side runs vertically (e.g. 12 × 24 in)"
          className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
            !isLandscape
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          ↕ Vertical
        </button>
      </div>

      {/* Grout */}
      <div className="flex items-center gap-1.5">
        <DimensionField
          label="Grout"
          mm={tileConfig.grout}
          unit={groutFmt.unit}
          imperialFormat={groutFmt.imperialFormat}
          onChangeMM={setGroutMM}
          minMM={0}
          stepMM={imperial ? toMM(1 / 16, 'inches') : 0.5}
          className="flex-1"
          title="Grout joint width"
        />
        <div className="flex gap-1">
          {groutPresets.map(({ label, mm }) => (
            <button
              key={label}
              onClick={() => setGroutMM(mm)}
              className={`px-1.5 py-1 text-[10px] font-medium rounded transition-colors ${
                approx(tileConfig.grout, mm)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Pattern */}
      <div className="grid grid-cols-2 gap-1.5">
        {PATTERNS.map(({ value, label }) => {
          const active = tileConfig.pattern === value;
          return (
            <button
              key={value}
              onClick={() => setPattern(value)}
              className={`p-1.5 rounded border text-left transition-colors ${
                active
                  ? 'border-blue-500 bg-blue-600/20'
                  : 'border-gray-800 bg-gray-800/60 hover:border-gray-600'
              }`}
            >
              <PatternPreview pattern={value} active={active} />
              <span
                className={`block mt-1 text-[11px] font-medium ${
                  active ? 'text-blue-300' : 'text-gray-400'
                }`}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Alignment within the room */}
      <div className="space-y-1">
        <label className="input-label">Alignment</label>
        <div className="grid grid-cols-3 gap-1">
          {ALIGNMENTS.map(({ value, label, title }) => (
            <button
              key={value}
              onClick={() => setAlignment(value)}
              title={title}
              className={`py-1.5 text-[11px] font-medium rounded transition-colors ${
                alignment === value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {alignment !== 'optimize' && (
          <p className="text-[10px] text-gray-500">
            Fixed alignment — the optimizer is paused while centering.
          </p>
        )}
      </div>

      {herringboneMismatch && (
        <div className="rounded border border-amber-600/40 bg-amber-500/10 p-2 space-y-1.5">
          <p className="text-[11px] text-amber-300 leading-snug">
            Herringbone only fits exactly with 2:1 tiles (length = 2 × width,
            including grout). Other sizes will show gaps or drifting joints.
          </p>
          <button
            onClick={() => setTileSizeMM(herringbonePreset.w, herringbonePreset.h)}
            className="px-2 py-1 text-[11px] font-medium rounded bg-amber-500/20
                       text-amber-200 hover:bg-amber-500/30 transition-colors"
          >
            Use {herringbonePreset.label}
          </button>
        </div>
      )}
    </div>
  );
}

/** Tolerant comparison for mm values that originate from unit conversion. */
function approx(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.5;
}
