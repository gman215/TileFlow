import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  setOutLines,
  toLayoutRoom,
  groupFrame,
  pointInPolygon,
  type LayoutResult,
  type Polygon,
  type Room,
  type TileConfig,
  type AlignmentMode,
  type Vec2,
  type SetOut,
  type PatternFrame,
} from '@tileflow/geometry';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { settingsOf, tileTotals } from '../../store/planHelpers';
import { describeAnchor } from '../../api/ai';
import { colourTiles, layoutOrder, orderQuantity, rowOrders, COLOUR_NAMES } from '../../utils/order';
import { PATTERNS, overOffsetWarning } from '../Controls/TilePanel';
import { ALIGNMENTS } from '../Controls/OptimizationPanel';
import { buildCutList, cutLength, cutKindText, pieceKey, type CutList } from '../../hooks/useCutList';
import { boxesForOrders, productBoxes, productKey } from '../../utils/boxes';
import {
  formatArea,
  formatImperialFeetInches,
  formatWithUnit,
  groutDisplay,
  tileDisplay,
  type MeasurementSystem,
} from '../../utils/measurements';
import { Markdown } from '../AI/markdown';

/**
 * 012 R2 — the set-out sheet: what an installer takes to the job. A preview
 * over the app, printed (or saved as PDF) by the browser. Everything on it is
 * the engine's: the tiles, the cut list (`cutPieces`/`groupCuts`), the start
 * lines (`setOutLines`), the counts; this component lays them out on paper.
 */

const PAPER = {
  metric: { name: 'A4 landscape', w: 297, h: 210 },
  imperial: { name: 'letter landscape', w: 279.4, h: 215.9 },
} as const;
const PAD = 9; // mm
const SIDE = 82; // mm — the right-hand column
/** Most cut rows the first page tries; fewer when the side column would overflow. */
const FIRST_PAGE_ROWS = 18;
const MORE_ROWS = 34; // per column, two columns on a continuation page

interface SheetRoom {
  id: string;
  name: string;
  room: Room;
  tileConfig: TileConfig;
  alignment: AlignmentMode;
  layout: LayoutResult;
  setOut: SetOut;
  /** What the drawing outlines and dimensions: the finish faces in a plan */
  walls: Polygon;
  cuts: CutList;
  anchorText: string | null;
  referenceWall: boolean;
  grouped: boolean;
  brief: string | null;
  handMoved: boolean;
}

/** Set-out distances: whole mm, or feet and inches to 1/16. */
function setOutLength(mm: number, system: MeasurementSystem): string {
  return system === 'metric' ? `${Math.round(mm).toLocaleString('en-US').replace(/,/g, ' ')} mm` : formatImperialFeetInches(mm / 25.4);
}

/** Which way a direction points on the page (y down). */
function sideWord(v: Vec2): string {
  return Math.abs(v.x) > Math.abs(v.y) ? (v.x > 0 ? 'right' : 'left') : v.y > 0 ? 'bottom' : 'top';
}

const shift = (p: Polygon, d: Vec2): Polygon => ({ vertices: p.vertices.map((v) => ({ x: v.x - d.x, y: v.y - d.y })) });
const rectPoly = (w: number, h: number): Polygon => ({
  vertices: [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ],
});
const pts = (p: Polygon) => p.vertices.map((v) => `${v.x},${v.y}`).join(' ');

