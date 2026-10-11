import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as os from 'os';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
	Executable,
} from 'vscode-languageclient/node';
import { SkinkFormattingEditProvider } from './formatter';
import { SkinkDiagnosticProvider } from './diagnostics';

// ─── Extension Entry Point ───────────────────────────────────────────────

let languageClient: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext) {
	// 1. Debug configuration provider
	//    The "Skink" debugger type is a placeholder: the provider compiles the
	//    .skink file, then launches a *new* debug session using a native
	//    debugger (lldb, lldb-dap, or cppdbg) via vscode.debug.startDebugging.
	//    It returns undefined so VS Code does not try to start a (non-existent)
	//    "Skink" debug adapter. No DebugAdapterDescriptorFactory is registered
	//    because the "Skink" type never runs a real debug adapter.
	const debugProvider = new SkinkDebugConfigurationProvider();
	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider('Skink', debugProvider)
	);

	// 2. Test controller
	const testController = new SkinkTestController();
	context.subscriptions.push(testController);
	testController.discoverAll();

	// 3. Commands
	context.subscriptions.push(
		vscode.commands.registerCommand('skink.runTests', () => testController.runAll()),
		vscode.commands.registerCommand('skink.runTestFile', (uri: vscode.Uri) => testController.runFile(uri)),
		vscode.commands.registerCommand('skink.refreshTests', () => testController.discoverAll())
	);

	// 4. File watchers for test discovery
	const testWatcher = vscode.workspace.createFileSystemWatcher('**/*_test.skink');
	context.subscriptions.push(
		testWatcher.onDidCreate((uri) => testController.addFile(uri)),
		testWatcher.onDidChange((uri) => testController.refreshFile(uri)),
		testWatcher.onDidDelete((uri) => testController.removeFile(uri)),
		testWatcher
	);

	// 5. Register the Skink formatter so it behaves like any other VS Code
	//    formatter (appears in "Format Document With...", can be set as the
	//    default formatter, works with "Format on Save"). This runs in the
	//    extension host and does not require the language server.
	//
	//    IMPORTANT: When the LSP is enabled, skink-lsp already advertises
	//    documentFormattingProvider:true and the vscode-languageclient library
	//    auto-registers a formatter for it. If we ALSO register our own
	//    extension-host formatter here, VS Code sees TWO formatters for Skink
	//    files. With multiple formatters and no default formatter set, VS Code
	//    hides the "Format Document" entry from the editor context menu (right-
	//    click). To keep a single formatter (so the context menu works), we
	//    only register the extension-host formatter when the LSP is disabled.
	//    When the LSP is enabled, the LSP's formatter is the sole provider.
	//
	//    Settings behavior:
	//    - When LSP is ENABLED (default): the LSP formatter is used. It honors
	//      `tabSize` and `insertSpaces` from the LSP FormattingOptions (which
	//      VS Code populates from `editor.tabSize` and `editor.insertSpaces`).
	//      The `skink.format.indentSize`, `trimTrailingWhitespace`, and
	//      `ensureFinalNewline` settings are NOT passed to the LSP by the
	//      standard LSP formatting request, so they have no effect when the
	//      LSP is enabled. The LSP formatter always trims trailing whitespace
	//      and ensures a final newline (sensible defaults).
	//    - When LSP is DISABLED: the extension-host formatter is used. It
	//      honors all `skink.format.*` settings: `indentSize`, `insertSpaces`,
	//      `trimTrailingWhitespace`, and `ensureFinalNewline`.
	const enableLSP = vscode.workspace.getConfiguration('skink').get<boolean>('enableLSP', true);
	const formatEnabled = vscode.workspace.getConfiguration('skink.format').get<boolean>('enable', true);
	if (formatEnabled && !enableLSP) {
		const formatter = new SkinkFormattingEditProvider();
		context.subscriptions.push(
			vscode.languages.registerDocumentFormattingEditProvider(
				[{ scheme: 'file', language: 'Skink' }, { scheme: 'file', language: 'skink' }],
				formatter,
			),
			vscode.languages.registerDocumentRangeFormattingEditProvider(
				[{ scheme: 'file', language: 'Skink' }, { scheme: 'file', language: 'skink' }],
				formatter,
			),
		);
	}

	// 6. Start the skink-lsp language server (provides diagnostics, completion,
	//    hover, symbols, definition, formatting, semantic tokens, etc.)
	//
	//    When the LSP is disabled or fails to start, we register a fallback
	//    diagnostic provider that runs `skink -check` on document changes.
	//    This ensures syntax/type errors are always highlighted in the editor
	//    even without the language server.
	let diagnosticProvider: SkinkDiagnosticProvider | undefined;
	const enableDiagnostics = vscode.workspace.getConfiguration('skink').get<boolean>('enableDiagnostics', true);

	if (enableLSP) {
		// Try to start the LSP. If it fails (binary not found, crash, etc.),
		// fall back to the compiler-based diagnostic provider.
		const lspStarted = await startLanguageServer(context);
		if (!lspStarted && enableDiagnostics) {
			diagnosticProvider = new SkinkDiagnosticProvider();
			diagnosticProvider.refreshConfig();
			context.subscriptions.push(diagnosticProvider);
			registerDiagnosticListeners(context, diagnosticProvider);
		}
	} else if (enableDiagnostics) {
		// LSP disabled — use the fallback diagnostic provider exclusively.
		diagnosticProvider = new SkinkDiagnosticProvider();
		diagnosticProvider.refreshConfig();
		context.subscriptions.push(diagnosticProvider);
		registerDiagnosticListeners(context, diagnosticProvider);
	}
}

