import React from 'react';

/**
 * A small ⓘ that explains a term on hover or keyboard focus (010 R6). The
 * text is also the button's accessible label, so screen readers get it
 * without the hover.
 */
export default function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={text}
        className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-ink-muted/50
                   text-[9px] font-semibold leading-none text-ink-muted hover:text-ink focus:text-ink focus:outline-none"
      >
        i
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 hidden w-56 -translate-x-1/2 rounded-md
                   bg-ink px-2.5 py-1.5 text-[11px] font-normal leading-snug text-white shadow-lg
                   group-hover:block group-focus-within:block"
      >
        {text}
      </span>
    </span>
  );
}
