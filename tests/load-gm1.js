// Helper to load GM1 headless from gm1.html under Node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadGM1(customHtmlPath) {
  const htmlPath = customHtmlPath || path.resolve(__dirname, '..', 'gm1.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scriptMatches = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  if (scriptMatches.length === 0) {
    throw new Error('No <script> tag found in gm1.html');
  }
  const sandbox = {
    module: { exports: {} },
    exports: {},
    BigInt,
    console,
    Map,
    Set,
    Array,
    Object,
    Number,
    String,
    Boolean,
    Math,
    JSON,
    Error,
    RegExp
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const m of scriptMatches) {
    vm.runInContext(m[1], sandbox, { filename: 'gm1.html' });
  }
  const GM1 = sandbox.GM1 || sandbox.module.exports;
  if (!GM1 || !GM1.Machine) {
    throw new Error('GM1 failed to export from gm1.html');
  }
  return { GM1, html, htmlPath };
}

module.exports = { loadGM1 };