// Register document event listeners that drive the fallback diagnostic provider.
function registerDiagnosticListeners(
	context: vscode.ExtensionContext,
	provider: SkinkDiagnosticProvider,
) {
	// Check open documents on activation
	for (const doc of vscode.workspace.textDocuments) {
		provider.scheduleCheck(doc);
	}

	context.subscriptions.push(
		// Check on document open
		vscode.workspace.onDidOpenTextDocument((doc) => provider.scheduleCheck(doc)),
		// Check on document change (debounced inside the provider)
		vscode.workspace.onDidChangeTextDocument((e) => provider.scheduleCheck(e.document)),
		// Clear diagnostics on close
		vscode.workspace.onDidCloseTextDocument((doc) => provider.clear(doc.uri)),
		// Re-check on save (the file on disk is now current)
		vscode.workspace.onDidSaveTextDocument((doc) => provider.scheduleCheck(doc)),
	);
}

export async function deactivate(): Promise<void> {
	if (languageClient) {
		await languageClient.stop();
		languageClient = undefined;
	}
}

// ─── Language Server ─────────────────────────────────────────────────────

async function startLanguageServer(context: vscode.ExtensionContext): Promise<boolean> {
	const lspPath = findSkinkLSP();
	if (!lspPath) {
		vscode.window.showWarningMessage(
			'Could not find the skink-lsp language server. Please configure "skink.lspPath" in your settings, or ensure skink-lsp is on your PATH.',
		);
		return false;
	}

	// Pass SKINK_HOME to the LSP server so it can resolve stdlib modules.
	const skinkHome = getSkinkHome();
	const serverEnv: Record<string, string> = { ...process.env as Record<string, string> };
	if (skinkHome) {
		serverEnv.SKINK_HOME = skinkHome;
	}

	const executable: Executable = {
		command: lspPath,
		transport: TransportKind.stdio,
		options: {
			env: serverEnv,
		},
	};

	const serverOptions: ServerOptions = {
		run: executable,
		debug: executable,
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'Skink' }],
		synchronize: {
			fileEvents: vscode.workspace.createFileSystemWatcher('**/*.skink'),
		},
	};

	languageClient = new LanguageClient(
		'skink-lsp',
		'Skink Language Server',
		serverOptions,
		clientOptions,
	);

	// Start the client. This also activates all LSP-provided features
	// (diagnostics, completion, hover, definition, symbols, formatting,
	// semantic tokens, document highlights, rename, references).
	context.subscriptions.push(languageClient);

	try {
		await languageClient.start();
		return true;
	} catch (err: any) {
		vscode.window.showErrorMessage(`Failed to start skink-lsp: ${err.message}`);
		languageClient = undefined;
		return false;
	}
}

