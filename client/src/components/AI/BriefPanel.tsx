import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { ai, AiError, buildBriefRequest } from '../../api/ai';
import { CARD_STYLE } from '../Controls/StatsPanel';
import { Markdown } from './markdown';

/**
 * The installation brief (004): a right-hand drawer over the stage, so the
 * layout it describes stays visible beside it.
 *
 * Every figure in the text was computed by the geometry engine and handed to
 * the model pre-formatted; the model contributes words, never numbers
 * (Constitution I). This component's job is to show that text honestly: as it
 * arrives, marked when it is incomplete, and marked when the layout has moved
 * on underneath it.
 */

type Status = 'idle' | 'streaming' | 'done' | 'incomplete' | 'error';

/**
 * Everything that, if changed, means the brief no longer describes the screen
 * (AC-4.4): the optimizer's chosen offset and score, and the tile settings and
 * room that produced them.
 */
function layoutSignature(): string | null {
  const s = useTileFlowStore.getState();
  if (!s.layout) return null;
  return JSON.stringify([
    s.layout.optimizationScore, s.layout.offsetX, s.layout.offsetY,
    s.tileConfig, s.alignment, s.room, s.system,
  ]);
}

/** A failure before any text arrived, said plainly (design failure table). */
function messageFor(err: unknown): string {
  if (err instanceof AiError) {
    switch (err.code) {
      case 'rate_limited':
        return err.retryAfterSeconds
          ? `Too many requests — try again in ${err.retryAfterSeconds}s.`
          : 'Too many requests. Try again shortly.';
      case 'upstream':
        return 'The brief could not be written just now. Try again in a moment.';
      case 'network':
        return 'Could not reach the server. Check your connection and try again.';
      case 'config':
        return 'AI features are not configured on this deployment.';
    }
  }
  return 'Something went wrong writing the brief. Try again.';
}

export default function BriefPanel({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stale, setStale] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);
  const signatureRef = useRef<string | null>(null);

  const generate = useCallback(async () => {
    // One request at a time: regenerating abandons the previous one (AC-4.2).
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const request = buildBriefRequest();
    if (!request) return; // the Brief button is disabled without a layout
    signatureRef.current = layoutSignature();
    setStale(false);
    setError(null);
    setStatus('streaming');
    let demoMode = false;
    let received = false;

    try {
      for await (const chunk of ai.brief(request, controller.signal, () => { demoMode = true; })) {
        if (!aliveRef.current || controller.signal.aborted) return;
        // The previous brief stays on screen until the new one starts arriving,
        // so a failed regenerate does not wipe a good brief (design table).
        if (!received) {
          received = true;
          setText('');
          setDemo(demoMode);
        }
        setText((t) => t + chunk);
      }
      if (!aliveRef.current || controller.signal.aborted) return;
      setStatus(received ? 'done' : 'incomplete');
    } catch (err) {
      // Stopped by us (close, unmount, regenerate): no state update (AC-3.3).
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!aliveRef.current || controller.signal.aborted) return;
      if (received) {
        // Died mid-flight: keep what arrived, say so, offer a retry (AC-3.4).
        setStatus('incomplete');
      } else {
        setError(messageFor(err));
        setStatus('error');
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  // Opening the drawer is the request; closing or unmounting stops it.
  useEffect(() => {
    aliveRef.current = true;
    void generate();
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
    };
  }, [generate]);

  // Mark — never refetch — when the layout moves on (AC-4.4). A call the user
  // did not ask for is a cost the user did not agree to (Constitution VII).
  useEffect(
    () =>
      useTileFlowStore.subscribe(() => {
        const sig = layoutSignature();
        if (signatureRef.current && sig && sig !== signatureRef.current) setStale(true);
      }),
    []
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(text); // the raw markdown (AC-4.3)
      setCopied(true);
      setTimeout(() => aliveRef.current && setCopied(false), 1500);
    } catch {
      setError('Could not copy — select the text instead.');
    }
  }

  const streaming = status === 'streaming';

  return (
    <aside
      aria-label="Installation brief"
      className="absolute bottom-3 right-3 top-16 z-20 flex w-[380px] flex-col rounded-xl text-white"
      style={CARD_STYLE}
    >
      <header className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <h3 className="text-[13px] font-semibold">Installation brief</h3>
        {demo && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
            demo mode
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={copy}
            disabled={!text}
            className="rounded px-2 py-1 text-[11px] text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={() => void generate()}
            disabled={streaming}
            className="rounded px-2 py-1 text-[11px] text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            Regenerate
          </button>
          <button onClick={onClose} aria-label="Close brief" className="rounded px-2 py-1 text-[14px] text-white/50 hover:text-white">
            ×
          </button>
        </div>
      </header>

      {stale && (
        <div className="mx-3 mt-3 flex items-center justify-between rounded-lg bg-amber-100 px-2.5 py-1.5 text-[11px] text-amber-900">
          The layout has changed since this brief was written.
          <button onClick={() => void generate()} className="font-semibold underline">Regenerate</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {error && <div className="mb-3 rounded-lg bg-red-500/15 px-2.5 py-2 text-[11px] text-red-200">{error}</div>}
        {!text && streaming && <p className="text-[12px] italic text-white/50">Writing the brief…</p>}
        {text && <Markdown source={text} />}
        {/* A quiet caret while text is still arriving. */}
        {streaming && text && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-white/60 align-[-2px]" />}
        {status === 'incomplete' && (
          <div className="mt-3 flex items-center justify-between rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] text-white/80">
            Incomplete — the connection dropped before the brief finished.
            <button onClick={() => void generate()} className="font-semibold underline">Retry</button>
          </div>
        )}
      </div>

      <footer className="border-t border-white/10 px-4 py-2 text-[10px] text-white/45">
        Every figure is from the layout engine. Not saved — closes with the drawer.
      </footer>
    </aside>
  );
}
