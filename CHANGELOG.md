# Changelog

All notable changes to the Skink Language Support extension will be documented in this file.

## [Unreleased]

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
