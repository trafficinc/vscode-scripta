const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const tm = require('vscode-textmate');
const onig = require('vscode-oniguruma');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
let grammar;
before(async () => {
  await onig.loadWASM(fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')));
  const registry = new tm.Registry({
    onigLib: Promise.resolve({ createOnigScanner: p => new onig.OnigScanner(p), createOnigString: s => new onig.OnigString(s) }),
    loadGrammar: async scope => scope === 'source.scripta' ? read('syntaxes/scripta.tmLanguage.json') : null,
  });
  grammar = await registry.loadGrammar('source.scripta');
});
function tokens(line, state) {
  const result = grammar.tokenizeLine(line, state);
  return { state: result.ruleStack, tokens: result.tokens.map(t => ({ text: line.slice(t.startIndex, t.endIndex), scopes: t.scopes })) };
}
function has(result, text, scope) {
  assert.ok(result.tokens.some(t => t.text === text && t.scopes.includes(scope)), JSON.stringify(result.tokens));
}
test('recognition covers extensions, tags, direct and env shebangs', () => {
  const lang = read('package.json').contributes.languages[0];
  assert.deepEqual(lang.extensions, ['.scr']);
  const firstLine = new RegExp(lang.firstLine);
  for (const line of ['<?scr', '\uFEFF<?scr', '#!/usr/bin/env scr', '#!/usr/bin/env -S scr run', '#!/usr/local/bin/scr', '#! /opt/bin/scr']) assert.ok(firstLine.test(line), line);
  for (const line of ['<?script', '#!/usr/bin/env script', '#!/bin/bash', '#!/opt/scraper']) assert.ok(!firstLine.test(line), line);
});
test('tags, declarations, variable keyword boundaries, and strict equality', () => {
  has(tokens('<?scr'), '<?scr', 'punctuation.section.embedded.begin.scripta');
  has(tokens('function greet($if: string): string {'), 'greet', 'entity.name.function.scripta');
  has(tokens('$if === true;'), '$if', 'variable.other.scripta');
  has(tokens('$if === true;'), '===', 'keyword.operator.scripta');
  has(tokens('if ($if) {'), 'if', 'keyword.control.scripta');
  assert.ok(!tokens('if_name;').tokens.some(t => t.scopes.includes('keyword.control.scripta')));
});
test('strings preserve literal variables and comment/tag text', () => {
  const result = tokens('"$name // # <?scr ?> 世界"');
  assert.ok(result.tokens.every(t => t.scopes.includes('string.quoted.double.scripta')));
  assert.ok(!result.tokens.some(t => t.scopes.some(s => /variable|comment|embedded/.test(s))));
});
test('quote-specific escapes and escaped quote do not terminate strings', () => {
  has(tokens(String.raw`"a\n\"b"; echo "ok";`), '\\n', 'constant.character.escape.scripta');
  has(tokens(String.raw`"a\n\"b"; echo "ok";`), 'echo', 'support.function.output.scripta');
  has(tokens(String.raw`'a\nb'`), '\\n', 'invalid.illegal.escape.scripta');
  has(tokens(String.raw`'a\'b'`), "\\'", 'constant.character.escape.scripta');
});
test('multiline strings and block comments carry state and recover', () => {
  let result = tokens('"first');
  result = tokens('second"; echo "ok";', result.state);
  has(result, 'echo', 'support.function.output.scripta');
  result = tokens('/* " <?scr');
  result = tokens('still comment */ echo "ok";', result.state);
  has(result, 'echo', 'support.function.output.scripta');
  for (const line of ['// " <?scr', '# " <?scr', '#!/usr/bin/env scr']) assert.ok(tokens(line).tokens.every(t => t.scopes.some(s => s.startsWith('comment.'))));
});
test('qualified calls, methods, properties, numbers, and built-ins', () => {
  has(tokens('Json::decode("{}");'), 'Json', 'entity.name.namespace.scripta');
  has(tokens('Json::decode("{}");'), 'decode', 'support.function.scripta');
  has(tokens('$response->json();'), 'json', 'entity.name.function.scripta');
  has(tokens('$response->status;'), 'status', 'variable.other.property.scripta');
  has(tokens('len($items);'), 'len', 'support.function.builtin.scripta');
  for (const number of ['0', '42', '1.25', '1e3', '1.25E-3']) has(tokens(number + ';'), number, 'constant.numeric.scripta');
});
test('real example closes multiline states', () => {
  let state;
  for (const line of fs.readFileSync(path.join(root, 'examples/highlighting.scr'), 'utf8').split(/\r?\n/)) state = tokens(line, state).state;
  has(tokens('echo "after";', state), 'echo', 'support.function.output.scripta');
});
// Resolve snippet defaults while honoring escaped dollars/backslashes and mirrored tabstops.
function expand(body) {
  const defaults = new Map();
  return body.join('\n').replace(/\\([\\$}])|\$\{(\d+)(?::([^}]*))?\}|\$(\d+)/g, (_, escaped, index, value, bare) => {
    if (escaped) return escaped;
    index ??= bare;
    if (value !== undefined && !defaults.has(index)) defaults.set(index, value);
    return defaults.get(index) ?? '';
  });
}
test('snippet expansions preserve Scripta variables and newline escapes', () => {
  const snippets = read('snippets/scripta.json');
  assert.match(expand(snippets.For.body), /for \(\$i = 0; \$i < 10; \$i \+= 1\)/);
  assert.match(expand(snippets.Foreach.body), /foreach \(\$items as \$item\)/);
  assert.match(expand(snippets.Echo.body), /echo "text\\n";/);
});
test('example and expanded snippets pass scr check', { skip: !process.env.SCR_BIN && 'Set SCR_BIN to validate with Scripta' }, () => {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scripta-snippets-'));
  try {
    const sources = [fs.readFileSync(path.join(root, 'examples/highlighting.scr'), 'utf8')];
    for (const snippet of Object.values(read('snippets/scripta.json'))) {
      const body = expand(snippet.body);
      sources.push(body.includes('<?scr') ? body : '<?scr\n' + body);
    }
    sources.forEach((source, index) => {
      const file = path.join(dir, `${index}.scr`);
      fs.writeFileSync(file, source);
      const result = spawnSync(process.env.SCR_BIN, ['check', file], { encoding: 'utf8' });
      assert.equal(result.status, 0, source + '\n' + (result.error ?? '') + result.stderr);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
