import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { snapshot } from './lib/files.mjs';
import { compile, extract, isLocalMarkdown } from './lib/markdown.mjs';
import { createProjection } from './lib/projection.mjs';
import { materialize, linkAt } from './lib/layout.mjs';

let path = resolve(process.argv[2]);
const metadata = process.argv[3];
let file = await snapshot(path), model = compile(file.source, { images: file.images });
const resources = new Map(await Promise.all(['viewer.js', 'layout.js', 'viewer.css'].map(async name => [name, await readFile(new URL(name, import.meta.url))])));
const katexDist = new URL('./', import.meta.resolve('katex'));
resources.set('katex/katex.min.css', await readFile(new URL('katex.min.css', katexDist)));
for (const name of await readdir(new URL('fonts/', katexDist))) {
  if (/\.(woff2?|ttf)$/.test(name)) resources.set(`katex/fonts/${name}`, await readFile(new URL(`fonts/${name}`, katexDist)));
}
const token = randomUUID(), base = `/${token}/`;
const escape = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let current, extraction, sequence = 0, projection = null, published = false, hello = false;
let pageId = 0, layoutId = 0, layout, project, layoutKey, layoutError, linkAction = null, actionSequence = 0, layoutNeedsReload = false;
let fragment = '', navigation = Promise.resolve();
let restore, lastCursor, position, positionId = 0, external, externalId = 0, metadataWrites = Promise.resolve();
const same = (a, b) => a && b && ['bufferId', 'incarnation', 'sessionId', 'revision'].every(key => a[key] === b[key]);
const send = frame => process.stdout.write(JSON.stringify(frame) + '\n');
async function publishName() {
  if (!metadata) return;
  const data = JSON.stringify({ path, position, external });
  metadataWrites = metadataWrites.then(async () => {
    try { await writeFile(metadata + '.tmp', data, { mode: 0o600 }); await rename(metadata + '.tmp', metadata); }
    catch { /* Host disposal may already have removed its private directory. */ }
  });
  await metadataWrites;
}
await publishName();
function clear() { current = undefined; extraction = undefined; published = false; projection = null; linkAction = null; }
function page() {
  pageId++; layout = undefined; project = undefined; layoutKey = undefined; layoutError = undefined; layoutNeedsReload = false; clear();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(basename(path))}</title><link rel="stylesheet" href="./katex/katex.min.css"><link rel="stylesheet" href="./viewer.css"></head><body data-page="${pageId}" data-fragment="${escape(fragment)}"><main>${model.html || '<p class="empty">This document is empty.</p>'}</main><div id="notice" role="status" hidden></div><div id="projection" aria-hidden="true"></div><script type="module" src="./viewer.js"></script></body></html>`;
}
async function finishExtraction() {
  if (!extraction || extraction.finishing || layoutNeedsReload || !layout && !layoutError) return;
  const job = extraction; job.finishing = true;
  if (layoutError) { extraction = undefined; send({ type: 'text-result', id: job.id, ticket: job.ticket, error: layoutError }); }
  else {
    const prepared = layout, target = restore;
    const document = extract(prepared);
    if (target) {
      let point = target.kind === 'cursor' ? target : undefined;
      if (target.kind === 'target' && fragment) {
        let id; try { id = decodeURIComponent(fragment); } catch { id = fragment; }
        const heading = model.headings.find(h => h.id === id);
        const segment = heading && model.lines[heading.row]?.segments[0];
        if (segment) point = { run: segment.run, start: segment.from };
      }
      let row = 0, column = 0;
      if (point) for (let i = 0; i < layout.lines.length; i++) {
        const segment = layout.lines[i].segments.find(s => s.run === point.run && s.from <= point.start && point.start < s.to);
        if (segment) { row = i; column = segment.startByte + Buffer.byteLength(model.runs[point.run].slice(segment.from, point.start)); break; }
      }
      position = { id: ++positionId, ticket: job.ticket, row: row + 1, column, top: target.kind === 'target' };
      // Make restoration available before Neovim commits the new rows. Its
      // buffer-change callback applies it without a later timer moving the cursor.
      await publishName();
    }
    if (extraction !== job || layout !== prepared || layoutNeedsReload) return;
    extraction = undefined; published = true;
    if (restore === target) restore = undefined;
    send({ type: 'text-result', id: job.id, ticket: job.ticket, document });
  }
}
async function body(req) {
  let size = 0, chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2097152) throw new Error('Layout request exceeds 2 MiB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  const origin = `http://127.0.0.1:${server.address().port}`;
  if (req.headers.host !== new URL(origin).host) { res.writeHead(403).end(); return; }
  if (req.method === 'POST' && [base + 'layout', base + 'follow'].includes(req.url)) {
    if (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(403).end(); return; }
    try {
      const data = await body(req);
      if (data.page !== pageId) { json(res, { error: 'Obsolete page' }, 409); return; }
      if (req.url === base + 'layout') {
        if (!Array.isArray(data.size) || data.size.length !== 2 || !data.size.every(n => Number.isFinite(n) && n > 0 && n <= 100000)) throw new Error('Invalid viewport');
        const key = JSON.stringify([data.size, data.rows, data.error]);
        const reload = layoutKey !== undefined && layoutKey !== key;
        if (reload) { layoutNeedsReload = true; restore ??= lastCursor && { kind: 'cursor', ...lastCursor }; position = undefined; }
        if (layoutKey !== key) {
          layoutKey = key; layout = undefined; project = undefined; published = false; projection = null; layoutError = undefined;
          try {
            if (data.error) throw new Error(String(data.error).slice(0, 1000));
            layout = materialize(model, data.rows, ++layoutId); project = createProjection(layout);
          } catch (error) { layoutError = error.message.slice(0, 1000); }
        }
        // A real reload makes the host issue a new ticket. Never publish a changed
        // layout against the previous document revision.
        if (!reload) finishExtraction();
        json(res, { reload, layout: layoutId });
      } else {
        const link = model.links[data.link];
        if (!Number.isSafeInteger(data.link) || !link) throw new Error('Unknown reference');
        if (link.href.startsWith('#')) {
          const id = decodeURIComponent(link.href.slice(1)), heading = model.headings.find(h => h.id === id);
          if (!heading) throw new Error('Heading not found: ' + id);
          const point = model.lines[heading.row]?.segments[0];
          if (published && point) {
            const row = layout.lines.findIndex(line => line.segments.some(s => s.run === point.run && s.from <= point.from && point.from < s.to));
            if (row >= 0) {
              position = { id: ++positionId, ticket: current, row: row + 1, column: 0, top: true };
              await publishName();
            }
          }
          json(res, { fragment: id }); return;
        }
        if (/^https?:\/\//i.test(link.href)) {
          const url = new URL(link.href);
          external = { id: ++externalId, url: url.href }; await publishName();
          json(res, { opened: true }); return;
        }
        if (!isLocalMarkdown(link.href)) throw new Error('Not a local Markdown reference');
        const visit = async () => {
          if (data.page !== pageId) throw new Error('Obsolete page');
          const [relative, hash = ''] = link.href.split('#');
          const nextPath = resolve(dirname(path), decodeURIComponent(relative));
          const nextFile = await snapshot(nextPath), nextModel = compile(nextFile.source, { images: nextFile.images });
          if (data.page !== pageId) throw new Error('Obsolete page');
          clear(); layout = undefined; project = undefined; layoutKey = undefined;
          file = nextFile; model = nextModel; path = nextPath; fragment = hash;
          restore = { kind: 'target' }; lastCursor = undefined; position = undefined;
          pageId++;
          await publishName();
        };
        const job = navigation.then(visit); navigation = job.catch(() => {}); await job;
        json(res, { reload: true });
      }
    } catch (error) { json(res, { error: error.message.slice(0, 1000) }, 400); }
    return;
  }
  if (req.method !== 'GET') { res.writeHead(405).end(); return; }
  if (req.url === base) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page()); }
  else if (req.url === base + 'state') json(res, { projection, sequence, page: pageId, layout: layoutId, linkAction });
  else if (req.url === base + 'model') json(res, { page: pageId, lines: model.lines, runs: model.runs, links: model.links });
  else if (req.url.startsWith(base) && resources.has(req.url.slice(base.length))) {
    const name = req.url.slice(base.length), extension = name.split('.').at(-1);
    res.setHeader('Content-Type', { css: 'text/css', js: 'text/javascript', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf' }[extension]); res.end(resources.get(name));
  } else if (req.url.startsWith(base) && file.assets.has(req.url.slice(base.length))) {
    const { type, data } = file.assets.get(req.url.slice(base.length)); res.setHeader('Content-Type', type); res.end(data);
  } else res.writeHead(404).end();
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const stop = (code = 0) => { server.close(); process.exit(code); };
process.on('SIGTERM', () => stop()); process.on('SIGINT', () => stop()); process.stdout.on('error', () => stop());
const input = createInterface({ input: process.stdin });
input.on('close', () => stop());
input.on('line', line => {
  try {
    if (Buffer.byteLength(line) > 1048576) throw new Error('Worker input exceeds frame budget');
    const f = JSON.parse(line);
    if (f.type === 'shutdown') return stop();
    if (f.type === 'hello') {
      if (hello || f.version !== 1) throw new Error('Invalid worker handshake');
      const required = ['surface.web', 'text.extract', 'source.navigate', 'source.navigate.cursor', 'source.navigate.selection', 'surface.actions'];
      if (!required.every(capability => f.capabilities?.includes(capability))) throw new Error('Host must support character and selection navigation and surface actions');
      hello = true;
      send({ type: 'ready', version: 1, capabilities: required, surface: { backend: 'web', url: `http://127.0.0.1:${server.address().port}${base}` } });
      return;
    }
    if (!hello) throw new Error('Expected hello');
    if (f.type === 'cancel' && extraction?.id === f.id && same(extraction.ticket, f.ticket)) extraction = undefined;
    if (f.type === 'extract') {
      current = f.ticket; projection = null; published = false;
      extraction = { id: f.id, ticket: f.ticket }; setImmediate(finishExtraction);
    }
    if (f.type === 'navigate' && published && same(current, f.ticket) && Number.isSafeInteger(f.sequence) && f.sequence > sequence) {
      sequence = f.sequence; projection = project(f);
      const cursor = project({ ...f, selection: null });
      if (cursor?.ranges[0]) lastCursor = cursor.ranges[0];
    }
    if (f.type === 'action' && published && Number.isSafeInteger(f.sequence) && f.sequence > actionSequence) {
      actionSequence = f.sequence;
      const match = /^follow-link\.(\d+)\.(\d+)\.(\d+)$/.exec(f.action);
      if (match && Number(match[1]) === current?.revision) {
        const link = linkAt(layout, Number(match[2]) - 1, Number(match[3]));
        if (link !== null) linkAction = { sequence: actionSequence, page: pageId, link };
      }
    }
  } catch (error) { process.stderr.write(`${error.message}\n`); stop(1); }
});
