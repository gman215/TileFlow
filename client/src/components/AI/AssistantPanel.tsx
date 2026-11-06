import React, { useEffect, useRef, useState } from 'react';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { useAssistant, type AssistantTurn } from '../../hooks/useAssistant';
import { useAiAvailability } from '../../hooks/useAiAvailability';
import { AiError } from '../../api/ai';
import type { ToolOutcome } from '../../ai/tools';
import {
  formatDisplayFromMM,
  groutDisplay,
  isImperialUnit,
  roomDisplay,
  tileDisplay,
  type FieldDisplay,
  type MeasurementSystem,
} from '../../utils/measurements';
import { PATTERNS } from '../Controls/TilePanel';
import { ALIGNMENTS } from '../Controls/OptimizationPanel';

const MAX_MESSAGE = 2000;

// ─── Chips ────────────────────────────────────────────────────────────────────

/** A length in the unit that field uses in the sidebar, with its suffix. */
function fmt(mm: unknown, d: FieldDisplay): string {
  if (typeof mm !== 'number') return '?';
  const text = formatDisplayFromMM(mm, d.unit, d.imperialFormat);
  // Imperial formats carry their own unit; metric ones are bare numbers.
  return isImperialUnit(d.unit) ? text : `${text} ${d.unit}`;
}

/** What each tool is called on a chip — the sidebar's words, not the tool's. */
const TOOL_LABEL: Record<string, string> = {
  set_tile_size: 'Tile size',
  set_grout: 'Grout',
  set_pattern: 'Pattern',
  set_alignment: 'Layout',
  set_tile_orientation: 'Orientation',
  set_optimization_weights: 'Fine-tune',
  set_room_size: 'Room size',
  set_reference_wall: 'Squaring wall',
  reset_to_rectangle: 'Outline',
  read_layout_stats: 'Layout figures',
};

const ORIENTATION_LABEL: Record<string, string> = {
  horizontal: 'Landscape',
  vertical: 'Portrait',
  square: 'Square',
};

/**
 * An applied call as the user would describe it: "Pattern → Herringbone".
 *
 * Built from the tool's *result*, which is read back from the store, never from
 * the model's arguments or its prose — so a chip cannot claim a value that is
 * not in effect (003 AC-4.5). Figures are formatted by the same helpers the
 * sidebar uses; nothing here is the model's number (Constitution I).
 */
function chipText(o: ToolOutcome, system: MeasurementSystem): string {
  const r = o.result;
  const label = TOOL_LABEL[o.name] ?? o.name;
  switch (o.name) {
    case 'set_tile_size': {
      const d = tileDisplay(system);
      return `${label} → ${fmt(r.width_mm, d)} × ${fmt(r.height_mm, d)}`;
    }
    case 'set_grout':
      return `${label} → ${fmt(r.grout_mm, groutDisplay(system))}`;
    case 'set_pattern':
      return `${label} → ${PATTERNS.find((p) => p.value === r.pattern)?.label ?? String(r.pattern)}`;
    case 'set_alignment':
      return `${label} → ${ALIGNMENTS.find((a) => a.value === r.alignment)?.label ?? String(r.alignment)}`;
    case 'set_tile_orientation':
      return `${label} → ${ORIENTATION_LABEL[String(r.orientation)] ?? String(r.orientation)}`;
    case 'set_optimization_weights':
      return `Larger cuts ${Number(r.alpha).toFixed(2)} · Waste ${Number(r.beta).toFixed(2)}`;
    case 'set_room_size': {
      const d = roomDisplay(system);
      return `${label} → ${fmt(r.width_mm, d)} × ${fmt(r.height_mm, d)}`;
    }
    case 'set_reference_wall':
      // W1-based, matching the wall table — the tools number from 0.
      return typeof r.reference_wall === 'number'
        ? `Square to W${r.reference_wall + 1}`
        : 'Squared to the room';
    case 'reset_to_rectangle':
      return `${label} → rectangle`;
    case 'read_layout_stats':
      return 'Read the layout figures';
    default:
      return label;
  }
}