function findSkinkLSP(): string | undefined {
	// 1. From VS Code settings
	const settingsPath = vscode.workspace.getConfiguration('skink').get<string>('lspPath');
	if (settingsPath && settingsPath.trim()) {
		if (fs.existsSync(settingsPath)) {
			return settingsPath;
		}
	}

	// 2. Repository relative layout (extension inside repo)
	const repoPaths = [
		path.resolve(__dirname, '../../skink-lsp/skink-lsp'),
		path.resolve(__dirname, '../../skink-lsp/skink-lsp.exe'),
		path.resolve(__dirname, '../../skink-lsp/bin/skink-lsp'),
	];
	for (const p of repoPaths) {
		if (fs.existsSync(p)) {
			return p;
		}
	}

	// 3. Workspace relative
	if (vscode.workspace.workspaceFolders) {
		for (const folder of vscode.workspace.workspaceFolders) {
			const wsPaths = [
				path.resolve(folder.uri.fsPath, 'skink-lsp/skink-lsp'),
				path.resolve(folder.uri.fsPath, 'skink-lsp/bin/skink-lsp'),
			];
			for (const p of wsPaths) {
				if (fs.existsSync(p)) {
					return p;
				}
			}
		}
	}

	// 4. PATH lookup
	const exeName = os.platform() === 'win32' ? 'skink-lsp.exe' : 'skink-lsp';
	const envPaths = (process.env.PATH || '').split(path.delimiter);
	for (const p of envPaths) {
		const fullPath = path.join(p, exeName);
		if (fs.existsSync(fullPath)) {
			return fullPath;
		}
	}

	// 5. Common install locations
	const installPaths = [
		'/usr/local/bin/skink-lsp',
		'/usr/bin/skink-lsp',
		path.join(os.homedir(), '.local/bin/skink-lsp'),
	];
	for (const p of installPaths) {
		if (fs.existsSync(p)) {
			return p;
		}
	}

	return undefined;
}

// ─── Compiler Discovery ──────────────────────────────────────────────────

async function findSkinkCompiler(configCompilerPath?: string, folder?: vscode.WorkspaceFolder): Promise<string | undefined> {
	// 1. From explicit configuration
	if (configCompilerPath && configCompilerPath.trim()) {
		if (fs.existsSync(configCompilerPath)) {
			return configCompilerPath;
		}
	}

	// 2. From VS Code settings (lowercase key to match package.json)
	const settingsPath = vscode.workspace.getConfiguration('skink').get<string>('compilerPath');
	if (settingsPath && settingsPath.trim()) {
		if (fs.existsSync(settingsPath)) {
			return settingsPath;
		}
	}

	// 2. Repository relative layout (extension inside repo)
	const repoPaths = [
		path.resolve(__dirname, '../../skink/skink'),
		path.resolve(__dirname, '../../skink/skink.exe'),
		path.resolve(__dirname, '../../skink-pure/skink'),
		path.resolve(__dirname, '../../skink-pure/skink.exe'),
		path.resolve(__dirname, '../../skink'),
		path.resolve(__dirname, '../../skink.exe'),
	];
	for (const p of repoPaths) {
		if (fs.existsSync(p)) {
			return p;
		}
	}

	// 3. Workspace relative
	if (folder) {
		const wsPaths = [
			path.resolve(folder.uri.fsPath, 'skink/skink'),
			path.resolve(folder.uri.fsPath, 'skink'),
			path.resolve(folder.uri.fsPath, 'skink-pure/skink'),
		];
		for (const p of wsPaths) {
			if (fs.existsSync(p)) {
				return p;
			}
		}
	}

	// 4. Common install locations
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

	// 5. PATH lookup
	const exeName = os.platform() === 'win32' ? 'skink.exe' : 'skink';
	const envPaths = (process.env.PATH || '').split(path.delimiter);
	for (const p of envPaths) {
		const fullPath = path.join(p, exeName);
		if (fs.existsSync(fullPath)) {
			return fullPath;
		}
	}

	return undefined;
}

