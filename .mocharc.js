// Mocha configuration for skink-vscode unit tests.
// The setup file intercepts require('vscode') and returns a mock.
module.exports = {
    require: ['./test/setup.js'],
    spec: 'out/**/*.test.js',
};
