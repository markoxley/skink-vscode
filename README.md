# Skink Language Support for VS Code

Provides syntax highlighting, snippets, and basic language configuration for the [Skink](https://github.com/markoxley/skink-lang) programming language.

## Features

- **Syntax Highlighting** — Full TextMate grammar covering:
  - Keywords (`fn`, `pub`, `struct`, `enum`, `if`, `for`, `match`, `defer`, `unsafe`, `async`, `await`, `spawn`, `select`, `comptime`, `ruleset`, `service`, `extern`, etc.)
  - Primitive types (`int`, `int8`–`int64`, `uint`, `uint8`–`uint64`, `float`, `bool`, `string`, `bytes`, `void`)
  - Collection types (`chan`, `tensor`, `set`, `[]T`, `map`)
  - Attributes (`[packed]`, `[cuda]`, `[inline]`, etc.)
  - String interpolation with `{expression}` inside double-quoted strings
  - Numeric literals (decimal, hex `0x`, binary `0b`, octal `0o`, floats with exponent)
  - Comments (`//`, `/* */`, `///` documentation)
  - Operators (arithmetic, bitwise, logical, comparison, assignment, channel `<-`)

- **Code Snippets** — Quickly scaffold common Skink constructs:
  - `fn` / `pubfn` — function declarations
  - `struct` / `gstruct` — struct and generic struct
  - `enum` — enumeration
  - `if` / `ife` / `forin` / `forc` / `while` / `until` / `match` — control flow
  - `service` / `ruleset` — service and ruleset definitions
  - `select` / `chan` / `spawn` / `async` — concurrency primitives
  - `defer` / `unsafe` / `with` / `comptime` — statements
  - `import` / `importb` / `module` / `extern` — module system
  - `tensor` — tensor declaration
  - `errret` / `errprop` — error handling
  - `doc` — documentation comment block

- **Debugging** — Compile and debug Skink programs with CodeLLDB or the C/C++ extension:
  - Press `F5` to compile the current `.skink` file and launch the native debugger
  - Automatically detects CodeLLDB (`vadimcn.vscode-lldb`) or C/C++ Tools (`ms-vscode.cpptools`)
  - Falls back to prompting to install CodeLLDB if neither is available

- **Testing** — Run `*_test.skink` files directly from the VS Code Test Explorer:
  - Discovers tests automatically from files matching `*_test.skink`
  - Parses `fn Test*(...)` functions in each test file
  - Run all tests, a single file, or individual tests
  - Results appear inline in the editor and in the Test Explorer panel
  - Uses the `skink test` command under the hood

- **Language Configuration**:
  - Auto-closing pairs for brackets, parentheses, and quotes
  - Comment toggling (`Ctrl+/`)
  - Indentation rules for `{}` blocks
  - Word pattern for identifier selection
  - Doc-comment continuation (`///`)

## Requirements

- **Skink compiler** — The extension looks for the `skink` executable in:
  1. `skink.compilerPath` setting
  2. `PATH` environment variable
  3. Workspace-relative paths (`skink/compiler/cmd/skink/skink`)
  4. Extension-relative paths (when running from the repo)

- **Native debugger** (for debugging) — Install one of:
  - [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb) (recommended)
  - [C/C++](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools)

## Configuration

| Setting              | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `skink.compilerPath` | Absolute path to the `skink` compiler executable                   |
| `skink.skinkHome`    | Directory containing `lib/` and `std/` (sets `SKINK_HOME` env var) |

Example `settings.json`:

```json
{
  "skink.compilerPath": "/home/user/skink-lang/skink/compiler/cmd/skink/skink",
  "skink.skinkHome": "/home/user/skink-lang/skink/compiler"
}
```

## Launch Configuration

Add to your workspace `.vscode/launch.json`:

```json
{
  "type": "Skink",
  "request": "launch",
  "name": "Debug Skink File",
  "program": "${file}",
  "compilerPath": "${workspaceFolder}/skink/compiler/cmd/skink/skink",
  "skinkHome": "${workspaceFolder}/skink/compiler"
}
```

## Installation

### From Source

1. Clone the repository
2. Open the `Skink-vscode` folder in VS Code
3. Press `F5` to launch a new Extension Development Host window with the extension loaded

### VSIX Package

```bash
cd Skink-vscode
npm install -g @vscode/vsce
vsce package
```

Then install the generated `.vsix` file via the Extensions panel (`Install from VSIX...`).

## File Association

Files with the `.skink` extension are automatically recognized as Skink source files.

## Example

```Skink
module example

/// Clamps a value between a minimum and maximum.
pub fn clamp(val: float, min: float, max: float) -> float {
    if val < min { return min }
    if val > max { return max }
    return val
}

fn main() -> int {
    result := clamp(15.0, 0.0, 10.0)
    print("Clamped: {result}")
    return 0
}
```

## License

MIT
