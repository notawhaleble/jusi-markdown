const bytes = text => new TextEncoder().encode(text).length;
const key = anchor => JSON.stringify([anchor.source, anchor.startByte, anchor.endByte]);

// Return UTF-16 DOM Range boundaries for the UTF-8 ranges supplied by Neovim.
// Never estimate widths: Chromium supplies the actual glyph geometry.
export function rangesFor(model, rowIndex, startByte, endByte) {
  const row = model.lines[rowIndex];
  if (!row || !Number.isSafeInteger(startByte) || !Number.isSafeInteger(endByte) || startByte < 0 || endByte < startByte || endByte > bytes(row.text)) return [];
  const result = [];
  for (const segment of row.segments) {
    let byte = segment.startByte, offset = segment.from, start, end;
    for (const char of model.runs[segment.run].slice(segment.from, segment.to)) {
      const next = byte + bytes(char);
      if (byte < endByte && next > startByte) { start ??= offset; end = offset + char.length; }
      byte = next; offset += char.length;
    }
    if (start !== undefined) result.push({ run: segment.run, start, end });
  }
  return result;
}

export function createProjection(model) {
  const rows = new Map(model.lines.map((line, row) => [key(line.anchor), row]));
  return frame => {
    if (!frame.anchor) return null;
    const row = rows.get(key(frame.anchor));
    if (row === undefined) return null;
    if (frame.selection !== null && frame.selection !== undefined) {
      if (!Array.isArray(frame.selection) || frame.selection.length > 512) return null;
      const ranges = frame.selection.flatMap(s => rangesFor(model, s.row, s.startByte, s.endByte));
      return { kind: 'selection', row, ranges };
    }
    const text = model.lines[row].text, length = bytes(text);
    if (!Number.isSafeInteger(frame.cursorByte) || frame.cursorByte < 0 || frame.cursorByte > length) return null;
    let start = 0, end = 0;
    for (const char of text) {
      end = start + bytes(char);
      if (end > frame.cursorByte) break;
      start = end;
    }
    return { kind: 'cursor', row, ranges: rangesFor(model, row, start, end) };
  };
}
