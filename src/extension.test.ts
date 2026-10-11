import * as assert from 'assert';
import { parseTestOutput } from './extension';

describe('parseTestOutput', () => {
	it('marks tests as passed when PASS line is found', () => {
		const lines = ['PASS TestFoo', 'PASS TestBar'];
		const results = parseTestOutput(lines, ['TestFoo', 'TestBar']);
		assert.strictEqual(results.get('TestFoo'), 'pass');
		assert.strictEqual(results.get('TestBar'), 'pass');
	});

	it('marks tests as failed when FAIL line is found', () => {
		const lines = ['FAIL TestFoo', 'PASS TestBar'];
		const results = parseTestOutput(lines, ['TestFoo', 'TestBar']);
		assert.strictEqual(results.get('TestFoo'), 'fail');
		assert.strictEqual(results.get('TestBar'), 'pass');
	});

	it('marks test as failed when FAIL: line mentions test name', () => {
		const lines = ['FAIL: AssertTrue failed: TestFoo assertion failed'];
		const results = parseTestOutput(lines, ['TestFoo', 'TestBar']);
		assert.strictEqual(results.get('TestFoo'), 'fail');
		assert.strictEqual(results.get('TestBar'), undefined);
	});

	it('does not mark TestFoo as failed when TestFooBar fails (no false positives)', () => {
		// The old substring matcher would match "TestFoo" inside "TestFooBar".
		// The new parser uses word-boundary matching via startsWith.
		const lines = ['FAIL TestFooBar'];
		const results = parseTestOutput(lines, ['TestFoo', 'TestFooBar']);
		assert.strictEqual(results.get('TestFooBar'), 'fail');
		assert.strictEqual(results.get('TestFoo'), undefined);
	});

	it('does not mark a test as failed just because FAIL appears in output', () => {
		// The old code would mark ALL tests failed if "FAIL" appeared anywhere.
		const lines = ['some random FAIL text', 'PASS TestFoo'];
		const results = parseTestOutput(lines, ['TestFoo']);
		assert.strictEqual(results.get('TestFoo'), 'pass');
	});

	it('handles empty output', () => {
		const results = parseTestOutput([], ['TestFoo']);
		assert.strictEqual(results.get('TestFoo'), undefined);
	});

	it('handles multiple FAIL: lines for the same test', () => {
		const lines = [
			'FAIL: AssertEqualInt failed: expected 1, got 2 - TestFoo',
			'FAIL: AssertTrue failed: TestFoo second assertion',
		];
		const results = parseTestOutput(lines, ['TestFoo']);
		assert.strictEqual(results.get('TestFoo'), 'fail');
	});
});
