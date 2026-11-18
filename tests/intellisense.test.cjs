const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerIntelliSense, isCodeAt } = require('../src/intellisense');

function harness(marked) {
  const offset = marked.indexOf('|');
  const source = marked.slice(0, offset) + marked.slice(offset + 1);
  const state = {};
  class Position {
    constructor(line, character) { Object.assign(this, { line, character }); }
  }
  const document = {
    getText: () => source,
    lineAt: line => ({ text: source.split('\n')[line] }),
    offsetAt: position => source.split('\n').slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character,
    positionAt: offset => {
      const lines = source.slice(0, offset).split('\n');
      return new Position(lines.length - 1, lines.at(-1).length);
    },
  };
  const vscode = {
    Position,
    Range: class { constructor(start, end) { Object.assign(this, { start, end }); } },
    CompletionItem: class { constructor(label, kind) { Object.assign(this, { label, kind }); } },
    CompletionItemKind: { Function: 1, Keyword: 2 },
    SnippetString: class {
      value = ''; index = 0;
      appendText(text) { this.value += text; return this; }
      appendPlaceholder(text) { this.value += '${' + (++this.index) + ':' + text.replace(/[$}\\]/g, '\\$&') + '}'; return this; }
      appendTabstop(index) { this.value += '$' + index; return this; }
    },
    MarkdownString: class {
      value = '';
      appendCodeblock(text, language) { this.value += '```' + language + '\n' + text + '\n```'; }
      appendMarkdown(text) { this.value += text; }
    },
    Hover: class { constructor(contents, range) { Object.assign(this, { contents, range }); } },
    languages: {
      registerCompletionItemProvider(selector, provider, ...triggers) {
        Object.assign(state, { selector, completion: provider, triggers }); return { dispose() { state.completionDisposed = true; } };
      },
      registerHoverProvider(selector, provider) {
        state.hover = provider; return { dispose() { state.hoverDisposed = true; } };
      },
    },
  };
  const context = { subscriptions: [] };
  registerIntelliSense(vscode, context);
  const position = document.positionAt(offset);
  const token = { isCancellationRequested: false };
  return { state, token, completions: () => state.completion.provideCompletionItems(document, position, token),
    hover: () => state.hover.provideHover(document, position, token),
    insert(item) {
      return source.slice(0, document.offsetAt(item.range.start)) + item.insertText.value
        + source.slice(document.offsetAt(item.range.end));
    },
    dispose: () => context.subscriptions.forEach(item => item.dispose()),
  };
}

test('completion inserts calls, required placeholders and keywords without a runtime or trusted workspace', () => {
  const h = harness('<?scripta\nle|');
  assert.deepEqual(h.state.selector, { language: 'scripta' });
  assert.deepEqual(h.state.triggers, [':']);
  const items = h.completions();
  const len = items.find(item => item.label === 'len');
  assert.equal(h.insert(len), '<?scripta\nlen(${1:\\$value})$0');
  assert.match(len.documentation.value, /Unicode scalar/);
  assert.ok(items.some(item => item.label === 'foreach' && item.insertText === 'foreach'));
  assert.ok(items.some(item => item.label === 'class'));
  assert.ok(items.some(item => item.label === 'File::read'));
  h.dispose();
  assert.equal(h.state.completionDisposed, true);
  assert.equal(h.state.hoverDisposed, true);
});

test('module completion replaces the method only and omits optional arguments', () => {
  const h = harness('<?scripta\nString :: sub|string');
  const items = h.completions();
  assert.ok(items.length > 0);
  assert.ok(items.every(item => item.detail.startsWith('String::')));
  const substring = items.find(item => item.label === 'substring');
  assert.equal(h.insert(substring), '<?scripta\nString :: substring(${1:\\$text}, ${2:\\$start})$0');
  const empty = harness('Map::|');
  assert.equal(empty.insert(empty.completions().find(item => item.label === 'create')), 'Map::create()$0');
  assert.deepEqual(harness('Unknown::|').completions(), []);
  assert.deepEqual(harness('String:|').completions(), []);
});

test('completion reuses existing parentheses and replaces a word around the cursor', () => {
  const h = harness('String::tr|im ($text)');
  assert.equal(h.insert(h.completions().find(item => item.label === 'trim')), 'String::trim ($text)');
  const global = harness('le|n($items)');
  assert.equal(global.insert(global.completions().find(item => item.label === 'len')), 'len($items)');
});

test('literal and comment states survive multiline text, escapes and CRLF and recover after closing', () => {
  for (const source of ['"unfinished', "'unfinished", '"first\nsecond', "'first\nsecond", '// text', '# text', '\uFEFF#!/usr/bin/env scripta',
    '/* first\nsecond', '"escaped\\"quote', "'escaped\\'quote", '/* text *']) {
    assert.equal(isCodeAt(source, source.length), false, source);
    assert.deepEqual(harness(source + '|').completions(), [], source);
  }
  for (const source of ['"done";', "'done';", '/* done */', '// text\n', '# text\r\n', '"backslash\\\\";', '"# /* literal */";']) {
    assert.equal(isCodeAt(source, source.length), true, source);
    assert.ok(harness(source + '|').completions().length, source);
  }
});

test('built-ins are not suggested as variables, instance members or declaration names', () => {
  for (const source of ['$le|', '$object->re|', '$object-> re|', 'function le|', 'class Fi|', 'new Fi|', '$File::re|', 'Other::File::re|']) {
    assert.deepEqual(harness(source).completions(), [], source);
  }
});

test('hover explains global and qualified built-ins, with context limitations', () => {
  assert.match(harness('le|n($items)').hover().contents.value, /len\(value\): int/);
  assert.match(harness('<?scripta\nString :: tr|im($text)').hover().contents.value, /Removes Unicode whitespace/);
  assert.match(harness('Session::st|art()').hover().contents.value, /only in a web request/);
  assert.match(harness('Sqlite::op|en($path)').hover().contents.value, /SQLite enabled/);
  for (const source of ['$le|n', '$object->le|n()', 'Unknown::le|n()', '// le|n()', '/* le|n() */', '"le|n()"',
    '"first\nle|n()"', 'function le|n()', 'nothingHe|re()', '"String" :: tr|im()']) {
    assert.equal(harness(source).hover(), undefined, source);
  }
});

test('cancelled editor requests return no results', () => {
  const h = harness('le|n');
  h.token.isCancellationRequested = true;
  assert.deepEqual(h.completions(), []);
  assert.equal(h.hover(), undefined);
});
