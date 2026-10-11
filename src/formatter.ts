import * as vscode from 'vscode';

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

/** Configuration read from the `skink.format.*` settings. */
interface FormatOptions {
	indentSize: number;
	insertSpaces: boolean;
	trimTrailingWhitespace: boolean;
	ensureFinalNewline: boolean;
}

function readFormatOptions(
	document: vscode.TextDocument,
	formattingOptions: vscode.FormattingOptions,
): FormatOptions {
	const formatCfg = vscode.workspace.getConfiguration('skink.format', document.uri);

	// VS Code passes the resolved editor indent settings (tabSize /
	// insertSpaces) for the document via FormattingOptions. The skink.format.*
	// settings override them when explicitly set; otherwise the editor's
	// values are used.
	return {
		indentSize: formatCfg.get<number>('indentSize', formattingOptions.tabSize),
		insertSpaces: formatCfg.get<boolean>('insertSpaces', formattingOptions.insertSpaces),
		trimTrailingWhitespace: formatCfg.get<boolean>('trimTrailingWhitespace', true),
		ensureFinalNewline: formatCfg.get<boolean>('ensureFinalNewline', true),
	};
}

/** Build an indentation string of `level` levels using the given options. */
function makeIndent(level: number, opts: FormatOptions): string {
	if (level <= 0) {
		return '';
	}
	const unit = opts.insertSpaces ? ' '.repeat(opts.indentSize) : '\t';
	return unit.repeat(level);
}

/** Remove trailing whitespace from a line. */
function trimTrailing(s: string): string {
	let end = s.length;
	while (end > 0) {
		const c = s.charCodeAt(end - 1);
		if (c === 32 /* space */ || c === 9 /* tab */) {
			end--;
		} else {
			break;
		}
	}
	return end === s.length ? s : s.slice(0, end);
}

/** Trim leading and trailing whitespace. */
function trimBoth(s: string): string {
	let start = 0;
	let end = s.length;
	while (start < end) {
		const c = s.charCodeAt(start);
		if (c === 32 || c === 9) {
			start++;
		} else {
			break;
		}
	}
	while (end > start) {
		const c = s.charCodeAt(end - 1);
		if (c === 32 || c === 9) {
			end--;
		} else {
			break;
		}
	}
	return s.slice(start, end);
}

// ─── Bracket counting (string/comment aware) ──────────────────────────────
//
// The formatter needs to know the net bracket delta of each line to adjust
// indentation correctly. A line like `}}` should decrease indent by 2, not
// 1. Brackets inside string literals or comments must be ignored.

/**
 * Compute the net bracket delta of a line, skipping brackets inside string
 * literals and comments. Returns a positive number if the line opens more
 * brackets than it closes, negative if it closes more than it opens.
 *
 * Also returns `leadingClosing` — the number of consecutive closing brackets
 * at the start of the (trimmed) line. These are used to decrease indent
 * *before* emitting the line.
 */
