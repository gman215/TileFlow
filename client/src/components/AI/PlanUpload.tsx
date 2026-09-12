import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { RoomShape } from '@tileflow/geometry';
import { summarizeShape, validateShape } from '@tileflow/geometry';
import type { PointDTO, RoomFromImageDTO } from '@api/_lib/types';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { useAiAvailability } from '../../hooks/useAiAvailability';
import { AiError, ai } from '../../api/ai';
import { ImageError, downscaleToJpeg } from '../../utils/image';
import { formatDisplayFromMM, roomDisplay } from '../../utils/measurements';

/** Same conversions ShapePanel uses, so the two cards report identical figures. */
const MM2_PER_M2 = 1_000_000;
const MM2_PER_FT2 = 92_903.04;

/** Below this the model is telling us it guessed the scale (AC-3.7). */
const LOW_CONFIDENCE = 0.4;

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

function toRoomShape(dto: RoomFromImageDTO): RoomShape {
  const ring = (points: PointDTO[]) => ({ vertices: points.map((p) => ({ x: p.x, y: p.y })) });
  return { boundary: ring(dto.boundary), holes: dto.holes.map(ring) };
}

/**
 * A failure the user can read. Mirrors the table in `design.md`: every case
 * leaves the room exactly as it was, so the message only has to say what
 * happened and whether trying again is worth it.
 */
function messageFor(err: unknown): string {
  if (err instanceof ImageError) return err.message;

  if (err instanceof AiError) {
    switch (err.code) {
      case 'rate_limited':
        return err.retryAfterSeconds
          ? `Too many requests — try again in ${err.retryAfterSeconds}s.`
          : 'Too many requests. Try again shortly.';
      case 'upstream':
        return 'Could not read that plan. Try again, or draw the room by hand.';
      case 'config':
        return 'AI features are not configured on this deployment.';
      case 'too_large':
        return 'That image is too large to send. Try a smaller photo.';
      case 'network':
        return 'Could not reach the server. Check your connection and try again.';
      default:
        return err.message;
    }
  }

  return 'Something went wrong reading that image.';
}

/**
 * Read a floor plan or sketch into a proposed room outline (002-photo-to-room).
 *
 * The model proposes; it never applies. Everything shown about a proposal —
 * area, perimeter, wall count, and every problem with it — comes from the same
 * engine functions the Shape panel already uses on the committed outline
 * (Constitution I), so the figures here are the figures the user gets.
 */
