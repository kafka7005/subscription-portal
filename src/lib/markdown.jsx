// Мини-Markdown для документов (оферта, правила): заголовки #/##/###, списки -/1.,
// **жирный**, *курсив*, [ссылка](url), абзацы. Без HTML — текст не может внедрить разметку.
import { Fragment } from 'react';

function inline(text, keyBase) {
  const out = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0; let m; let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[2]) out.push(<strong key={k}>{m[2]}</strong>);
    else if (m[3]) out.push(<em key={k}>{m[3]}</em>);
    else {
      const url = /^(https?:\/\/|\/|mailto:)/.test(m[5]) ? m[5] : '#';
      out.push(<a key={k} href={url} target={url.startsWith('/') ? undefined : '_blank'} rel="noopener noreferrer">{m[4]}</a>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let para = []; let list = null;
  const flushPara = () => { if (para.length) { blocks.push({ t: 'p', v: para.join(' ') }); para = []; } };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (h) { flushPara(); flushList(); blocks.push({ t: `h${Math.min(3, h[1].length + 1)}`, v: h[2] }); continue; }
    if (ul || ol) {
      flushPara();
      const type = ul ? 'ul' : 'ol';
      if (!list || list.t !== type) { flushList(); list = { t: type, items: [] }; }
      list.items.push((ul || ol)[1]);
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return <>{blocks.map((b, i) => {
    if (b.t === 'ul' || b.t === 'ol') {
      const Tag = b.t;
      return <Tag key={i}>{b.items.map((it, j) => <li key={j}>{inline(it, `${i}-${j}`)}</li>)}</Tag>;
    }
    const Tag = b.t;
    return <Fragment key={i}><Tag>{inline(b.v, String(i))}</Tag></Fragment>;
  })}</>;
}
