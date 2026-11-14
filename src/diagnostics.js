'use strict';

// Scripta reports one-based Unicode scalar columns; VS Code uses UTF-16 offsets.
function utf16Column(line, scalarColumn, firstLine = false) {
  let offset = firstLine && line.startsWith('\uFEFF') ? 1 : 0;
  let remaining = Math.max(0, scalarColumn - 1);
  for (const character of line.slice(offset)) {
    if (remaining-- <= 0) break;
    offset += character.length;
  }
  return offset;
}

function parseDiagnostics(output, source) {
  const lines = source.split(/\r\n|\r|\n/);
  const records = [];
  // ANSI color is optional in CLI output. Match a whole header to avoid excerpts.
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
  for (const block of clean.split(/(?=^error(?:\[[^\]\r\n]+\])?:)/m)) {
    const header = /^error(?:\[([^\]\r\n]+)\])?:[ \t]*(.*)$/m.exec(block);
    const location = /^[ \t]*--> (.+):(\d+):(\d+)[ \t]*$/m.exec(block);
    if (!header || !location) continue;
    const lineIndex = Number(location[2]) - 1;
    if (lineIndex < 0 || lineIndex >= lines.length) continue;
    const column = Number(location[3]);
    if (column < 1) continue;
    const width = /^[ \t]*\|[ \t]*(\^+)[ \t]*$/m.exec(block)?.[1].length ?? 1;
    const text = lines[lineIndex];
    const start = utf16Column(text, column, lineIndex === 0);
    const end = utf16Column(text, column + width, lineIndex === 0);
    const help = /^help:[ \t]*(.*)$/m.exec(block)?.[1];
    records.push({
      path: location[1], line: lineIndex, start, end,
      message: header[2] + (help ? '\n' + help : ''), code: header[1],
    });
  }
  return records;
}

module.exports = { parseDiagnostics, utf16Column };
