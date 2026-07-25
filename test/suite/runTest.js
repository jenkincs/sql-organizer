const path = require('path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  await runTests({
    extensionDevelopmentPath: path.resolve(__dirname, '../..'),
    extensionTestsPath: path.resolve(__dirname, './index.js'),
    launchArgs: [path.resolve(__dirname, '../fixtures/sql-workspace'), '--disable-workspace-trust'],
  });
}
main().catch((error) => { console.error(error); process.exit(1); });
