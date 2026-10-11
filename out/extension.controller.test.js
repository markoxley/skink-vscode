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
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const extension_1 = require("./extension");
// Minimal child_process spawn mock that emits stdout and exits immediately.
function makeMockSpawn() {
    const calls = [];
    const originalSpawn = require('child_process').spawn;
    const mockSpawn = (command, args, options) => {
        calls.push({ command, args, options });
        const stdout = { on: (event, cb) => {
                if (event === 'data') {
                    process.nextTick(() => cb(Buffer.from('PASS TestFoo\n')));
                }
            } };
        const stderr = { on: () => { } };
        const child = {
            stdout,
            stderr,
            on: (event, cb) => {
                if (event === 'exit') {
                    process.nextTick(cb);
                }
            },
            kill: () => { },
        };
        return child;
    };
    return { calls, mockSpawn, originalSpawn };
}
describe('SkinkTestController memory hygiene', () => {
    let tmpDir;
    let savedPATH;
    let controller;
    let spawnMock;
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skink-test-'));
        // Create a fake skink compiler on PATH so runFile reaches runTestFile.
        const fakeCompiler = path.join(tmpDir, 'skink');
        fs.writeFileSync(fakeCompiler, '#!/bin/sh\necho PASS TestFoo\n', { mode: 0o755 });
        savedPATH = process.env.PATH || '';
        process.env.PATH = tmpDir + path.delimiter + savedPATH;
        spawnMock = makeMockSpawn();
        require('child_process').spawn = spawnMock.mockSpawn;
        controller = new extension_1.SkinkTestController();
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
        const createdSources = [];
        vscode.CancellationTokenSource = function () {
            originalSource.call(this);
            createdSources.push(this);
        };
        vscode.CancellationTokenSource.prototype = originalSource.prototype;
        try {
            const testFile = path.join(tmpDir, 'foo_test.skink');
            fs.writeFileSync(testFile, 'fn TestFoo() {}');
            const uri = require('vscode').Uri.file(testFile);
            await controller.runFile(uri);
            assert.strictEqual(createdSources.length, 1, 'expected one CancellationTokenSource');
            assert.strictEqual(createdSources[0].disposed, true, 'CancellationTokenSource should be disposed after runFile');
        }
        finally {
            vscode.CancellationTokenSource = originalSource;
        }
    });
});
//# sourceMappingURL=extension.controller.test.js.map