/** Why a call did not apply, for the chip's tooltip (AC-5.3). */
function rejectionReason(o: ToolOutcome): string {
  const r = o.result;
  if (typeof r.message === 'string') return r.message;
  if (Array.isArray(r.issues)) return `Rejected: ${r.issues.join('; ')}`;
  switch (r.reason) {
    case 'unknown_tool':
      return 'The assistant asked for an action this app does not support.';
    case 'no_layout':
      return 'There was no computed layout to read yet.';
    default:
      return 'The change was not made.';
  }
}

function Chip({ outcome, system }: { outcome: ToolOutcome; system: MeasurementSystem }) {
  if (outcome.applied) {
    const read = outcome.name === 'read_layout_stats';
    // Changes are solid; a read is quiet — it changed nothing.
    return (
      <span className={`seg px-1.5 py-0.5 text-[10px] ${read ? 'seg-idle' : 'seg-active'}`}>
        {chipText(outcome, system)}
      </span>
    );
  }
  // Rejected or no-op: muted and struck through, reason on hover.
  return (
    <span
      title={rejectionReason(outcome)}
      className="seg seg-idle cursor-help px-1.5 py-0.5 text-[10px] line-through opacity-60"
    >
      {TOOL_LABEL[outcome.name] ?? 'Unsupported action'} — not changed
    </span>
  );
}

// ─── Failures ─────────────────────────────────────────────────────────────────

/**
 * A failed turn, said plainly (003 design, failure table; AC-6.4). Each message
 * says whether trying again is worth it. That nothing changed is stated by the
 * caller, which knows whether that is true: a failure partway through a turn
 * can follow changes that did apply.
 */
function messageFor(err: unknown): string {
  if (err instanceof AiError) {
    switch (err.code) {
      case 'rate_limited':
        return err.retryAfterSeconds
          ? `Too many requests — try again in ${err.retryAfterSeconds}s.`
          : 'Too many requests. Try again shortly.';
      case 'upstream':
        return 'The assistant could not answer just now. Try again in a moment.';
      case 'network':
        return 'Could not reach the assistant. Check your connection and try again.';
      case 'config':
        return 'AI features are not configured on this deployment.';
      case 'bad_request':
        // Ours, not the server's: e.g. "the layout is still being computed".
        return err.message;
      default:
        return 'Something went wrong with that request. Try again.';
    }
  }
  return 'Something went wrong with that request. Try again.';
}

// ─── Turns ────────────────────────────────────────────────────────────────────

/** Anything the loop had to say about how the turn ended. */
function turnNotes(t: AssistantTurn): string[] {
  const notes: string[] = [];
  // AC-6.1: everything the model asked for was malformed. The model was told
  // why and may say so itself, but the user is told regardless.
  const outcomes = t.outcomes ?? [];
  if (outcomes.length > 0 && outcomes.every((o) => o.result.reason === 'invalid_arguments')) {
    notes.push('The assistant’s request could not be understood, so nothing was changed.');
  }
  if (t.capped) {
    const applied = t.outcomes?.filter((o) => o.applied && o.name !== 'read_layout_stats').length ?? 0;
    notes.push(
      `Stopped after 4 steps. ${applied} change${applied === 1 ? '' : 's'} applied` +
        (t.skipped ? `; ${t.skipped} more requested but not made.` : '.')
    );
  }
  if (t.unsupported) {
    notes.push(
      t.unsupported === 1
        ? 'The assistant asked for an action this app does not support; it was ignored.'
        : `The assistant asked for ${t.unsupported} actions this app does not support; they were ignored.`
    );
  }
  return notes;
}

