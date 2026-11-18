const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { formatSource, whitespaceEdits, registerFormatting } = require('../src/formatter');

function apply(source, edits) {
  for (const edit of [...edits].reverse()) source = source.slice(0, edit.start) + edit.newText + source.slice(edit.end);
  return source;
}

test('whitespace edits preserve Unicode, literal contents, CRLF and selection boundaries', () => {
  const source = '// Source\r\n$x= "😀 first\r\n second";\r\nif(true){echo $x;}';
  const formatted = '// Source\n$x = "😀 first\r\n second";\nif (true) {\n    echo $x;\n}\n';
  const edits = whitespaceEdits(source, formatted, 0, source.length, '\r\n');
  assert.equal(apply(source, edits), '// Source\r\n$x = "😀 first\r\n second";\r\nif (true) {\r\n    echo $x;\r\n}\r\n');
  const start = source.indexOf('if');
  const end = source.indexOf('echo');
  const selected = whitespaceEdits(source, formatted, start, end, '\r\n');
  assert.ok(selected.every(edit => edit.start >= start && edit.end <= end));
  assert.equal(apply(source, selected), source.slice(0, start) + 'if (true) {\r\n    ' + source.slice(end));
  assert.deepEqual(whitespaceEdits(formatted, formatted), []);
  assert.throws(() => whitespaceEdits('$x = 1;', '$x = 2;'), /beyond whitespace/);
  assert.throws(() => whitespaceEdits('\uFEFF$x = 1;', '$x = 1;'), /beyond whitespace/);
});

function harness(formatter) {
  const context = { subscriptions: [] };
  const state = { trusted: true, cancelled: false, logs: [] };
  const token = { get isCancellationRequested() { return state.cancelled; },
    onCancellationRequested(fn) { state.cancel = () => { state.cancelled = true; fn(); }; return { dispose() {} }; } };
  const vscode = {
    EndOfLine: { LF: 1, CRLF: 2 },
    Range: class { constructor(start, end) { Object.assign(this, { start, end }); } },
    TextEdit: { replace: (range, newText) => ({ start: range.start, end: range.end, newText }) },
    window: { createOutputChannel: () => ({ appendLine: message => state.logs.push(message), dispose() {} }) },
    workspace: { get isTrusted() { return state.trusted; }, getConfiguration: () => ({ get: () => '/tools/scripta with spaces' }) },
    languages: { registerDocumentRangeFormattingEditProvider(selector, provider) {
      state.selector = selector; state.provider = provider; return { dispose() {} };
    } },
  };
  const source = '// Source\nif(true){echo "literal  spaces";}';
  const document = { version: 1, uri: {}, eol: 1, getText: () => source, offsetAt: offset => offset, positionAt: offset => offset };
  registerFormatting(vscode, context, formatter);
  return { state, document, source, request: (range = { start: 0, end: source.length }) =>
    state.provider.provideDocumentRangeFormattingEdits(document, range, {}, token),
  dispose: () => context.subscriptions.forEach(item => item.dispose()) };
}

test('registered formatter uses current buffer, supports selections and skips untrusted requests', async () => {
  let calls = 0;
  const formatted = '// Source\nif (true) {\n    echo "literal  spaces";\n}\n';
  const h = harness(async (executable, source) => {
    calls++;
    assert.equal(executable, '/tools/scripta with spaces');
    assert.equal(source, h.source);
    return formatted;
  });
  assert.deepEqual(h.state.selector.map(selector => selector.scheme), ['file', 'untitled']);
  assert.equal(apply(h.source, await h.request()), formatted);
  const selected = await h.request({ start: 10, end: 18 });
  assert.ok(selected.every(edit => edit.start >= 10 && edit.end <= 18));
  h.state.trusted = false;
  assert.deepEqual(await h.request(), []);
  assert.equal(calls, 2);
  h.dispose();
  assert.equal(require('../package.json').contributes.configurationDefaults['[scripta]']['editor.formatOnSave'], true);
});

test('formatter discards stale, closed, cancelled, disposed and no longer trusted results', async () => {
  for (const invalidate of [h => h.document.version++, h => { h.document.isClosed = true; },
    h => h.state.cancel(), h => h.dispose(), h => { h.state.trusted = false; }]) {
    let finish;
    const h = harness(() => new Promise(resolve => { finish = resolve; }));
    const request = h.request();
    invalidate(h);
    finish('// Source\nif (true) {\n    echo "literal  spaces";\n}\n');
    assert.deepEqual(await request, []);
  }
  const h = harness(async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); });
  await assert.rejects(h.request(), /Cannot find scripta/);
  assert.match(h.state.logs[0], /executablePath/);
  h.dispose();
});

test('runtime adapter formats only a temporary snapshot and cleans up success, failure and cancellation', {
  skip: process.platform === 'win32' && 'The fake executable uses a POSIX shell launcher',
}, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-formatter-test-'));
  const executable = path.join(directory, 'fake runtime $ with spaces');
  const record = path.join(directory, 'record.json');
  async function runtime(body) {
    const script = path.join(directory, 'runtime.cjs');
    const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
    await fs.writeFile(script, `const fs = require('node:fs');\nconst args = process.argv.slice(2);\nfs.writeFileSync(${JSON.stringify(record)}, JSON.stringify(args));\n${body}`);
    await fs.writeFile(executable, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`, { mode: 0o700 });
  }
  async function cleaned() {
    const args = JSON.parse(await fs.readFile(record, 'utf8'));
    assert.deepEqual(args.slice(0, 2), ['fmt', '--']);
    await assert.rejects(fs.access(path.dirname(args[2])), { code: 'ENOENT' });
  }
  try {
    await runtime('fs.writeFileSync(args[2], fs.readFileSync(args[2], "utf8").replace("$x=1", "$x = 1"));');
    assert.equal(await formatSource(executable, '// Source\n$x=1;'), '// Source\n$x = 1;');
    await cleaned();
    await runtime('process.stderr.write("invalid syntax"); process.exit(1);');
    await assert.rejects(formatSource(executable, 'invalid'), /invalid syntax/);
    await cleaned();
    await runtime('setInterval(() => {}, 1000);');
    await assert.rejects(formatSource(executable, '', { timeout: 200 }), error => error.killed);
    await cleaned();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(formatSource(executable, '', { signal: controller.signal }), { name: 'AbortError' });
    await assert.rejects(formatSource(executable, 'x'.repeat(1024 * 1024 + 1)), /1 MiB/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

const executable = process.env.SCRIPTA_BIN || process.env.SCR_BIN;
test('real runtime formatting is idempotent, preserves literals and rejects invalid syntax', {
  skip: !executable && 'Set SCRIPTA_BIN for formatter integration',
}, async () => {
  const source = '// Source\n// keep  comment\nfunction greet($x:string):string{return "😀  first\n  second".$x;}\nfor($i=0;$i<2;$i+=1){echo greet(str($i));}\n';
  const formatted = await formatSource(executable, source);
  assert.ok(formatted.includes('"😀  first\n  second"'));
  assert.ok(formatted.includes('// keep  comment'));
  assert.ok(formatted.includes('\n    return '));
  assert.ok(formatted.includes('for ($i = 0; $i < 2; $i += 1) {'));
  assert.equal(apply(source, whitespaceEdits(source, formatted)), formatted);
  assert.equal(await formatSource(executable, formatted), formatted);
  await assert.rejects(formatSource(executable, '// Source\nif ( {'), /error/);
});
