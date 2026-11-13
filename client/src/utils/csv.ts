/**
 * Save CSV text as a file the browser downloads. A UTF-8 BOM goes first so
 * Excel reads ×, ², ½ and inch fractions correctly instead of as mojibake.
 */
export function downloadCsv(text: string, name: string): void {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "Kitchen & Bath" → "kitchen-bath"; empty → the fallback. */
export function fileSlug(text: string | null | undefined, fallback: string): string {
  return (text ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}