function Turn({
  turn,
  system,
  undoable,
  onUndo,
}: {
  turn: AssistantTurn;
  system: MeasurementSystem;
  undoable: boolean;
  onUndo: () => void;
}) {
  if (turn.role === 'user') {
    return (
      <div className="ml-6 rounded-lg bg-[#F0EFEB] px-2.5 py-1.5 text-[12px] text-ink">{turn.text}</div>
    );
  }

  const outcomes = turn.outcomes ?? [];
  const notes = turnNotes(turn);

  return (
    <div className="mr-6 space-y-1.5">
      {turn.demoMode && (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
          demo mode
        </span>
      )}
      {turn.text && <p className="text-[12px] leading-snug text-ink">{turn.text}</p>}
      {turn.error !== undefined && (
        <div className="rounded-lg bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
          {messageFor(turn.error)}{' '}
          {outcomes.some((o) => o.applied && o.name !== 'read_layout_stats')
            ? 'The changes listed below were made before it stopped.'
            : 'Nothing was changed.'}
        </div>
      )}
      {outcomes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {outcomes.map((o) => (
            <Chip key={o.callId} outcome={o} system={system} />
          ))}
        </div>
      )}
      {notes.map((n) => (
        <p key={n} className="text-[10px] text-ink-muted">
          {n}
        </p>
      ))}
      {undoable && (
        <button onClick={onUndo} className="text-[11px] font-medium text-ink-secondary underline hover:text-ink">
          Undo AI change
        </button>
      )}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

/**
 * The layout assistant (003): plain English in, the store's own actions out.
 *
 * Every change it makes goes through the same actions the sidebar's buttons
 * call, so the panels above update as it works, and the canvas recomputes
 * through the existing worker subscription — nothing here triggers a layout.
 */
export default function AssistantPanel() {
  const system = useTileFlowStore((s) => s.system);
  const aiSnapshot = useTileFlowStore((s) => s.aiSnapshot);
  const undoAiChange = useTileFlowStore((s) => s.undoAiChange);
  const { turns, busy, send } = useAssistant();
  const { configured, demoMode, loading, reason } = useAiAvailability();
  // Demo mode stays usable: the route answers with a labelled canned reply.
  const disabled = busy || loading || !configured;

  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, busy]);

  // Undo belongs to the newest turn that changed something, and only while
  // its snapshot is still the store's — after an undo the link goes away.
  const lastChanging = [...turns]
    .reverse()
    .find((t) => t.role === 'assistant' && t.outcomes?.some((o) => o.applied && o.name !== 'read_layout_stats'));
  const undoTurnId = aiSnapshot && lastChanging ? lastChanging.id : null;

  function submit() {
    const text = draft.trim();
    if (!text || disabled) return;
    setDraft('');
    void send(text);
  }

  return (
    <details open className="group px-4 py-4">
      <summary className="section-header flex cursor-pointer list-none items-center justify-between">
        Ask the assistant
        {configured && demoMode && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
            demo mode
          </span>
        )}
      </summary>

      <div className="mt-3 space-y-2">
        {/* Unconfigured is a fact about the deployment, not an error the user
            caused — stated once, quietly; every other panel is untouched (AC-6.3). */}
        {!loading && !configured && (
          <p className="text-[11px] leading-snug text-ink-muted">
            {reason} Everything else in the sidebar still works.
          </p>
        )}

        {turns.length === 0 ? (
          <p className="text-[11px] leading-snug text-ink-muted">
            Describe the layout you want — “12 × 24 herringbone, squared to the long wall” — or ask
            what a setting does. Changes show in the sidebar as they are made.
          </p>
        ) : (
          <div ref={scrollRef} className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
            {turns.map((t) => (
              <Turn key={t.id} turn={t} system={system} undoable={t.id === undoTurnId} onUndo={undoAiChange} />
            ))}
            {busy && <p className="text-[11px] italic text-ink-muted">Working on it…</p>}
          </div>
        )}

        <input
          type="text"
          value={draft}
          maxLength={MAX_MESSAGE}
          disabled={disabled}
          title={!loading && !configured ? (reason ?? undefined) : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends. IME composition (e.g. Japanese input) uses Enter to
            // confirm a word, so it must not send mid-composition.
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            busy
              ? 'Working…'
              : loading
                ? 'Checking the assistant…'
                : !configured
                  ? 'The assistant is unavailable here'
                  : 'Ask or describe a change, then press Enter'
          }
          className="input-field text-[12px]"
          aria-label="Message the layout assistant"
        />

        {/* AC-1.3: said, not silently lost. */}
        <p className="text-[10px] text-ink-muted">
          This conversation is not saved and resets when you reload.
        </p>
      </div>
    </details>
  );
}
