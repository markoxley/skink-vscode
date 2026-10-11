// Mocha setup file that intercepts require('vscode') and returns a mock.
// This allows unit tests to import source files that depend on the
// vscode module without requiring the full VS Code extension host.
const Module = require('module');
const path = require('path');

const vscodeMock = require('./vscode-mock.js');

// Override Module._resolveFilename to redirect 'vscode' to our mock.
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
    if (request === 'vscode') {
        return path.join(__dirname, 'vscode-mock.js');
    }
    if (request === 'vscode-languageclient/node') {
        // Return a minimal mock for the language client.
        return path.join(__dirname, 'langclient-mock.js');
    }
    return originalResolveFilename.apply(this, arguments);
};