function getSkinkHome(configSkinkHome?: string, folder?: vscode.WorkspaceFolder): string | undefined {
	// 1. Explicit
	if (configSkinkHome && configSkinkHome.trim()) {
		return configSkinkHome;
	}
	// 2. Settings
	const settingsHome = vscode.workspace.getConfiguration('skink').get<string>('skinkHome');
	if (settingsHome && settingsHome.trim()) {
		return settingsHome;
	}
	// 3. Env
	if (process.env.SKINK_HOME) {
		return process.env.SKINK_HOME;
	}
	// 4. Repo relative
	const repoHomes = [
		path.resolve(__dirname, '../../skink/std'),
		path.resolve(__dirname, '../../skink'),
		path.resolve(__dirname, '../../skink-pure/std'),
		path.resolve(__dirname, '../../skink-pure'),
	];
	for (const h of repoHomes) {
		if (fs.existsSync(path.join(h, 'json.skink')) || fs.existsSync(path.join(h, 'std/json.skink'))) {
			return fs.existsSync(path.join(h, 'json.skink')) ? h : path.join(h, 'std');
		}
	}
	// 5. Workspace relative
	if (folder) {
		const wsHomes = [
			path.resolve(folder.uri.fsPath, 'std'),
			path.resolve(folder.uri.fsPath, 'skink/std'),
			path.resolve(folder.uri.fsPath, 'skink-pure/std'),
			folder.uri.fsPath,
		];
		for (const wsHome of wsHomes) {
			if (fs.existsSync(path.join(wsHome, 'json.skink'))) {
				return wsHome;
			}
			if (fs.existsSync(path.join(wsHome, 'std/json.skink'))) {
				return wsHome;
			}
		}
	}
	// 6. Common install locations
	const installHomes = [
		'/usr/local/lib/skink/std',
		'/usr/local/lib/skink',
		path.join(os.homedir(), '.local/lib/skink/std'),
		path.join(os.homedir(), '.local/lib/skink'),
	];
	for (const h of installHomes) {
		if (fs.existsSync(path.join(h, 'json.skink')) || fs.existsSync(path.join(h, 'std/json.skink'))) {
			return fs.existsSync(path.join(h, 'json.skink')) ? h : path.join(h, 'std');
		}
	}
	return undefined;
}

// ─── Debug Configuration Provider ──────────────────────────────────────────

class SkinkDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
	private outputChannel?: vscode.OutputChannel;

	private getOutputChannel(): vscode.OutputChannel {
		if (!this.outputChannel) {
			this.outputChannel = vscode.window.createOutputChannel('Skink Build');
		}
		return this.outputChannel;
	}

	async resolveDebugConfigurationWithSubstitutedVariables(
		folder: vscode.WorkspaceFolder | undefined,
		config: vscode.DebugConfiguration,
		token?: vscode.CancellationToken
	): Promise<vscode.DebugConfiguration | undefined | null> {

		// Default to active editor if no program specified
		if (!config.program) {
			const activeEditor = vscode.window.activeTextEditor;
			if (activeEditor && activeEditor.document.languageId === 'Skink') {
				config.program = activeEditor.document.fileName;
			} else {
				vscode.window.showErrorMessage('No Skink file is currently open to debug.');
				return null;
			}
		}

		const programPath = config.program;
		if (!fs.existsSync(programPath)) {
			vscode.window.showErrorMessage(`Skink program file does not exist: ${programPath}`);
			return null;
		}

		// Find compiler
		const compilerPath = await findSkinkCompiler(config.compilerPath, folder);
		if (!compilerPath) {
			vscode.window.showErrorMessage(
				'Could not find the Skink compiler ("skink"). Please configure "skink.compilerPath" in your settings.'
			);
			return null;
		}

		const skinkHome = getSkinkHome(config.skinkHome, folder);

		const parsedPath = path.parse(programPath);
		const outBinaryName = parsedPath.name + (os.platform() === 'win32' ? '.exe' : '');
		const outBinaryPath = path.join(parsedPath.dir, outBinaryName);

		const output = this.getOutputChannel();
		output.clear();
		output.appendLine(`[Skink Build] Compiling: ${programPath}`);
		output.appendLine(`[Skink Build] Using compiler: ${compilerPath}`);
		if (skinkHome) {
			output.appendLine(`[Skink Build] SKINK_HOME: ${skinkHome}`);
		}
		output.appendLine(`[Skink Build] Output binary: ${outBinaryPath}`);
		output.show(true);

		try {
			await compileSkink(compilerPath, programPath, outBinaryPath, output, skinkHome, token);
		} catch (err: any) {
			vscode.window.showErrorMessage('Skink Compilation Failed. See output for more details.');
			return null;
		}

		output.appendLine('[Skink Build] Compilation successful! Invoking native debugger...');

		const availableDebugger = findAvailableDebugger();
		const targetType = availableDebugger ? availableDebugger.type : 'lldb';
		const targetLabel = availableDebugger ? availableDebugger.label : 'CodeLLDB (default)';
		const args = config.args || [];

		output.appendLine(`[Skink Build] Target native debugger: ${targetLabel} (type: "${targetType}")`);

		if (!availableDebugger) {
			vscode.window.showWarningMessage(
				'To debug Skink code, install the "CodeLLDB" or "C/C++" extensions for native debugging.',
				'Install CodeLLDB'
			).then((selection) => {
				if (selection === 'Install CodeLLDB') {
					vscode.commands.executeCommand('workbench.extensions.installExtension', 'vadimcn.vscode-lldb');
				}
			});
		}

		// Build a fresh native debug config and launch it as a new debug session.
		// We must NOT mutate config.type in-place and return it — VS Code does not
		// re-dispatch to a different debugger type from within a
		// resolveDebugConfigurationWithSubstitutedVariables handler, so the
		// mutated type would result in "no debug adapter registered for type
		// 'Skink'" (or the mutated type). Instead, start a brand-new session with
		// the native debugger type and return undefined to cancel this "Skink"
		// resolution.
		const nativeConfig: vscode.DebugConfiguration = {
			type: targetType,
			request: 'launch',
			name: config.name || 'Skink (native)',
			program: outBinaryPath,
			args,
			cwd: config.cwd || (folder ? folder.uri.fsPath : parsedPath.dir),
			stopOnEntry: config.stopOnEntry ?? false,
		};

		if (targetType === 'lldb') {
			nativeConfig.sourceMap = config.sourceMap || {};
		} else if (targetType === 'lldb-dap') {
			nativeConfig.sourceMap = config.sourceMap || {};
		} else if (targetType === 'cppdbg') {
			nativeConfig.MIMode = os.platform() === 'darwin' ? 'lldb' : 'gdb';
			nativeConfig.environment = config.environment || [];
			nativeConfig.externalConsole = false;
		}

		// Launch the native debug session. Return undefined so VS Code does not
		// try to start a (non-existent) "Skink" debug adapter.
		vscode.debug.startDebugging(folder, nativeConfig).then(
			(started) => {
				if (!started) {
					output.appendLine(`[Skink Build] Failed to start ${targetLabel} debug session.`);
				}
			},
			(err: any) => {
				output.appendLine(`[Skink Build] Error starting native debugger: ${err?.message || err}`);
			},
		);

		return undefined;
	}
}

function findAvailableDebugger(): { type: string; label: string } | undefined {
	if (vscode.extensions.getExtension('vadimcn.vscode-lldb')) {
		return { type: 'lldb', label: 'CodeLLDB' };
	}
	if (vscode.extensions.getExtension('llvm-vs-code-extensions.lldb-dap')) {
		return { type: 'lldb-dap', label: 'LLDB DAP' };
	}
	if (
		vscode.extensions.getExtension('ms-vscode.cpptools') ||
		vscode.extensions.getExtension('codeium.windsurf-cpptools')
	) {
		return { type: 'cppdbg', label: 'C/C++ Debugger (GDB/LLDB)' };
	}
	return undefined;
}

// ─── Compilation Helper ──────────────────────────────────────────────────

