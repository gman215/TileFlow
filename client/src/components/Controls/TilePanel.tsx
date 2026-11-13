import React from 'react';
import { useTileFlowStore } from '../../store/tileFlowStore';
import {
  generateTiles,
  basketweaveBlock,
  toMM,
  type PatternType,
  type TilePolygon,
} from '@tileflow/geometry';
import { groutDisplay, tileDisplay } from '../../utils/measurements';
import DimensionField from './DimensionField';
import { productKey, parseBoxSize, boxArea } from '../../utils/boxes';

export const PATTERNS: { value: PatternType; label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'checkerboard', label: 'Checkerboard' },
  { value: 'offset-1/2', label: '½ Offset' },
  { value: 'offset-1/3', label: '⅓ Offset' },
  { value: 'offset-1/4', label: '¼ Offset' },
  { value: 'herringbone', label: 'Herringbone' },
  { value: 'basketweave', label: 'Basketweave' },
  { value: 'diagonal-45', label: '45° Diagonal' },
  { value: 'hexagon', label: 'Hexagon' },
];

/**
 * ANSI A108.02: tiles with a side over 18 in → running bond at most 33 % (013 R3).
 * Rows stagger along the tile's width, so it applies when the width is that
 * long side — 24 × 12 laid ↔. Laid ↕, a ½ offset staggers the short side and
 * long edges never slide past each other.
 */
export const LONG_TILE_MM = 18 * 25.4;
export function overOffsetWarning(t: { width: number; height: number; pattern: PatternType }): boolean {
  return t.pattern === 'offset-1/2' && t.width > LONG_TILE_MM + 0.01 && t.width >= t.height;
}

