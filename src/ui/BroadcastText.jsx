import React from 'react';

const tags = new Map(Object.entries({ b:'b', strong:'b', i:'i', em:'i', u:'u', ins:'u', s:'s', del:'s', strike:'s', pre:'pre', code:'code', blockquote:'blockquote', a:'a' }));
function escape(text) {
  return text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}
function format(html, serialize) {
  const template = document.createElement('template');
  template.innerHTML = html;
  function walk(node, key) {
    if (node.nodeType === 3) return serialize ? escape(node.textContent) : node.textContent;
    if (node.nodeType !== 1 || ['script','style','iframe','img','object'].includes(node.localName)) return '';
    if (node.localName === 'br') return '\n';
    let children = Array.from(node.childNodes,walk);
    const wrap = (tag, href) => {
      children = [serialize ? '<'+tag+(href?' href="'+escape(href)+'"':'')+'>'+children.join('')+'</'+tag+'>'
        : React.createElement(tag, {key, ...(href ? {href,target:'_blank',rel:'noopener noreferrer'} : {})}, ...children)];
    };
    const tag = tags.get(node.localName);
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) wrap(tag,href);
    } else if (tag) wrap(tag);
    else if (node.localName === 'span') {
      if (/bold|[6-9]00/.test(node.style.fontWeight)) wrap('b');
      if (node.style.fontStyle === 'italic') wrap('i');
      if (node.style.textDecoration.includes('underline')) wrap('u');
      if (node.style.textDecoration.includes('line-through')) wrap('s');
    }
    if (['p','div','li'].includes(node.localName)) children.push('\n');
    return serialize ? children.join('') : <React.Fragment key={key}>{children}</React.Fragment>;
  }
  const parts=Array.from(template.content.childNodes,walk);
  return serialize ? parts.join('').trimEnd() : parts;
}
export const pastedBroadcast = html => format(html,true);
export function BroadcastText({html}) {
  return <span style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{format(html,false)}</span>;
}
