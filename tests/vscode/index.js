// Run with VS Code --extensionDevelopmentPath=<repo> --extensionTestsPath=<this directory>.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

exports.run = async function () {
  const executable = (process.env.SCRIPTA_BIN || process.env.SCR_BIN);
  assert.ok(executable, 'Set SCRIPTA_BIN to the Scripta executable');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-editor-'));
  const filename = path.join(dir, 'script with $ and ;.scripta');
  const uri = vscode.Uri.file(filename);
  const configuration = vscode.workspace.getConfiguration('scripta');
  try {
    await configuration.update('executablePath', executable, vscode.ConfigurationTarget.Global);
    await configuration.update('checkOnSave', false, vscode.ConfigurationTarget.Global);
    await fs.writeFile(filename, '<?scripta\n$x = "😀"; @');
    const document = await vscode.workspace.openTextDocument(uri);
    assert.equal(document.languageId, 'scripta');
    await vscode.window.showTextDocument(document);
    const extension = vscode.extensions.getExtension('trafficinc.scripta-language-support');
    assert.ok(extension);
    await extension.activate();
    await vscode.commands.executeCommand('scripta.checkFile');
    const errors = vscode.languages.getDiagnostics(uri).filter(d => d.source === 'scripta');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'E0101');
    assert.equal(document.getText(errors[0].range), '@');
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), '<?scripta\necho "editor smoke test\\n";');
    await vscode.workspace.applyEdit(edit);
    // Run must save this dirty buffer, then execute successfully.
    const ended = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listener.dispose(); reject(new Error('Run task timed out')); }, 15000);
      const listener = vscode.tasks.onDidEndTaskProcess(event => {
        if (event.execution.task.definition.type === 'scripta') {
          clearTimeout(timer); listener.dispose(); resolve(event.exitCode);
        }
      });
    });
    await vscode.commands.executeCommand('scripta.runFile');
    assert.equal(await ended, 0);
    assert.equal(document.isDirty, false);
    await vscode.commands.executeCommand('scripta.checkFile');
    assert.equal(vscode.languages.getDiagnostics(uri).filter(d => d.source === 'scripta').length, 0);
    console.log('Scripta editor smoke test passed: language, diagnostics, save, run task, clean recheck.');
  } finally {
    await configuration.update('executablePath', undefined, vscode.ConfigurationTarget.Global);
    await configuration.update('checkOnSave', undefined, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await fs.rm(dir, { recursive: true, force: true });
  }
};
