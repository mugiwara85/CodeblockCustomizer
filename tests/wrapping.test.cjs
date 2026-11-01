/* eslint-disable @typescript-eslint/no-require-imports -- Use the same CommonJS CodeMirror instance as the bundled module under test. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const Module = require('node:module');
const path = require('node:path');
const { EditorState, StateField, StateEffect } = require('@codemirror/state');

global.ResizeObserver = class { observe() {} unobserve() {} };
const sourceMode = StateField.define({ create: () => false, update: (v, tr) => tr.effects.find(e => e.is(modeEffect))?.value ?? v });
const modeEffect = StateEffect.define();
global.__cbcSourceMode = state => state.field(sourceMode);

async function loadWrapping() {
  const result = await esbuild.build({
    stdin: { contents: 'export { wrapExtension } from "./src/EditorView/Wrapping"; export { wrapEffect } from "./src/EditorView/EditorEffects";', resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'obsidian-source-mode-seam', setup(build) {
      build.onResolve({ filter: /^\.\.\/Utils$/ }, () => ({ path: 'utils', namespace: 'test' }));
      build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const isSourceMode = state => globalThis.__cbcSourceMode(state);' }));
    } }]
  });
  const mod = new Module(path.join(process.cwd(), 'wrapping-test.cjs'), module);
  mod.filename = path.join(process.cwd(), 'wrapping-test.cjs');
  mod.paths = module.paths;
  mod._compile(result.outputFiles[0].text, mod.filename);
  return mod.exports;
}
const loaded = loadWrapping();
const block = '```js\nconst longLine = "abcdefghijklmnopqrstuvwxyz";\n```';
function scan(state) {
  const out = []; let start;
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    if (!line.text.startsWith('```')) continue;
    if (start === undefined) start = line.from;
    else { out.push({ codeBlockStartPos: start, codeBlockEndPos: line.to, parameters: { exclude: state.doc.lineAt(start).text.includes('exclude') } }); start = undefined; }
  }
  return out;
}
async function fixture(unwrap = true, delayed = false, doc = block) {
  const { wrapExtension, wrapEffect } = await loaded;
  const discover = StateEffect.define();
  const positions = StateField.define({ create: s => delayed ? [] : scan(s), update: (v, tr) => tr.docChanged || tr.effects.some(e => e.is(discover)) ? scan(tr.state) : v });
  const settings = { pluginSettings: { common: { enableInSourceMode: false }, codeblock: { unwrapcode: unwrap } } };
  const fields = wrapExtension(positions, settings);
  let state = EditorState.create({ doc, extensions: [sourceMode, positions, fields.wrappingField, fields.unwrappedCodeBlocksField] });
  return { ...fields, settings, wrapEffect, discover, get state() { return state; }, update(spec) { state = state.update(spec).state; } };
}
function lines(f) {
  const out = []; f.state.field(f.wrappingField).between(0, f.state.doc.length, (from, to, value) => { if (value.spec.attributes?.class === 'codeblock-customizer-nowrap') out.push(from); }); return out;
}
test('enabled setting automatically unwraps on initial editor creation', async () => {
  const f = await fixture();
  assert.deepEqual([...f.state.field(f.unwrappedCodeBlocksField)], [0]);
  assert.equal(lines(f).length, 3);
});
test('settings changes and returning from disabled Source Mode reapply default', async () => {
  const f = await fixture(false);
  assert.equal(lines(f).length, 0);
  f.settings.pluginSettings.codeblock.unwrapcode = true;
  f.update({});
  assert.equal(lines(f).length, 3);
  f.update({ effects: modeEffect.of(true) });
  assert.equal(lines(f).length, 0);
  f.update({ effects: modeEffect.of(false) });
  assert.equal(lines(f).length, 3);
  f.settings.pluginSettings.codeblock.unwrapcode = false;
  f.update({});
  assert.equal(lines(f).length, 0);
});
test('disabled default preserves manual unwrap and remaps it across edits', async () => {
  const f = await fixture(false);
  assert.equal(lines(f).length, 0);
  f.update({ effects: f.wrapEffect.of({ pos: 0, unwrap: true }) });
  assert.equal(lines(f).length, 3);
  f.update({ changes: { from: 0, insert: 'prefix\n' } });
  assert.deepEqual([...f.state.field(f.unwrappedCodeBlocksField)], [7]);
  assert.equal(lines(f).length, 3);
  f.update({ effects: f.wrapEffect.of({ pos: 7, unwrap: false }) });
  assert.equal(lines(f).length, 0);
});
test('excluded blocks remain untouched', async () => {
  const f = await fixture();
  f.update({ changes: { from: 0, to: f.state.doc.length, insert: block.replace('```js', '```js exclude') } });
  assert.equal(lines(f).length, 0);
});
test('initially excluded block inherits unwrap default when exclusion is removed', async () => {
  const f = await fixture(true, false, block.replace('```js', '```js exclude'));
  assert.equal(lines(f).length, 0);
  assert.equal(f.state.field(f.unwrappedCodeBlocksField).size, 0);
  f.update({ changes: { from: '```js'.length, to: '```js exclude'.length, insert: '' } });
  assert.deepEqual([...f.state.field(f.unwrappedCodeBlocksField)], [0]);
  assert.equal(lines(f).length, 3);
});
test('decorations cover inserted lines and clear when a block is deleted', async () => {
  const f = await fixture();
  f.update({ changes: { from: f.state.doc.line(2).from, insert: 'extra\n' } });
  assert.equal(lines(f).length, 4);
  f.update({ changes: { from: 0, to: f.state.doc.length, insert: '' } });
  assert.equal(lines(f).length, 0);
  assert.equal(f.state.field(f.unwrappedCodeBlocksField).size, 0);
});
test('late-parsed and newly inserted blocks inherit default; manual overrides survive edits', async () => {
  const f = await fixture(true, true);
  f.update({ effects: f.discover.of(true) });
  assert.equal(lines(f).length, 3, 'late parsing must apply default');
  f.update({ effects: f.wrapEffect.of({ pos: 0, unwrap: false }) });
  assert.equal(lines(f).length, 0);
  f.update({ changes: { from: 0, insert: 'prefix\n' } });
  assert.equal(lines(f).length, 0, 'manual wrap persists after moving block');
  f.update({ changes: { from: f.state.doc.length, insert: '\n' + block } });
  assert.equal(lines(f).length, 3, 'new block inherits unwrap');
  f.update({ changes: { from: 0, insert: 'another\n' } });
  assert.equal(lines(f).length, 3);
  assert.deepEqual([...f.state.field(f.unwrappedCodeBlocksField)], [f.state.doc.line(6).from]);
});
