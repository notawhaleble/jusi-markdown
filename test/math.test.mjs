import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, extract } from '../lib/markdown.mjs';
import { createProjection } from '../lib/projection.mjs';

test('inline delimiters preserve TeX and typeset fractions, indices and roots', () => {
  const source = String.raw`For $x_i^2$ use \(\frac{α}{\sqrt{2}}\) in prose.`;
  const model = compile(source);
  assert.equal((model.html.match(/data-math="true"/g) ?? []).length, 2);
  assert.match(model.html, /<mfrac>/);
  assert.match(model.html, /<msqrt>/);
  assert.equal(extract(model).lines[0].text, source);
  const project = createProjection(model);
  let byte = 0;
  for (const char of source) {
    const { ranges } = project({ anchor: model.lines[0].anchor, cursorByte: byte });
    assert.equal(ranges.map(r => model.runs[r.run].slice(r.start, r.end)).join(''), char);
    byte += Buffer.byteLength(char);
  }
});

test('display blocks preserve source lines, comments, source anchors and equation environments', () => {
  for (const [open, close] of [['$$', '$$'], ['\\[', '\\]']]) {
    const formula = String.raw`\begin{aligned}
f(x) &= \int_0^x t^2\,dt \\ % keep this comment on its own source line
     &= \frac{x^3}{3}
\end{aligned}`;
    const source = `Before\r\n${open}\r\n${formula.replaceAll('\n', '\r\n')}\r\n${close}\r\nAfter`;
    const model = compile(source);
    assert.match(model.html, /katex-display/);
    assert.match(model.html, /<mtable/);
    assert.doesNotMatch(model.html, /math-error/);
    assert.equal(model.lines.map(l => l.text).join('\n'), source.replaceAll('\r\n', '\n'));
    for (const row of model.lines.slice(1, -1)) {
      assert.equal(row.anchor.startByte, Buffer.byteLength('Before\r\n'));
      assert.equal(row.anchor.endByte, Buffer.byteLength(source.slice(0, source.indexOf('After'))));
    }
  }
});

test('math works in lists, blockquotes, headings, links, tables and math fences', () => {
  const model = compile(String.raw`# Roots $\sqrt{x}$

- $\alpha_1$

> \[
> \begin{pmatrix}1 & 0\\0 & 1\end{pmatrix}
> \]

[Value $x$](chapter.md)

| Formula | Meaning |
| --- | --- |
| $\sum_{i=1}^n i$ | sum |

` + '```math\nx^2+y^2=z^2\n```');
  assert.equal((model.html.match(/data-math="true"/g) ?? []).length, 6);
  assert.doesNotMatch(model.html, /math-error/);
  assert.equal(model.runLinks[model.runs.indexOf('$x$')], 0);
  assert.equal(model.headings[0].title, 'Roots $\\sqrt{x}$');
});

test('literal dollars, Markdown escapes and code are preserved', () => {
  const model = compile('Costs $5 and $10. Escaped \\$x\\$. Unclosed $x.\n\n`$x$` and `\\(x\\)`\n\n```tex\n$$x$$\n```\n\n    $x$\n');
  assert.doesNotMatch(model.html, /data-math/);
  assert.match(model.html, /Costs \$5 and \$10/);
  assert.ok(model.runs.includes('$$x$$'));
  assert.ok(model.runs.includes('$x$'));
  assert.doesNotMatch(compile('$$\nunfinished').html, /data-math/);
});

test('bad or excessive TeX falls back to escaped source; math cannot inject resources or HTML', () => {
  for (const tex of [String.raw`\frac{`, String.raw`\unknown{x}`, String.raw`\def\a{\a}\a`, 'x'.repeat(10001)]) {
    const model = compile(`$${tex}$`);
    assert.match(model.html, /math-error/);
    assert.equal(model.lines[0].text, `$${tex}$`);
  }
  const model = compile(String.raw`$\href{javascript:alert(1)}{x}$ $\includegraphics{https://example.com/x.png}$ $\htmlClass{evil}{x}$ $\text{<script>alert(1)</script>}$`);
  assert.doesNotMatch(model.html, /<script|<img|href=|class="evil"/);
  assert.equal(model.links.length, 0);
  const isolated = compile(String.raw`$\gdef\foo{1}\foo$ then $\foo$`);
  assert.match(isolated.html, /math-error/);
});
