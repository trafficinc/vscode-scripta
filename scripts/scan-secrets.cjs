'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const executable = process.env.GITLEAKS_BIN || 'gitleaks';
const version = spawnSync(executable, ['version'], { encoding: 'utf8' });
if (version.error || version.status !== 0) {
  console.error('Gitleaks is required (v8.19 or newer). Install with: brew install gitleaks');
  console.error('Or download it from https://github.com/gitleaks/gitleaks/releases and set GITLEAKS_BIN.');
  process.exit(1);
}

const common = ['--redact=100', '--verbose', '--no-banner', '--exit-code=1'];
let exitCode = 0;
for (const [label, args] of [
  ['Git history (all refs)', ['git', '--log-opts=--all', ...common, root]],
  ['Current files (including untracked and ignored files)', [
    'dir', '--config', path.join(__dirname, 'gitleaks-working-tree.toml'), ...common, root,
  ]],
]) {
  console.log(`\nScanning ${label}...`);
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit' });
  if (result.error) console.error('Could not run Gitleaks:', result.error.message);
  if (result.signal) console.error('Gitleaks terminated:', result.signal);
  if (result.status !== 0) exitCode = result.status || 1;
}
process.exitCode = exitCode;