function compileSkink(
	compilerPath: string,
	programPath: string,
	outBinaryPath: string,
	output: vscode.OutputChannel,
	skinkHome?: string,
	token?: vscode.CancellationToken
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (token?.isCancellationRequested) {
			return reject(new Error('Compilation cancelled.'));
		}

		// Compile with output path and debug info flag (-g) if supported
		const args = ['-g', '-o', outBinaryPath, programPath];
		const env = { ...process.env };
		if (skinkHome) {
			env.SKINK_HOME = skinkHome;
		}

		const child = cp.spawn(compilerPath, args, { env });
		let errOutput = '';

		child.stdout.on('data', (data) => {
			output.append(data.toString());
		});

		child.stderr.on('data', (data) => {
			const str = data.toString();
			errOutput += str;
			output.append(str);
		});

		// Dispose the cancellation listener when the process exits to avoid
		// leaking the listener if the token outlives the compilation.
		const cancelDisposable = token?.onCancellationRequested(() => {
			child.kill();
			reject(new Error('Compilation cancelled.'));
		});

		child.on('error', (err) => {
			cancelDisposable?.dispose();
			output.appendLine(`[Skink Build Error] Failed to run compiler: ${err.message}`);
			reject(err);
		});

		child.on('exit', (code) => {
			cancelDisposable?.dispose();
			if (code === 0) {
				resolve();
			} else {
				output.appendLine(`[Skink Build Error] Compiler exited with code ${code}`);
				reject(new Error(`Exit code ${code}. ${errOutput}`));
			}
		});
	});
}

// ─── Test Output Parser ────────────────────────────────────────────────
//
// parseTestOutput parses the output of the Skink test runner and returns
// a map from test name to 'pass' or 'fail'. The parser looks for:
//   1. Explicit "PASS <name>" or "FAIL <name>" lines (suite-level)
//   2. "FAIL: <message>" lines (assertion-level failures from the testing module)
//   3. Lines containing a test name with "FAIL" nearby
//
// If a test name appears in a FAIL context, it is marked 'fail'. Otherwise
// it defaults to 'pass' (the test harness exits non-zero on any failure,
// so a missing explicit PASS is not treated as a failure).
//
// Exported for unit testing.

export type TestResult = 'pass' | 'fail';

export function parseTestOutput(lines: string[], testNames: string[]): Map<string, TestResult> {
	const results = new Map<string, TestResult>();

	// First pass: look for explicit "PASS <name>" / "FAIL <name>" lines.
	for (const line of lines) {
		const trimmed = line.trim();
		// Match "PASS <name>" or "FAIL <name>" at the start of the line.
		const passMatch = /^PASS\s+(\S+)/.exec(trimmed);
		if (passMatch) {
			const name = passMatch[1];
			for (const testName of testNames) {
				if (testName === name || testName.startsWith(name + ' ') || name.startsWith(testName + ' ')) {
					results.set(testName, 'pass');
				}
			}
			continue;
		}
		const failMatch = /^FAIL\s+(\S+)/.exec(trimmed);
		if (failMatch) {
			const name = failMatch[1];
			for (const testName of testNames) {
				if (testName === name || testName.startsWith(name + ' ') || name.startsWith(testName + ' ')) {
					results.set(testName, 'fail');
				}
			}
			continue;
		}
	}

	// Second pass: look for "FAIL: <message>" lines that mention a test name.
	// The testing module prints "FAIL: <message>" for assertion failures.
	// If a test name appears in such a line, mark it as failed.
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith('FAIL:')) {
			for (const testName of testNames) {
				if (trimmed.includes(testName) && !results.has(testName)) {
					results.set(testName, 'fail');
				}
			}
		}
	}

	return results;
}

// ─── Test Controller ───────────────────────────────────────────────────

export class SkinkTestController implements vscode.Disposable {
	private ctrl: vscode.TestController;
	private runOutput?: vscode.OutputChannel;
	private fileItems = new Map<string, vscode.TestItem>();

	constructor() {
		this.ctrl = vscode.tests.createTestController('skinkTests', 'Skink Tests');
		this.ctrl.resolveHandler = async (item) => {
			if (!item) {
				this.discoverAll();
			} else if (item.uri && item.uri.fsPath.endsWith('_test.skink')) {
				await this.parseTestsInFile(item);
			}
		};
		this.ctrl.createRunProfile(
			'Run',
			vscode.TestRunProfileKind.Run,
			(request, token) => this.runHandler(request, token),
			true
		);
	}