export default function PlanUpload() {
  const system = useTileFlowStore((s) => s.system);
  const shapeProposal = useTileFlowStore((s) => s.shapeProposal);
  const setShapeProposal = useTileFlowStore((s) => s.setShapeProposal);
  const applyShapeProposal = useTileFlowStore((s) => s.applyShapeProposal);

  const { configured, loading, reason } = useAiAvailability();

  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The model's account of an image it declined to read (confidence 0). */
  const [rejected, setRejected] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);

  // Unmounting mid-request aborts it, and nothing sets state afterwards
  // (AC-5.2). The store keeps any proposal already made, so switching panels
  // and back does not lose it.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const display = roomDisplay(system);
  const imperial = system === 'imperial';

  // Engine figures, computed exactly as ShapePanel computes them.
  const summary = useMemo(
    () => (shapeProposal ? summarizeShape(shapeProposal.shape) : null),
    [shapeProposal]
  );
  const issues = useMemo(
    () => (shapeProposal ? validateShape(shapeProposal.shape) : []),
    [shapeProposal]
  );

  async function handleFile(file: File) {
    setError(null);
    setRejected(null);
    setShapeProposal(null);
    setBusy(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Decoding and resizing happen first, so a file that is not an image
      // never reaches the network (AC-1.4).
      const image = await downscaleToJpeg(file);

      const dto = await ai.roomFromImage(
        {
          imageBase64: image.base64,
          mimeType: image.mimeType,
          system,
          note: note.trim() || undefined,
        },
        controller.signal
      );

      if (!aliveRef.current || controller.signal.aborted) return;

      // Zero confidence is the model saying "this is not a floor plan". Offering
      // it as a proposal would invite the user to accept an invented room, so
      // the reason is shown instead (AC-2.5).
      if (dto.confidence === 0) {
        setRejected(dto.notes || 'That image does not look like a floor plan.');
        return;
      }

      setShapeProposal({
        shape: toRoomShape(dto),
        confidence: dto.confidence,
        notes: dto.notes,
        demoMode: dto.demoMode,
      });
    } catch (err) {
      // An abort is us, not a failure — say nothing.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!aliveRef.current) return;
      setError(messageFor(err));
    } finally {
      // Only the newest request owns the busy flag. Picking a second file
      // aborts the first, and the loser must not clear a spinner the winner
      // is still using.
      if (aliveRef.current && abortRef.current === controller) setBusy(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Cleared so picking the same file twice fires a second change event.
    e.target.value = '';
    if (file) void handleFile(file);
  }

  const disabled = busy || loading || !configured;
  const lowConfidence = shapeProposal !== null && shapeProposal.confidence < LOW_CONFIDENCE;

  const areaText = summary
    ? imperial
      ? `${(summary.area / MM2_PER_FT2).toFixed(1)} ft²`
      : `${(summary.area / MM2_PER_M2).toFixed(2)} m²`
    : '';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="section-header">Read a plan</h3>
        {shapeProposal?.demoMode && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
            demo mode
          </span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={onPick}
        className="hidden"
      />

      <button
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        title={
          configured
            ? 'Upload a photo of a floor plan or a sketch'
            : (reason ?? 'AI features are unavailable.')
        }
        className="w-full rounded-lg border border-hairline px-2 py-1.5 text-[12px]
                   font-medium text-ink transition-colors hover:bg-hairline
                   disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
      >
        {busy ? 'Reading the plan…' : 'Upload a plan or sketch'}
      </button>

      {/* Unconfigured is a fact about the deployment, not an error the user
          caused — stated once, quietly, with hand-drawing untouched (AC-5.3). */}
      {!loading && !configured && (
        <p className="text-[10px] text-ink-muted">{reason} You can still draw the room by hand.</p>
      )}

      {configured && (
        <div>
          <label className="input-label block" htmlFor="plan-note">
            Note for the model (optional)
          </label>
          <input
            id="plan-note"
            type="text"
            value={note}
            maxLength={300}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. the long wall is 14 ft"
            className="input-field text-[12px]"
          />
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 px-2.5 py-2 text-[11px] text-red-700">{error}</div>
      )}

      {/* The model read the image and declined it. Its reason is the useful
          part — it usually says what the picture actually is. */}
      {rejected && (
        <div className="rounded-lg bg-[#F0EFEB] px-2.5 py-2 text-[11px] text-ink-secondary">
          {rejected}
        </div>
      )}

      {shapeProposal && summary && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-ink">Proposed outline</span>
            <span className="font-mono text-[10px] text-ink-muted">
              {Math.round(shapeProposal.confidence * 100)}% confident
            </span>
          </div>

          {/* Engine figures, not the model's */}
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

          {shapeProposal.notes && (
            <p className="text-[10px] italic text-ink-secondary">{shapeProposal.notes}</p>
          )}

          {/* Same red box the Shape panel uses for a hand-drawn outline's
              problems — a proposal is held to the identical standard (AC-3.2). */}
          {issues.length > 0 && (
            <div className="rounded-lg bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
              {issues.map((issue, i) => (
                <div key={i}>{issue.message}</div>
              ))}
            </div>
          )}

          {lowConfidence && (
            <div className="rounded-lg bg-amber-100 px-2.5 py-2 text-[11px] font-medium text-amber-900">
              Low confidence — the shape is probably right but the size may not be. Check the
              wall lengths against the drawing before you tile.
            </div>
          )}

          {/* A photo without a dimension label has no absolute scale, so this
              stays on the card whatever the confidence (AC-4.2). */}
          <p className="text-[10px] text-ink-muted">
            Check one wall you know against the drawing — retype it in the wall table below and
            the room stays square.
          </p>

          <div className="flex gap-1.5">
            <button onClick={applyShapeProposal} className="btn-primary flex-1 px-2 py-1.5 text-[12px]">
              Apply outline
            </button>
            <button
              onClick={() => setShapeProposal(null)}
              className="seg seg-idle flex-1 px-2 py-1.5 text-[12px]"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
