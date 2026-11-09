import React from 'react';

/**
 * Just enough markdown for the installation brief (004 T7): `## ` headings,
 * `- ` lists, `**bold**` and paragraphs. The prompt controls which shapes come
 * back, so a library for four of them would be all cost — and this never
 * touches `innerHTML`, so model text can only ever render as text.
 *
 * Tolerant of a half-streamed document: an unclosed `**` renders literally
 * until its partner arrives, and a list or paragraph simply grows.
 */
function inline(text: string, key: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={`${key}-${i}`} className="font-semibold text-white">{part.slice(2, -2)}</strong>
    ) : (
      <React.Fragment key={`${key}-${i}`}>{part}</React.Fragment>
    )
  );
}

export function Markdown({ source }: { source: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (list.length) {
      const k = `ul${blocks.length}`;
      blocks.push(<ul key={k} className="ml-4 list-disc space-y-1">{list.map((li, i) => <li key={i}>{inline(li, `${k}-${i}`)}</li>)}</ul>);
      list = [];
    }
    if (para.length) {
      const k = `p${blocks.length}`;
      blocks.push(<p key={k}>{inline(para.join(' '), k)}</p>);
      para = [];
    }
  };
  for (const line of source.split('\n')) {
    const t = line.trim();
    if (/^#{1,3} /.test(t)) {
      flush();
      blocks.push(<h4 key={`h${blocks.length}`} className="pt-1 text-[13px] font-semibold text-white">{inline(t.replace(/^#{1,3} /, ''), `h${blocks.length}`)}</h4>);
    } else if (/^[-*] /.test(t)) {
      if (para.length) flush();
      list.push(t.slice(2));
    } else if (t === '') flush();
    else {
      if (list.length) flush();
      para.push(t);
    }
  }
  flush();
  return <div className="space-y-2 text-[12.5px] leading-relaxed text-white/85">{blocks}</div>;
}