function bracketDelta(s: string): { delta: number; leadingClosing: number } {
	let delta = 0;
	let i = 0;
	const n = s.length;

	// String state: 0 = none, 1 = double-quote, 2 = single-quote (backtick)
	let inString = 0;
	// Comment state: 0 = none, 1 = line comment (//), 2 = block comment (/* */)
	let inLineComment = false;
	let inBlockComment = false;

	while (i < n) {
		const c = s[i];
		const next = i + 1 < n ? s[i + 1] : '';

		// Handle string literals
		if (inString === 1) {
			if (c === '\\') {
				i += 2; // skip escaped char
				continue;
			}
			if (c === '"') {
				inString = 0;
			}
			i++;
			continue;
		}
		if (inString === 2) {
			if (c === '`') {
				inString = 0;
			}
			i++;
			continue;
		}

		// Handle comments
		if (inLineComment) {
			break; // rest of line is comment
		}
		if (inBlockComment) {
			if (c === '*' && next === '/') {
				inBlockComment = false;
				i += 2;
				continue;
			}
			i++;
			continue;
		}

		// Not in string or comment — check for string/comment starts
		if (c === '"') {
			inString = 1;
			i++;
			continue;
		}
		if (c === '`') {
			inString = 2;
			i++;
			continue;
		}
		if (c === '/' && next === '/') {
			inLineComment = true;
			break;
		}
		if (c === '/' && next === '*') {
			inBlockComment = true;
			i += 2;
			continue;
		}

		// Count brackets
		if (OPENING_BRACKETS.has(c)) {
			delta++;
		} else if (CLOSING_BRACKETS.has(c)) {
			delta--;
		}
		i++;
	}

	// Count leading closing brackets (on the trimmed line, skipping
	// strings/comments). These determine how much to dedent before the line.
	let leadingClosing = 0;
	i = 0;
	inString = 0;
	inLineComment = false;
	inBlockComment = false;
	while (i < n) {
		const c = s[i];
		const next = i + 1 < n ? s[i + 1] : '';

		if (inString === 1) {
			if (c === '\\') { i += 2; continue; }
			if (c === '"') inString = 0;
			i++; continue;
		}
		if (inString === 2) {
			if (c === '`') inString = 0;
			i++; continue;
		}
		if (inLineComment) break;
		if (inBlockComment) {
			if (c === '*' && next === '/') { inBlockComment = false; i += 2; continue; }
			i++; continue;
		}
		if (c === '"') { inString = 1; i++; continue; }
		if (c === '`') { inString = 2; i++; continue; }
		if (c === '/' && next === '/') { inLineComment = true; break; }
		if (c === '/' && next === '*') { inBlockComment = true; i += 2; continue; }

		if (c === ' ' || c === '\t') {
			i++;
			continue;
		}
		if (CLOSING_BRACKETS.has(c)) {
			leadingClosing++;
			i++;
			continue;
		}
		break; // first non-whitespace non-closing-bracket char
	}

	return { delta, leadingClosing };
}

/**
 * Format the full text of a Skink document and return the formatted lines.
 * Returns an array of formatted lines (without trailing newline).
 */
function formatLines(text: string, opts: FormatOptions): string[] {
	const lines = text.split('\n');
	const formatted: string[] = [];
	let indentLevel = 0;

	for (const rawLine of lines) {
		const trimmed = trimBoth(rawLine);

		// Preserve blank lines (but clear any whitespace on them).
		if (trimmed.length === 0) {
			formatted.push('');
			continue;
		}

		const { leadingClosing } = bracketDelta(trimmed);

		// Decrease indent for leading closing brackets (e.g. `}`, `}}`,
		// `})`, `} else {`).
		if (leadingClosing > 0) {
			indentLevel = Math.max(0, indentLevel - leadingClosing);
		}

		const indent = makeIndent(indentLevel, opts);
		let lineOut = indent + trimmed;
		if (opts.trimTrailingWhitespace) {
			lineOut = trimTrailing(lineOut);
		}
		formatted.push(lineOut);

		// Adjust indent level based on the net bracket delta of this line.
		// Leading closing brackets were already subtracted above, so we add
		// `delta + leadingClosing` to avoid double-counting them. This
		// correctly handles:
		//   `} else {`  → delta=0,  leadingClosing=1 → dedent 1 before, +1 after
		//   `}}`         → delta=-2, leadingClosing=2 → dedent 2 before, +0 after
		//   `fn foo() {` → delta=+1, leadingClosing=0 → no dedent,     +1 after
		const { delta } = bracketDelta(trimmed);
		indentLevel = Math.max(0, indentLevel + delta + leadingClosing);
	}

	return formatted;
}

/**
 * Format the full text of a Skink document and return the formatted string.
 * Returns the original text unchanged if formatting would produce no diff.
 */
function formatText(text: string, opts: FormatOptions): string {
	const formattedLines = formatLines(text, opts);
	let result = formattedLines.join('\n');

	// Ensure a trailing newline if the original had one or if configured.
	const hadTrailingNewline = text.length > 0 && text.charCodeAt(text.length - 1) === 10;
	if (opts.ensureFinalNewline && result.length > 0 && result.charCodeAt(result.length - 1) !== 10) {
		result += '\n';
	} else if (!opts.ensureFinalNewline && !hadTrailingNewline && result.charCodeAt(result.length - 1) === 10) {
		// Respect the original file: no trailing newline if the source had none.
		result = result.slice(0, -1);
	}

	return result;
}

/**
 * Build minimal `TextEdit`s that only touch lines whose formatted version
 * differs from the original. This avoids replacing the entire document,
 * which can revert the user's unsaved edits if the document changed
 * between when the formatter read it and when VS Code applies the edits.
 */
