---
name: testing-skink-debugging
description: How to end-to-end test the Skink VS Code extension's debug handoff (F5 on a .skink file) on a Linux box without a real skink compiler.
---

# Testing Skink VS Code debugging

## Install / build the extension
- Package: `npm install && npx vsce package` in the repo root (or use a checked-in `*.vsix`).
- Install: `code --install-extension /abs/path/skink-lang-<ver>.vsix`; swap versions with
  `code --uninstall-extension skink-lang.skink-lang` first — VS Code keeps stale folders in
  `~/.vscode/extensions/`, so verify the *active* version with
  `python3 -c "import json;print([(e['identifier']['id'],e['version']) for e in json.load(open('/home/ubuntu/.vscode/extensions/extensions.json'))])"`.
- Any install/uninstall requires **Reload Window** (Ctrl+Shift+P → "Reload Window") to take effect.
- `.vscodeignore` must NOT exclude `node_modules/**`, otherwise `require('vscode-languageclient/node')`
  at the top of `out/extension.js` throws, `activate()` never runs, and F5 shows
  "Couldn't find a debug adapter descriptor for debug type 'Skink'". Verify the packaged extension
  contains `node_modules/vscode-languageclient` before testing.

## Native debugger
The extension only compiles and then re-launches via a native debug session, so one of
`vadimcn.vscode-lldb` (preferred) or `ms-vscode.cpptools` must be installed:
`code --install-extension vadimcn.vscode-lldb`. With neither installed the expected behaviour is a
warning notification with an "Install CodeLLDB" button and no debug session.

## Stub skink compiler (when the real Go/LLVM compiler can't be built)
`compileSkink` just runs `<compilerPath> -o <outBinary> <src.skink>`. A stub that emits C with
`#line N "<abs path to .skink>"` directives and compiles it with `gcc -g -O0` makes DWARF point at
the .skink file, so **breakpoints set in the .skink source actually resolve in lldb/gdb**. Point
`"skink.compilerPath"` (workspace settings) at the stub.

## Workspace setup
`.vscode/launch.json` with `{"type": "Skink", "request": "launch", "name": "Launch Skink File",
"program": "${workspaceFolder}/hello.skink"}`.

Breakpoints in `.skink` files require `"breakpoints": [{"language": "Skink"}]` in
`contributes` (present since 0.5.7). If a build ever lacks it, VS Code silently ignores gutter
clicks/F9 in `.skink` files — the workaround is `"debug.allowBreakpointsEverywhere": true` in
workspace settings, but the real fix is the `contributes.breakpoints` entry.

Gotcha when verifying breakpoint behaviour: breakpoints persist in VS Code workspace state across
reloads and extension reinstalls, so run **Run → Remove All Breakpoints** first, otherwise a
leftover breakpoint makes a broken build look like it works. Also, hovering the gutter shows a
faded red dot preview — confirm a breakpoint really exists via the **Breakpoints** panel entry
(`hello.skink` with the line-number badge) with the mouse moved away, not by the gutter alone.

## Verifying
- Output → "Skink Build" should log `Compiling:`, `Compilation successful! Invoking native debugger...`,
  `Target native debugger: CodeLLDB (type: "lldb")`.
- Output → "Extension Host", filter for `Cannot find module` — must be empty.
- Program stdout appears in the integrated Terminal tab ("Launch Skink File"), not the Debug Console.

## Devin Secrets Needed
None.
