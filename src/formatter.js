'use strict';
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// fmt writes its input file. Give it a private snapshot, never the user's file.
async function formatSource(executable, source, { signal, timeout = 10000 } = {}) {
  if (Buffer.byteLength(source, 'utf8') > 1024 * 1024) throw new Error('Formatting is limited to 1 MiB of source.');
  signal?.throwIfAborted();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-format-'));
  try {
    const filename = path.join(directory, 'buffer.scripta');
    await fs.writeFile(filename, source, { mode: 0o600 });
    signal?.throwIfAborted();
    await new Promise((resolve, reject) => {
      execFile(executable, ['fmt', '--', filename], {
        signal, timeout, maxBuffer: 1024 * 1024, encoding: 'utf8', windowsHide: true,
      }, (error, stdout, stderr) => {
        if (error) {
          if (typeof error.code === 'number' && !error.killed) {
            error.message = stderr.trim() || stdout.trim() || `scripta fmt exited with code ${error.code}`;
          }
          reject(error);
        } else resolve();
      });
    });
    signal?.throwIfAborted();
    const metadata = await fs.stat(filename);
    if (metadata.size > 4 * 1024 * 1024) throw new Error('Formatted source exceeded 4 MiB.');
    return await fs.readFile(filename, 'utf8');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

// Align every non-whitespace UTF-16 code unit and edit only the gaps. Keeping
// edits small preserves cursor positions and confines selection formatting.
function whitespaceEdits(source, formatted, start = 0, end = source.length, eol = '\n') {
  const edits = [];
  const whitespace = character => character !== undefined && /[ \t\r\n]/.test(character);
  let left = 0;
  let right = 0;
  while (left < source.length || right < formatted.length) {
    const from = left;
    const replacement = right;
    while (whitespace(source[left])) left++;
    while (whitespace(formatted[right])) right++;
    const oldText = source.slice(from, left);
    const rawText = formatted.slice(replacement, right);
    // Unchanged gaps may be inside literal multiline strings. Leave them exact.
    const newText = oldText === rawText ? rawText : rawText.replace(/\r?\n/g, eol);
    if (oldText !== newText && from >= start && left <= end) edits.push({ start: from, end: left, newText });
    if (source[left] !== formatted[right]) throw new Error('Formatter changed source text beyond whitespace; no edits applied.');
    left++;
    right++;
  }
  return edits;
}

function registerFormatting(vscode, context, formatter = formatSource) {
  const running = new Set();
  let disposed = false;
  const output = vscode.window.createOutputChannel('Scripta Formatting');
  const provider = {
    async provideDocumentRangeFormattingEdits(document, range, _options, token) {
      if (disposed || !vscode.workspace.isTrusted || token.isCancellationRequested) return [];
      const source = document.getText();
      const version = document.version;
      const controller = new AbortController();
      const cancellation = token.onCancellationRequested(() => controller.abort());
      running.add(controller);
      try {
        const executable = vscode.workspace.getConfiguration('scripta', document.uri).get('executablePath', 'scripta');
        if (typeof executable !== 'string' || !executable.trim()) throw new Error('Set scripta.executablePath to the Scripta executable.');
        const formatted = await formatter(executable, source, { signal: controller.signal });
        if (disposed || controller.signal.aborted || token.isCancellationRequested || document.isClosed
          || document.version !== version || !vscode.workspace.isTrusted) return [];
        const edits = whitespaceEdits(source, formatted, document.offsetAt(range.start), document.offsetAt(range.end),
          document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
        return edits.map(edit => vscode.TextEdit.replace(
          new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.newText));
      } catch (error) {
        if (disposed || controller.signal.aborted || token.isCancellationRequested) return [];
        const message = error.code === 'ENOENT'
          ? 'Cannot find scripta. Set scripta.executablePath to a runtime with the fmt command.'
          : error.killed ? 'Scripta formatting exceeded its time limit.' : error.message;
        output.appendLine(message);
        throw new Error(message);
      } finally {
        cancellation.dispose();
        running.delete(controller);
      }
    },
  };
  // VS Code also uses range formatters for Format Document and format on save.
  context.subscriptions.push(output, vscode.languages.registerDocumentRangeFormattingEditProvider([
    { language: 'scripta', scheme: 'file' }, { language: 'scripta', scheme: 'untitled' },
  ], provider), { dispose() {
    disposed = true;
    for (const controller of running) controller.abort();
    running.clear();
  } });
}

module.exports = { formatSource, whitespaceEdits, registerFormatting };