function editsForFullDocument(document: vscode.TextDocument, opts: FormatOptions): vscode.TextEdit[] {
	const original = document.getText();
	const formatted = formatText(original, opts);
	if (original === formatted) {
		return [];
	}

	const originalLines = original.split('\n');
	const formattedLines = formatted.split('\n');

	// If the line count changed (e.g. trailing newline added/removed), fall
	// back to a single full-range replacement.
	if (originalLines.length !== formattedLines.length) {
		const lastLine = document.lineCount - 1;
		const fullRange = new vscode.Range(
			new vscode.Position(0, 0),
			new vscode.Position(lastLine, document.lineAt(lastLine).text.length),
		);
		return [vscode.TextEdit.replace(fullRange, formatted)];
	}

	// Collect contiguous runs of changed lines and emit one TextEdit per run.
	const edits: vscode.TextEdit[] = [];
	let runStart = -1;
	for (let i = 0; i < formattedLines.length; i++) {
		if (originalLines[i] !== formattedLines[i]) {
			if (runStart < 0) {
				runStart = i;
			}
		} else {
			if (runStart >= 0) {
				edits.push(makeRangeEdit(document, runStart, i - 1, formattedLines, runStart, i - 1));
				runStart = -1;
			}
		}
	}
	if (runStart >= 0) {
		edits.push(makeRangeEdit(document, runStart, formattedLines.length - 1, formattedLines, runStart, formattedLines.length - 1));
	}

	return edits;
}

/** Create a TextEdit that replaces lines [startLine, endLine] with the
 *  formatted lines [fmtStart, fmtEnd]. */
function makeRangeEdit(
	document: vscode.TextDocument,
	startLine: number,
	endLine: number,
	formattedLines: string[],
	fmtStart: number,
	fmtEnd: number,
): vscode.TextEdit {
	const newText = formattedLines.slice(fmtStart, fmtEnd + 1).join('\n');
	const range = new vscode.Range(
		new vscode.Position(startLine, 0),
		new vscode.Position(endLine, document.lineAt(endLine).text.length),
	);
	return vscode.TextEdit.replace(range, newText);
}

/**
 * Build `TextEdit`s for formatting only a subrange of the document.
 *
 * The full document is reformatted (so bracket-based indentation stays
 * consistent), and then only the lines that fall within `range` are
 * compared against the original. Changed lines within the range are
 * returned as minimal per-run `TextEdit`s.
 */
function editsForRange(
	document: vscode.TextDocument,
	range: vscode.Range,
	opts: FormatOptions,
): vscode.TextEdit[] {
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
		const fullRange = new vscode.Range(
			new vscode.Position(0, 0),
			new vscode.Position(lastLine, document.lineAt(lastLine).text.length),
		);
		return [vscode.TextEdit.replace(fullRange, formatted)];
	}

	const startLine = range.start.line;
	const endLine = range.end.line;

	// Collect contiguous runs of changed lines within the selected range.
	const edits: vscode.TextEdit[] = [];
	let runStart = -1;
	for (let i = startLine; i <= endLine && i < formattedLines.length; i++) {
		if (originalLines[i] !== formattedLines[i]) {
			if (runStart < 0) {
				runStart = i;
			}
		} else {
			if (runStart >= 0) {
				edits.push(makeRangeEdit(document, runStart, i - 1, formattedLines, runStart, i - 1));
				runStart = -1;
			}
		}
	}
	if (runStart >= 0) {
		edits.push(makeRangeEdit(document, runStart, endLine, formattedLines, runStart, endLine));
	}

	return edits;
}

/** Provider registered with `vscode.languages.registerDocumentFormattingEditProvider`. */
export class SkinkFormattingEditProvider
	implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider
{
	provideDocumentFormattingEdits(
		document: vscode.TextDocument,
		options: vscode.FormattingOptions,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.TextEdit[]> {
		const opts = readFormatOptions(document, options);
		return editsForFullDocument(document, opts);
	}

	provideDocumentRangeFormattingEdits(
		document: vscode.TextDocument,
		range: vscode.Range,
		options: vscode.FormattingOptions,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.TextEdit[]> {
		const opts = readFormatOptions(document, options);
		return editsForRange(document, range, opts);
	}
}
