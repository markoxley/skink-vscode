// Minimal mock of vscode-languageclient/node for unit testing.
module.exports = {
    LanguageClient: function() { return { start: function() {}, dispose: function() {} }; },
    LanguageClientOptions: {},
    ServerOptions: {},
    TransportKind: { stdio: 0 },
    Executable: {},
};