function useSheetRooms(): { rooms: SheetRoom[]; projectName: string; isPlan: boolean } {
  // Only what the sheet reads, so an unrelated store change (a hover, a
  // notice) does not re-measure every room.
  const system = useTileFlowStore((s) => s.system);
  const manualOffsets = useTileFlowStore((s) => s.manualOffsets);
  const lastBrief = useTileFlowStore((s) => s.lastBrief);
  const planSel = useTileFlowStore((s) => s.plan);
  const derivedSel = useTileFlowStore((s) => s.derived);
  const layout = useTileFlowStore((s) => s.layout);
  const room = useTileFlowStore((s) => s.room);
  const tileConfig = useTileFlowStore((s) => s.tileConfig);
  const alignment = useTileFlowStore((s) => s.alignment);
  const projectName = useTileFlowStore((s) => s.projectName);
  const roomLayouts = useTileFlowStore((s) => s.roomLayouts);
  const activeRoomId = useTileFlowStore((s) => s.activeRoomId);
  return useMemo(() => {
    const s = { system, manualOffsets, lastBrief, plan: planSel, derived: derivedSel, layout, room, tileConfig, alignment, projectName, roomLayouts, activeRoomId };
    const sys = s.system as MeasurementSystem;
    const handMoved = Object.keys(s.manualOffsets).length > 0;
    const briefFor = (layout: LayoutResult) => (s.lastBrief && s.lastBrief.layout === layout ? s.lastBrief.text : null);

    if (!s.plan || !s.derived) {
      if (!s.layout) return { rooms: [], projectName: s.projectName, isPlan: false };
      const room = s.room;
      return {
        projectName: s.projectName,
        isPlan: false,
        rooms: [
          {
            id: 'room',
            name: 'Floor',
            room,
            tileConfig: s.tileConfig,
            alignment: s.alignment,
            layout: s.layout,
            setOut: setOutLines(room, s.tileConfig, s.layout),
            walls: room.shape?.boundary ?? rectPoly(room.width, room.height),
            cuts: buildCutList(s.layout, s.tileConfig, sys),
            anchorText: describeAnchor(room, sys, 0),
            referenceWall: room.shape?.referenceWall != null,
            grouped: false,
            brief: briefFor(s.layout),
            handMoved,
          },
        ],
      };
    }

    const plan = s.plan;
    const derived = s.derived;
    const rooms: SheetRoom[] = [];
    for (const r of plan.rooms) {
      const d = derived.rooms.get(r.id);
      const layout = s.roomLayouts[r.id];
      const lr = d ? toLayoutRoom(d, r) : null;
      if (!d || !lr || !layout || d.status !== 'ok') continue;
      const settings = settingsOf(plan, r);
      const group = r.groupId ? plan.groups.find((g) => g.id === r.groupId) : undefined;
      let frame: PatternFrame | undefined;
      if (group) {
        const f = groupFrame(plan, group, derived.rooms);
        if (f) frame = { origin: { x: f.origin.x - lr.origin.x, y: f.origin.y - lr.origin.y }, angle: f.angle };
      }
      // Distances are taken to the finish faces: the tiled edge sits an
      // expansion gap inside them, under the baseboard.
      const walls = d.finishBoundary ? shift(d.finishBoundary, lr.origin) : lr.room.shape?.boundary ?? rectPoly(lr.room.width, lr.room.height);
      const islands = d.holes.length - r.holes.length;
      rooms.push({
        id: r.id,
        name: r.name,
        room: lr.room,
        tileConfig: settings.tileConfig,
        alignment: settings.alignment,
        layout,
        setOut: setOutLines(lr.room, settings.tileConfig, layout, frame, walls),
        walls,
        cuts: buildCutList(layout, settings.tileConfig, sys),
        anchorText: group ? null : describeAnchor(lr.room, sys, islands),
        referenceWall: group ? Boolean(group.referenceWallId) : lr.room.shape?.referenceWall != null,
        grouped: Boolean(group),
        brief: r.id === s.activeRoomId ? briefFor(layout) : null,
        handMoved: handMoved && r.id === s.activeRoomId,
      });
    }
    return { rooms, projectName: s.projectName, isPlan: true };
  }, [system, manualOffsets, lastBrief, planSel, derivedSel, layout, room, tileConfig, alignment, projectName, roomLayouts, activeRoomId]);
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function Drawing({ r, system, boxW, boxH }: { r: SheetRoom; system: MeasurementSystem; boxW: number; boxH: number }) {
  const xs = r.walls.vertices.map((v) => v.x);
  const ys = r.walls.vertices.map((v) => v.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  const m = Math.max(w, h) * 0.1;
  const vbW = w + 2 * m, vbH = h + 2 * m;
  // Printed mm per layout mm — text is sized for the paper, not the room.
  const k = Math.min(boxW / vbW, boxH / vbH);
  const fs = 2.6 / k;
  const minLabel = 1.5 / k;
  const hair = 0.15 / k;

  // Wall lengths, outside each wall, kept upright.
  const walls = r.walls.vertices.map((a, i) => {
    const b = r.walls.vertices[(i + 1) % r.walls.vertices.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < fs * 4) return null;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    if (pointInPolygon({ x: mid.x + n.x * fs * 0.5, y: mid.y + n.y * fs * 0.5 }, r.walls)) n = { x: -n.x, y: -n.y };
    let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg <= -90) deg += 180;
    const at = { x: mid.x + n.x * fs * 1.3, y: mid.y + n.y * fs * 1.3 };
    return (
      <text
        key={i}
        x={at.x}
        y={at.y}
        fontSize={fs}
        textAnchor="middle"
        dominantBaseline="middle"
        transform={`rotate(${deg} ${at.x} ${at.y})`}
        fill="#44403c"
        stroke="#fff"
        strokeWidth={fs * 0.35}
        paintOrder="stroke"
      >
        {setOutLength(len, system)}
      </text>
    );
  });

  // Start lines with their distances to the walls (AC-2.3).
  const lines = r.setOut.lines.map((l, i) => {
    // Past the wall-length labels (at 1.3 fs), so a marker never sits on one.
    const ext = fs * 3;
    const from = { x: l.from.x - l.dir.x * ext, y: l.from.y - l.dir.y * ext };
    const to = { x: l.to.x + l.dir.x * ext, y: l.to.y + l.dir.y * ext };
    // Where along the line its dimension sits: A's near one end, B's near the
    // other, so the two never cross in the middle of the room.
    const t = i === 0 ? 0.12 : 0.88;
    const base = { x: l.from.x + (l.to.x - l.from.x) * t, y: l.from.y + (l.to.y - l.from.y) * t };
    const neg = { x: base.x - l.normal.x * l.toNeg, y: base.y - l.normal.y * l.toNeg };
    const pos = { x: base.x + l.normal.x * l.toPos, y: base.y + l.normal.y * l.toPos };
    const dimText = (p: Vec2, q: Vec2, mm: number, key: string) => {
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      let deg = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
      if (deg > 90) deg -= 180;
      if (deg <= -90) deg += 180;
      const off = { x: l.dir.x * fs * 0.8, y: l.dir.y * fs * 0.8 };
      return (
        <text
          key={key}
          x={mid.x + off.x}
          y={mid.y + off.y}
          fontSize={fs * 0.9}
          fontWeight={600}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#b91c1c"
          stroke="#fff"
          strokeWidth={fs * 0.25}
          paintOrder="stroke"
          transform={`rotate(${deg} ${mid.x + off.x} ${mid.y + off.y})`}
        >
          {setOutLength(mm, system)}
        </text>
      );
    };
    const tick = (p: Vec2, key: string) => (
      <line
        key={key}
        x1={p.x - l.dir.x * fs * 0.5}
        y1={p.y - l.dir.y * fs * 0.5}
        x2={p.x + l.dir.x * fs * 0.5}
        y2={p.y + l.dir.y * fs * 0.5}
        stroke="#b91c1c"
        strokeWidth={hair * 2}
      />
    );
    return (
      <g key={l.id}>
        <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#dc2626" strokeWidth={hair * 3} strokeDasharray={`${fs * 0.8} ${fs * 0.4}`} />
        <line x1={neg.x} y1={neg.y} x2={pos.x} y2={pos.y} stroke="#b91c1c" strokeWidth={hair * 1.5} />
        {tick(neg, 'tn')}
        {tick(pos, 'tp')}
        {l.toNeg > fs * 3 && dimText(base, neg, l.toNeg, 'dn')}
        {l.toPos > fs * 3 && dimText(base, pos, l.toPos, 'dp')}
        {[from, to].map((p, j) => (
          <g key={j}>
            <circle cx={p.x} cy={p.y} r={fs * 0.75} fill="#dc2626" />
            <text x={p.x} y={p.y} fontSize={fs} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="#fff">
              {l.id}
            </text>
          </g>
        ))}
      </g>
    );
  });

  // Scale bar: 1 m / 3 ft, or half that for a small room.
  const big = Math.max(w, h) > 2500;
  const bar = system === 'metric' ? (big ? 1000 : 500) : big ? 914.4 : 304.8;
  const barLabel = system === 'metric' ? (big ? '1 m' : '50 cm') : big ? '3 ft' : '1 ft';
  const bx = minX - m * 0.6;
  const by = maxY + m * 0.75;

  const p = r.setOut.point;
  return (
    <svg
      viewBox={`${minX - m} ${minY - m} ${vbW} ${vbH}`}
      width={`${vbW * k}mm`}
      height={`${vbH * k}mm`}
      style={{ display: 'block', margin: '0 auto' }}
      aria-label={`${r.name} layout drawing`}
    >
      <defs>
        <pattern id={`hatch-${r.id}`} width={fs} height={fs} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={fs} stroke="#a8a29e" strokeWidth={hair * 2} />
        </pattern>
      </defs>
      <polygon points={pts(r.walls)} fill="#fafaf9" />
      {r.layout.tiles.map((t) => {
        const polys = t.pieces?.length ? t.pieces : [t.clipped];
        return polys.map((poly, j) => (
          <polygon
            key={`${t.id}:${j}`}
            points={pts(poly)}
            fill={t.variant === 1 ? (t.isFull ? '#a8a29e' : '#d6a26f') : t.isFull ? '#f5f5f4' : '#fde7c8'}
            stroke="#a8a29e"
            strokeWidth={hair * 2}
          />
        ));
      })}
      {r.room.shape?.holes.map((hole, i) => (
        <polygon key={`h${i}`} points={pts(hole)} fill={`url(#hatch-${r.id})`} stroke="#57534e" strokeWidth={hair * 4} />
      ))}
      <polygon points={pts(r.walls)} fill="none" stroke="#1c1917" strokeWidth={hair * 6} />
      {/* Cut letters, the drawer's and the table's */}
      {r.cuts.groups.flatMap((g) =>
        g.pieces.map((pc) => {
          const size = Math.max(minLabel, Math.min(pc.labelSize * 0.7, fs * 1.1));
          return (
            <text
              key={pieceKey(pc.tileId, pc.piece)}
              x={pc.labelAt.x}
              y={pc.labelAt.y}
              fontSize={size}
              fontWeight={700}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#7c2d12"
            >
              {g.label}
            </text>
          );
        })
      )}
      {lines}
      <g>
        <circle cx={p.x} cy={p.y} r={fs * 0.55} fill="none" stroke="#1d4ed8" strokeWidth={hair * 4} />
        <line x1={p.x - fs} y1={p.y} x2={p.x + fs} y2={p.y} stroke="#1d4ed8" strokeWidth={hair * 3} />
        <line x1={p.x} y1={p.y - fs} x2={p.x} y2={p.y + fs} stroke="#1d4ed8" strokeWidth={hair * 3} />
      </g>
      {walls}
      <g>
        <rect x={bx} y={by - fs * 0.25} width={bar / 2} height={fs * 0.5} fill="#1c1917" />
        <rect x={bx + bar / 2} y={by - fs * 0.25} width={bar / 2} height={fs * 0.5} fill="#fff" stroke="#1c1917" strokeWidth={hair * 2} />
        <text x={bx + bar + fs * 0.6} y={by} fontSize={fs * 0.85} dominantBaseline="middle" fill="#44403c">
          {barLabel}
        </text>
      </g>
    </svg>
  );
}

// ─── Tables ───────────────────────────────────────────────────────────────────

const th: React.CSSProperties = { textAlign: 'left', fontWeight: 600, color: '#78716c', fontSize: '6.5pt', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0.6mm 1mm' };
const td: React.CSSProperties = { padding: '0.55mm 1mm', borderTop: '0.2mm solid #e7e5e4', fontSize: '8pt', verticalAlign: 'top' };
const mono: React.CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };
const h3: React.CSSProperties = { fontSize: '8.5pt', fontWeight: 700, margin: '2.5mm 0 1mm' };

function CutTable({ groups, system }: { groups: CutList['groups']; system: MeasurementSystem }) {
  const coloured = groups.some((g) => g.variant !== undefined);
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={th}></th>
          {coloured && <th style={th}>Colour</th>}
          <th style={th}>Size ({system === 'metric' ? 'mm' : 'in'})</th>
          <th style={th}>Cut</th>
          <th style={{ ...th, textAlign: 'right' }}>Pcs</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <tr key={g.label}>
            <td style={{ ...td, ...mono, fontWeight: 700, color: '#9a3412' }}>{g.label}</td>
            {coloured && <td style={td}>{COLOUR_NAMES[g.variant ?? 0]}</td>}
            <td style={{ ...td, ...mono, whiteSpace: 'nowrap' }}>
              {cutLength(g.width, system)} × {cutLength(g.height, system)}
            </td>
            <td style={{ ...td, color: '#57534e' }}>{cutKindText(g, system)}</td>
            <td style={{ ...td, ...mono, textAlign: 'right' }}>{g.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <tr>
      <td style={{ ...td, color: '#78716c', width: '27mm' }}>{k}</td>
      <td style={td}>{v}</td>
    </tr>
  );
}

// ─── Pages ────────────────────────────────────────────────────────────────────

function Header({ title, projectName, page }: { title: string; projectName: string; page: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: '0.4mm solid #1c1917', paddingBottom: '1.5mm', marginBottom: '3mm' }}>
      <div>
        <span style={{ fontSize: '13pt', fontWeight: 700 }}>{title}</span>
        <span style={{ fontSize: '9pt', color: '#78716c', marginLeft: '3mm' }}>{projectName}</span>
      </div>
      <div style={{ fontSize: '7.5pt', color: '#78716c' }}>
        {new Date().toLocaleDateString()} · TileFlow · {page}
      </div>
    </div>
  );
}

