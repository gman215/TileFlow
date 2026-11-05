import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Rect, Line, Text, Group } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { FramingMember } from '@tileflow/geometry';
import { frameWalls, layoutMarks } from '@tileflow/geometry';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { formatDisplayFromMM, roomDisplay } from '../../utils/measurements';
import { snapGridMM } from '../../utils/snapping';

const BG = '#1B1A18';
const FILL: Record<FramingMember['kind'], string> = {
  stud: '#E3CFA3',
  corner: '#E3CFA3',
  partition: '#E3CFA3',
  king: '#D9BE86',
  jack: '#CFAE6E',
  cripple: '#E8D8B4',
  header: '#B8925A',
  sill: '#CFAE6E',
  'bottom-plate': '#C9A86F',
  'top-plate': '#C9A86F',
  block: '#D9BE86',
};
const EDGE = 'rgba(27,26,24,0.7)';
const LABEL = 'rgba(255,255,255,0.75)';
const MUTED = 'rgba(255,255,255,0.45)';
const OPENING = '#F59E0B';
const PAD = 70;

/**
 * Framing elevation of the selected wall (009 AC-8.2): plates, studs,
 * openings with their kings, jacks, headers and cripples, and the layout
 * marks a framer would pull from the layout-start end. Viewed from either
 * side; openings drag along the wall here exactly as they do in plan.
 */
