import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, extract } from '../lib/markdown.mjs';
import { createProjection, rangesFor } from '../lib/projection.mjs';

const source = '# Café 文 😀\r\n\r\nA **bold** and *italic* [link](https://example.com).\r\nnext line\r\n\r\n- [x] Done\r\n- [ ] Later\r\n\r\n> Quote\r\n\r\n```js\r\nconst x = "é";\r\n  x++;\r\n```\r\n\r\n| A | B |\r\n| - | - |\r\n| x | y |\r\n';
test('rich formatting and readable rows share unique original-source anchors', () => {
  const model = compile(source), doc = extract(model);
  for (const tag of ['h1', 'strong', 'em', 'ul', 'blockquote', 'pre', 'table']) assert.match(model.html, new RegExp(`<${tag}[ >]`));
  assert.match(model.html, /hljs-keyword/);
  assert.deepEqual(doc.lines.map(l => l.text), ['Café 文 😀', 'A bold and italic link.', 'next line', '☑ Done', '☐ Later', 'Quote', 'const x = "é";', '  x++;', 'A', 'B', 'x', 'y']);
  assert.equal(new Set(doc.lines.map(l => l.anchor.source)).size, doc.lines.length);
  for (const { anchor } of doc.lines) assert.ok(anchor.endByte > anchor.startByte && anchor.endByte <= Buffer.byteLength(source));
  assert.equal(Buffer.from(source).subarray(0, doc.lines[0].anchor.endByte).toString(), '# Café 文 😀\r\n');
  for (const row of model.lines) {
    assert.equal(row.segments.map(s => model.runs[s.run].slice(s.from, s.to)).join(''), row.text);
  }
});
test('UTF-8 cursors resolve to exact UTF-16 characters through formatting and multiline code', () => {
  const model = compile('A **é** 文 😀 é\n\n```js\nlet x = "文";\nx++;\n```');
  const project = createProjection(model);
  const textFor = ranges => ranges.map(r => model.runs[r.run].slice(r.start, r.end)).join('');
  for (let row = 0; row < model.lines.length; row++) {
    let byte = 0;
    for (const char of model.lines[row].text) {
      assert.equal(textFor(project({ anchor: model.lines[row].anchor, cursorByte: byte }).ranges), char);
      byte += Buffer.byteLength(char);
    }
  }
  assert.equal(textFor(rangesFor(model, 0, 2, 12)), 'é 文 😀');
  assert.equal(project({ anchor: { ...model.lines[0].anchor, source: 'forged' }, cursorByte: 0 }), null);
  assert.equal(project({ anchor: model.lines[0].anchor, cursorByte: -1 }), null);
  assert.deepEqual(rangesFor(model, 0, 0, 1000), []);
  assert.deepEqual(project({ anchor: model.lines[0].anchor, cursorByte: 0, selection: [] }).ranges, []);
  const selection = project({ anchor: model.lines[0].anchor, selection: [{ row: 0, startByte: 2, endByte: 4 }, { row: 2, startByte: 0, endByte: 3 }] });
  assert.equal(selection.kind, 'selection'); assert.equal(textFor(selection.ranges), 'éx++');
});
test('entities, escapes, links, image captions, task symbols and duplicate headings remain mappable', () => {
  const model = compile('# Same\n\n# Same\n\n# Same-1\n\n&amp; \\* **[é](https://example.com)** ![**alt**](x.png)\n\n- [X] done');
  assert.deepEqual(model.headings.map(h => h.id), ['same', 'same-1', 'same-1-1']);
  assert.equal(model.lines[3].text, '& * é [Image: alt]');
  assert.equal(model.lines[4].text, '☑ done');
  assert.match(model.html, /target="_blank"/);
});
test('untrusted HTML and resource URLs cannot become executable content', () => {
  const model = compile('<script>globalThis.pwned=1</script>\n\n![secret](file:///etc/passwd)\n\n[x](javascript:alert(1)) [local](../secret) [web](https://example.com)');
  assert.ok(!model.html.includes('<script>')); assert.ok(!model.html.includes('<img'));
  assert.ok(!model.html.includes('href="javascript:')); assert.ok(!model.html.includes('href="../'));
  assert.match(model.html, /href="https:\/\/example.com"/);
});
test('empty input, CR-only input and host extraction limits', () => {
  assert.deepEqual(extract(compile('')).lines, []);
  assert.equal(compile('# One\r\rTwo').lines[1].anchor.startByte, 7);
  assert.equal(compile('\uFEFF# One\r\rTwo').lines[1].anchor.startByte, 10);
  assert.throws(() => extract(compile('x'.repeat(524289))), /budget/);
  assert.throws(() => extract(compile('a\n'.repeat(10001))), /budget/);
});
