import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../lib/markdown.mjs';
import { materialize, linkAt } from '../lib/layout.mjs';
import { createProjection } from '../lib/projection.mjs';
test('measured rows split prose at visual boundaries and retain exact link ownership', () => {
  const base = compile('Hello **café** [first](one.md) and [second](two.md) 😀');
  const index = text => base.runs.indexOf(text);
  const rows = [[[index('Hello '), 0, 5]], [[index('café'), 0, 4], null, [index('first'), 0, 5], [index(' and '), 0, 5], [index('second'), 0, 6]], [[index(' 😀'), 1, 3]]];
  const model = materialize(base, rows, 1);
  assert.deepEqual(model.lines.map(l => l.text), ['Hello', 'café\tfirst and second', '😀']);
  assert.equal(linkAt(model, 1, 16), 1);
  assert.equal(linkAt(model, 1, 0), 0);
  const p = createProjection(model)({ anchor: model.lines[2].anchor, cursorByte: 0 });
  assert.deepEqual(p.ranges, [{ run: index(' 😀'), start: 1, end: 3 }]);
  assert.notEqual(materialize(base, rows, 2).lines[0].anchor.source, model.lines[0].anchor.source);
  assert.throws(() => materialize(base, [[[index(' 😀'), 2, 3]]], 1), /boundary/);
  assert.throws(() => materialize(base, [[[999, 0, 1]]], 1), /boundary/);
});
