const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkFile } = require('../src/checker');
const { parseDiagnostics } = require('../src/diagnostics');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scripta-runtime-'));
  return { dir, file: path.join(dir, 'script with $ and ;.scripta'), dispose: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
test('diagnostics parse multiple errors, Windows paths, help and ANSI colors', () => {
  const output = '\x1b[31merror[E0202]: use strict equality\x1b[0m\n  --> C:\\work\\test.scripta:2:4\n  |\n2 | $a == 1;\n  |    ^^\nhelp: use ===\n\nerror[E0201]: invalid control flow\n  --> C:\\work\\test.scripta:3:1\n  | ^^^^^';
  const records = parseDiagnostics(output, '<?scripta\n$a == 1;\nbreak;');
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], { path: 'C:\\work\\test.scripta', line: 1, start: 3, end: 5, code: 'E0202', message: 'use strict equality\nuse ===' });
  assert.equal(records[1].end, 5);
});
test('scalar columns convert astral Unicode, BOM, tabs, CRLF and EOF correctly', () => {
  const records = parseDiagnostics('error[E0101]: invalid\n --> x:1:7\n | ^\nerror[E0101]: invalid\n --> x:2:5\n | ^\nerror[E0201]: EOF\n --> x:3:1\n | ^', '\uFEFF<?scr @\r\n\t"😀"@\r\n');
  assert.deepEqual(records.map(r => [r.line, r.start, r.end]), [[0, 7, 8], [1, 5, 6], [2, 0, 0]]);
  assert.deepEqual(parseDiagnostics('Error: missing file\n', ''), []);
});
test('checker passes literal paths, returns exit codes and reports process errors', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.dir, 'check'), 'process.stderr.write(JSON.stringify(process.argv.slice(2))); process.exit(1);');
    const result = await checkFile(process.execPath, f.file, { cwd: f.dir });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(JSON.parse(result.output), ['--', f.file]);
    await assert.rejects(checkFile(path.join(f.dir, 'missing-scr'), f.file), { code: 'ENOENT' });
  } finally { f.dispose(); }
});
test('checker bounds slow checks and supports cancellation', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.dir, 'check'), 'setInterval(() => {}, 1000);');
    await assert.rejects(checkFile(process.execPath, f.file, { cwd: f.dir, timeout: 100 }), error => error.killed);
    const controller = new AbortController();
    const promise = checkFile(process.execPath, f.file, { cwd: f.dir, signal: controller.signal });
    controller.abort();
    await assert.rejects(promise, { code: 'ABORT_ERR' });
  } finally { f.dispose(); }
});
test('real Scripta checker returns diagnostics without executing the script', { skip: !(process.env.SCRIPTA_BIN || process.env.SCR_BIN) && 'Set SCRIPTA_BIN for runtime integration' }, async () => {
  const f = fixture();
  try {
    for (const extension of ['.scripta', '.scta']) {
      for (const tag of ['<?scripta', '<?scr']) {
        const file = path.join(f.dir, 'hello' + extension);
        fs.writeFileSync(file, tag + '\necho "hello";');
        assert.deepEqual(await checkFile((process.env.SCRIPTA_BIN || process.env.SCR_BIN), file), { exitCode: 0, output: '' });
      }
    }
    const source = '<?scripta\n$x = "😀"; @';
    fs.writeFileSync(f.file, source);
    const result = await checkFile((process.env.SCRIPTA_BIN || process.env.SCR_BIN), f.file);
    assert.equal(result.exitCode, 1);
    const [record] = parseDiagnostics(result.output, source);
    assert.equal(record.path, f.file);
    assert.equal(record.code, 'E0101');
    assert.equal(source.split('\n')[1].slice(record.start, record.end), '@');
  } finally { f.dispose(); }
});
