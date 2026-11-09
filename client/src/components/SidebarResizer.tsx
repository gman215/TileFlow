import React, { useEffect, useRef } from 'react';
import {
  useTileFlowStore,
  clampSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '../store/tileFlowStore';

const KEY_STEP = 16;

/**
 * The drag handle on the sidebar's right edge (011 R1).
 *
 * A separator in the accessibility sense: focusable, announced with its value,
 * and operable with ←/→ — so resizing is not a mouse-only feature. During a
 * drag the width is applied at most once per animation frame; the canvas
 * re-fits through its own ResizeObserver, so nothing here talks to Konva.
 */
export default function SidebarResizer() {
  const width = useTileFlowStore((s) => s.sidebarWidth);
  const setWidth = useTileFlowStore((s) => s.setSidebarWidth);
  const frame = useRef<number | null>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  // A smaller window can leave a stored width too wide for the canvas floor.
  useEffect(() => {
    const onResize = () => setWidth(useTileFlowStore.getState().sidebarWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setWidth]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const next = d.startWidth + (e.clientX - d.startX);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setWidth(next));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset · [ hides the sidebar"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => setWidth(SIDEBAR_DEFAULT_WIDTH)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          setWidth(clampSidebarWidth(width + (e.key === 'ArrowRight' ? KEY_STEP : -KEY_STEP)));
        }
      }}
      className="group relative z-20 -ml-[3px] w-[6px] flex-shrink-0 cursor-col-resize touch-none outline-none"
    >
      {/* The visible line: hairline at rest, emphasised on hover, drag and focus. */}
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:w-[3px] group-hover:bg-ink/25 group-focus-visible:w-[3px] group-focus-visible:bg-ink/40 group-active:w-[3px] group-active:bg-ink/40" />
    </div>
  );
}
