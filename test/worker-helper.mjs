import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
export const capabilities = ['surface.web', 'text.extract', 'source.navigate', 'source.navigate.cursor', 'source.navigate.selection', 'surface.actions'];
export const ticket = { bufferId: 1, incarnation: 1, sessionId: 'test', revision: 1 };
export function worker(path) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../viewer.mjs', import.meta.url)), path]);
  const exit = once(child, 'exit'), frames = [], waiters = [];
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  createInterface({ input: child.stdout }).on('line', line => { frames.push(JSON.parse(line)); waiters.shift()?.(); });
  return { child, exit, frames, stderr: () => stderr,
    send: frame => child.stdin.write(JSON.stringify(frame) + '\n'),
    async next() {
      if (!frames.length) await Promise.race([new Promise(resolve => waiters.push(resolve)),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`frame timeout: ${stderr}`)), 5000).unref()),
        exit.then(() => { throw new Error(`worker exited: ${stderr}`); })]);
      return frames.shift();
    },
  };
}
export async function stateAt(url, predicate) {
  for (let i = 0; i < 200; i++) {
    const state = await fetch(url + 'state').then(response => response.json());
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('state timeout');
}
export const post = (url, route, data) => fetch(url + route, { method: 'POST', headers: { Origin: new URL(url).origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
// Protocol fixture only; real geometry is exercised in Electron.
export async function publishFixtureLayout(url, size = [900, 700]) {
  const model = await fetch(url + 'model').then(r => r.json());
  const rows = model.lines.map(line => line.segments.map(s => [s.run, s.from, s.to]));
  return post(url, 'layout', { page: model.page, rows, size });
}
