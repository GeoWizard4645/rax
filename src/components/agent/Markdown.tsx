import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * A small, safe Markdown renderer for assistant replies: paragraphs, headings, bullet/numbered lists, tables, block quotes,
 * fenced code, and inline **bold**, *italic*, `code` and [links](…). It builds React elements (never HTML strings), and only
 * https:// or same-site links are clickable, so model output can't inject markup or javascript: URLs.
 */

function link(href: string, label: ReactNode, key: number): ReactNode {
  if (/^\/[a-z0-9/_-]*(\?[^\s]*)?$/i.test(href)) return <Link key={key} to={href}>{label}</Link>;
  if (/^https:\/\/[^\s]+$/i.test(href)) return <a key={key} href={href} target="_blank" rel="noopener noreferrer">{label}</a>;
  return <Fragment key={key}>{label}</Fragment>;
}

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|\*[^*\n]+\*|https:\/\/[^\s<>)]+)/g;

export function Inline({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={k++} className="font-semibold text-head">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={k++} className="num rounded bg-base px-1 py-0.5 text-[12px] text-emerald">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      out.push(link(mm[2], mm[1], k++));
    } else if (tok.startsWith('https://')) {
      const trimmed = tok.replace(/[.,;:!?]+$/, '');
      out.push(link(trimmed, trimmed.replace(/^https:\/\//, ''), k++), tok.slice(trimmed.length));
    } else out.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    last = i + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={key++} className="num overflow-x-auto rounded-md border border-line bg-base p-2 text-[12px] leading-snug">{body.join('\n')}</pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<p key={key++} className="mt-1 font-semibold text-head"><Inline text={h[2]} /></p>);
      i++;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key++} className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead><tr>{head.map((c, j) => <th key={j} className="border-b border-line px-2 py-1 text-left font-medium text-muted"><Inline text={c} /></th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} className="border-b border-line/60 px-2 py-1 align-top"><Inline text={c} /></td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(<Tag key={key++} className={`${ordered ? 'list-decimal' : 'list-disc'} space-y-0.5 pl-5`}>{items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</Tag>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={key++} className="border-l-2 border-line pl-3 text-muted"><Inline text={q.join(' ')} /></blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|>\s?|\s*([-*•]|\d+[.)])\s+)/.test(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) para.push(lines[i++]);
    blocks.push(<p key={key++}><Inline text={para.join(' ')} /></p>);
  }
  return <div className="space-y-2 break-words text-[13px] leading-relaxed">{blocks}</div>;
}
