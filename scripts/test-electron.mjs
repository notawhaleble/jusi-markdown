import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { createServer } from 'node:http';
const root = fileURLToPath(new URL('..', import.meta.url));
const host = resolve(process.env.JUSI_NEOVIM_ROOT ?? join(root, '../jusi-neovim'));
const electron = createRequire(join(host, 'package.json'))('electron');
const scratch = await mkdtemp(join(tmpdir(), 'jusi-markdown-electron-'));
const external = createServer((_req, res) => res.end('<!doctype html><title>External reference</title><p>External reference reached</p>'));
await new Promise(resolve => external.listen(0, '127.0.0.1', resolve));
try {
  const fixture = join(scratch, 'fixture.md');
  const demo = await readFile(join(root, 'examples/demo.md'), 'utf8');
  const math = (await readFile(join(root, 'examples/math.md'), 'utf8')).replace(/^#/gm, '##')
    + '\n\n$$\nW = ' + Array.from({ length: 60 }, (_, i) => `x_{${i}}`).join(' + ') + '\n$$\n';
  await writeFile(fixture, demo + '\n\n## Wrapping\n\n' + 'A long paragraph with **bold** and Unicode 文 😀 text. '.repeat(15) + '\n\n![Local image](pixel.png)\n\n```js\nconst wide = "' + 'x'.repeat(300) + 'END";\n```\n\nFollow [first chapter](chapter.md) or [second chapter](second.md).\n\n' + math);
  await writeFile(join(scratch, 'chapter.md'), '# First chapter\n\n[Return to fixture](fixture.md)\n\n[External reference](http://127.0.0.1:' + external.address().port + '/external)\n');
  await writeFile(join(scratch, 'second.md'), '# Second chapter\n\n[Return to fixture](fixture.md)\n');
  await writeFile(join(scratch, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6ioAAAAASUVORK5CYII=', 'base64'));
  await mkdir(join(root, '.local/review'), { recursive: true });
  const child = spawn(electron, [join(root, 'test/electron.mjs')], {
    cwd: root, stdio: 'inherit', env: { ...process.env, JUSI_MARKDOWN_ROOT: root, JUSI_NEOVIM_ROOT: host,
      JUSI_TEST_SCRATCH: scratch, JUSI_TEST_FILE: fixture, JUSI_TEST_NODE: process.execPath, JUSI_TEST_EXTERNAL: `http://127.0.0.1:${external.address().port}/external`,
      XDG_STATE_HOME: join(scratch, 'state'), XDG_CACHE_HOME: join(scratch, 'cache') },
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 120000);
  try { const [code, signal] = await once(child, 'exit'); process.exitCode = signal ? 1 : code ?? 1; }
  finally { clearTimeout(timeout); }
} finally { external.closeAllConnections(); external.close(); await rm(scratch, { recursive: true, force: true }); }
