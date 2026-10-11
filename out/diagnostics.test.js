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
const diagnostics_1 = require("./diagnostics");
describe('makeTempFileName', () => {
    it('includes the PID', () => {
        const name = (0, diagnostics_1.makeTempFileName)('/home/user/proj/main.skink', 12345);
        assert.ok(name.includes('12345'), `PID not in name: ${name}`);
    });
    it('includes the basename', () => {
        const name = (0, diagnostics_1.makeTempFileName)('/home/user/proj/main.skink', 12345);
        assert.ok(name.includes('main.skink'), `basename not in name: ${name}`);
    });
    it('produces different names for different paths with same basename', () => {
        const name1 = (0, diagnostics_1.makeTempFileName)('/home/user/proj_a/main.skink', 12345);
        const name2 = (0, diagnostics_1.makeTempFileName)('/home/user/proj_b/main.skink', 12345);
        assert.notStrictEqual(name1, name2, 'same basename should produce different temp names');
    });
    it('produces different names for the same path on successive calls (counter)', () => {
        const name1 = (0, diagnostics_1.makeTempFileName)('/home/user/proj/main.skink', 12345);
        const name2 = (0, diagnostics_1.makeTempFileName)('/home/user/proj/main.skink', 12345);
        assert.notStrictEqual(name1, name2, 'successive calls should produce different names');
    });
});
describe('parseCompilerOutputLine', () => {
    it('parses a standard error line', () => {
        const result = (0, diagnostics_1.parseCompilerOutputLine)('/path/to/file.skink 12:5: undefined variable x');
        assert.deepStrictEqual(result, {
            line: 11,
            col: 4,
            message: 'undefined variable x',
        });
    });
    it('parses a line with a path containing digits', () => {
        const result = (0, diagnostics_1.parseCompilerOutputLine)('/home/mark/prose_v2/foo.skink 3:10: some error');
        assert.deepStrictEqual(result, {
            line: 2,
            col: 9,
            message: 'some error',
        });
    });
    it('returns undefined for "type check passed"', () => {
        const result = (0, diagnostics_1.parseCompilerOutputLine)('type check passed');
        assert.strictEqual(result, undefined);
    });
    it('returns undefined for empty lines', () => {
        const result = (0, diagnostics_1.parseCompilerOutputLine)('   ');
        assert.strictEqual(result, undefined);
    });
    it('returns undefined for lines without colons', () => {
        const result = (0, diagnostics_1.parseCompilerOutputLine)('some random text without colons');
        assert.strictEqual(result, undefined);
    });
    it('clamps negative line/col to 0', () => {
        const result = (0, diagnostics_1.parseCompilerOutputLine)('/path/file.skink 0:0: zero error');
        assert.deepStrictEqual(result, {
            line: 0,
            col: 0,
            message: 'zero error',
        });
    });
});
//# sourceMappingURL=diagnostics.test.js.map