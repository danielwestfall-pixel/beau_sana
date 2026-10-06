export function safeLink(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function linkParts(text) {
  const parts = []; let cursor = 0;
  for (const match of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>"']+/gi)) {
    let value = match[0].replace(/[.,;:!?]+$/, '');
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      while (value.endsWith(close) && value.split(close).length > value.split(open).length) value = value.slice(0, -1);
    }
    const href = safeLink(value.startsWith('www.') ? `https://${value}` : value);
    if (!href) continue;
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index) });
    parts.push({ text: value, href }); cursor = match.index + value.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
function makeLink(href, text) {
  const link = document.createElement('a'); link.href = href; link.textContent = text;
  link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `${text} (opens in a new tab)`); return link;
}
function plainNodes(text, target) {
  for (const part of linkParts(text)) target.append(part.href ? makeLink(part.href, part.text) : document.createTextNode(part.text));
}
export function renderContent(target, text, html) {
  target.replaceChildren();
  if (!html) { plainNodes(text || '', target); return; }
  // Asana rich text is XML. Parsing as XML avoids loading HTML image/iframe resources.
  const parsed = new DOMParser().parseFromString(html, 'application/xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement.tagName.toLowerCase() !== 'body') { plainNodes(text || '', target); return; }
  const allowed = new Set(['STRONG', 'EM', 'U', 'S', 'CODE', 'OL', 'UL', 'LI', 'BLOCKQUOTE', 'PRE', 'P', 'BR']);
  const blocked = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'SVG', 'MATH']);
  function copy(source, destination) {
    for (const child of source.childNodes) {
      if (child.nodeType === 3) { plainNodes(child.textContent, destination); continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toUpperCase();
      if (blocked.has(tag)) continue;
      if (tag === 'A') {
        const href = safeLink(child.getAttribute('href'));
        if (href) destination.append(makeLink(href, child.textContent || href));
        else copy(child, destination);
      } else if (allowed.has(tag)) {
        const element = document.createElement(tag.toLowerCase()); copy(child, element); destination.append(element);
      } else {
        // Keep text from unsupported containers, but never copy their attributes.
        copy(child, destination);
        if (['DIV', 'H1', 'H2', 'H3', 'TR'].includes(tag)) destination.append(document.createTextNode('\n'));
        if (tag === 'IMG' && child.getAttribute('alt')) destination.append(document.createTextNode(child.getAttribute('alt')));
      }
    }
  }
  copy(parsed.documentElement, target);
  if (!target.textContent.trim()) { target.replaceChildren(); plainNodes(text || '', target); }
}
