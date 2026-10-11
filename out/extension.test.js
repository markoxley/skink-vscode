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
const assert = __importStar(require("assert"));
const extension_1 = require("./extension");
describe('parseTestOutput', () => {
    it('marks tests as passed when PASS line is found', () => {
        const lines = ['PASS TestFoo', 'PASS TestBar'];
        const results = (0, extension_1.parseTestOutput)(lines, ['TestFoo', 'TestBar']);
        assert.strictEqual(results.get('TestFoo'), 'pass');
        assert.strictEqual(results.get('TestBar'), 'pass');
    });
    it('marks tests as failed when FAIL line is found', () => {
        const lines = ['FAIL TestFoo', 'PASS TestBar'];
        const results = (0, extension_1.parseTestOutput)(lines, ['TestFoo', 'TestBar']);
        assert.strictEqual(results.get('TestFoo'), 'fail');
        assert.strictEqual(results.get('TestBar'), 'pass');
    });
    it('marks test as failed when FAIL: line mentions test name', () => {
        const lines = ['FAIL: AssertTrue failed: TestFoo assertion failed'];
        const results = (0, extension_1.parseTestOutput)(lines, ['TestFoo', 'TestBar']);
        assert.strictEqual(results.get('TestFoo'), 'fail');
        assert.strictEqual(results.get('TestBar'), undefined);
    });
    it('does not mark TestFoo as failed when TestFooBar fails (no false positives)', () => {
        // The old substring matcher would match "TestFoo" inside "TestFooBar".
        // The new parser uses word-boundary matching via startsWith.
        const lines = ['FAIL TestFooBar'];
        const results = (0, extension_1.parseTestOutput)(lines, ['TestFoo', 'TestFooBar']);
        assert.strictEqual(results.get('TestFooBar'), 'fail');
        assert.strictEqual(results.get('TestFoo'), undefined);
    });
    it('does not mark a test as failed just because FAIL appears in output', () => {
        // The old code would mark ALL tests failed if "FAIL" appeared anywhere.
        const lines = ['some random FAIL text', 'PASS TestFoo'];
        const results = (0, extension_1.parseTestOutput)(lines, ['TestFoo']);
        assert.strictEqual(results.get('TestFoo'), 'pass');
    });
    it('handles empty output', () => {
        const results = (0, extension_1.parseTestOutput)([], ['TestFoo']);
        assert.strictEqual(results.get('TestFoo'), undefined);
    });
    it('handles multiple FAIL: lines for the same test', () => {
        const lines = [
            'FAIL: AssertEqualInt failed: expected 1, got 2 - TestFoo',
            'FAIL: AssertTrue failed: TestFoo second assertion',
        ];
        const results = (0, extension_1.parseTestOutput)(lines, ['TestFoo']);
        assert.strictEqual(results.get('TestFoo'), 'fail');
    });
});
//# sourceMappingURL=extension.test.js.map