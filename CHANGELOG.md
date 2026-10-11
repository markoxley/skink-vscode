# Changelog

All notable changes to the Skink Language Support extension will be documented in this file.

## [0.6.2] - 2026-10-05

### Fixed
- **Formatter block indentation**: The formatter now counts all brackets on each line (not just the first and last character) to compute the correct indent delta. Lines like `}}` now decrease indent by 2 instead of 1, and `} else {` correctly dedents before the line and re-indents after. Brackets inside string literals and comments are skipped.
- **Formatter no longer reverts code**: The formatter now returns minimal per-line `TextEdit`s (one per contiguous run of changed lines) instead of a single full-document replacement. This prevents the formatter from overwriting the user's recent edits when the document changes between when the formatter reads it and when VS Code applies the edits (e.g. during format-on-save).
- **Syntax highlighting consistency**: Fixed the function declaration pattern (the `begin`/`end` pattern matched too early, so function names were never highlighted as declarations). Added missing `type` and `as` keywords. Added `type-annotations` and `field-access` patterns for more consistent highlighting of types after `:` and properties after `.`. Removed the generic function call pattern that matched identifiers followed by `<` (which caused false positives on comparison expressions).

## [0.6.1] - 2026-09-04

### Fixed
- **Diagnostics now work in real-time**: The `skink-lsp` language server was silently dropping all syntax and parser errors because `diagnostics.skink` only captured the declarations from `resolver.Resolve()` and ignored the returned error list. Errors were instead printed to stdout, corrupting the LSP protocol. The diagnostics module now captures both return values and converts resolver/parser errors into LSP diagnostics, so syntax errors are highlighted immediately as you type.
- **Error position parsing**: `parseCheckerError()` now correctly handles the `filePath line:col: message` format (with a file-path prefix that may contain digits) by walking backwards from the first colon to find the line-number digit run, rather than assuming the entire prefix is the line number.

### Added
- **Fallback diagnostic provider**: When the `skink-lsp` language server is unavailable, disabled, or fails to start, the extension now runs `skink -check` on document changes (debounced 250ms) and highlights syntax/type errors in the editor. This ensures error highlighting works even without the language server installed.
- New `skink.enableDiagnostics` setting (default: `true`) to control the fallback diagnostic provider.

## [0.6.0] - 2026-09-01

## [0.5.5] - 2026-08-31

### Fixed
- **Debugging**: The debug configuration provider no longer mutates `config.type` in-place (which VS Code does not re-dispatch, causing "no debug adapter registered for type 'Skink'" errors). It now builds a fresh native debug config and launches it via `vscode.debug.startDebugging()`, returning `undefined` to cancel the placeholder "Skink" session. Debugging now correctly delegates to CodeLLDB / LLDB-DAP / C/C++ debugger.
- **Formatting context menu**: Resolved a dual-formatter conflict where both the extension-host formatter and the skink-lsp language server registered as formatters for `.skink` files. With two formatters and no default set, VS Code hides "Format Document" from the right-click context menu. The extension-host formatter is now only registered when the LSP is disabled (`skink.enableLSP: false`), so there is always exactly one formatter and "Format Document" / "Format Selection" appear in the context menu.

### Added
- Registered the extension as a first-class VS Code formatter for `.skink` files via `vscode.languages.registerDocumentFormattingEditProvider` and `registerDocumentRangeFormattingEditProvider`.
- Formatting now works with **Format Document** (`Shift+Alt+F`), **Format Selection** (`Ctrl+K Ctrl+F`), **Format on Save**, and the **Format Document With...** picker, and can be set as `editor.defaultFormatter`.
- New `skink.format.*` settings: `enable`, `indentSize`, `insertSpaces`, `trimTrailingWhitespace`, `ensureFinalNewline`.
- Formatter runs in the extension host and does not require the language server.

## [0.1.0] - 2026-06-07

### Added
- Initial release with syntax highlighting for the Skink programming language.
- Support for `.skink` file extension.
- TextMate grammar covering keywords, types, operators, literals, strings (with interpolation), comments, and attributes.
- 25+ code snippets for common Skink constructs (functions, structs, enums, control flow, concurrency, etc.).
- Language configuration with bracket matching, auto-closing pairs, and comment toggling.
