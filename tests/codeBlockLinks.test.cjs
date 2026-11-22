/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test file. */
// Links inside code blocks are rewritten by the plugin when a file is renamed (they aren't in Obsidian's metadata cache)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load.cjs');

const { getRenamedLinkText, getDisplayNameAndReference, replaceLinesIfUnchanged } = load('src/CodeBlockLinks.ts');

test('display name and reference are split off the link text', () => {
  assert.deepEqual(getDisplayNameAndReference('Note'), { displayName: '', reference: '' });
  assert.deepEqual(getDisplayNameAndReference('Note|alias'), { displayName: '|alias', reference: '' });
  assert.deepEqual(getDisplayNameAndReference('Note#Heading'), { displayName: '', reference: '#Heading' });
  assert.deepEqual(getDisplayNameAndReference('Note#Heading|alias'), { displayName: '|alias', reference: '#Heading' });
});

test('renamed link: one row per link form, heading and alias kept, unrelated or still valid links untouched', () => {
  const rename = (link, linkResolves = false) => getRenamedLinkText(link, 'Dir/Note.md', 'New/Renamed.md', '.md', linkResolves);
  const rows = [
    // with folder and extension
    ['Dir/Note.md', 'New/Renamed.md'],
    ['dir/note.md', 'New/Renamed.md'],
    ['Dir/Note.MD', null], // the extension check is case-sensitive (as before), so ".MD" is compared as an extensionless link and doesn't match
    // without folder, with extension
    ['Note.md', 'New/Renamed.md'],
    // with folder, without extension
    ['Dir/Note', 'New/Renamed'],
    ['DIR/NOTE', 'New/Renamed'],
    // without folder and extension
    ['Note', 'New/Renamed'],
    // heading and alias are kept
    ['Note#Heading|alias', 'New/Renamed#Heading|alias'],
    ['Dir/Note.md|alias', 'New/Renamed.md|alias'],
    // links to other notes stay
    ['Other', null],
    ['Other/Note', null],
    ['Dir/Note.canvas', null],
  ];
  for (const [link, expected] of rows) {
    assert.equal(rename(link), expected, link);
  }
  assert.equal(rename('Note', true), null, 'the link still points to an existing file, so it is not a link to the renamed one');
  assert.equal(getRenamedLinkText('Dir', 'Dir', 'Dir2', null, false), 'Dir2', 'a renamed folder has no extension');
  assert.equal(getRenamedLinkText('Dir/Note.md', 'Dir', 'Dir2', null, false), null);
});

test('rename writes the new block only if its lines still hold what was read (the file may have changed meanwhile)', () => {
  const lines = text => text.join('\n');
  const content = lines(['# Note', '```', '[[Old]]', '```', 'after']);
  const block = lines(['```', '[[Old]]', '```']);
  const updated = lines(['```', '[[New]]', '```']);
  assert.equal(replaceLinesIfUnchanged(content, 1, 3, block, updated), lines(['# Note', '```', '[[New]]', '```', 'after']));

  const edited = lines(['# Note', 'a line typed above', '```', '[[Old]]', '```', 'after']);
  assert.equal(replaceLinesIfUnchanged(edited, 1, 3, block, updated), null, 'lines 1-3 hold other text now, so nothing is overwritten');

  const crlf = content.split('\n').join('\r\n');
  const crlfBlock = crlf.split('\n').slice(1, 4).join('\n'); // how handleFileRename builds the block text: every line keeps its \r
  assert.equal(replaceLinesIfUnchanged(crlf, 1, 3, crlfBlock, crlfBlock.replace('Old', 'New')), crlf.replace('Old', 'New'), 'CRLF files: every line keeps its \\r');
});