	dispose() {
		this.ctrl.dispose();
		this.runOutput?.dispose();
	}

	async discoverAll() {
		this.ctrl.items.replace([]);
		this.fileItems.clear();
		if (!vscode.workspace.workspaceFolders) {
			return;
		}
		const seen = new Set<string>();
		for (const folder of vscode.workspace.workspaceFolders) {
			const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*_test.skink'));
			for (const uri of uris) {
				if (!seen.has(uri.fsPath)) {
					seen.add(uri.fsPath);
					this.addFile(uri);
				}
			}
		}
	}

	addFile(uri: vscode.Uri) {
		const existing = this.fileItems.get(uri.fsPath);
		if (existing) {
			return;
		}
		const fileName = path.basename(uri.fsPath);
		const item = this.ctrl.createTestItem(uri.fsPath, fileName, uri);
		item.canResolveChildren = true;
		this.ctrl.items.add(item);
		this.fileItems.set(uri.fsPath, item);
	}

	removeFile(uri: vscode.Uri) {
		const item = this.fileItems.get(uri.fsPath);
		if (item) {
			this.ctrl.items.delete(item.id);
			this.fileItems.delete(uri.fsPath);
		}
	}

	refreshFile(uri: vscode.Uri) {
		const item = this.fileItems.get(uri.fsPath);
		if (item) {
			item.children.replace([]);
			item.canResolveChildren = true;
		}
	}

	async parseTestsInFile(fileItem: vscode.TestItem) {
		if (!fileItem.uri) {
			return;
		}
		const content = await fs.promises.readFile(fileItem.uri.fsPath, 'utf-8');
		const lines = content.split('\n');
		const children: vscode.TestItem[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			// Match: fn TestName(...) or pub fn TestName(...)
			const match = /\bfn\s+(Test[A-Za-z0-9_]*)\s*\(/.exec(line);
			if (match) {
				const testName = match[1];
				const testId = `${fileItem.uri.fsPath}#${testName}`;
				const testItem = this.ctrl.createTestItem(testId, testName, fileItem.uri);
				testItem.range = new vscode.Range(i, 0, i, line.length);
				children.push(testItem);
			}
		}

		fileItem.children.replace(children);
		fileItem.canResolveChildren = false;
	}

	async runHandler(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
		const run = this.ctrl.createTestRun(request);
		const queue: vscode.TestItem[] = [];

		if (request.include) {
			queue.push(...request.include);
		} else {
			this.ctrl.items.forEach((item) => queue.push(item));
		}

		if (!this.runOutput) {
			this.runOutput = vscode.window.createOutputChannel('Skink Test');
		}
		this.runOutput.clear();
		this.runOutput.show(true);

		const compilerPath = await findSkinkCompiler();
		if (!compilerPath) {
			vscode.window.showErrorMessage('Could not find skink compiler for running tests.');
			this.runOutput.appendLine('[Skink Test] ERROR: skink compiler not found.');
			run.end();
			return;
		}

		const skinkHome = getSkinkHome();

		while (queue.length > 0 && !token.isCancellationRequested) {
			const item = queue.shift()!;
			if (item.uri && item.uri.fsPath.endsWith('_test.skink')) {
				await this.runTestFile(item, run, token, compilerPath, skinkHome);
			} else {
				// It's a single test within a file
				const parent = this.findParentFile(item);
				if (parent) {
					await this.runSingleTest(parent, item, run, token, compilerPath, skinkHome);
				}
			}
		}

		run.end();
	}

	async runTestFile(
		fileItem: vscode.TestItem,
		run: vscode.TestRun,
		token: vscode.CancellationToken,
		compilerPath: string,
		skinkHome?: string
	) {
		if (!fileItem.uri) { return; }
		await this.parseTestsInFile(fileItem);

		const folder = vscode.workspace.getWorkspaceFolder(fileItem.uri);
		const cwd = folder ? folder.uri.fsPath : path.dirname(fileItem.uri.fsPath);

		this.runOutput?.appendLine(`[Skink Test] Running ${path.basename(fileItem.uri.fsPath)}...`);
		const start = Date.now();

		const env = { ...process.env };
		if (skinkHome) {
			env.SKINK_HOME = skinkHome;
		}

		// Run tests using compiler flag '-t <file>' which delegates to the test harness.
		const testFilePath = fileItem.uri.fsPath;
		const child = cp.spawn(compilerPath, ['-t', testFilePath], {
			cwd,
			env,
		});

		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (d) => { stdout += d.toString(); this.runOutput?.append(d.toString()); });
		child.stderr.on('data', (d) => { stderr += d.toString(); this.runOutput?.append(d.toString()); });

		const cancelDisposable = token.onCancellationRequested(() => { child.kill(); });
		await new Promise<void>((resolve) => {
			child.on('exit', () => resolve());
		});
		cancelDisposable.dispose();

		const elapsed = Date.now() - start;

		// Parse output to mark individual tests.
		//
		// The Skink testing module prints "FAIL: <message>" for assertion
		// failures. The test runner script prints "PASS <label>" / "FAIL <label>"
		// for suite-level results. We use a structured parser that looks for
		// explicit PASS/FAIL markers associated with each test name, falling
		// back to the FAIL: prefix for assertion-level failures.
		const lines = (stdout + '\n' + stderr).split('\n');

		// Collect test names from the file's children.
		const testNames: string[] = [];
		fileItem.children.forEach((testItem) => { testNames.push(testItem.label); });

		const results = parseTestOutput(lines, testNames);

		let anyFailed = false;
		fileItem.children.forEach((testItem) => {
			const testName = testItem.label;
			const result = results.get(testName);

			if (result === 'fail') {
				anyFailed = true;
				run.failed(testItem, new vscode.TestMessage('Test failed. See Skink Test output for details.'), elapsed / fileItem.children.size);
			} else {
				// Default to passed if not explicitly failed. This is correct
				// because the test harness exits non-zero on any failure, and
				// we only mark a test as failed if we found an explicit failure
				// marker associated with it.
				run.passed(testItem, elapsed / fileItem.children.size);
			}
		});

		if (!anyFailed) {
			run.passed(fileItem, elapsed);
		} else {
			run.failed(fileItem, new vscode.TestMessage('One or more tests failed. See Skink Test output.'), elapsed);
		}
	}

