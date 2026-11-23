import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, cp, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const host = resolve(process.env.JUSI_NEOVIM_ROOT ?? join(root, '../jusi-neovim'));
const scratch = await mkdtemp(join(tmpdir(), 'jusi-markdown-host-'));
try {
  const packages = join(scratch, 'site/pack/test/start');
  const plugin = join(packages, 'jusi-markdown'); await mkdir(plugin, { recursive: true });
  await cp(join(host, 'runtime'), join(packages, 'jusi-host'), { recursive: true });
  for (const name of ['lua', 'plugin', 'lib', 'viewer.mjs', 'layout.js', 'viewer.js', 'viewer.css']) await cp(join(root, name), join(plugin, name), { recursive: true });
  await symlink(join(root, 'node_modules'), join(plugin, 'node_modules'), 'dir');
  const path = join(scratch, 'fixture % # " ; name.md');
  await writeFile(path, '# Hello café\n\nSearch and yank **Привет 文 😀**\n');
  const init = join(scratch, 'init.lua');
  await writeFile(init, "vim.opt.packpath = { vim.env.JUSI_TEST_PACKPATH, vim.env.VIMRUNTIME }\nvim.g.jusi_markdown = { node = vim.env.JUSI_TEST_NODE, text_layer = 'off' }\n");
  const result = spawnSync(process.env.JUSI_NVIM ?? 'nvim', ['--headless', '-u', init,
    '-c', "lua local ok, err = pcall(dofile, vim.env.JUSI_TEST_SCRIPT); if not ok then print(err); vim.cmd('cquit 1') end"], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, XDG_CONFIG_HOME: join(scratch, 'config'), XDG_DATA_HOME: join(scratch, 'data'),
      XDG_STATE_HOME: join(scratch, 'state'), XDG_CACHE_HOME: join(scratch, 'cache'),
      JUSI_TEST_PACKPATH: join(scratch, 'site'), JUSI_TEST_SCRIPT: join(root, 'test/host.lua'),
      JUSI_TEST_NODE: process.execPath, JUSI_TEST_FILE: path, JUSI_TEST_LAYOUT: join(root, 'test/publish-layout.mjs') },
  });
  process.stdout.write(result.stdout + result.stderr);
  if (result.error || result.status !== 0) throw new Error(`Neovim integration failed: ${result.error ?? result.status}`);
} finally { await rm(scratch, { recursive: true, force: true }); }
