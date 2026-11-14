# Changelog

## 0.2.0

- Add Run Scripta File in the editor toolbar, context menu, and Command Palette.
- Run scripts as process tasks with literal arguments and integrated terminal input.
- Add Check Scripta File and optional checks on save, enabled by default.
- Show syntax errors and diagnostic codes in Problems and editor underlines.
- Convert Unicode scalar columns to VS Code positions and discard stale results.
- Configure the executable path and script arguments; restrict execution to trusted workspaces.

## 0.1.0

- Recognize `.scr` files, Scripta shebangs, and opening tags.
- Add syntax highlighting based on Scripta's lexer, including literal multiline
  strings and quote-specific escapes.
- Add comment toggling, bracket pairs, indentation, region folding, and snippets.
