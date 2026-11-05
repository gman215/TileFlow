import React from 'react';

/** Small stroke icons for the toolbar; 16 px, currentColor. */
const PATHS: Record<string, React.ReactNode> = {
  select: <path d="M4 3l8 4.5-3.5 1L7 12z" fill="currentColor" stroke="none" />,
  room: <rect x="3" y="3" width="10" height="10" rx="0.5" strokeWidth="2.2" />,
  wall: (
    <>
      <path d="M2 12L12 2" strokeWidth="3" />
      <circle cx="2.5" cy="11.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="2.5" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  draw: <path d="M3 13V6l4-3 6 3v7z" />,
  cutout: <rect x="4" y="4" width="8" height="8" strokeDasharray="2 1.6" />,
  undo: <path d="M5 6H10a3 3 0 010 6H7M5 6l2.5-2.5M5 6l2.5 2.5" />,
  redo: <path d="M11 6H6a3 3 0 000 6h3M11 6L8.5 3.5M11 6L8.5 8.5" />,
  plan: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" />
      <path d="M8 2.5v6M8 8.5h5.5" />
    </>
  ),
};

export default function ToolIcon({ name }: { name: keyof typeof PATHS | string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}
