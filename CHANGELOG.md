# Changelog

## Unreleased

- Use a PNG README banner so standard VSIX packaging succeeds.
- Explain the open-folder requirement for Run in empty windows; launch editor smoke tests in an isolated workspace.
- Add built-in and keyword completion, with module suggestions after `::` and required argument placeholders.
- Add hover signatures and documentation for 226 global and module functions.
- Keep basic IntelliSense available without the runtime and in Restricted Mode; suppress it in strings and comments.

## 0.4.0

- Add Format Document and Format Selection using the runtime's `scripta fmt` command.
- Enable formatting on save for Scripta by default; disable with `[scripta]` → `editor.formatOnSave`.
- Include `scripta` in Code Spell Checker's default accepted words.

## 0.3.0

- Recognize official `.scripta` files and shorthand `.scta` files.
- Highlight `<?scripta` and detect `scripta` shebangs.
- Default Run and Check to the `scripta` executable.
- Update script snippets, examples, documentation, and packaging to canonical names.
- Remove the legacy `.scr` file association.
- Keep legacy `<?scr`, `scr` shebangs, and snippet prefixes compatible.

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
