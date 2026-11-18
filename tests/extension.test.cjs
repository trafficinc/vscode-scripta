const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { activateWithApi } = require('../src/extension');
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(checker = async () => ({ exitCode: 0, output: '' })) {
  const calls = { tasks: [], errors: [], warnings: [], logs: [], executed: [], saves: 0 };
  const values = { executablePath: '/tools/scripta executable', runArguments: ['hello world', '$(literal)'], checkOnSave: true };
  const events = {};
  const register = name => fn => { events[name] = fn; return { dispose() {} }; };
  const uri = { scheme: 'file', fsPath: path.resolve('examples/a file.scripta'), toString() { return 'file://' + this.fsPath; } };
  const document = { uri, languageId: 'scripta', version: 1, isDirty: false, isClosed: false, isUntitled: false,
    getText: () => '<?scripta\n$a == 1;', async save() { calls.saves++; this.isDirty = false; return true; } };
  const commands = new Map();
  const items = new Map();
  const diagnostics = { set(uri, value) { items.set(uri.toString(), value); }, delete(uri) { items.delete(uri.toString()); }, clear() { items.clear(); }, dispose() {} };
  const vscode = {
    languages: { createDiagnosticCollection: () => diagnostics, registerDocumentRangeFormattingEditProvider: () => ({ dispose() {} }),
      registerCompletionItemProvider: () => ({ dispose() {} }), registerHoverProvider: () => ({ dispose() {} }) },
    window: { activeTextEditor: { document }, createOutputChannel: () => ({ appendLine: s => calls.logs.push(s), show() {}, dispose() {} }),
      showErrorMessage: s => calls.errors.push(s), showWarningMessage: s => calls.warnings.push(s), setStatusBarMessage() {} },
    workspace: { isTrusted: true, getConfiguration: () => ({ get: (name, fallback) => values[name] ?? fallback }), getWorkspaceFolder: () => undefined,
      onDidSaveTextDocument: register('save'), onDidChangeTextDocument: register('change'), onDidCloseTextDocument: register('close'), onDidChangeConfiguration: register('configuration') },
    commands: { registerCommand: (name, fn) => { commands.set(name, fn); return { dispose() {} }; }, executeCommand: async name => calls.executed.push(name) },
    tasks: { executeTask: async task => calls.tasks.push(task) },
    Task: class { constructor(definition, scope, name, source, execution, problemMatchers) { Object.assign(this, { definition, scope, name, source, execution, problemMatchers }); } },
    ProcessExecution: class { constructor(process, args, options) { Object.assign(this, { process, args, options }); } },
    Range: class { constructor(startLine, startCharacter, endLine, endCharacter) { Object.assign(this, { startLine, startCharacter, endLine, endCharacter }); } },
    Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
    DiagnosticSeverity: { Error: 0 }, TaskScope: { Global: 1 }, TaskRevealKind: { Always: 1 }, TaskPanelKind: { Dedicated: 2 },
  };
  const context = { subscriptions: [] };
  activateWithApi(vscode, context, checker);
  return { calls, values, events, document, vscode, items, commands, dispose: () => context.subscriptions.forEach(s => s.dispose()) };
}
test('Run saves changes and launches a direct process task with literal arguments', async () => {
  const h = harness();
  h.document.isDirty = true;
  await h.commands.get('scripta.runFile')();
  assert.equal(h.calls.saves, 1);
  const [task] = h.calls.tasks;
  assert.equal(task.execution.process, h.values.executablePath);
  assert.deepEqual(task.execution.args, ['run', '--', h.document.uri.fsPath, 'hello world', '$(literal)']);
  assert.equal(task.execution.options.cwd, path.dirname(h.document.uri.fsPath));
  assert.equal(task.presentationOptions.focus, true);
});
test('Run and Check default to the canonical scripta executable', async () => {
  const checked = [];
  const h = harness(async executable => { checked.push(executable); return { exitCode: 0, output: '' }; });
  delete h.values.executablePath;
  await h.commands.get('scripta.runFile')();
  assert.equal(h.calls.tasks[0].execution.process, 'scripta');
  await h.commands.get('scripta.checkFile')();
  assert.deepEqual(checked, ['scripta']);
  const manifest = require('../package.json');
  assert.equal(manifest.contributes.configuration.properties['scripta.executablePath'].default, 'scripta');
});
test('cancelled save, remote documents and untrusted workspaces cannot run', async () => {
  const h = harness();
  h.document.isDirty = true;
  h.document.save = async () => false;
  await h.commands.get('scripta.runFile')();
  assert.equal(h.calls.tasks.length, 0);
  h.document.uri.scheme = 'vscode-remote';
  await h.commands.get('scripta.runFile')();
  assert.match(h.calls.warnings.at(-1), /local file/);
  h.vscode.workspace.isTrusted = false;
  await h.commands.get('scripta.runFile')();
  await h.commands.get('scripta.checkFile')();
  assert.equal(h.calls.tasks.length, 0);
  assert.match(h.calls.warnings.at(-1), /Trust/);
});
test('Check publishes source ranges and codes; successful recheck clears errors', async () => {
  let result;
  const h = harness(async () => result);
  result = { exitCode: 1, output: `error[E0202]: strict equality required\n --> ${h.document.uri.fsPath}:2:4\n |    ^^` };
  await h.commands.get('scripta.checkFile')();
  const [diagnostic] = h.items.get(h.document.uri.toString());
  assert.equal(diagnostic.code, 'E0202');
  assert.equal(diagnostic.source, 'scripta');
  assert.equal(diagnostic.range.startCharacter, 3);
  assert.equal(diagnostic.range.endCharacter, 5);
  assert.deepEqual(h.calls.executed, ['workbench.actions.view.problems']);
  result = { exitCode: 0, output: '' };
  await h.commands.get('scripta.checkFile')();
  assert.deepEqual(h.items.get(h.document.uri.toString()), []);
});
test('editing and newer checks suppress late results even when the process ignores cancellation', async () => {
  const queue = [];
  const h = harness((_, __, options) => new Promise(resolve => queue.push({ resolve, signal: options.signal })));
  const first = h.commands.get('scripta.checkFile')();
  await tick();
  h.document.version++;
  h.events.change({ document: h.document });
  assert.equal(queue[0].signal.aborted, true);
  queue[0].resolve({ exitCode: 1, output: `error[E0202]: old\n --> ${h.document.uri.fsPath}:2:4\n | ^^` });
  await first;
  assert.equal(h.items.size, 0);
  const second = h.commands.get('scripta.checkFile')();
  await tick();
  const third = h.commands.get('scripta.checkFile')();
  await tick();
  queue[2].resolve({ exitCode: 0, output: '' });
  await third;
  queue[1].resolve({ exitCode: 1, output: `error[E0202]: older\n --> ${h.document.uri.fsPath}:2:4\n | ^^` });
  await second;
  assert.deepEqual(h.items.get(h.document.uri.toString()), []);
});
test('check on save respects settings and trust; close cancels pending checks', async () => {
  let resolve;
  const h = harness(() => new Promise(r => { resolve = r; }));
  h.values.checkOnSave = false;
  h.events.save(h.document);
  assert.equal(resolve, undefined);
  h.values.checkOnSave = true;
  h.vscode.workspace.isTrusted = false;
  h.events.save(h.document);
  assert.equal(resolve, undefined);
  h.vscode.workspace.isTrusted = true;
  h.events.save(h.document);
  assert.equal(typeof resolve, 'function');
  h.events.close(h.document);
  resolve({ exitCode: 0, output: '' });
  await tick();
  assert.equal(h.items.size, 0);
});
test('missing runtime and unparseable failures are visible without inventing diagnostics', async () => {
  const h = harness(async () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error; });
  await h.commands.get('scripta.checkFile')();
  assert.match(h.calls.errors[0], /scripta.executablePath/);
  const other = harness(async () => ({ exitCode: 2, output: 'unknown option' }));
  await other.commands.get('scripta.checkFile')();
  assert.match(other.calls.errors[0], /without a source location/);
  assert.deepEqual(other.items.get(other.document.uri.toString()), []);
});
test('configuration changes and disposal cancel checks and suppress late updates', async () => {
  let resolve, signal;
  const h = harness((_, __, options) => { signal = options.signal; return new Promise(r => { resolve = r; }); });
  const first = h.commands.get('scripta.checkFile')();
  await tick();
  h.events.configuration({ affectsConfiguration: name => name === 'scripta' });
  assert.equal(signal.aborted, true);
  resolve({ exitCode: 0, output: '' });
  await first;
  assert.equal(h.items.size, 0);
  const second = h.commands.get('scripta.checkFile')();
  await tick();
  h.dispose();
  assert.equal(signal.aborted, true);
  resolve({ exitCode: 0, output: '' });
  await second;
  assert.equal(h.items.size, 0);
});
