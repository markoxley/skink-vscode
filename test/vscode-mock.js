// Minimal mock of the 'vscode' module for unit testing.
// This allows tests to import source files that depend on vscode
// without requiring the full VS Code extension host.
module.exports = {
	languages: {
		createDiagnosticCollection: function() {
			return { set: function() {}, delete: function() {}, dispose: function() {} };
		},
		registerDocumentFormattingEditProvider: function() { return { dispose: function() {} }; },
		registerDocumentRangeFormattingEditProvider: function() { return { dispose: function() {} }; },
	},
	workspace: {
		getConfiguration: function() {
			return { get: function(key, defaultVal) { return defaultVal; } };
		},
		getWorkspaceFolder: function() { return undefined; },
		createFileSystemWatcher: function() {
			return {
				onDidCreate: function() { return { dispose: function() {} }; },
				onDidChange: function() { return { dispose: function() {} }; },
				onDidDelete: function() { return { dispose: function() {} }; },
				dispose: function() {},
			};
		},
	},
	window: {
		createOutputChannel: function() {
			return {
				clear: function() {},
				show: function() {},
				append: function() {},
				appendLine: function() {},
				dispose: function() {},
			};
		},
		showErrorMessage: function() {},
	},
	tests: {
		createTestController: function() {
			const items = new Map();
			return {
				items: {
					add: function(item) { items.set(item.id, item); },
					delete: function(id) { items.delete(id); },
					replace: function(newItems) { items.clear(); for (const item of newItems) { items.set(item.id, item); } },
					forEach: function(cb) { items.forEach(cb); },
					size: items.size,
					get: function(id) { return items.get(id); },
				},
				resolveHandler: undefined,
				createTestItem: function(id, label, uri) {
					return { id: id || '', label: label || '', uri: uri, children: { forEach: function() {}, size: 0, replace: function() {} }, canResolveChildren: true };
				},
				createRunProfile: function() {},
				createTestRun: function() {
					return { passed: function() {}, failed: function() {}, end: function() {} };
				},
				dispose: function() {},
			};
		},
	},
	TestRunRequest: function(include) { this.include = include; },
	TestRunProfileKind: { Run: 1, Debug: 2, Coverage: 3 },
	CancellationTokenSource: function() {
		this.disposed = false;
		const listeners = [];
		this.token = {
			isCancellationRequested: false,
			onCancellationRequested: function(cb) {
				listeners.push(cb);
				const listenerIdx = listeners.length - 1;
				return {
					dispose: function() {
						listeners[listenerIdx] = undefined;
					}
				};
			}
		};
		this.dispose = function() {
			this.disposed = true;
			for (let i = 0; i < listeners.length; i++) {
				if (listeners[i]) { listeners[i](); }
			}
		};
	},
	Diagnostic: function(range, message, severity) {
		this.range = range;
		this.message = message;
		this.severity = severity;
	},
	DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
	Range: function(sLine, sChar, eLine, eChar) {
		this.start = { line: sLine, character: sChar };
		this.end = { line: eLine, character: eChar };
	},
	TestMessage: function(msg) { this.message = msg; },
	Uri: {
		file: function(p) { return { fsPath: p, scheme: 'file' }; },
	},
};
