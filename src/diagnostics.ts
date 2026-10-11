import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';

// ─── Fallback Diagnostics Provider ───────────────────────────────────────
//
// When the skink-lsp language server is not available (binary not found,
// disabled, or crashed), this provider runs `skink -check` on the document
// and parses the compiler's error output into VS Code diagnostics. This
// gives users real-time syntax and type error highlighting without needing
// the LSP server.
//
// The provider debounces updates (250ms by default) to avoid running the
// compiler on every keystroke.

const DEBOUNCE_MS = 250;

// Counter for generating unique temp-file names. Combined with the PID and
// a hash of the file path, this ensures two documents with the same basename
// in different directories don't race on the same temp file.
let tempCounter = 0;

/**
 * makeTempFileName builds a unique temp file name for a given source path.
 * The name includes the PID, a hash of the full path (to distinguish files
 * with the same basename in different directories), and a monotonic counter
 * (to handle rapid re-checks of the same file).
 *
 * Exported for unit testing.
 */
export function makeTempFileName(filePath: string, pid: number): string {
	tempCounter = (tempCounter + 1) % 1000000;
	const pathHash = crypto.createHash('md5').update(filePath).digest('hex').slice(0, 8);
	const base = path.basename(filePath);
	return `skink_check_${pid}_${pathHash}_${tempCounter}_${base}`;
}

/**
 * ParsedError represents a single compiler error extracted from output.
 */
export interface ParsedError {
	line: number;   // 0-based line number
	col: number;    // 0-based column number
	message: string;
}

/**
 * parseCompilerOutputLine parses a single line of compiler output of the
 * form "filePath line:col: message" and returns a ParsedError, or undefined
 * if the line doesn't match.
 *
 * The regex is greedy on the path to handle paths containing digits. The
 * path is separated from the line number by a space, so we match the last
 * space before the first colon. Lines saying "type check passed" are
 * ignored.
 *
 * Exported for unit testing.
 */
export function parseCompilerOutputLine(line: string): ParsedError | undefined {
	const trimmed = line.trim();
	if (!trimmed || trimmed === 'type check passed') {
		return undefined;
	}
	// Match: <path> <line>:<col>: <message>
	// The path is greedy (.+) to consume any spaces/digits in the path.
	// We require the line:col: pattern at the end, preceded by a space
	// that separates the path from the line number.
	const errorRe = /^(.+)\s+(\d+):(\d+):\s*(.+)$/;
	const match = errorRe.exec(trimmed);
	if (!match) {
		return undefined;
	}
	const [, , lineStr, colStr, message] = match;
	const lineNum = parseInt(lineStr, 10) - 1; // 0-based
	const colNum = parseInt(colStr, 10) - 1;
	return {
		line: Math.max(0, lineNum),
		col: Math.max(0, colNum),
		message,
	};
}

export class SkinkDiagnosticProvider {
	private diagnosticCollection: vscode.DiagnosticCollection;
	private timers = new Map<string, NodeJS.Timeout>();
	private compilerPath: string | undefined;
	private skinkHome: string | undefined;

	constructor() {
		this.diagnosticCollection = vscode.languages.createDiagnosticCollection('skink');
	}

	dispose() {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();
		this.diagnosticCollection.dispose();
	}

	/** Refresh configuration from VS Code settings. */
	refreshConfig() {
		const config = vscode.workspace.getConfiguration('skink');
		const cpSetting = config.get<string>('compilerPath', '');
		this.compilerPath = cpSetting && cpSetting.trim() && fs.existsSync(cpSetting)
			? cpSetting
			: this.findCompilerOnPath();
		this.skinkHome = config.get<string>('skinkHome', '') || process.env.SKINK_HOME || undefined;
	}

	/** Schedule a diagnostic check for a document (debounced). */
	scheduleCheck(document: vscode.TextDocument) {
		if (document.languageId !== 'Skink' && document.languageId !== 'skink') {
			return;
		}
		if (document.uri.scheme !== 'file') {
			return;
		}

		const key = document.uri.fsPath;
		const existing = this.timers.get(key);
		if (existing) {
			clearTimeout(existing);
		}

		const timer = setTimeout(() => {
			this.timers.delete(key);
			this.checkDocument(document);
		}, DEBOUNCE_MS);
		this.timers.set(key, timer);
	}

