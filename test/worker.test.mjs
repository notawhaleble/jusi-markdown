import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { worker, capabilities, ticket, stateAt, publishFixtureLayout, post } from './worker-helper.mjs';

test('math stylesheet and fonts are local allowlisted resources with correct MIME and CSP', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'markdown-math-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'math.md'); await writeFile(path, '$\\frac{a}{b}$');
  const w = worker(path); t.after(() => w.child.kill());
  w.send({ type: 'hello', version: 1, capabilities });
  const { surface: { url } } = await w.next();
  const page = await fetch(url), html = await page.text();
  assert.match(html, /katex\/katex.min.css/);
  assert.match(html, /<mfrac>/);
  assert.match(page.headers.get('content-security-policy'), /font-src 'self'/);
  const css = await fetch(url + 'katex/katex.min.css');
  assert.equal(css.headers.get('content-type'), 'text/css');
  const fontPaths = [...(await css.text()).matchAll(/url\((fonts\/[^)]+)\)/g)].map(m => m[1]);
  assert.ok(fontPaths.length > 0);
  for (const path of fontPaths) {
    const font = await fetch(url + 'katex/' + path);
    assert.equal(font.status, 200, path);
    assert.match(font.headers.get('content-type'), /^font\//);
    assert.ok((await font.arrayBuffer()).byteLength > 0);
  }
  assert.equal((await fetch(url + 'katex/package.json')).status, 404);
});

test('worker snapshot, character/selection navigation, stale tickets, cancellation, isolation and EOF cleanup', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'markdown-worker-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'quoted " file; name.md');
  await writeFile(path, '# Hello\n\nUnicode **é** 文 😀\n');
  const w = worker(path); t.after(() => w.child.kill());
  w.send({ type: 'hello', version: 1, capabilities });
  const ready = await w.next(), url = ready.surface.url;
  assert.deepEqual(ready.capabilities, capabilities);
  const response = await fetch(url), html = await response.text();
  assert.match(html, /data-run="0">Hello/);
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal((await fetch(url + '../secret')).status, 404);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  await writeFile(path, '# Changed');
  await publishFixtureLayout(url);
  w.send({ type: 'extract', id: 1, ticket });
  const result = await w.next(); assert.equal(result.document.lines[0].text, 'Hello');
  let anchor = result.document.lines[1].anchor;
  w.send({ type: 'navigate', sequence: 1, ticket, windowId: 1000, anchor, cursorByte: 8, selection: null });
  let state = await stateAt(url, s => s.sequence === 1);
  assert.equal(state.projection.kind, 'cursor'); assert.equal(state.projection.ranges[0].end - state.projection.ranges[0].start, 1);
  w.send({ type: 'navigate', sequence: 2, ticket: { ...ticket, revision: 0 }, anchor: null });
  w.send({ type: 'navigate', sequence: 1, ticket, anchor: null });
  w.send({ type: 'navigate', sequence: 3, ticket, anchor, cursorByte: 13, selection: [{ row: 1, startByte: 8, endByte: 10 }] });
  state = await stateAt(url, s => s.sequence === 3);
  assert.equal(state.projection.kind, 'selection'); assert.equal(state.projection.ranges.length, 1);
  w.send({ type: 'navigate', sequence: 4, ticket, anchor, cursorByte: 0, selection: [] });
  assert.deepEqual((await stateAt(url, s => s.sequence === 4)).projection.ranges, []);
  w.send({ type: 'navigate', sequence: 5, ticket, anchor: null });
  assert.equal((await stateAt(url, s => s.sequence === 5)).projection, null);
  await fetch(url); // A new page waits for its measured layout.
  w.send({ type: 'extract', id: 2, ticket });
  w.send({ type: 'cancel', id: 2, ticket });
  await publishFixtureLayout(url);
  const newer = { ...ticket, revision: 2 };
  w.send({ type: 'extract', id: 3, ticket: newer });
  const rebuilt = await w.next(); assert.equal(rebuilt.id, 3); anchor = rebuilt.document.lines[1].anchor;
  w.send({ type: 'navigate', sequence: 99, ticket, anchor, cursorByte: 0 });
  w.send({ type: 'navigate', sequence: 6, ticket: newer, anchor, cursorByte: 0 });
  assert.equal((await stateAt(url, s => s.sequence === 6)).projection.kind, 'cursor');
  w.child.stdin.end(); assert.equal((await w.exit)[0], 0);
  await assert.rejects(fetch(url));
});
test('local image allowlist snapshots raster files and excludes traversal and symlinks outside the document directory', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'markdown-images-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'doc'));
  await writeFile(join(dir, 'outside.png'), 'outside');
  await writeFile(join(dir, 'doc', 'inside.png'), 'image snapshot');
  await symlink(join(dir, 'outside.png'), join(dir, 'doc', 'escape.png'));
  const path = join(dir, 'doc', 'images.md');
  await writeFile(path, '![yes](inside.png) ![no](../outside.png) ![no](escape.png) ![no](https://example.com/a.png)');
  const w = worker(path); t.after(() => w.child.kill());
  w.send({ type: 'hello', version: 1, capabilities }); const { surface } = await w.next();
  const html = await fetch(surface.url).then(r => r.text());
  assert.equal((html.match(/<img /g) ?? []).length, 1);
  await writeFile(join(dir, 'doc', 'inside.png'), 'changed');
  assert.equal(await fetch(surface.url + 'asset/0').then(r => r.text()), 'image snapshot');
  assert.equal((await fetch(surface.url + 'asset/1')).status, 404);
  w.send({ type: 'shutdown' }); assert.equal((await w.exit)[0], 0);
});
test('startup errors, capability mismatch, and recoverable extraction budget failures', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'markdown-errors-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'bad.md'), Buffer.from([255]));
  await writeFile(join(dir, 'nul.md'), 'a\0b');
  await writeFile(join(dir, 'large.md'), 'x'.repeat(1048577));
  for (const name of ['missing.md', 'bad.md', 'nul.md', 'large.md', '.']) {
    const w = worker(join(dir, name)); assert.notEqual((await w.exit)[0], 0, name);
  }
  const path = join(dir, 'text-budget.md'); await writeFile(path, 'x'.repeat(524289));
  const old = worker(path); old.send({ type: 'hello', version: 1, capabilities: ['surface.web'] });
  assert.notEqual((await old.exit)[0], 0); assert.match(old.stderr(), /character and selection/);
  const w = worker(path); t.after(() => w.child.kill());
  w.send({ type: 'hello', version: 1, capabilities }); const { surface } = await w.next();
  await fetch(surface.url); await publishFixtureLayout(surface.url);
  for (const id of [1, 2]) { w.send({ type: 'extract', id, ticket }); assert.match((await w.next()).error, /budget/); }
  assert.equal((await fetch(surface.url)).status, 200);
  w.send({ type: 'shutdown' }); assert.equal((await w.exit)[0], 0);
});

