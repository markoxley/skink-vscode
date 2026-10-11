import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SkinkTestController } from './extension';

// Minimal child_process spawn mock that emits stdout and exits immediately.
function makeMockSpawn() {
	const calls: any[] = [];
	const originalSpawn = require('child_process').spawn;
	const mockSpawn = (command: string, args: string[], options: any) => {
		calls.push({ command, args, options });
		const stdout: any = { on: (event: string, cb: (data: Buffer) => void) => {
			if (event === 'data') {
				process.nextTick(() => cb(Buffer.from('PASS TestFoo\n')));
			}
		} };
		const stderr: any = { on: () => {} };
		const child: any = {
			stdout,
			stderr,
			on: (event: string, cb: () => void) => {
				if (event === 'exit') {
					process.nextTick(cb);
				}
			},
			kill: () => {},
		};
		return child;
	};
	return { calls, mockSpawn, originalSpawn };
}

describe('SkinkTestController memory hygiene', () => {
	let tmpDir: string;
	let savedPATH: string;
	let controller: SkinkTestController;
	let spawnMock: ReturnType<typeof makeMockSpawn>;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skink-test-'));
		// Create a fake skink compiler on PATH so runFile reaches runTestFile.
		const fakeCompiler = path.join(tmpDir, 'skink');
		fs.writeFileSync(fakeCompiler, '#!/bin/sh\necho PASS TestFoo\n', { mode: 0o755 });
		savedPATH = process.env.PATH || '';
		process.env.PATH = tmpDir + path.delimiter + savedPATH;

		spawnMock = makeMockSpawn();
		require('child_process').spawn = spawnMock.mockSpawn;

		controller = new SkinkTestController();
	});

	afterEach(() => {
		require('child_process').spawn = spawnMock.originalSpawn;
		process.env.PATH = savedPATH;
		fs.rmSync(tmpDir, { recursive: true, force: true });
		controller.dispose();
	});

	it('disposes the CancellationTokenSource after runFile', async () => {
		// Track the CancellationTokenSource instances created by the test controller.
		const vscode = require('vscode');
		const originalSource = vscode.CancellationTokenSource;
		const createdSources: any[] = [];
		vscode.CancellationTokenSource = function (this: any) {
			originalSource.call(this);
			createdSources.push(this);
		};
		vscode.CancellationTokenSource.prototype = originalSource.prototype;

		try {
			const testFile = path.join(tmpDir, 'foo_test.skink');
			fs.writeFileSync(testFile, 'fn TestFoo() {}');
			const uri = (require('vscode') as any).Uri.file(testFile);
			await controller.runFile(uri);

			assert.strictEqual(createdSources.length, 1, 'expected one CancellationTokenSource');
			assert.strictEqual(createdSources[0].disposed, true, 'CancellationTokenSource should be disposed after runFile');
		} finally {
			vscode.CancellationTokenSource = originalSource;
		}
	});
});
