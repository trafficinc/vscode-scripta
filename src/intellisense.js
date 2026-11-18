'use strict';
const catalog = require('./builtins.json');
const functions = new Map(catalog.functions.map(entry => [entry.name, entry]));

// Track only literal/comment boundaries, so incomplete programs need no parser.
// Scripta strings are literal and can span lines; # also covers shebangs.
function isCodeAt(source, offset) {
  let state = 'code';
  for (let i = 0; i < offset; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (state === 'line') {
      if (char === '\n' || char === '\r') state = 'code';
    } else if (state === 'block') {
      if (char === '*' && next === '/' && i + 1 < offset) { state = 'code'; i++; }
    } else if (state === '"' || state === "'") {
      if (char === '\\') i++;
      else if (char === state) state = 'code';
    } else if (char === '"' || char === "'") state = char;
    else if (char === '#') state = 'line';
    else if (char === '/' && i + 1 < offset) {
      if (next === '/') { state = 'line'; i++; }
      else if (next === '*') { state = 'block'; i++; }
    }
  }
  return state === 'code';
}

function blockedPrefix(prefix) {
  return /(?:\$|->|::|\b(?:function|class|interface|new|extends|implements)\s+)\s*$/.test(prefix);
}

function documentation(vscode, entry) {
  const markdown = new vscode.MarkdownString();
  markdown.appendCodeblock(entry.signature, 'scripta');
  markdown.appendMarkdown('\n\n' + entry.description);
  return markdown;
}

function registerIntelliSense(vscode, context) {
  // No process execution or disk access: also available in Restricted Mode and
  // untitled documents. Let VS Code select any document with this language ID.
  const selector = { language: 'scripta' };
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(selector, {
      provideCompletionItems(document, position, token) {
        if (token.isCancellationRequested) return [];
        const source = document.getText();
        const offset = document.offsetAt(position);
        if (!isCodeAt(source, offset)) return [];
        const prefix = /[A-Za-z0-9_]*$/.exec(source.slice(0, offset))[0];
        const start = offset - prefix.length;
        const before = source.slice(0, start);
        const qualified = /\b([A-Za-z_][A-Za-z0-9_]*)\s*::\s*$/.exec(before);
        if (qualified ? blockedPrefix(before.slice(0, qualified.index)) : blockedPrefix(before)) return [];
        // A colon triggers suggestions only after the complete :: operator.
        if (!qualified && /:\s*$/.test(before)) return [];
        const end = offset + /^[A-Za-z0-9_]*/.exec(source.slice(offset))[0].length;
        const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
        const hasParenthesis = /^\s*\(/.test(source.slice(end));
        const items = [];
        for (const entry of catalog.functions) {
          if (qualified && !entry.name.startsWith(qualified[1] + '::')) continue;
          const label = qualified ? entry.name.split('::')[1] : entry.name;
          const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Function);
          item.detail = entry.signature;
          item.documentation = documentation(vscode, entry);
          item.range = range;
          const snippet = new vscode.SnippetString();
          snippet.appendText(label);
          if (!hasParenthesis) {
            snippet.appendText('(');
            const required = entry.parameters.filter(parameter => !parameter.optional);
            required.forEach((parameter, index) => {
              if (index) snippet.appendText(', ');
              snippet.appendPlaceholder('$' + parameter.name);
            });
            snippet.appendText(')');
            snippet.appendTabstop(0);
          }
          item.insertText = snippet;
          items.push(item);
        }
        if (!qualified) {
          for (const keyword of catalog.keywords) {
            const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
            item.range = range;
            item.insertText = keyword;
            items.push(item);
          }
        }
        return items;
      },
    }, ':'),
    vscode.languages.registerHoverProvider(selector, {
      provideHover(document, position, token) {
        if (token.isCancellationRequested) return;
        const source = document.getText();
        const offset = document.offsetAt(position);
        if (!isCodeAt(source, offset)) return;
        const line = document.lineAt(position.line).text;
        const lineOffset = document.offsetAt(new vscode.Position(position.line, 0));
        const pattern = /\b[A-Za-z_][A-Za-z0-9_]*(?:\s*::\s*[A-Za-z_][A-Za-z0-9_]*)?/g;
        for (const match of line.matchAll(pattern)) {
          if (position.character < match.index || position.character >= match.index + match[0].length) continue;
          const start = lineOffset + match.index;
          if (!isCodeAt(source, start) || blockedPrefix(source.slice(0, start))) return;
          const entry = functions.get(match[0].replace(/\s/g, ''));
          if (!entry) return;
          return new vscode.Hover(documentation(vscode, entry),
            new vscode.Range(document.positionAt(start), document.positionAt(start + match[0].length)));
        }
      },
    }),
  );
}

module.exports = { registerIntelliSense, isCodeAt };
