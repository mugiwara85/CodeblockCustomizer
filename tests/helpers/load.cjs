/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test helper. */
// Bundles TypeScript sources with esbuild and loads them as one CommonJS module. npm packages stay external, so the bundle
// and the tests share the same @codemirror instances. The npm "obsidian" package has types only, so it is replaced by a stub.
const esbuild = require('esbuild');
const Module = require('node:module');
const path = require('node:path');
const { StateEffect, StateField } = require('@codemirror/state');

// getCurrentMode() reads the theme class from these documents (no body => dark mode). documentElement is what @codemirror/view reads on load.
globalThis.document ??= { querySelector: () => null, documentElement: { style: {} } };
globalThis.activeDocument ??= globalThis.document;

// Live Preview is on by default, isSourceMode(state) is true after setLivePreview.of(false)
const setLivePreview = StateEffect.define();
const obsidian = {
  editorLivePreviewField: StateField.define({ create: () => true, update: (value, tr) => tr.effects.find(e => e.is(setLivePreview))?.value ?? value }),
};

// load('src/Parsing.ts', 'src/Utils.ts') returns the exports of all given files from a single bundle
function load(...files) {
  const result = esbuild.buildSync({
    stdin: { contents: files.map(file => `export * from ${JSON.stringify(`./${file}`)};`).join('\n'), resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
  });
  const filename = path.join(process.cwd(), 'test-bundle.cjs');
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod.require = id => id === 'obsidian' ? obsidian : Module.prototype.require.call(mod, id);
  mod._compile(result.outputFiles[0].text, filename);
  return mod.exports;
}

module.exports = { load, obsidian, setLivePreview };
