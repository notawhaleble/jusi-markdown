import { extract } from './markdown.mjs';

// The sandbox supplies only ranges into immutable runs, never arbitrary text,
// host tickets, filenames, or executable values. Revalidate at this boundary.
export function materialize(model, rows, generation) {
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error('Rendered text exceeds the host row budget');
  let parts = 0;
  const lines = rows.map((items, index) => {
    if (!Array.isArray(items)) throw new Error('Invalid rendered row');
    const line = { text: '', segments: [], anchor: { source: `view:${generation}:${index}`, startByte: 0, endByte: 0 } };
    for (const part of items) {
      if (++parts > 100000) throw new Error('Rendered mapping exceeds its budget');
      if (part === null) { line.text += '\t'; continue; }
      if (!Array.isArray(part) || part.length !== 3) throw new Error('Invalid rendered range');
      const [run, from, to] = part, text = model.runs[run];
      if (![run, from, to].every(Number.isSafeInteger) || typeof text !== 'string' || from < 0 || to <= from || to > text.length
          || /[\uDC00-\uDFFF]/.test(text[from] ?? '') || /[\uDC00-\uDFFF]/.test(text[to] ?? '')) throw new Error('Invalid rendered text boundary');
      const value = text.slice(from, to);
      if (/[\r\n]/.test(value)) throw new Error('Rendered row contains a line break');
      const startByte = Buffer.byteLength(line.text), endByte = startByte + Buffer.byteLength(value);
      line.segments.push({ run, from, to, startByte, endByte });
      line.text += value;
    }
    line.anchor.endByte = Buffer.byteLength(line.text);
    return line;
  });
  const result = { ...model, lines };
  extract(result); // Enforce the transport and text limits before publication.
  return result;
}

export function linkAt(model, row, column) {
  const line = model?.lines[row];
  if (!line) return null;
  const exact = line.segments.find(s => s.startByte <= column && column < s.endByte && model.runLinks[s.run] !== null);
  const first = exact ?? line.segments.find(s => model.runLinks[s.run] !== null);
  return first ? model.runLinks[first.run] : null;
}
