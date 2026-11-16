'use strict';
const path = require('node:path');
const { checkFile } = require('./checker');
const { parseDiagnostics } = require('./diagnostics');

function activateWithApi(vscode, context, checker = checkFile) {
  const diagnostics = vscode.languages.createDiagnosticCollection('scripta');
  const output = vscode.window.createOutputChannel('Scripta');
  const pending = new Map();
  let disposed = false;
  const key = document => document.uri.toString();
  const isScripta = document => document.languageId === 'scripta' && document.uri.scheme === 'file';
  const settings = document => vscode.workspace.getConfiguration('scripta', document.uri);
  const cwd = document => vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? path.dirname(document.uri.fsPath);

  function invalidate(document) {
    const id = key(document);
    pending.get(id)?.abort();
    pending.delete(id);
    diagnostics.delete(document.uri);
  }
  function fail(message, explicit) {
    if (disposed) return;
    output.appendLine(message);
    if (explicit) {
      output.show(true);
      void vscode.window.showErrorMessage(message);
    }
  }
  function executable(document) {
    const value = settings(document).get('executablePath', 'scripta');
    if (typeof value !== 'string' || !value.trim()) throw new Error('Set scripta.executablePath to the Scripta executable or its full path.');
    return value;
  }
  async function activeDocument() {
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage('Trust this workspace to run Scripta commands.');
      return;
    }
    const document = vscode.window.activeTextEditor?.document;
    if (!document || document.languageId !== 'scripta') {
      void vscode.window.showWarningMessage('Open a Scripta file first.');
      return;
    }
    if (document.isUntitled) {
      if (!await document.save()) return;
    } else if (document.uri.scheme !== 'file') {
      void vscode.window.showWarningMessage('Save this script as a local file before running Scripta commands.');
      return;
    } else if (document.isDirty && !await document.save()) return;
    // Save As can replace the document rather than mutating the original one.
    const saved = document.isClosed ? vscode.window.activeTextEditor?.document : document;
    if (!saved || !isScripta(saved) || saved.isDirty || saved.isUntitled) return;
    return saved;
  }

  async function check(document, explicit = false) {
    if (disposed || !vscode.workspace.isTrusted || !isScripta(document) || document.isDirty || document.isClosed) return;
    invalidate(document);
    const controller = new AbortController();
    pending.set(key(document), controller);
    const version = document.version;
    const current = () => !disposed && pending.get(key(document)) === controller
      && !controller.signal.aborted && !document.isClosed && !document.isDirty
      && document.version === version && vscode.workspace.isTrusted;
    try {
      const result = await checker(executable(document), document.uri.fsPath, {
        cwd: cwd(document), signal: controller.signal,
      });
      if (!current()) return;
      const records = parseDiagnostics(result.output, document.getText()).filter(record =>
        path.resolve(cwd(document), record.path) === path.resolve(document.uri.fsPath));
      diagnostics.set(document.uri, records.map(record => {
        const range = new vscode.Range(record.line, record.start, record.line, record.end);
        const diagnostic = new vscode.Diagnostic(range, record.message, vscode.DiagnosticSeverity.Error);
        diagnostic.code = record.code;
        diagnostic.source = 'scripta';
        return diagnostic;
      }));
      if (result.exitCode !== 0) {
        output.appendLine(`[Check] ${document.uri.fsPath}\n${result.output}`);
        if (!records.length) fail('Scripta check failed without a source location. See the Scripta output channel.', explicit);
        else if (explicit) await vscode.commands.executeCommand('workbench.actions.view.problems');
      } else if (explicit) {
        vscode.window.setStatusBarMessage('Scripta: no syntax errors.', 4000);
      }
    } catch (error) {
      if (current()) {
        const detail = error.code === 'ENOENT'
          ? 'Cannot find scripta. Set scripta.executablePath in Settings to your Scripta executable.'
          : error.killed ? 'Scripta check exceeded its time limit.' : `Scripta check failed: ${error.message}`;
        fail(detail, explicit);
      }
    } finally {
      if (pending.get(key(document)) === controller) pending.delete(key(document));
    }
  }

  async function run() {
    try {
      const document = await activeDocument();
      if (!document || disposed || !vscode.workspace.isTrusted) return;
      const args = settings(document).get('runArguments', []);
      if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw new Error('scripta.runArguments must be an array of strings.');
      const execution = new vscode.ProcessExecution(executable(document), ['run', '--', document.uri.fsPath, ...args], { cwd: cwd(document) });
      const task = new vscode.Task({ type: 'scripta', file: document.uri.fsPath },
        vscode.workspace.getWorkspaceFolder(document.uri) ?? vscode.TaskScope.Global,
        `Run ${path.basename(document.uri.fsPath)}`, 'Scripta', execution, []);
      task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, focus: true, clear: true };
      await vscode.tasks.executeTask(task);
    } catch (error) { fail(`Could not run Scripta: ${error.message}`, true); }
  }

  context.subscriptions.push(
    diagnostics, output,
    vscode.commands.registerCommand('scripta.runFile', run),
    vscode.commands.registerCommand('scripta.checkFile', async () => {
      try {
        const document = await activeDocument();
        if (document) await check(document, true);
      } catch (error) { fail(`Could not check Scripta: ${error.message}`, true); }
    }),
    vscode.workspace.onDidSaveTextDocument(document => {
      if (isScripta(document) && settings(document).get('checkOnSave', true)) void check(document);
    }),
    vscode.workspace.onDidChangeTextDocument(event => { if (isScripta(event.document)) invalidate(event.document); }),
    vscode.workspace.onDidCloseTextDocument(invalidate),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('scripta')) {
        for (const controller of pending.values()) controller.abort();
        pending.clear();
        diagnostics.clear();
      }
    }),
    { dispose() {
      disposed = true;
      for (const controller of pending.values()) controller.abort();
      pending.clear();
    } },
  );
}

function activate(context) { activateWithApi(require('vscode'), context); }
module.exports = { activate, activateWithApi };
