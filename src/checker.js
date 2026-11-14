'use strict';
const { execFile } = require('node:child_process');

// A direct process invocation preserves paths literally, including spaces and $.
function checkFile(executable, filename, { cwd, signal, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(executable, ['check', '--', filename], {
      cwd, signal, timeout, maxBuffer: 1024 * 1024, encoding: 'utf8', windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error && (typeof error.code !== 'number' || error.killed)) {
        reject(error);
        return;
      }
      resolve({ exitCode: error?.code ?? 0, output: stderr + stdout });
    });
  });
}

module.exports = { checkFile };