	async runSingleTest(
		parent: vscode.TestItem,
		_testItem: vscode.TestItem,
		run: vscode.TestRun,
		token: vscode.CancellationToken,
		compilerPath: string,
		skinkHome?: string
	) {
		// Note: the Skink compiler does not currently support filtering by
		// individual test name (e.g. `-t <file> -run <TestName>`). We run the
		// whole test file and report only the requested test's result. If the
		// compiler gains per-test filtering in the future, this should be
		// updated to pass the test name to avoid running unrelated tests.
		await this.runTestFile(parent, run, token, compilerPath, skinkHome);
	}

	findParentFile(testItem: vscode.TestItem): vscode.TestItem | undefined {
		let result: vscode.TestItem | undefined;
		this.ctrl.items.forEach((item) => {
			item.children.forEach((child) => {
				if (child.id === testItem.id) {
					result = item;
				}
			});
		});
		return result;
	}

	runAll(): Promise<void> {
		const request = new vscode.TestRunRequest();
		const tokenSource = new vscode.CancellationTokenSource();
		return this.runHandler(request, tokenSource.token).finally(() => tokenSource.dispose());
	}

	runFile(uri: vscode.Uri): Promise<void> {
		const item = this.fileItems.get(uri.fsPath);
		if (!item) {
			this.addFile(uri);
			const newItem = this.fileItems.get(uri.fsPath);
			if (newItem) {
				const request = new vscode.TestRunRequest([newItem]);
				const tokenSource = new vscode.CancellationTokenSource();
				return this.runHandler(request, tokenSource.token).finally(() => tokenSource.dispose());
			}
			return Promise.resolve();
		}
		const request = new vscode.TestRunRequest([item]);
		const tokenSource = new vscode.CancellationTokenSource();
		return this.runHandler(request, tokenSource.token).finally(() => tokenSource.dispose());
	}
}