	/** Clear diagnostics for a document. */
	clear(uri: vscode.Uri) {
		const key = uri.fsPath;
		const timer = this.timers.get(key);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(key);
		}
		this.diagnosticCollection.delete(uri);
	}

	/** Run `skink -check` on the document and publish diagnostics. */
	private async checkDocument(document: vscode.TextDocument) {
		if (!this.compilerPath) {
			this.refreshConfig();
		}
		if (!this.compilerPath) {
			return;
		}

		const filePath = document.uri.fsPath;
		const folder = vscode.workspace.getWorkspaceFolder(document.uri);
		const cwd = folder ? folder.uri.fsPath : path.dirname(filePath);

		// Build environment with SKINK_HOME
		const env = { ...process.env } as Record<string, string>;
		if (this.skinkHome) {
			env.SKINK_HOME = this.skinkHome;
		}

		// Write the current document text to a temp file so we check unsaved
		// content, not just what's on disk. The temp file name includes a
		// hash of the full path and a counter to avoid collisions between
		// documents with the same basename in different directories.
		const tmpDir = os.tmpdir();
		const tmpFile = path.join(tmpDir, makeTempFileName(filePath, process.pid));
		try {
			fs.writeFileSync(tmpFile, document.getText());
		} catch {
			return;
		}

		try {
			const result = await this.runCompiler(tmpFile, cwd, env);
			const diags = this.parseCompilerOutput(result.stdout, document);
			this.diagnosticCollection.set(document.uri, diags);
		} catch {
			// Compiler failed to run — clear diagnostics rather than showing stale ones
			this.diagnosticCollection.set(document.uri, []);
		} finally {
			try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
		}
	}

	private runCompiler(
		tmpFile: string,
		cwd: string,
		env: Record<string, string>,
	): Promise<{ stdout: string; stderr: string }> {
		return new Promise((resolve, reject) => {
			const child = cp.spawn(this.compilerPath!, ['-check', tmpFile], { cwd, env });
			let stdout = '';
			let stderr = '';
			child.stdout.on('data', (d) => { stdout += d.toString(); });
			child.stderr.on('data', (d) => { stderr += d.toString(); });
			child.on('error', reject);
			child.on('exit', () => resolve({ stdout, stderr }));
		});
	}

	/**
	 * Parse compiler output lines of the form:
	 *   "filePath line:col: message"
	 * into VS Code Diagnostics. Lines that say "type check passed" are ignored.
	 */
	private parseCompilerOutput(
		output: string,
		document: vscode.TextDocument,
	): vscode.Diagnostic[] {
		const diags: vscode.Diagnostic[] = [];
		const lines = output.split('\n');

		for (const line of lines) {
			const parsed = parseCompilerOutputLine(line);
			if (!parsed) {
				continue;
			}
			const startLine = parsed.line;
			const startChar = parsed.col;

			// Underline from the column to end of line
			const docLine = document.lineAt(Math.min(startLine, document.lineCount - 1));
			const range = new vscode.Range(
				startLine, startChar,
				startLine, Math.max(startChar + 1, docLine.range.end.character),
			);

			diags.push(new vscode.Diagnostic(
				range,
				parsed.message,
				vscode.DiagnosticSeverity.Error,
			));
		}

		return diags;
	}

	private findCompilerOnPath(): string | undefined {
		const exeName = os.platform() === 'win32' ? 'skink.exe' : 'skink';
		const envPaths = (process.env.PATH || '').split(path.delimiter);
		for (const p of envPaths) {
			const fullPath = path.join(p, exeName);
			if (fs.existsSync(fullPath)) {
				return fullPath;
			}
		}
		// Common install locations
		const installPaths = [
			'/usr/local/bin/skink',
			'/usr/bin/skink',
			path.join(os.homedir(), '.local/bin/skink'),
		];
		for (const p of installPaths) {
			if (fs.existsSync(p)) {
				return p;
			}
		}
		return undefined;
	}
}
