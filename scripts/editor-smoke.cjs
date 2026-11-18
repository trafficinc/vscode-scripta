'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (!(process.env.SCRIPTA_BIN || process.env.SCR_BIN)) {
  console.error('Set SCRIPTA_BIN to the Scripta executable before running the editor test.');
  process.exit(1);
}
const root = path.resolve(__dirname, '..');
const executable = process.env.VSCODE_BIN || (process.platform === 'darwin'
  ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code'
  : process.platform === 'win32' ? 'code.exe' : 'code');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scripta-vscode-test-'));
const workspace = path.join(directory, 'workspace');
fs.mkdirSync(workspace);
let exitCode = 1;
try {
  const result = spawnSync(executable, [
    workspace,
    '--user-data-dir', path.join(directory, 'profile'),
    '--extensions-dir', path.join(directory, 'extensions'),
    '--extensionDevelopmentPath=' + root,
    '--extensionTestsPath=' + path.join(root, 'tests/vscode'),
    '--disable-extensions', '--disable-workspace-trust', '--disable-telemetry', '--disable-updates',
    '--skip-welcome', '--skip-release-notes', '--skip-add-to-recently-opened',
  ], { stdio: 'inherit', timeout: 120000 });
  if (result.error) console.error('Could not run VS Code editor tests:', result.error.message);
  if (result.signal) console.error('VS Code editor tests terminated:', result.signal);
  exitCode = result.status ?? 1;
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
process.exitCode = exitCode;
