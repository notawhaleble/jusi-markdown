import katex from 'katex';

// Parse before Markdown escapes/emphasis so TeX backslashes and underscores
// reach KaTeX unchanged. Code spans and fences keep their normal precedence.
function closing(source, delimiter, start) {
  for (let at = source.indexOf(delimiter, start); at !== -1; at = source.indexOf(delimiter, at + delimiter.length)) {
    let slashes = 0;
    for (let i = at - 1; i >= 0 && source[i] === '\\'; i--) slashes++;
    if (slashes % 2 === 0) return at;
  }
  return -1;
}

export function mathPlugin(md) {
  md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
    const start = state.pos, source = state.src;
    const open = ['\\(', '\\[', '$$', '$'].find(mark => source.startsWith(mark, start));
    if (!open) return false;
    const close = { '\\(': '\\)', '\\[': '\\]', '$$': '$$', '$': '$' }[open];
    const from = start + open.length;
    if (open === '$' && /\s|\$/.test(source[from] ?? ' ')) return false;
    let end = closing(source, close, from);
    if (open === '$') {
      while (end !== -1 && (/\s/.test(source[end - 1]) || /[\d$]/.test(source[end + 1] ?? ''))) {
        end = closing(source, close, end + 1);
      }
    }
    if (end === -1 || end === from || /\n\s*\n/.test(source.slice(from, end))) return false;
    if (open === '$' && source.slice(from, end).includes('\n')) return false;
    if (!silent) {
      const token = state.push('math_inline', '', 0);
      token.content = source.slice(from, end);
      token.markup = open;
      token.meta = { display: open === '$$' || open === '\\[', source: source.slice(start, end + close.length) };
    }
    state.pos = end + close.length;
    return true;
  });

  md.block.ruler.before('fence', 'math_block', (state, start, end, silent) => {
    if (state.sCount[start] - state.blkIndent >= 4) return false;
    const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
    const open = first.startsWith('$$') ? '$$' : first.startsWith('\\[') ? '\\[' : null;
    if (!open) return false;
    const close = open === '$$' ? '$$' : '\\]';
    let last = start, content = first.slice(open.length), at = closing(content, close, 0);
    while (at === -1 && last + 1 < end) {
      last++;
      if (state.sCount[last] < state.blkIndent && state.src.slice(state.bMarks[last], state.eMarks[last]).trim()) return false;
      content += '\n' + state.getLines(last, last + 1, state.blkIndent, false);
      at = closing(content, close, 0);
    }
    if (at === -1 || content.slice(at + close.length).trim()) return false;
    if (silent) return true;
    const token = state.push('math_block', '', 0);
    token.block = true;
    token.content = content.slice(0, at).trim();
    token.map = [start, last + 1];
    token.meta = { display: true, source: open + content.slice(0, at) + close };
    state.line = last + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
}

export function renderMath(content, display) {
  // Each expression has its own macro scope and finite expansion/size limits.
  // Errors fall back to escaped, mapped source in the caller.
  if (content.length > 10000) throw new Error('Formula exceeds rendering budget');
  return katex.renderToString(content, {
    displayMode: display, output: 'htmlAndMathml', throwOnError: true,
    trust: false, strict: 'error', maxExpand: 1000, maxSize: 20,
  });
}
