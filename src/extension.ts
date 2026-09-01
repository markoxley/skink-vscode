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

// ─── Extension Entry Point ───────────────────────────────────────────────

let languageClient: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext) {
	// 1. Debug configuration provider
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

	// 5. Start the skink-lsp language server (provides diagnostics, completion,
	//    hover, symbols, definition, formatting, semantic tokens, etc.)
	const enableLSP = vscode.workspace.getConfiguration('skink').get<boolean>('enableLSP', true);
	if (enableLSP) {
		startLanguageServer(context);
	}
}

export async function deactivate(): Promise<void> {
	if (languageClient) {
		await languageClient.stop();
		languageClient = undefined;
	}
}

// ─── Language Server ─────────────────────────────────────────────────────

async function startLanguageServer(context: vscode.ExtensionContext): Promise<void> {
	const lspPath = findSkinkLSP();
	if (!lspPath) {
		vscode.window.showWarningMessage(
			'Could not find the skink-lsp language server. Please configure "skink.lspPath" in your settings, or ensure skink-lsp is on your PATH.',
		);
		return;
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
	} catch (err: any) {
		vscode.window.showErrorMessage(`Failed to start skink-lsp: ${err.message}`);
		languageClient = undefined;
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

	// 3. Repository relative layout (extension inside repo)
	const repoPaths = [
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

	// 4. Workspace relative
	if (folder) {
		const wsPaths = [
			path.resolve(folder.uri.fsPath, 'skink-pure/skink'),
			path.resolve(folder.uri.fsPath, 'skink'),
		];
		for (const p of wsPaths) {
			if (fs.existsSync(p)) {
				return p;
			}
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
		path.resolve(__dirname, '../../skink-pure/std'),
		path.resolve(__dirname, '../../skink-pure'),
	];
	for (const h of repoHomes) {
		if (fs.existsSync(path.join(h, 'json.skink'))) {
			return h;
		}
	}
	// 5. Workspace relative
	if (folder) {
		const wsHome = path.resolve(folder.uri.fsPath, 'skink-pure/std');
		if (fs.existsSync(path.join(wsHome, 'json.skink'))) {
			return wsHome;
		}
	}
	// 6. Common install locations
	const installHomes = [
		'/usr/local/lib/skink/std',
		'/usr/local/lib/skink',
	];
	for (const h of installHomes) {
		if (fs.existsSync(path.join(h, 'json.skink'))) {
			return h;
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

		// Check which native debugger extensions are installed
		const codeLldbExtension = vscode.extensions.getExtension('vadimcn.vscode-lldb');
		const cpptoolsExtension = vscode.extensions.getExtension('ms-vscode.cpptools');
		const args = config.args || [];
		const cwd = config.cwd || (folder ? folder.uri.fsPath : parsedPath.dir);
		const name = config.name || 'Launch Skink File';

		let nativeConfig: vscode.DebugConfiguration;

		if (codeLldbExtension) {
			output.appendLine('[Skink Build] Target native debugger: CodeLLDB (type: "lldb")');
			nativeConfig = {
				...config,
				type: 'lldb',
				request: 'launch',
				name,
				program: outBinaryPath,
				args,
				cwd,
				sourceMap: config.sourceMap || {},
			};
		} else if (cpptoolsExtension) {
			output.appendLine('[Skink Build] Target native debugger: C/C++ Extension (type: "cppdbg")');
			nativeConfig = {
				...config,
				type: 'cppdbg',
				request: 'launch',
				name,
				program: outBinaryPath,
				args,
				cwd,
				MIMode: os.platform() === 'darwin' ? 'lldb' : 'gdb',
				environment: config.environment || [],
				externalConsole: false,
			};
		} else {
			output.appendLine('[Skink Build] No native debugger extension installed; aborting debug session.');
			vscode.window.showWarningMessage(
				'To debug Skink code, install the "CodeLLDB" or "C/C++" (ms-vscode.cpptools) extensions for native debugging.',
				'Install CodeLLDB'
			).then(selection => {
				if (selection === 'Install CodeLLDB') {
					vscode.commands.executeCommand('workbench.extensions.installExtension', 'vadimcn.vscode-lldb');
				}
			});
			return undefined;
		}

		// A session keeps the debug type it was started with, so the compiled
		// binary is handed to the native debugger as a separate session.
		delete nativeConfig.compilerPath;
		delete nativeConfig.skinkHome;

		vscode.debug.startDebugging(folder, nativeConfig, { noDebug: config.noDebug === true }).then(
			(started) => {
				if (!started) {
					output.appendLine(`[Skink Build Error] Failed to start the "${nativeConfig.type}" debug session.`);
					vscode.window.showErrorMessage(
						`Failed to start the native debugger ("${nativeConfig.type}"). See the Skink Build output for details.`
					);
				}
			},
			(err: any) => {
				output.appendLine(`[Skink Build Error] ${err?.message ?? err}`);
				vscode.window.showErrorMessage(`Failed to start the native debugger: ${err?.message ?? err}`);
			}
		);

		return undefined;
	}
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

		const args = ['-o', outBinaryPath, programPath];
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

		token?.onCancellationRequested(() => {
			child.kill();
			reject(new Error('Compilation cancelled.'));
		});

		child.on('error', (err) => {
			output.appendLine(`[Skink Build Error] Failed to run compiler: ${err.message}`);
			reject(err);
		});

		child.on('exit', (code) => {
			if (code === 0) {
				resolve();
			} else {
				output.appendLine(`[Skink Build Error] Compiler exited with code ${code}`);
				reject(new Error(`Exit code ${code}. ${errOutput}`));
			}
		});
	});
}

// ─── Test Controller ───────────────────────────────────────────────────

class SkinkTestController implements vscode.Disposable {
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

		const child = cp.spawn(compilerPath, ['test', path.basename(fileItem.uri.fsPath, '_test.skink')], {
			cwd,
			env,
		});

		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (d) => { stdout += d.toString(); this.runOutput?.append(d.toString()); });
		child.stderr.on('data', (d) => { stderr += d.toString(); this.runOutput?.append(d.toString()); });

		await new Promise<void>((resolve) => {
			child.on('exit', () => resolve());
			token.onCancellationRequested(() => { child.kill(); resolve(); });
		});

		const elapsed = Date.now() - start;

		// Parse output to mark individual tests
		const lines = (stdout + '\n' + stderr).split('\n');
		let anyFailed = false;

		fileItem.children.forEach((testItem) => {
			const testName = testItem.label;
			let found = false;
			let passed = true;

			for (const line of lines) {
				if (line.includes(testName)) {
					found = true;
					if (line.startsWith('FAIL') || line.includes('FAIL')) {
						passed = false;
						anyFailed = true;
					}
					break;
				}
			}

			if (!found && (stdout + stderr).includes('FAIL')) {
				passed = false;
				anyFailed = true;
			}

			if (passed) {
				run.passed(testItem, elapsed / fileItem.children.size);
			} else {
				run.failed(testItem, new vscode.TestMessage('Test failed. See Skink Test output for details.'), elapsed / fileItem.children.size);
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
		// Run the whole file but only report the single test
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

	runAll() {
		const request = new vscode.TestRunRequest();
		this.runHandler(request, new vscode.CancellationTokenSource().token);
	}

	runFile(uri: vscode.Uri) {
		const item = this.fileItems.get(uri.fsPath);
		if (!item) {
			this.addFile(uri);
			const newItem = this.fileItems.get(uri.fsPath);
			if (newItem) {
				const request = new vscode.TestRunRequest([newItem]);
				this.runHandler(request, new vscode.CancellationTokenSource().token);
			}
			return;
		}
		const request = new vscode.TestRunRequest([item]);
		this.runHandler(request, new vscode.CancellationTokenSource().token);
	}
}
