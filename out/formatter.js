"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkinkFormattingEditProvider = void 0;
const vscode = __importStar(require("vscode"));
// ─── Skink Formatter ────────────────────────────────────────────────────
//
// A native VS Code formatter for the Skink language. It registers itself
// through `vscode.languages.registerDocumentFormattingEditProvider` so it
// behaves like any other formatter in VS Code (shows up in the
// "Format Document With..." picker, can be set as the default formatter,
// works with "Format on Save", etc.).
//
// The formatting logic mirrors the `skink-lsp` formatting module
// (lsp/formatting.skink): consistent indentation, trailing whitespace
// trimming, and bracket-based indent adjustment. It runs entirely in the
// extension host, so it works whether or not the language server is running.
const CLOSING_BRACKETS = new Set(['}', ']', ')']);
const OPENING_BRACKETS = new Set(['{', '[', '(']);
function readFormatOptions(document, formattingOptions) {
    const formatCfg = vscode.workspace.getConfiguration('skink.format', document.uri);
    // VS Code passes the resolved editor indent settings (tabSize /
    // insertSpaces) for the document via FormattingOptions. The skink.format.*
    // settings override them when explicitly set; otherwise the editor's
    // values are used.
    return {
        indentSize: formatCfg.get('indentSize', formattingOptions.tabSize),
        insertSpaces: formatCfg.get('insertSpaces', formattingOptions.insertSpaces),
        trimTrailingWhitespace: formatCfg.get('trimTrailingWhitespace', true),
        ensureFinalNewline: formatCfg.get('ensureFinalNewline', true),
    };
}
/** Build an indentation string of `level` levels using the given options. */
function makeIndent(level, opts) {
    if (level <= 0) {
        return '';
    }
    const unit = opts.insertSpaces ? ' '.repeat(opts.indentSize) : '\t';
    return unit.repeat(level);
}
/** Remove trailing whitespace from a line. */
function trimTrailing(s) {
    let end = s.length;
    while (end > 0) {
        const c = s.charCodeAt(end - 1);
        if (c === 32 /* space */ || c === 9 /* tab */) {
            end--;
        }
        else {
            break;
        }
    }
    return end === s.length ? s : s.slice(0, end);
}
/** Trim leading and trailing whitespace. */
function trimBoth(s) {
    let start = 0;
    let end = s.length;
    while (start < end) {
        const c = s.charCodeAt(start);
        if (c === 32 || c === 9) {
            start++;
        }
        else {
            break;
        }
    }
    while (end > start) {
        const c = s.charCodeAt(end - 1);
        if (c === 32 || c === 9) {
            end--;
        }
        else {
            break;
        }
    }
    return s.slice(start, end);
}
/** Returns true if the (trimmed) line starts with a closing bracket. */
function startsWithClosing(s) {
    return s.length > 0 && CLOSING_BRACKETS.has(s[0]);
}
/**
 * Returns true if the (trimmed) line ends with an opening bracket.
 * Ignores trailing line comments so that `fn foo() { // comment` still
 * triggers an indent increase.
 */
function endsWithOpening(s) {
    if (s.length === 0) {
        return false;
    }
    // Strip a trailing // comment for bracket detection.
    let work = s;
    const commentIdx = work.indexOf('//');
    if (commentIdx >= 0) {
        work = trimTrailing(work.slice(0, commentIdx));
    }
    if (work.length === 0) {
        return false;
    }
    return OPENING_BRACKETS.has(work[work.length - 1]);
}
/**
 * Format the full text of a Skink document and return the formatted string.
 * Returns the original text unchanged if formatting would produce no diff.
 */
function formatText(text, opts) {
    const lines = text.split('\n');
    const formatted = [];
    let indentLevel = 0;
    for (const rawLine of lines) {
        const trimmed = trimBoth(rawLine);
        // Preserve blank lines (but clear any whitespace on them).
        if (trimmed.length === 0) {
            formatted.push('');
            continue;
        }
        // Decrease indent for lines that start with a closing bracket.
        if (startsWithClosing(trimmed) && indentLevel > 0) {
            indentLevel--;
        }
        const indent = makeIndent(indentLevel, opts);
        let lineOut = indent + trimmed;
        if (opts.trimTrailingWhitespace) {
            lineOut = trimTrailing(lineOut);
        }
        formatted.push(lineOut);
        // Increase indent after lines that end with an opening bracket.
        if (endsWithOpening(trimmed)) {
            indentLevel++;
        }
    }
    let result = formatted.join('\n');
    // Ensure a trailing newline if the original had one or if configured.
    const hadTrailingNewline = text.length > 0 && text.charCodeAt(text.length - 1) === 10;
    if (opts.ensureFinalNewline && result.length > 0 && result.charCodeAt(result.length - 1) !== 10) {
        result += '\n';
    }
    else if (!opts.ensureFinalNewline && !hadTrailingNewline && result.charCodeAt(result.length - 1) === 10) {
        // Respect the original file: no trailing newline if the source had none.
        result = result.slice(0, -1);
    }
    return result;
}
/**
 * Build the `TextEdit` that replaces the whole document with the formatted
 * text. Returns `[]` when the document is already formatted.
 */
function editsForFullDocument(document, opts) {
    const original = document.getText();
    const formatted = formatText(original, opts);
    if (original === formatted) {
        return [];
    }
    const lastLine = document.lineCount - 1;
    const fullRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lastLine, document.lineAt(lastLine).text.length));
    return [vscode.TextEdit.replace(fullRange, formatted)];
}
/**
 * Build `TextEdit`s for formatting only a subrange of the document.
 *
 * The full document is reformatted (so bracket-based indentation stays
 * consistent), and then only the lines that fall within `range` are
 * compared against the original. Changed lines within the range are
 * returned as a single replacing `TextEdit`.
 */
function editsForRange(document, range, opts) {
    const original = document.getText();
    const formatted = formatText(original, opts);
    if (original === formatted) {
        return [];
    }
    const originalLines = original.split('\n');
    const formattedLines = formatted.split('\n');
    if (originalLines.length !== formattedLines.length) {
        // Line count changed — fall back to full-document replacement.
        const lastLine = document.lineCount - 1;
        const fullRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lastLine, document.lineAt(lastLine).text.length));
        return [vscode.TextEdit.replace(fullRange, formatted)];
    }
    const startLine = range.start.line;
    const endLine = range.end.line;
    // Collect the formatted lines for the selected range.
    let changed = false;
    const out = [];
    for (let i = startLine; i <= endLine && i < formattedLines.length; i++) {
        if (originalLines[i] !== formattedLines[i]) {
            changed = true;
        }
        out.push(formattedLines[i]);
    }
    if (!changed) {
        return [];
    }
    const newText = out.join('\n');
    const replaceRange = new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine, document.lineAt(endLine).text.length));
    return [vscode.TextEdit.replace(replaceRange, newText)];
}
/** Provider registered with `vscode.languages.registerDocumentFormattingEditProvider`. */
class SkinkFormattingEditProvider {
    provideDocumentFormattingEdits(document, options, _token) {
        const opts = readFormatOptions(document, options);
        return editsForFullDocument(document, opts);
    }
    provideDocumentRangeFormattingEdits(document, range, options, _token) {
        const opts = readFormatOptions(document, options);
        return editsForRange(document, range, opts);
    }
}
exports.SkinkFormattingEditProvider = SkinkFormattingEditProvider;
//# sourceMappingURL=formatter.js.map