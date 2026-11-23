// Measure actual Chromium text lines. No font-width estimates or source-line
// wrapping: each Unicode code point is measured in its real styled text node.
export async function measure(model, elements) {
  const groups = new Map(), nodes = new Map();
  for (const [run, element] of elements) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), list = [];
    let node, offset = 0;
    while ((node = walker.nextNode())) { list.push({ node, start: offset, end: offset + node.length }); offset += node.length; }
    nodes.set(run, list);
  }
  let count = 0;
  function add(run, from, to, blank = false) {
    const element = elements.get(run);
    if (!element) return;
    const group = element.closest('.math-display') ?? element.closest('tr') ?? element.closest('p, pre, li, h1, h2, h3, h4, h5, h6') ?? element;
    if (!groups.has(group)) groups.set(group, []);
    let rect;
    if (element.dataset.math) rect = element.getBoundingClientRect();
    else {
      const node = nodes.get(run).find(n => from >= n.start && (from < n.end || blank && from === n.end));
      if (!node) return;
      const range = document.createRange();
      range.setStart(node.node, from - node.start); range.setEnd(node.node, Math.min(to - node.start, node.node.length));
      rect = range.getBoundingClientRect();
    }
    if (!rect.height) return;
    const top = rect.top + scrollY, bottom = rect.bottom + scrollY;
    const lines = groups.get(group);
    const overlaps = l => l && Math.min(l.bottom, bottom) - Math.max(l.top, top) > Math.min(l.bottom - l.top, bottom - top) * .5;
    const last = lines.at(-1);
    const sourceLine = element.dataset.math && model.runs[run].includes('\n');
    let line = sourceLine ? undefined : overlaps(last) ? last : last && top >= last.bottom ? undefined : lines.find(overlaps);
    if (!line) { line = { top, bottom, chars: [], code: group.tagName === 'PRE' }; lines.push(line); }
    if (!blank) line.chars.push({ run, from, to, cell: element.closest('td,th'), text: model.runs[run].slice(from, to) });
  }
  for (const row of model.lines) {
    if (!row.segments.length && row.point) add(row.point.run, row.point.offset, row.point.offset, true);
    for (const segment of row.segments) {
      // TeX source and typeset glyphs are not character-equivalent. Preserve a
      // formula as one searchable/yankable source run on its measured line.
      if (elements.get(segment.run)?.dataset.math) {
        add(segment.run, segment.from, segment.to);
        continue;
      }
      let offset = segment.from;
      for (const char of model.runs[segment.run].slice(segment.from, segment.to)) {
        add(segment.run, offset, offset + char.length); offset += char.length;
        if (++count % 4000 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }
  const rows = [];
  for (const lines of groups.values()) for (const line of lines.sort((a, b) => a.top - b.top)) {
    if (!line.code) while (line.chars.length && /^\s+$/u.test(line.chars.at(-1).text)) line.chars.pop();
    const parts = [];
    let cell;
    for (const char of line.chars) {
      if (cell && char.cell && cell !== char.cell) parts.push(null);
      const last = parts.at(-1);
      if (last && last[0] === char.run && last[2] === char.from) last[2] = char.to;
      else parts.push([char.run, char.from, char.to]);
      cell = char.cell;
    }
    rows.push(parts);
  }
  return rows;
}
