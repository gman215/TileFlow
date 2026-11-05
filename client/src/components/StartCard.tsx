import React, { useEffect, useState } from 'react';
import { useTileFlowStore } from '../store/tileFlowStore';
import { TEMPLATES, type TemplateId } from '../store/templates';

const SEEN_KEY = 'tileflow.startSeen';

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}
function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* a preference only — the app works the same without it */
  }
}

const SHORTCUTS: [string, string][] = [
  ['V', 'Select'],
  ['R', 'Room — drag a rectangle (floor plan)'],
  ['W', 'Wall — click corners (floor plan)'],
  ['D', 'Draw a room shape (single room)'],
  ['C', 'Cut-out — an area that is not tiled'],
  ['E', 'Edit tiles — nudge single tiles'],
  ['F', 'Fit to screen'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Shift+Z', 'Redo'],
  ['Delete', 'Remove the selected wall'],
  ['Esc', 'Cancel / finish drawing'],
  ['Enter', 'Finish the outline or wall chain'],
  ['Shift', 'Draw at any angle (hold)'],
  ['?', 'This help'],
];

/**
 * The first thing a new visitor sees (010 R1): three ways to start, each in
 * one sentence, and a handful of examples. `?` brings it back with the
 * keyboard shortcuts.
 */
export default function StartCard() {
  const helpOpen = useTileFlowStore((s) => s.helpOpen);
  const setHelpOpen = useTileFlowStore((s) => s.setHelpOpen);
  const loadTemplate = useTileFlowStore((s) => s.loadTemplate);
  const startEmptyPlan = useTileFlowStore((s) => s.startEmptyPlan);
  const [firstRun, setFirstRun] = useState(() => !seen());

  const open = firstRun || helpOpen;
  const close = () => {
    markSeen();
    setFirstRun(false);
    setHelpOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!open) return null;

  const pick = (action: () => void) => {
    action();
    close();
  };
  const focusRoomSize = () =>
    window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>('aside input')?.focus());

  const choice = (title: string, body: string, onClick: () => void, accent = false) => (
    <button
      onClick={onClick}
      className={`flex-1 rounded-xl border p-4 text-left transition-colors ${
        accent ? 'border-ink bg-ink text-white hover:bg-[#333230]' : 'border-hairline bg-white hover:bg-[#F7F6F3]'
      }`}
    >
      <div className="text-[14px] font-semibold">{title}</div>
      <div className={`mt-1 text-[12px] leading-snug ${accent ? 'text-white/75' : 'text-ink-muted'}`}>{body}</div>
    </button>
  );

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-title"
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="max-h-full w-full max-w-[640px] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 id="start-title" className="text-[18px] font-bold text-ink">
              {helpOpen && !firstRun ? 'How TileFlow works' : 'What are you tiling?'}
            </h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              TileFlow lays the tile out for you: every full tile and cut, the waste, and how much to buy.
              Pick a way to start — you can change everything later.
            </p>
          </div>
          <button onClick={close} aria-label="Close" className="px-2 text-[18px] text-ink-muted hover:text-ink">
            ×
          </button>
        </div>

        <div className="mt-5 flex gap-3">
          {choice(
            'Tile one room',
            'Type the room size, pick a tile and pattern. Draw an L-shape or add an island any time.',
            () => pick(focusRoomSize),
            true
          )}
          {choice(
            'Draw a floor plan',
            'Several rooms with real walls — studs, drywall, doors — and a materials list. Drag rectangles to add rooms.',
            () => pick(startEmptyPlan)
          )}
        </div>

        <div className="mt-5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Or open an example</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => pick(() => loadTemplate(t.id as TemplateId))}
                className="rounded-lg border border-hairline px-3 py-2 text-left hover:bg-[#F7F6F3]"
              >
                <div className="text-[13px] font-medium text-ink">{t.name}</div>
                <div className="text-[11px] text-ink-muted">{t.blurb}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 rounded-lg bg-[#F7F6F3] px-3 py-2.5">
          <div className="text-[11px] font-semibold text-ink">The three steps</div>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[12px] text-ink-secondary">
            <li>
              <b>Room</b> — size or shape it (or draw a floor plan of several rooms).
            </li>
            <li>
              <b>Tile</b> — pick a size, grout and pattern.
            </li>
            <li>
              <b>Layout</b> — the app finds the least-waste position; read the order quantity bottom-left.
            </li>
          </ol>
          <p className="mt-1.5 text-[11px] text-ink-muted">
            The line under the toolbar always says what to do next.
          </p>
        </div>

        <details className="mt-3" open={helpOpen && !firstRun}>
          <summary className="cursor-pointer text-[12px] font-medium text-ink">Keyboard shortcuts</summary>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            {SHORTCUTS.map(([key, what]) => (
              <div key={key} className="flex items-center gap-2 text-[12px] text-ink-secondary">
                <kbd className="min-w-[2.2rem] rounded border border-hairline bg-[#F7F6F3] px-1.5 text-center font-mono text-[11px] text-ink">
                  {key}
                </kbd>
                {what}
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