export default function ElevationView() {
  const plan = useTileFlowStore((s) => s.plan);
  const wallId = useTileFlowStore((s) => s.elevationWallId);
  const system = useTileFlowStore((s) => s.system);
  const close = useTileFlowStore((s) => s.setElevationWall);
  const updateOpening = useTileFlowStore((s) => s.updateOpening);
  const beginDrag = useTileFlowStore((s) => s.beginVertexDrag);
  const endDrag = useTileFlowStore((s) => s.endVertexDrag);

  const [side, setSide] = useState<'right' | 'left'>('right');
  // An opening drag is measured from where it started, so slow moves smaller
  // than the snap grid still add up.
  const drag = useRef<{ start: number; dx: number }>({ start: 0, dx: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setSize({ width: e[0].contentRect.width, height: e[0].contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fw = useMemo(() => (plan && wallId ? frameWalls(plan).find((f) => f.wallId === wallId) : undefined), [plan, wallId]);
  const display = roomDisplay(system);
  const fmt = (mm: number) => formatDisplayFromMM(mm, display.unit, display.imperialFormat);

  if (!plan || !wallId) return null;
  const index = plan.walls.findIndex((w) => w.id === wallId) + 1;

  const header = (
    <div className="flex items-center justify-between px-4 py-2 text-white">
      <div className="flex items-center gap-3 text-[13px]">
        <span className="font-medium">Elevation — W{index}</span>
        {fw && (
          <span className="text-[11px] text-white/55">
            plate {fmt(fw.plateLength)} · framed height {fmt(fw.framing.framedHeight)} · stud {fmt(fw.studLength)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {(['right', 'left'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`rounded-full px-2.5 py-0.5 text-[11px] ${side === s ? 'bg-white text-ink' : 'text-white/70 hover:bg-white/10'}`}
          >
            From {s}
          </button>
        ))}
        <button onClick={() => close(null)} className="ml-2 px-2 text-[14px] text-white/70 hover:text-white" title="Close">
          ×
        </button>
      </div>
    </div>
  );

  const shell = (body: React.ReactNode) => (
    <div className="absolute inset-6 z-30 flex flex-col overflow-hidden rounded-xl shadow-2xl" style={{ background: BG, border: '1px solid rgba(255,255,255,.1)' }}>
      {header}
      <div ref={boxRef} className="relative flex-1">
        {body}
      </div>
      <p className="px-4 py-1.5 text-[10px] text-white/40">Planning estimate — not an engineered design. Drag an opening to slide it along the wall.</p>
    </div>
  );

  if (!fw) return shell(<p className="p-4 text-[12px] text-white/60">This wall has no stud core to frame.</p>);

  const L = fw.plateLength;
  const H = fw.framing.framedHeight;
  const scale = Math.max(0.01, Math.min((size.width - 2 * PAD) / L, (size.height - 2 * PAD) / H));
  const ox = (size.width - L * scale) / 2;
  const oy = (size.height + H * scale) / 2;
  // Viewed from the left the wall reads mirrored: its start is on the right.
  const sx = (x: number, w = 0) => ox + (side === 'right' ? x : L - x - w) * scale;
  const sy = (y: number) => oy - y * scale;

  const sw = fw.members.find((m) => m.kind === 'stud')?.width ?? 38;
  const marks = layoutMarks(L, fw.framing.spacing, sw, fw.framing.layoutFrom);
  const fromStart = (m: number) => (fw.framing.layoutFrom === 'a' ? m : L - m);
  const gridMM = snapGridMM(system);
  const openings = plan.openings.filter((o) => o.wallId === wallId);
  const font = 11;

  return shell(
    size.width > 0 && (
      <Stage width={size.width} height={size.height}>
        <Layer>
          {/* Floor line */}
          <Line points={[ox - 20, sy(0), ox + L * scale + 20, sy(0)]} stroke={MUTED} strokeWidth={1} />

          {fw.members.map((m, i) => (
            <Rect
              key={i}
              x={sx(m.x, m.width)}
              y={sy(m.y + m.height)}
              width={m.width * scale}
              height={m.height * scale}
              fill={FILL[m.kind]}
              stroke={EDGE}
              strokeWidth={0.75}
              listening={false}
              perfectDrawEnabled={false}
            />
          ))}
          {fw.members
            .filter((m) => m.kind === 'header' && m.label)
            .map((m, i) => (
              <Text
                key={`hl-${i}`}
                x={sx(m.x, m.width)}
                y={sy(m.y + m.height) - font - 3}
                width={m.width * scale}
                align="center"
                text={m.label}
                fontSize={font}
                fill={LABEL}
                listening={false}
              />
            ))}

          {/* Openings: dashed rough opening, draggable along the wall */}
          {openings.map((o) => {
            const issue = fw.issues.find((i) => i.openingId === o.id);
            const x0 = o.center - fw.plateStart - o.roughWidth / 2;
            const bottom = o.kind === 'window' ? o.sillHeight ?? 0 : 0;
            return (
              <Group
                key={o.id}
                draggable
                dragBoundFunc={(pos) => ({ x: pos.x, y: 0 })}
                onDragStart={() => {
                  drag.current = { start: o.center, dx: 0 };
                  beginDrag();
                }}
                onDragMove={(e: KonvaEventObject<DragEvent>) => {
                  drag.current.dx += e.target.x() / scale;
                  e.target.x(0);
                  const along = side === 'right' ? drag.current.dx : -drag.current.dx;
                  const next = Math.round((drag.current.start + along) / gridMM) * gridMM;
                  updateOpening(o.id, { center: next }, { quiet: true });
                }}
                onDragEnd={endDrag}
              >
                <Rect
                  x={sx(x0, o.roughWidth)}
                  y={sy(o.roughHeight)}
                  width={o.roughWidth * scale}
                  height={(o.roughHeight - bottom) * scale}
                  fill="rgba(245,158,11,0.06)"
                  stroke={issue ? '#F87171' : OPENING}
                  strokeWidth={1.5}
                  dash={[6, 4]}
                />
                <Text
                  x={sx(x0, o.roughWidth)}
                  y={sy((o.roughHeight + bottom) / 2) - font / 2}
                  width={o.roughWidth * scale}
                  align="center"
                  text={`${o.kind === 'window' ? 'Window' : o.kind === 'door' ? 'Door' : 'Opening'} ${fmt(o.roughWidth)} × ${fmt(o.roughHeight - bottom)}`}
                  fontSize={font}
                  fill={issue ? '#F87171' : OPENING}
                  listening={false}
                />
              </Group>
            );
          })}

          {/* Layout marks from the layout-start end */}
          {marks.map((m, i) => (
            <Group key={`mk-${i}`} listening={false}>
              <Line points={[sx(m), sy(0) + 8, sx(m), sy(0) + 16]} stroke={MUTED} strokeWidth={1} />
              {(scale * fw.framing.spacing > 34 || i % 2 === 1) && (
                <Text x={sx(m) - 30} y={sy(0) + 20} width={60} align="center" text={fmt(fromStart(m))} fontSize={font - 1} fill={MUTED} />
              )}
            </Group>
          ))}
          <Text
            x={side === 'right' === (fw.framing.layoutFrom === 'a') ? ox - 60 : ox + L * scale + 8}
            y={sy(0) + 8}
            width={52}
            align={side === 'right' === (fw.framing.layoutFrom === 'a') ? 'right' : 'left'}
            text="layout ▸"
            fontSize={font - 1}
            fill={MUTED}
            listening={false}
          />
          {/* Overall */}
          <Text x={ox} y={sy(H) - 22} width={L * scale} align="center" text={fmt(L)} fontSize={font + 1} fill={LABEL} listening={false} />
          {fw.issues.map((iss, i) => (
            <Text key={`is-${i}`} x={12} y={12 + i * 16} text={`⚠ ${iss.message}`} fontSize={font} fill="#F87171" listening={false} />
          ))}
        </Layer>
      </Stage>
    )
  );
}