/** Basketweave fits when long + g = k × (short + g), within 5 % — the herringbone test's tolerance. */
export function basketweaveMismatch(t: { width: number; height: number; grout: number; pattern: PatternType }): boolean {
  if (t.pattern !== 'basketweave') return false;
  const { L, S, k } = basketweaveBlock({ ...t });
  return Math.abs(L - k * S) > S * 0.05 || L / S < 1.5;
}


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

    const polys = React.useMemo<TilePolygon[]>(
      () =>
        generateTiles({
          // w = 2h + g so the herringbone and basketweave previews fit exactly;
          // squares for the checkerboard, a small hexagon for the hexagon.
          tileConfig:
            pattern === 'hexagon'
              ? { width: 10, height: 10, grout: 1, pattern }
              : pattern === 'checkerboard'
                ? { width: 8, height: 8, grout: 1, pattern }
                : { width: 17, height: 8, grout: 1, pattern },
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
        <rect width={VIEW_W} height={VIEW_H} fill={active ? '#1B1B19' : '#E6E4DF'} />
        {polys.map((p, i) => (
          <polygon
            key={i}
            points={p.vertices.map((v) => `${v.x},${v.y}`).join(' ')}
            fill={p.variant === 1 ? (active ? '#4E7299' : '#6B6963') : active ? '#8FB3D9' : '#9A9892'}
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
  const hexagon = tileConfig.pattern === 'hexagon';
  const weaveMismatch = basketweaveMismatch(tileConfig);
  const longTile = overOffsetWarning(tileConfig);

  return (
    <div className="px-4 py-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="section-header">
          <span className="step">2</span>Tile
        </h3>
        <span className="text-[10px] text-ink-muted">sizes in {presetUnitLabel}</span>
      </div>

      {/* Quick size presets */}
      <div className="flex flex-wrap gap-1">
        {sizePresets.map(({ label, w, h }) => (
          <button
            key={label}
            onClick={() => setTileSizeMM(w, h)}
            className={`seg px-2 py-1 text-[11px] font-mono ${
              isPresetActive(w, h) ? 'seg-active' : 'seg-idle'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Size — a hexagon has one: across the flats (013 AC-1.4) */}
      {hexagon ? (
        <DimensionField
          label="Across flats"
          mm={tileConfig.width}
          unit={tileFmt.unit}
          imperialFormat={tileFmt.imperialFormat}
          onChangeMM={(wMM) => setTileSizeMM(wMM, wMM)}
          minMM={10}
          stepMM={imperial ? toMM(1, 'inches') : 10}
          title="Hexagon size, measured flat side to flat side"
        />
      ) : (
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
      )}

      <BoxField />

      {/* Tile orientation — swaps W/H (e.g. 12×24 ↔ 24×12) */}
      {!hexagon && (
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold text-ink-muted w-10 shrink-0">
          Lay
        </span>
        <button
          onClick={() => setTileOrientation('horizontal')}
          title="Landscape — long side runs horizontally (e.g. 24 × 12 in)"
          className={`seg flex-1 py-1.5 text-xs ${
            isLandscape ? 'seg-active' : 'seg-idle'
          }`}
        >
          ↔ Horizontal
        </button>
        <button
          onClick={() => setTileOrientation('vertical')}
          title="Portrait — long side runs vertically (e.g. 12 × 24 in)"
          className={`seg flex-1 py-1.5 text-xs ${
            !isLandscape ? 'seg-active' : 'seg-idle'
          }`}
        >
          ↕ Vertical
        </button>
      </div>
      )}

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
              className={`seg px-1.5 py-1 text-[10px] font-mono ${
                approx(tileConfig.grout, mm) ? 'seg-active' : 'seg-idle'
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
              className={`seg p-1.5 text-left ${active ? 'seg-active' : 'seg-idle'}`}
            >
              <PatternPreview pattern={value} active={active} />
              <span
                className={`block mt-1 text-[11px] font-medium ${
                  active ? 'text-white' : 'text-[#57554F]'
                }`}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {herringboneMismatch && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-50 p-2 space-y-1.5">
          <p className="text-[11px] text-amber-800 leading-snug">
            Herringbone only fits exactly with 2:1 tiles (length = 2 × width,
            including grout). Other sizes will show gaps or drifting joints.
          </p>
          <button
            onClick={() => setTileSizeMM(herringbonePreset.w, herringbonePreset.h)}
            className="px-2 py-1 text-[11px] font-medium rounded-lg bg-amber-100
                       text-amber-900 hover:bg-amber-200 transition-colors"
          >
            Use {herringbonePreset.label}
          </button>
        </div>
      )}

      {weaveMismatch && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-50 p-2 space-y-1.5">
          <p className="text-[11px] text-amber-800 leading-snug">
            Basketweave fits when the tile's length is two (or three) widths, grout included —
            a 2:1 or 3:1 tile. This size will leave gaps between the blocks.
          </p>
          <button
            onClick={() => setTileSizeMM(herringbonePreset.w, herringbonePreset.h)}
            className="px-2 py-1 text-[11px] font-medium rounded-lg bg-amber-100 text-amber-900 hover:bg-amber-200 transition-colors"
          >
            Use {herringbonePreset.label}
          </button>
        </div>
      )}

      {longTile && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-50 p-2 space-y-1.5" role="note" aria-label="33 percent offset rule">
          <p className="text-[11px] text-amber-800 leading-snug">
            <span className="font-semibold">Tiles over 18 in: offset at most 33 %.</span> ANSI A108.02
            recommends it for tiles with a side over 18 in (457 mm) — warpage makes a ½ offset meet
            the high centre of one tile with the low end of the next (lippage). A ½ offset needs the
            maker's approval and a mock-up.
          </p>
          <div className="flex gap-1.5">
            <button onClick={() => setPattern('offset-1/3')} className="px-2 py-1 text-[11px] font-medium rounded-lg bg-amber-100 text-amber-900 hover:bg-amber-200 transition-colors">
              Use ⅓ offset
            </button>
            <button onClick={() => setPattern('offset-1/4')} className="px-2 py-1 text-[11px] font-medium rounded-lg bg-amber-100 text-amber-900 hover:bg-amber-200 transition-colors">
              Use ¼ offset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Tolerant comparison for mm values that originate from unit conversion. */
function approx(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.5;
}

/**
 * 012 AC-3.1 — pieces per box for this tile size. Takes a count, or the area
 * printed on the box (`15.5 ft²`), which is turned into pieces from the tile
 * size and said so. Empty clears it.
 */
function BoxField() {
  const tileConfig = useTileFlowStore((s) => s.tileConfig);
  const system = useTileFlowStore((s) => s.system);
  const key = productKey(tileConfig);
  const perBox = useTileFlowStore((s) => s.boxSizes[key]);
  const setBoxSize = useTileFlowStore((s) => s.setBoxSize);
  const shown = perBox ? String(perBox) : '';
  const [text, setText] = React.useState(shown);
  const [note, setNote] = React.useState<string | null>(null);
  React.useEffect(() => setText(shown), [shown]);

  const commit = () => {
    if (text.trim() === '') {
      setBoxSize(key, null);
      setNote(null);
      return;
    }
    const parsed = parseBoxSize(text, tileConfig);
    if (!parsed) {
      setNote(system === 'metric' ? 'Pieces (8) or area per box (1.44 m²)' : 'Pieces (8) or area per box (15.5 ft²)');
      setText(shown);
      return;
    }
    setBoxSize(key, parsed.pieces);
    setText(String(parsed.pieces));
    setNote(parsed.fromArea ? `${text.trim()} = ${parsed.pieces} pieces (rounded)` : null);
  };

  return (
    <div className="space-y-0.5">
      <div
        title="How many tiles come in a box — or type the area on the box (15.5 ft², 1.44 m²)"
        className="flex items-center bg-[#F7F6F3] border border-hairline rounded-lg focus-within:border-accent focus-within:ring-1 focus-within:ring-accent transition-colors"
      >
        <span className="pl-2.5 pr-1.5 text-[10px] font-semibold text-ink-muted select-none shrink-0">Per box</span>
        <input
          type="text"
          aria-label="Tiles per box"
          value={text}
          placeholder="optional"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') {
              setText(shown);
              setNote(null);
              e.currentTarget.blur();
            }
          }}
          spellCheck={false}
          className="w-full min-w-0 bg-transparent py-1.5 font-mono text-sm text-ink outline-none placeholder:font-sans placeholder:text-[11px] placeholder:text-ink-muted/70"
        />
        <span className="pr-2.5 pl-1 text-[10px] text-ink-muted select-none shrink-0">
          {perBox ? `pcs · ${boxArea(perBox, tileConfig, system === 'metric')}` : 'pcs'}
        </span>
      </div>
      {note && <p className="px-1 text-[10px] text-ink-muted">{note}</p>}
    </div>
  );
}