test('layout changes revoke projection until real navigation; relative references and stale actions stay scoped', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'markdown-layout-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'docs'));
  await writeFile(join(dir, 'README.md'), '# Start\n\nRead [one](docs/one.md) or [missing](docs/missing.md).\n');
  await writeFile(join(dir, 'docs/one.md'), '# One\n\n[Back](../README.md)\n');
  const w = worker(join(dir, 'README.md')); t.after(() => w.child.kill());
  w.send({ type: 'hello', version: 1, capabilities }); const { surface: { url } } = await w.next();
  await fetch(url); await publishFixtureLayout(url);
  w.send({ type: 'extract', id: 1, ticket }); const first = await w.next();
  const page = (await stateAt(url, s => s.page > 0)).page;
  w.send({ type: 'action', sequence: 1, action: 'follow-link.999.2.6', count: 1 });
  w.send({ type: 'action', sequence: 2, action: 'follow-link.1.2.6', count: 1 });
  assert.equal((await stateAt(url, s => s.linkAction?.sequence === 2)).linkAction.link, 0);
  const response = await publishFixtureLayout(url, [600, 700]); assert.equal((await response.json()).reload, true);
  w.send({ type: 'navigate', sequence: 1, ticket, anchor: first.document.lines[1].anchor, cursorByte: 0 });
  assert.equal((await fetch(url + 'state').then(r => r.json())).projection, null);
  await fetch(url); await publishFixtureLayout(url, [600, 700]);
  const newer = { ...ticket, revision: 2 };
  w.send({ type: 'extract', id: 2, ticket: newer }); const second = await w.next();
  assert.notEqual(first.document.lines[1].anchor.source, second.document.lines[1].anchor.source);
  assert.equal((await post(url, 'follow', { page, link: 0 })).status, 409);
  const currentPage = (await fetch(url + 'state').then(r => r.json())).page;
  assert.equal((await post(url, 'follow', { page: currentPage, link: 1 })).status, 400);
  assert.equal((await post(url, 'follow', { page: currentPage, link: 0 })).status, 200);
  await fetch(url); const model = await fetch(url + 'model').then(r => r.json());
  assert.equal(model.lines[0].text, 'One');
  assert.equal((await fetch(url + 'follow', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: '{}' })).status, 403);
  assert.equal((await post(url, 'follow', { page: model.page, link: 0 })).status, 200);
  await fetch(url); assert.equal((await fetch(url + 'model').then(r => r.json())).lines[0].text, 'Start');
  w.send({ type: 'shutdown' }); assert.equal((await w.exit)[0], 0);
});
