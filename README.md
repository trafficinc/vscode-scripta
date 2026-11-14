![Scripta — VS Code Language Support. Syntax highlighting, snippets, run and check.](assets/readme-header.svg)

# Scripta VS Code Language Support

VS Code language support for [Scripta](https://github.com/trafficinc/scripta).
Open a `.scr` file to select **Scripta** automatically. Extensionless scripts are
recognized by a `scr` shebang or a first-line `<?scr` tag. You can also select
Scripta from VS Code's language mode picker.

Includes syntax highlighting, line/block comment toggling, bracket matching,
auto-closing quotes and brackets, indentation, and region folding. Strings stay
literal: `$name` inside a string is not interpolation. Double-quoted and
single-quoted strings have different supported escapes, matching Scripta.

Snippets: `scr`, `scrmain`, `fn`, `if`, `ifelse`, `foreach`, `foreachkv`, `for`,
`while`, `try`, `echo`, and `require`. Use **Insert Snippet** or completion to
insert one. The `scr`/`scrmain` snippets are intended for empty files.

## Install locally

In VS Code, run **Extensions: Install from VSIX...** from the Command Palette
and choose `dist/scripta-language-support-0.2.0.vsix`. Open a `.scr` file, or reopen
an existing one if its language mode was previously set manually.

## Run and check scripts

Install the `scr` runtime and put it on PATH, or set **Scripta: Executable Path**
to its full path in VS Code Settings. For example:

```json
{
  "scripta.executablePath": "/path/to/scr",
  "scripta.runArguments": ["--sample"],
  "scripta.checkOnSave": true
}
```

Open a Scripta file and use the play button, editor context menu, or Command
Palette command **Scripta: Run Scripta File**. The script runs in an integrated
terminal, which supports interactive input. Stop it with the task's terminate
button. Each `runArguments` item is passed literally as one script argument.
The working directory is the file's workspace folder, or its containing directory
when opened outside a workspace. Paths are passed directly to the process.

**Scripta: Check Scripta File** runs `scr check` without executing the script and
shows errors as editor underlines and entries in Problems, with diagnostic codes
and help text. A successful check clears previous errors. Checks also run on
save by default; turn off `scripta.checkOnSave` to check manually. Diagnostics
clear when you edit, so they never refer to an older buffer. Checks stop after
10 seconds or 1 MiB of output. Open **Output → Scripta** for runtime setup errors
or unrecognized CLI output. Only the saved entry file is checked; `scr check`
does not recursively check dependencies or perform full static type checking.

Run and Check save modified files first and offer Save As for an untitled
Scripta document. These features require a trusted workspace and files on disk;
remote workspaces use the runtime installed on the remote host. Highlighting
and snippets work without `scr` and in Restricted Mode. IntelliSense, formatting,
and debugging are not included.

## Develop

With Node.js 22+ and npm:

```sh
npm install
npm test
npm run package
```

Open this folder in VS Code and press **F5** to launch an Extension Development
Host with `examples/highlighting.scr`. Check colors in a light and dark theme,
comment toggling, quote/bracket completion, indentation, and snippet insertion.
The example can be checked and run using `scr check examples/highlighting.scr`
and `scr examples/highlighting.scr`.

Tests use VS Code's TextMate and Oniguruma engines to check actual token scopes,
including multiline state and escaped quotes. They also expand snippet defaults
and can validate them with the runtime when `SCR_BIN` is set to its executable.

For packaging without npm dependencies, Python 3 can create the local-install
VSIX with `python3 scripts/package.py`. Marketplace publishing is a separate step;
verify the publisher identity and repository URL before publishing.

An editor smoke test is available in `tests/vscode`. With an isolated VS Code
profile, set `SCR_BIN` and launch VS Code with `--extensionDevelopmentPath` set
to this repository and `--extensionTestsPath` set to `tests/vscode` (both absolute
paths). The test checks language recognition, actual diagnostics, saving, and
running a terminal task. Use a separate `--user-data-dir` and `--extensions-dir`
for this test; it temporarily changes that profile's Scripta settings.
