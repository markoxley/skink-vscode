import * as assert from 'assert';
import { makeTempFileName, parseCompilerOutputLine } from './diagnostics';

describe('makeTempFileName', () => {
	it('includes the PID', () => {
		const name = makeTempFileName('/home/user/proj/main.skink', 12345);
		assert.ok(name.includes('12345'), `PID not in name: ${name}`);
	});

	it('includes the basename', () => {
		const name = makeTempFileName('/home/user/proj/main.skink', 12345);
		assert.ok(name.includes('main.skink'), `basename not in name: ${name}`);
	});

	it('produces different names for different paths with same basename', () => {
		const name1 = makeTempFileName('/home/user/proj_a/main.skink', 12345);
		const name2 = makeTempFileName('/home/user/proj_b/main.skink', 12345);
		assert.notStrictEqual(name1, name2, 'same basename should produce different temp names');
	});

	it('produces different names for the same path on successive calls (counter)', () => {
		const name1 = makeTempFileName('/home/user/proj/main.skink', 12345);
		const name2 = makeTempFileName('/home/user/proj/main.skink', 12345);
		assert.notStrictEqual(name1, name2, 'successive calls should produce different names');
	});
});

describe('parseCompilerOutputLine', () => {
	it('parses a standard error line', () => {
		const result = parseCompilerOutputLine('/path/to/file.skink 12:5: undefined variable x');
		assert.deepStrictEqual(result, {
			line: 11,
			col: 4,
			message: 'undefined variable x',
		});
	});

	it('parses a line with a path containing digits', () => {
		const result = parseCompilerOutputLine('/home/mark/prose_v2/foo.skink 3:10: some error');
		assert.deepStrictEqual(result, {
			line: 2,
			col: 9,
			message: 'some error',
		});
	});

	it('returns undefined for "type check passed"', () => {
		const result = parseCompilerOutputLine('type check passed');
		assert.strictEqual(result, undefined);
	});

	it('returns undefined for empty lines', () => {
		const result = parseCompilerOutputLine('   ');
		assert.strictEqual(result, undefined);
	});

	it('returns undefined for lines without colons', () => {
		const result = parseCompilerOutputLine('some random text without colons');
		assert.strictEqual(result, undefined);
	});

	it('clamps negative line/col to 0', () => {
		const result = parseCompilerOutputLine('/path/file.skink 0:0: zero error');
		assert.deepStrictEqual(result, {
			line: 0,
			col: 0,
			message: 'zero error',
		});
	});
});