function RoomPage({
  r,
  system,
  paper,
  projectName,
  boxSizes,
  isPlan,
}: {
  r: SheetRoom;
  system: MeasurementSystem;
  paper: { w: number; h: number };
  projectName: string;
  boxSizes: Record<string, number>;
  isPlan: boolean;
}) {
  const tile = tileDisplay(system);
  const total = r.layout.fullTileCount + r.layout.cutTileCount;
  const colourOrders = colourTiles(r.layout).map(orderQuantity);
  const order = layoutOrder(r.layout);
  const perBox = boxSizes[productKey(r.tileConfig)];
  const box = boxesForOrders(colourOrders, perBox);
  const hexagon = r.tileConfig.pattern === 'hexagon';
  const longTile = overOffsetWarning(r.tileConfig);
  // Rows that fit beside the drawing depend on what else is in the column —
  // colours, boxes, a warning, a long anchor, wrapped notch text — so the
  // column is measured and rows move to the continuation page until it fits.
  const sideRef = useRef<HTMLDivElement>(null);
  const [firstRows, setFirstRows] = useState(FIRST_PAGE_ROWS);
  // A new layout starts from the full budget again.
  useLayoutEffect(() => setFirstRows(FIRST_PAGE_ROWS), [r.layout]);
  useLayoutEffect(() => {
    const el = sideRef.current;
    if (el && firstRows > 0 && el.scrollHeight > el.clientHeight + 1) setFirstRows((n) => n - 1);
  });
  const first = r.cuts.groups.slice(0, firstRows);
  const rest = r.cuts.groups.slice(firstRows);
  const more: CutList['groups'][] = [];
  for (let i = 0; i < rest.length; i += MORE_ROWS * 2) more.push(rest.slice(i, i + MORE_ROWS * 2));

  const pattern = PATTERNS.find((p) => p.value === r.tileConfig.pattern)?.label ?? r.tileConfig.pattern;
  const alignment = ALIGNMENTS.find((a) => a.value === r.alignment)?.label ?? r.alignment;
  const from = r.grouped
    ? 'the pattern group (grout lines run on through the linked rooms)'
    : r.anchorText ??
      (r.alignment === 'optimize'
        ? r.referenceWall
          ? 'least-waste position, square to the reference wall'
          : 'least-waste position'
        : r.referenceWall
          ? 'the reference wall’s midpoint'
          : 'the room centre');
  const herring = r.setOut.lines.every((l) => !l.onJoint);
  const title = isPlan ? `Set-out sheet — ${r.name}` : 'Set-out sheet';
  const pageStyle: React.CSSProperties = { width: `${paper.w}mm`, height: `${paper.h}mm`, padding: `${PAD}mm`, boxSizing: 'border-box' };
  const bodyH = paper.h - 2 * PAD - 12 - 7;
  const drawW = paper.w - 2 * PAD - SIDE - 5;

  return (
    <>
      <section className="sheet-page" style={pageStyle}>
        <Header title={title} projectName={projectName} page={r.name} />
        <div style={{ display: 'flex', gap: '5mm', height: `${bodyH}mm` }}>
          <div style={{ width: `${drawW}mm`, display: 'flex', alignItems: 'center' }}>
            <Drawing r={r} system={system} boxW={drawW} boxH={bodyH} />
          </div>
          <div ref={sideRef} style={{ width: `${SIDE}mm`, fontSize: '8pt', height: `${bodyH}mm`, overflow: 'hidden' }}>
            <div style={{ ...h3, marginTop: 0 }}>Layout</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <Row k="Floor area" v={formatArea(r.layout.roomArea, system)} />
                <Row
                  k="Tile"
                  v={
                    hexagon
                      ? `${formatWithUnit(r.tileConfig.width, tile)} hexagon, across the flats`
                      : `${formatWithUnit(r.tileConfig.width, tile)} × ${formatWithUnit(r.tileConfig.height, tile)}`
                  }
                />
                <Row k="Grout" v={formatWithUnit(r.tileConfig.grout, groutDisplay(system))} />
                <Row k="Pattern" v={pattern} />
                <Row k="Alignment" v={alignment} />
                <Row k="Set out from" v={from} />
                {longTile && (
                  <Row
                    k="Warning"
                    v={<b style={{ color: '#b91c1c' }}>½ offset on a tile over 18 in — ANSI A108.02 recommends at most 33 %; confirm with the maker and a mock-up.</b>}
                  />
                )}
              </tbody>
            </table>

            <div style={h3}>Start lines</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {r.setOut.lines.map((l) => (
                  <tr key={l.id}>
                    <td style={{ ...td, width: '6mm' }}>
                      <span style={{ display: 'inline-block', width: '4mm', height: '4mm', lineHeight: '4mm', borderRadius: '50%', background: '#dc2626', color: '#fff', textAlign: 'center', fontWeight: 700, fontSize: '7pt' }}>
                        {l.id}
                      </span>
                    </td>
                    <td style={td}>
                      <span style={mono}>{setOutLength(l.toNeg, system)}</span> from the {sideWord({ x: -l.normal.x, y: -l.normal.y })} wall ·{' '}
                      <span style={mono}>{setOutLength(l.toPos, system)}</span> from the {sideWord(l.normal)} wall
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: '6.8pt', color: '#78716c', margin: '1mm 0 0' }}>
              {herring
                ? `${hexagon ? 'Hexagons have' : 'Herringbone has'} no straight joint: snap A and B through the set-out point (blue) and set the ${hexagon ? 'first tile' : 'weave'} out from it.`
                : 'Both lines are grout-joint centres. Snap A, square B to it, and lay out from where they cross.'}{' '}
              Measured to the {isPlan ? 'finish face of the wall' : 'wall'}, square to the line.
            </p>

            <div style={h3}>Order</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <Row k="Tiles placed" v={`${total} (${r.layout.fullTileCount} full, ${r.layout.cutTileCount} cut)`} />
                <Row k="Order" v={<b>{order} tiles incl. 10 %</b>} />
                {colourOrders.length > 1 && (
                  <Row k="By colour" v={colourOrders.map((n, i) => `${COLOUR_NAMES[i]} ${n}`).join(' · ')} />
                )}
                {box && <Row k="Boxes" v={<b>{`${box.boxes} × ${perBox} = ${box.tiles} tiles`}</b>} />}
              </tbody>
            </table>

            <div style={h3}>
              Cut list <span style={{ fontWeight: 400, color: '#78716c' }}>· {r.cuts.pieces} pieces from {r.cuts.tiles} tiles, to {r.cuts.precision}</span>
            </div>
            {r.cuts.groups.length === 0 ? <p style={{ color: '#78716c' }}>No cuts — every tile is full.</p> : <CutTable groups={first} system={system} />}
            {rest.length > 0 && <p style={{ fontSize: '7pt', color: '#78716c', margin: '1mm 0 0' }}>Continued on the next page ({rest.length} more sizes).</p>}
          </div>
        </div>
        <div style={{ fontSize: '6.8pt', color: '#78716c', marginTop: '2mm', display: 'flex', justifyContent: 'space-between' }}>
          <span>
            Every figure is from the layout engine. Check dimensions on site before cutting.
            {r.handMoved && <b style={{ color: '#b91c1c' }}> Tiles moved by hand on screen are not shown — this is the computed layout.</b>}
          </span>
          <span>Sizes along the tile’s width × height. Each cut uses a whole tile.</span>
        </div>
      </section>

      {more.map((chunk, i) => (
        <section key={i} className="sheet-page" style={pageStyle}>
          <Header title={`${title} — cut list (continued)`} projectName={projectName} page={r.name} />
          <div style={{ display: 'flex', gap: '8mm' }}>
            <div style={{ flex: 1 }}>
              <CutTable groups={chunk.slice(0, MORE_ROWS)} system={system} />
            </div>
            <div style={{ flex: 1 }}>{chunk.length > MORE_ROWS && <CutTable groups={chunk.slice(MORE_ROWS)} system={system} />}</div>
          </div>
        </section>
      ))}

      {r.brief && (
        <section className="sheet-page sheet-flow" style={{ ...pageStyle, minHeight: `${paper.h}mm` }}>
          <Header title={`${title} — installation brief`} projectName={projectName} page={r.name} />
          <div className="sheet-brief" style={{ columnCount: 2, columnGap: '8mm', fontSize: '8.5pt' }}>
            <Markdown source={r.brief} />
          </div>
        </section>
      )}
    </>
  );
}

function ProjectOrderPage({ paper, projectName, system }: { paper: { w: number; h: number }; projectName: string; system: MeasurementSystem }) {
  const plan = useTileFlowStore((s) => s.plan);
  const derived = useTileFlowStore((s) => s.derived);
  const roomLayouts = useTileFlowStore((s) => s.roomLayouts);
  const boxSizes = useTileFlowStore((s) => s.boxSizes);
  if (!plan) return null;
  const tile = tileDisplay(system);
  const rows = tileTotals(plan, derived, roomLayouts);
  const boxes = productBoxes(rows.map((t) => ({ tileConfig: t.tileConfig, orders: rowOrders(t) })), boxSizes);
  const size = (t: { width: number; height: number }) => `${formatWithUnit(t.width, tile)} × ${formatWithUnit(t.height, tile)}`;
  return (
    <section className="sheet-page" style={{ width: `${paper.w}mm`, height: `${paper.h}mm`, padding: `${PAD}mm`, boxSizing: 'border-box' }}>
      <Header title="Project order" projectName={projectName} page="All rooms" />
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Tile</th>
            <th style={th}>Pattern</th>
            <th style={th}>Rooms</th>
            <th style={{ ...th, textAlign: 'right' }}>Area</th>
            <th style={{ ...th, textAlign: 'right' }}>Placed</th>
            <th style={{ ...th, textAlign: 'right' }}>Cut</th>
            <th style={{ ...th, textAlign: 'right' }}>Order incl. 10 %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.key}>
              <td style={{ ...td, ...mono }}>{size(t.tileConfig)}</td>
              <td style={td}>{PATTERNS.find((p) => p.value === t.tileConfig.pattern)?.label ?? t.tileConfig.pattern}</td>
              <td style={td}>{t.rooms.join(', ')}</td>
              <td style={{ ...td, textAlign: 'right' }}>{formatArea(t.area, system)}</td>
              <td style={{ ...td, ...mono, textAlign: 'right' }}>{t.tiles}</td>
              <td style={{ ...td, ...mono, textAlign: 'right' }}>{t.cuts}</td>
              <td style={{ ...td, ...mono, textAlign: 'right', fontWeight: 700 }}>
                {rowOrders(t).length > 1 ? rowOrders(t).map((n, i) => `${COLOUR_NAMES[i]} ${n}`).join(' + ') : rowOrders(t)[0]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {boxes.length > 0 && (
        <>
          <div style={h3}>By the box</div>
          <table style={{ width: '60%', borderCollapse: 'collapse' }}>
            <tbody>
              {boxes.map((b) => (
                <Row
                  key={`${b.key}|${b.colour ?? ''}`}
                  k={size(b.tile) + (b.colour !== undefined ? ` ${COLOUR_NAMES[b.colour].toLowerCase()}` : '')}
                  v={<b>{`${b.boxes.boxes} boxes × ${b.perBox} = ${b.boxes.tiles} tiles (order ${b.order})`}</b>}
                />
              ))}
            </tbody>
          </table>
        </>
      )}
      <p style={{ fontSize: '7pt', color: '#78716c', marginTop: '4mm' }}>
        {boxes.length > 0
          ? 'Boxes are counted on the combined order of every room using that tile.'
          : 'Enter the pieces per box in the Tile step to order by the box.'}{' '}
        Each room’s set-out sheet has its own cut list.
      </p>
    </section>
  );
}

export default function SetOutSheet({ onClose }: { onClose: () => void }) {
  const system = useTileFlowStore((s) => s.system) as MeasurementSystem;
  const boxSizes = useTileFlowStore((s) => s.boxSizes);
  const { rooms, projectName, isPlan } = useSheetRooms();
  const paper = PAPER[system];

  // While the sheet is up, the app's single-key shortcuts must not fire
  // underneath it; Esc closes. Ctrl/⌘ combos (print, zoom) pass through.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="print-root fixed inset-0 z-[100] overflow-auto bg-[#3f3f46]" role="dialog" aria-label="Set-out sheet">
      <style>{`@page { size: ${paper.name}; margin: 0; }`}</style>
      <div className="print-chrome sticky top-0 z-10 flex items-center gap-3 bg-[#27272a] px-4 py-2 text-white shadow">
        <span className="text-[13px] font-semibold">Set-out sheet</span>
        <span className="text-[11px] text-white/55">
          {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'} · {system === 'metric' ? 'A4' : 'US Letter'} landscape
        </span>
        <button
          onClick={() => window.print()}
          disabled={rooms.length === 0}
          className="ml-auto rounded-md bg-white px-3 py-1 text-[12px] font-semibold text-[#18181b] hover:bg-white/90 disabled:opacity-40"
        >
          Print / Save PDF
        </button>
        <button onClick={onClose} aria-label="Close set-out sheet" className="rounded px-2 text-[18px] text-white/60 hover:text-white">
          ×
        </button>
      </div>
      <div className="sheet-stack flex flex-col items-center gap-6 p-6">
        {rooms.length === 0 ? (
          <p className="text-white/70">No tiled room to print yet.</p>
        ) : (
          <>
            {rooms.map((r) => (
              <RoomPage key={r.id} r={r} system={system} paper={paper} projectName={projectName} boxSizes={boxSizes} isPlan={isPlan} />
            ))}
            {isPlan && <ProjectOrderPage paper={paper} projectName={projectName} system={system} />}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
