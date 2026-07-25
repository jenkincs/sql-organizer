const Mocha = require('mocha');
const path = require('path');

exports.run = () =>
  new Promise((resolve, reject) => {
    const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 15000 });
    mocha.addFile(path.resolve(__dirname, 'extension.test.js'));
    mocha.addFile(path.resolve(__dirname, 'apply.test.js'));
    try {
      mocha.run((failures) => (failures ? reject(new Error(`${failures} test failure(s).`)) : resolve()));
    } catch (error) {
      reject(error);
    }
  });
