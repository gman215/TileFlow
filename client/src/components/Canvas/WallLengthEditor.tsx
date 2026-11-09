import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { formatDisplayFromMM, parseDisplayToMM, roomDisplay } from '../../utils/measurements';
import {
  commitWall,
  editableWall,
  neighbourWall,
  previewWall,
  type WallPreview,
  type WallTarget,
} from './wallEdit';

/** How far off the wall the field sits, in screen px. */
const OFFSET_PX = 30;

/**
 * The length field that opens on a clicked wall (011 R2) — a real `<input>`
 * over the Konva stage, so typing, selection, IME and screen readers all
 * behave as they do in the sidebar. It accepts exactly what the wall table
 * accepts (`12 ft 6 in`, `4.2`), previews every keystroke as a ghost outline
 * (drawn by the canvas from `onPreview`), and commits through the same actions.
 */
export default function WallLengthEditor({
  target,
  scale,
  view,
  bounds,
  onPreview,
  onNavigate,
  onClose,
}: {
  target: WallTarget;
  scale: number;
  view: { x: number; y: number };
  bounds: { width: number; height: number };
  onPreview: (p: WallPreview | null) => void;
  onNavigate: (t: WallTarget) => void;
  onClose: () => void;
}) {
  // Re-read the wall whenever anything it depends on changes.
  const room = useTileFlowStore((s) => s.room);
  const plan = useTileFlowStore((s) => s.plan);
  const system = useTileFlowStore((s) => s.system);
  const dimensionMode = useTileFlowStore((s) => s.dimensionMode);
  const activeRoomId = useTileFlowStore((s) => s.activeRoomId);
  const wall = useMemo(() => editableWall(target), [target, room, plan, system, dimensionMode, activeRoomId]);

  const display = roomDisplay(system);
  const format = (mm: number) => formatDisplayFromMM(mm, display.unit, display.imperialFormat);
  const [text, setText] = useState(() => (wall ? format(wall.lengthMM) : ''));
  const [issue, setIssue] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // A new wall (click or Tab): its current length, selected, ready to overtype.
  const key = JSON.stringify(target);
  useLayoutEffect(() => {
    if (!wall) return;
    setText(format(wall.lengthMM));
    setIssue(null);
    onPreview(null);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => onPreview(null), [onPreview]);

  if (!wall) return null;

  const parse = (raw: string) => parseDisplayToMM(raw, display.unit, display.imperialFormat);
  const update = (raw: string) => {
    setText(raw);
    const mm = parse(raw);
    if (mm === null) {
      setIssue(raw.trim() ? 'Type a length, e.g. ' + format(wall.lengthMM) : null);
      onPreview(null);
      return;
    }
    // An unchanged value previews nothing — there is nothing to show.
    if (Math.abs(mm - wall.lengthMM) < 0.5) { setIssue(null); onPreview(null); return; }
    const p = previewWall(target, mm);
    setIssue(p?.issue ?? null);
    onPreview(p && !p.issue ? p : null);
  };
  /** Commit if there is a valid change; true when it is fine to move on. */
  const commit = (): boolean => {
    const mm = parse(text);
    if (mm === null) { setIssue('Type a length, e.g. ' + format(wall.lengthMM)); return false; }
    if (Math.abs(mm - wall.lengthMM) < 0.5) return true;
    if (!commitWall(target, mm)) { setIssue(previewWall(target, mm)?.issue ?? 'That length is not possible here.'); return false; }
    onPreview(null);
    return true;
  };

  // Where it sits: the wall's midpoint, pushed off the wall, kept on screen.
  const mx = (wall.a.x + wall.b.x) / 2;
  const my = (wall.a.y + wall.b.y) / 2;
  const sx = mx * scale + view.x + wall.outward.x * OFFSET_PX;
  const sy = my * scale + view.y + wall.outward.y * OFFSET_PX;
  const left = Math.min(Math.max(sx, 90), bounds.width - 90);
  const top = Math.min(Math.max(sy, 24), bounds.height - 40);

  return (
    <div
      className="absolute z-30 -translate-x-1/2 -translate-y-1/2"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 rounded-lg border border-amber-400/70 bg-[rgba(36,35,33,.95)] px-2 py-1 shadow-lg">
        <span className="text-[10px] font-medium text-amber-300">{wall.label}</span>
        <input
          ref={input}
          value={text}
          aria-label={`${wall.label} length`}
          onChange={(e) => update(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (commit()) onClose(); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            else if (e.key === 'Tab') {
              e.preventDefault();
              const next = neighbourWall(target, e.shiftKey ? -1 : 1);
              if (commit() && next) onNavigate(next);
            }
          }}
          className="w-[92px] rounded bg-white/10 px-1.5 py-0.5 font-mono text-[12px] text-white outline-none focus:bg-white/15"
        />
      </div>
      {issue && <div className="mt-1 max-w-[220px] rounded bg-red-500/90 px-2 py-0.5 text-[10px] text-white">{issue}</div>}
      {!issue && (
        <div className="mt-1 whitespace-nowrap text-center text-[9px] text-white/45">Enter to set · Esc · Tab next wall</div>
      )}
    </div>
  );
}
