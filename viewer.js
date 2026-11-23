import { measure } from './layout.js';
const layer = document.querySelector('#projection');
const runs = new Map([...document.querySelectorAll('[data-run]')].map(element => [Number(element.dataset.run), element]));
let projection = null, previous, pending = false, sequence = 0;
const page = Number(document.body.dataset.page);
let model, rebuilding = false, layoutTimer, measuring = false, layoutAgain = false, lastAction = 0;
function notice(message) {
  const element = document.querySelector('#notice'); element.textContent = message; element.hidden = !message;
}
async function post(route, data) {
  const response = await fetch('./' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page, ...data }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Document request failed');
  return result;
}
async function rebuild() {
  if (!model || rebuilding || innerWidth <= 0 || innerHeight <= 0) return;
  if (measuring) { layoutAgain = true; return; }
  measuring = true;
  const size = [innerWidth, innerHeight];
  try {
    let rows, error;
    try {
      if (model.lines.length > 10000 || model.runs.reduce((n, text) => n + new TextEncoder().encode(text).length, 0) > 524288) throw new Error('Markdown text exceeds the host text budget');
      rows = await measure(model, runs);
    } catch (failure) { error = failure.message; }
    if (size[0] !== innerWidth || size[1] !== innerHeight) { layoutAgain = true; return; }
    const result = await post('layout', { rows, error, size });
    if (result.reload) {
      rebuilding = true; projection = null; draw();
      // Real surface navigation revokes the old host ticket before extraction.
      location.reload();
    } else document.body.dataset.layoutReady = String(result.layout);
  } catch (error) { notice(error.message); }
  finally {
    measuring = false;
    if (layoutAgain) { layoutAgain = false; scheduleLayout(); }
  }
}
function scheduleLayout() { clearTimeout(layoutTimer); layoutTimer = setTimeout(rebuild, 160); }
async function follow(link) {
  const item = model?.links[link];
  if (!item || rebuilding) return;
  try {
    const result = await post('follow', { link });
    if (result.fragment) document.getElementById(result.fragment)?.scrollIntoView({ block: 'start' });
    if (result.reload) { rebuilding = true; projection = null; draw(); location.reload(); }
  } catch (error) { notice(error.message); }
}

// Syntax highlighting can split a run into nested text nodes. Resolve against
// their concatenated UTF-16 content. Use text-only ranges to avoid duplicate
// rectangles for both fully selected syntax elements and their text children.
function ranges() {
  const formulas = new Set();
  return (projection?.ranges ?? []).flatMap(part => {
    const element = runs.get(part.run);
    if (!element) return [];
    if (element.dataset.math) {
      if (formulas.has(part.run)) return [];
      formulas.add(part.run);
      const range = document.createRange();
      range.selectNode(element);
      return [range];
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), result = [];
    let node, offset = 0;
    while ((node = walker.nextNode())) {
      const start = Math.max(0, part.start - offset), end = Math.min(node.length, part.end - offset);
      if (start < end) {
        const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end); result.push(range);
      }
      offset += node.length;
      if (offset >= part.end) break;
    }
    return result;
  });
}
function draw(reveal = false) {
  layer.replaceChildren();
  layer.dataset.sequence = String(sequence);
  if (document.documentElement.dataset.jusiMode === 'rich') return;
  const active = ranges();
  if (reveal && active.length) {
    const rect = active[0].getBoundingClientRect();
    const top = 24, bottom = innerHeight - 24;
    if (rect.top < top || rect.bottom > bottom) window.scrollBy({ top: rect.top - Math.max(top, innerHeight / 3), behavior: 'instant' });
    // Reveal horizontally clipped code and wide tables as well.
    const element = rangeElement(active[0]);
    const scroller = element.closest('pre, .table-scroll, .math-display');
    if (scroller) {
      const bounds = scroller.getBoundingClientRect(), glyph = active[0].getBoundingClientRect();
      if (glyph.left < bounds.left || glyph.right > bounds.right) scroller.scrollLeft += glyph.left - bounds.left - 24;
    }
  }
  const fragment = document.createDocumentFragment();
  for (const range of active) for (const rect of rangeElement(range).dataset.math ? [rangeElement(range).getBoundingClientRect()] : range.getClientRects()) {
    let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
    let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
    const scroller = rangeElement(range).closest('pre, .table-scroll, .math-display');
    if (scroller) {
      const bounds = scroller.getBoundingClientRect();
      left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);
      top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
    }
    if (left >= right || top >= bottom) continue;
    const mark = document.createElement('div');
    mark.className = `mark ${projection.kind}`;
    Object.assign(mark.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    fragment.append(mark);
  }
  layer.append(fragment);
}
function rangeElement(range) {
  return range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer.childNodes[range.startOffset] : range.startContainer.parentElement;
}
function scheduleDraw() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; draw(); });
}
async function poll() {
  try {
    const state = await fetch('./state').then(response => response.json());
    if (state.page !== page || rebuilding) return;
    const key = JSON.stringify(state.projection);
    sequence = state.sequence;
    if (key !== previous) { previous = key; projection = state.projection; draw(true); }
    else layer.dataset.sequence = String(sequence);
    if (state.linkAction?.page === page && state.linkAction.sequence > lastAction) {
      lastAction = state.linkAction.sequence;
      await follow(state.linkAction.link);
    }
  } catch { /* Owner shutdown or temporary request failure; next poll retries. */ }
  finally { setTimeout(poll, 60); }
}
for (const table of document.querySelectorAll('table')) {
  const wrapper = document.createElement('div'); wrapper.className = 'table-scroll';
  table.replaceWith(wrapper); wrapper.append(table);
}
document.addEventListener('scroll', scheduleDraw, true);
window.addEventListener('resize', () => { scheduleDraw(); scheduleLayout(); });
new ResizeObserver(() => { scheduleDraw(); scheduleLayout(); }).observe(document.querySelector('main'));
new MutationObserver(() => draw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-jusi-mode'] });
document.fonts.addEventListener('loadingdone', scheduleLayout);
document.addEventListener('click', event => {
  const link = event.target.closest('a[data-link][href]');
  if (!link) return;
  const item = model?.links[Number(link.dataset.link)];
  if (!item) return;
  event.preventDefault();
  void follow(Number(link.dataset.link));
});
async function start() {
  model = await fetch('./model').then(response => response.json());
  if (model.page !== page) return;
  await document.fonts.ready;
  await rebuild();
  const hash = document.body.dataset.fragment;
  if (hash) { try { document.getElementById(decodeURIComponent(hash))?.scrollIntoView({ block: 'start' }); } catch { /* malformed fragment */ } }
  poll();
}
start().catch(error => notice(error.message));
