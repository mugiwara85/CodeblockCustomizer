/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test file. */
// Fold and tab state persistence: session (Map) and permanent (JSON record) storage, remapped when the document changes
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ChangeSet } = require('@codemirror/state');
const { load } = require('./helpers/load.cjs');

const { StateStore } = load('src/StateStore.ts');
const insertAt = (pos, text, docLength) => ChangeSet.of({ from: pos, insert: text }, docLength);
const deleteRange = (from, to, docLength) => ChangeSet.of({ from, to }, docLength);

for (const isPermanent of [false, true]) {
  const kind = isPermanent ? 'permanent' : 'session';

  test(`${kind}: get, set, getAll, delete removes empty files, clear`, () => {
    const store = new StateStore(isPermanent, Number);
    assert.equal(store.get('a.md', 5), undefined);
    store.set('a.md', 5, true);
    store.set('a.md', 10, false);
    store.set('b.md', 1, true);
    assert.equal(store.get('a.md', 5), true);
    assert.deepEqual([...store.getAll('a.md')], [[5, true], [10, false]]);

    store.delete('b.md', 1);
    assert.equal(store.getAll('b.md'), undefined);
    store.clear();
    assert.equal(store.getAll('a.md'), undefined);
  });

  test(`${kind}: remap moves positions through edits, drops deleted and out of range positions (#144)`, () => {
    const store = new StateStore(isPermanent, Number);
    store.set('a.md', 2, 'first');
    store.set('a.md', 20, 'second');
    store.set('a.md', 500, 'stale');
    store.remap('a.md', insertAt(0, 'xxxxx', 100));
    assert.deepEqual([...store.getAll('a.md')], [[7, 'first'], [25, 'second']]);

    store.remap('a.md', deleteRange(10, 30, 105));
    assert.deepEqual([...store.getAll('a.md')], [[7, 'first'], [10, 'second']], 'mapPos maps a deleted position to the start of the deletion');
    store.remap('missing.md', insertAt(0, 'x', 1));
    assert.equal(store.getAll('missing.md'), undefined);
  });
}

test('permanent data is stored as a JSON-ready record and keys are parsed back', () => {
  const store = new StateStore(true, Number);
  store.set('a.md', 7, true);
  assert.deepEqual(store.permanentData, { 'a.md': { 7: true } });
  assert.deepEqual(JSON.parse(JSON.stringify(store.permanentData)), { 'a.md': { 7: true } });

  const restored = new StateStore(true, Number);
  restored.permanentData = JSON.parse(JSON.stringify(store.permanentData));
  assert.deepEqual([...restored.getAll('a.md')], [[7, true]]);
});

test('switching persistence keeps the two stores separate', () => {
  const store = new StateStore(false, Number);
  store.set('a.md', 1, true);
  store.isPermanent = true;
  assert.equal(store.get('a.md', 1), undefined);
  store.isPermanent = false;
  assert.equal(store.get('a.md', 1), true);
});

test('remapValues remaps tab positions stored as values (permanent only)', () => {
  const store = new StateStore(true, String);
  store.set('a.md', 'group1', 10);
  store.set('a.md', 'group2', 999);
  store.remapValues('a.md', insertAt(0, 'abc', 50));
  assert.deepEqual(store.permanentData, { 'a.md': { group1: 13 } });

  const session = new StateStore(false, String);
  session.set('a.md', 'group1', 10);
  session.remapValues('a.md', insertAt(0, 'abc', 50));
  assert.equal(session.get('a.md', 'group1'), 10, 'session tabs are remapped by the GroupedCodeBlocks state field');
});
