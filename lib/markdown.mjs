import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import { mathPlugin, renderMath } from './math.mjs';

// This source model supplies immutable runs for rendering and DOM measurement.
// Source ranges remain original UTF-8 block ranges; the layout compiler later
// replaces these logical rows with measured rows and unique layout anchors.
export function compile(source, { images = new Map(), highlight = true } = {}) {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false }).use(mathPlugin);
  const escape = md.utils.escapeHtml;
  const tokens = md.parse(source.replace(/^\uFEFF/, ''), {}), lines = [], runs = [], headings = [], links = [], runLinks = [];
  const offsets = [0];
  for (const line of source.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? []) {
    offsets.push(offsets.at(-1) + Buffer.byteLength(line));
  }
  let row, sourceRange, activeLink = null;
  function nextRow() {
    row = { text: '', byteLength: 0, anchor: { source: `md:${lines.length}`, ...sourceRange }, segments: [] };
    lines.push(row);
  }
  function mapped(text, inner = escape(text), math = false) {
    const run = runs.length;
    runs.push(text);
    runLinks.push(activeLink);
    let from = 0;
    const pieces = text.split('\n');
    pieces.forEach((piece, index) => {
      if (index) nextRow();
      row.point = { run, offset: from };
      const startByte = row.byteLength;
      row.byteLength += Buffer.byteLength(piece);
      if (piece) row.segments.push({ run, from, to: from + piece.length, startByte, endByte: row.byteLength });
      row.text += piece;
      from += piece.length + 1;
    });
    return `<span class="${math ? 'math-run' : 'text-run'}" data-run="${run}"${math ? ' data-math="true"' : ''}>${inner}</span>`;
  }
  function formula(token) {
    const { display, source: tex } = token.meta;
    let result;
    try { result = mapped(tex, renderMath(token.content, display), true); }
    catch { result = `<code class="math-error">${mapped(tex)}</code>`; }
    return display ? `<span class="math-display">${result}</span>` : result;
  }
  function inline(children) {
    for (const token of children ?? []) {
      if (token.type === 'link_open') {
        activeLink = links.length; token.linkId = activeLink;
        links.push({ href: token.attrGet('href') ?? '' });
      } else if (token.type === 'link_close') activeLink = null;
      else if (token.type === 'text') token.mapped = mapped(token.content);
      else if (token.type === 'code_inline') token.mapped = `<code>${mapped(token.content)}</code>`;
      else if (token.type === 'math_inline') token.mapped = formula(token);
      else if (token.type === 'softbreak' || token.type === 'hardbreak') { nextRow(); token.mapped = '<br>\n'; }
      else if (token.type === 'image') {
        const label = `[Image: ${md.renderer.renderInlineAsText(token.children ?? [], md.options, {}) || token.content || 'image'}]`;
        const image = images.get(token.attrGet('src'));
        token.mapped = `<span class="image">${image ? `<img src="${escape(image)}" alt="${escape(token.content)}" loading="lazy">` : ''}<span class="image-caption">${mapped(label)}</span></span>`;
      } else if (token.children) inline(token.children);
    }
  }
  for (const type of ['text', 'code_inline', 'image', 'softbreak', 'hardbreak', 'math_inline', 'math_block']) {
    md.renderer.rules[type] = (ts, i) => ts[i].mapped;
  }
  md.renderer.rules.link_open = (ts, i, options, env, renderer) => {
    const token = ts[i], href = token.attrGet('href') ?? '';
    token.attrSet('data-link', String(token.linkId));
    if (/^https?:\/\//i.test(href)) { token.attrSet('target', '_blank'); token.attrSet('rel', 'noopener noreferrer'); }
    else if (!href.startsWith('#')) {
      if (isLocalMarkdown(href)) token.attrSet('href', './');
      else token.attrs = (token.attrs ?? []).filter(([name]) => name !== 'href');
    }
    return renderer.renderToken(ts, i, options);
  };
  for (const type of ['fence', 'code_block']) md.renderer.rules[type] = (ts, i) => ts[i].mapped;
  const parents = [], usedIds = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.nesting === -1) parents.pop();
    const range = token.map ? { startByte: offsets[token.map[0]], endByte: offsets[token.map[1]] } : parents.at(-1);
    if (token.nesting === 1) parents.push(range);
    if (!['inline', 'fence', 'code_block', 'math_block'].includes(token.type)) continue;
    sourceRange = range ?? { startByte: 0, endByte: Buffer.byteLength(source) };
    const firstRow = lines.length;
    nextRow();
    if (token.type === 'inline') {
      // Task markers remain real Unicode text, with exact cursor ownership.
      if (tokens[i - 2]?.type === 'list_item_open' && token.children?.[0]?.type === 'text') {
        token.children[0].content = token.children[0].content.replace(/^\[([ xX])\] /, (_, checked) => checked === ' ' ? '☐ ' : '☑ ');
      }
      inline(token.children);
      if (tokens[i - 1]?.type === 'heading_open') {
        const title = lines.slice(firstRow).map(line => line.text).join(' ');
        const base = title.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
        let id = base, suffix = 0;
        while (usedIds.has(id)) id = `${base}-${++suffix}`;
        usedIds.add(id);
        tokens[i - 1].attrSet('id', id);
        headings.push({ id, title, level: Number(tokens[i - 1].tag.slice(1)), row: firstRow });
      }
    } else if (token.type === 'math_block') {
      token.mapped = formula(token) + '\n';
    } else if (token.type === 'fence' && token.info.trim() === 'math') {
      token.meta = { display: true, source: '$$' + token.content.trim() + '$$' };
      token.mapped = formula(token) + '\n';
    } else {
      const text = token.content.replace(/\n$/, ''), language = token.info.trim().split(/\s+/)[0];
      let inner = escape(text);
      if (highlight && language && hljs.getLanguage(language) && text.length <= 100000) {
        try { inner = hljs.highlight(text, { language, ignoreIllegals: true }).value; } catch { /* readable plain code */ }
      }
      token.mapped = `<pre><code${language ? ` data-language="${escape(language)}"` : ''}>${mapped(text, inner)}</code></pre>\n`;
    }
  }
  return { html: md.renderer.render(tokens, md.options, {}), lines, runs, headings, links, runLinks };
}

export function isLocalMarkdown(href) {
  try {
    const path = decodeURIComponent(href.split('#')[0]);
    return !/^(?:[a-z][a-z\d+.-]*:|[\/\\])/i.test(path) && !/[\0?\\]/.test(path) && /\.(md|markdown|mdown|mkd)$/i.test(path);
  } catch { return false; }
}

export function extract(model) {
  const lines = model.lines.map(({ text, anchor }) => ({ text, anchor }));
  if (lines.length > 10000 || lines.reduce((sum, line) => sum + Buffer.byteLength(line.text), 0) > 524288) {
    throw new Error('Markdown text exceeds the host text budget (10,000 lines / 512 KiB)');
  }
  const document = { offsetEncoding: 'utf-8', lines };
  if (Buffer.byteLength(JSON.stringify(document)) > 900000) throw new Error('Markdown anchors exceed the host transport budget');
  return document;
}
