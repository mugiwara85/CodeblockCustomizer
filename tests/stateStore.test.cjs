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

  test(`${kind}: remap reports whether anything moved, so unchanged notes don't trigger a save`, () => {
    const store = new StateStore(isPermanent, Number);
    assert.equal(store.remap('a.md', insertAt(0, 'x', 100)), false, 'no saved folds in this note');
    store.set('a.md', 20, 'fold');
    assert.equal(store.remap('a.md', insertAt(50, 'x', 100)), false, 'an edit after the block moves nothing');
    assert.equal(store.remap('a.md', insertAt(0, 'x', 101)), true);
    assert.deepEqual([...store.getAll('a.md')], [[21, 'fold']]);
    assert.equal(store.remap('a.md', deleteRange(0, 1, 5)), true, 'a position past the end of the document is dropped (#144)');
    assert.deepEqual([...store.getAll('a.md')], []);
  });

  test(`${kind}: remapValues shifts editor tab positions once per edit and drops out of range ones`, () => {
    const store = new StateStore(isPermanent, String);
    store.set('a.md', 'group1', 100);
    store.set('a.md', 'group2', 999);
    assert.equal(store.remapValues('a.md', insertAt(0, 'x', 200)), true);
    assert.deepEqual([...store.getAll('a.md')], [['group1', 101]], 'shifted by exactly one, group2 was past the end (#144)');
    assert.equal(store.remapValues('a.md', insertAt(150, 'x', 201)), false, 'an edit after the block moves nothing');
    assert.equal(store.remapValues('b.md', insertAt(0, 'x', 10)), false, 'no saved tabs in this note');
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

for (const isPermanent of [false, true]) {
  const kind = isPermanent ? 'permanent' : 'session';

  test(`${kind}: a renamed file or folder keeps its entries, other files are untouched`, () => {
    const store = new StateStore(isPermanent, Number);
    store.set('A.md', 1, 'a');
    store.set('Dir/B.md', 2, 'b');
    store.set('Dir/Sub/C.md', 3, 'c');
    store.set('Dirt/D.md', 4, 'd');

    assert.equal(store.renamePath('A.md', 'Renamed.md'), true);
    assert.equal(store.get('A.md', 1), undefined);
    assert.equal(store.get('Renamed.md', 1), 'a');

    assert.equal(store.renamePath('Dir', 'Folder'), true, 'a folder rename moves every file inside it');
    assert.equal(store.get('Folder/B.md', 2), 'b');
    assert.equal(store.get('Folder/Sub/C.md', 3), 'c');
    assert.equal(store.get('Dirt/D.md', 4), 'd', '"Dirt" only starts with "Dir", it is not inside it');

    assert.equal(store.renamePath('Dir/B.md', 'Folder/B.md'), false, 'a later per-file event for the same rename finds nothing to move');
    assert.equal(store.get('Folder/B.md', 2), 'b');
  });

  test(`${kind}: a deleted file or folder drops its entries`, () => {
    const store = new StateStore(isPermanent, Number);
    store.set('A.md', 1, 'a');
    store.set('Dir/B.md', 2, 'b');
    store.set('Dirt/D.md', 4, 'd');

    assert.equal(store.deletePath('A.md'), true);
    assert.equal(store.getAll('A.md'), undefined);
    assert.equal(store.deletePath('Dir'), true);
    assert.equal(store.getAll('Dir/B.md'), undefined);
    assert.equal(store.get('Dirt/D.md', 4), 'd');
    assert.equal(store.deletePath('Missing.md'), false);
  });
}

test('rename and delete also update the store that is not active (session or permanent)', () => {
  const store = new StateStore(false, Number);
  store.set('A.md', 1, 'session');
  store.isPermanent = true;
  store.set('A.md', 1, 'permanent');
  store.renamePath('A.md', 'B.md');
  assert.equal(store.get('B.md', 1), 'permanent');
  store.isPermanent = false;
  assert.equal(store.get('B.md', 1), 'session');
});
