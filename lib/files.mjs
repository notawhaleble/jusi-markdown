import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import MarkdownIt from 'markdown-it';

export async function readBounded(path, limit) {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error(`Expected a regular file no larger than ${limit} bytes`);
    const data = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
    let size = 0;
    while (size < data.length) {
      const result = await file.read(data, size, data.length - size, size);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    if (size > stat.size || size > limit) throw new Error('File changed or exceeded its size limit while reading');
    return data.subarray(0, size);
  } finally { await file.close(); }
}

export async function snapshot(path) {
  const sourcePath = await realpath(path);
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readBounded(sourcePath, 1048576));
  if (source.includes('\0')) throw new Error('Markdown contains NUL');
  const images = new Map(), assets = new Map(), directory = dirname(sourcePath);
  const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' };
  const sources = new Set();
  function visit(tokens) { for (const token of tokens) { if (token.type === 'image') sources.add(token.attrGet('src')); if (token.children) visit(token.children); } }
  visit(new MarkdownIt({ html: false }).parse(source, {}));
  let total = 0;
  for (const src of sources) {
    try {
      const decoded = decodeURIComponent(src);
      if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || isAbsolute(decoded) || decoded.includes('\0') || decoded.includes('\\')) continue;
      const file = await realpath(resolve(directory, decoded));
      const rel = relative(directory, file), type = types[extname(file).toLowerCase()];
      if (!type || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) continue;
      const data = await readBounded(file, Math.min(16777216, 33554432 - total));
      total += data.length;
      const name = `asset/${assets.size}`;
      images.set(src, `./${name}`); assets.set(name, { data, type });
    } catch { /* Missing or unsupported images retain their readable captions. */ }
  }
  return { source, images, assets };
}
