/* eslint-disable @typescript-eslint/no-require-imports -- Use Node built-in test runner with bundled TypeScript helpers. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const Module = require('node:module');
const path = require('node:path');

async function loadUtilsHelpers() {
  const result = await esbuild.build({
    stdin: {
      contents: 'export { layerHighlightRanges, removeAnnotationRangesFromCode } from "./src/Utils";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [{
      name: 'obsidian-stub',
      setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = {};' }));
      },
    }],
  });

  const mod = new Module(path.join(process.cwd(), 'highlighting-annotations-test.cjs'), module);
  mod.filename = path.join(process.cwd(), 'highlighting-annotations-test.cjs');
  mod.paths = module.paths;
  mod._compile(result.outputFiles[0].text, mod.filename);
  return mod.exports;
}

const helpersPromise = loadUtilsHelpers();

test('layerHighlightRanges resolves overlapping default and alternate highlights consistently', async () => {
  const { layerHighlightRanges } = await helpersPromise;
  // "// Range overlap test: one two three four"
  //  hlt: one..three  => [23, 36], order 0
  //  medt: two..four  => [27, 41], order 1
  const resolved = layerHighlightRanges([
    { from: 23, to: 36, className: 'codeblock-customizer-highlighted-text', order: 0 },
    { from: 27, to: 41, className: 'codeblock-customizer-highlighted-text-medt', order: 1 },
  ]);

  assert.deepEqual(resolved, [
    { from: 23, to: 27, className: 'codeblock-customizer-highlighted-text' },
    { from: 27, to: 41, className: 'codeblock-customizer-highlighted-text-medt' },
  ]);
});

test('layerHighlightRanges keeps higher-order override even when it starts before lower-order rule', async () => {
  const { layerHighlightRanges } = await helpersPromise;
  const resolved = layerHighlightRanges([
    { from: 10, to: 30, className: 'codeblock-customizer-highlighted-text-medt', order: 1 },
    { from: 15, to: 25, className: 'codeblock-customizer-highlighted-text', order: 0 },
  ]);

  assert.deepEqual(resolved, [
    { from: 10, to: 30, className: 'codeblock-customizer-highlighted-text-medt' },
  ]);
});

test('layerHighlightRanges merges adjacent disjoint intervals sharing identical className', async () => {
  const { layerHighlightRanges } = await helpersPromise;
  const resolved = layerHighlightRanges([
    { from: 0, to: 5, className: 'a', order: 0 },
    { from: 5, to: 10, className: 'a', order: 0 },
    { from: 12, to: 18, className: 'b', order: 1 },
  ]);

  assert.deepEqual(resolved, [
    { from: 0, to: 10, className: 'a' },
    { from: 12, to: 18, className: 'b' },
  ]);
});

test('removeAnnotationRangesFromCode clears standalone annotation lines to empty rows and trims inline spacing', async () => {
  const { removeAnnotationRangesFromCode } = await helpersPromise;
  const code = [
    '// [!note] Standard note annotation',
    'const a = 1;',
    '  // [!warn] Indented annotation',
    '',
    'const b = 2; // [!error] Inline note',
    '// Regular comment',
    'const c = 3;',
  ].join('\n');

  const ranges = [
    { from: code.indexOf('// [!note]'), to: code.indexOf('\nconst a') },
    { from: code.indexOf('// [!warn]'), to: code.indexOf('\n\nconst b') },
    { from: code.indexOf('// [!error]'), to: code.indexOf('\n// Regular') },
    { from: code.indexOf('// Regular'), to: code.indexOf('\nconst c') },
  ];

  const cleaned = removeAnnotationRangesFromCode(code, ranges);
  assert.equal(cleaned, [
    '',
    'const a = 1;',
    '',
    '',
    'const b = 2;',
    '',
    'const c = 3;',
  ].join('\n'));
});
