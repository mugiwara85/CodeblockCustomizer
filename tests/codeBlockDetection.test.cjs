/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test file. */
// Code block detection in the editor. Fenced blocks come from Obsidian's HyperMD syntax tree, which is not available here, so this
// covers the closing fence search, the visible block filter and HTML code blocks (found without the syntax tree).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EditorState, EditorSelection } = require('@codemirror/state');
const { load, obsidian, setLivePreview } = require('./helpers/load.cjs');

const { findCodeBlockEnd, findCodeBlockPositions, getVisibleCodeBlocks, DEFAULT_SETTINGS } = load('src/EditorView/CodeBlockPositions.ts', 'src/Settings.ts');

const state = (doc, cursor = 0) => EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [obsidian.editorLivePreviewField] });
const sourceMode = s => s.update({ effects: setLivePreview.of(false) }).state;
const lineEnd = (s, n) => s.doc.line(n).to;

test('closing fence: same character and count, indentation allowed', () => {
  const s = state('```js\na\n````\n~~~\n  ```\nb');
  assert.equal(findCodeBlockEnd(0, s, 3, '`'), lineEnd(s, 5));
  assert.equal(findCodeBlockEnd(0, s, 4, '`'), lineEnd(s, 3));
  assert.equal(findCodeBlockEnd(0, s, 3, '~'), lineEnd(s, 4));
  assert.equal(findCodeBlockEnd(0, s, 5, '`'), undefined);
});

test('visible code blocks are the ones touching a visible range', () => {
  const blocks = [{ codeBlockStartPos: 0, codeBlockEndPos: 10 }, { codeBlockStartPos: 20, codeBlockEndPos: 30 }, { codeBlockStartPos: 50, codeBlockEndPos: 60 }];
  assert.deepEqual(getVisibleCodeBlocks(blocks, [{ from: 10, to: 20 }]), blocks.slice(0, 2));
  assert.deepEqual(getVisibleCodeBlocks(blocks, [{ from: 31, to: 49 }]), []);
  assert.deepEqual(getVisibleCodeBlocks(blocks, [{ from: 0, to: 5 }, { from: 55, to: 56 }]), [blocks[0], blocks[2]]);
});

test('HTML code blocks: only when enabled, parameters from data-cbc, source visible in source mode or with the cursor inside', () => {
  const doc = 'text\n<pre><code class="language-python" data-cbc="title:a.py hl:1 group:g">\nprint(1)\n</code></pre>';
  const settings = structuredClone(DEFAULT_SETTINGS);

  assert.deepEqual(findCodeBlockPositions(sourceMode(state(doc)), settings), [], 'disabled by default');
  settings.pluginSettings.common.enableHtmlCodeBlocks = true;

  const [block] = findCodeBlockPositions(sourceMode(state(doc)), settings);
  assert.equal(block.codeBlockStartPos, 5);
  assert.equal(block.codeBlockEndPos, doc.length);
  assert.deepEqual(block.htmlBlock, { from: 5, to: doc.length });
  assert.equal(block.parameters.language, 'python');
  assert.equal(block.parameters.headerDisplayText, 'a.py');
  assert.deepEqual(block.parameters.defaultLinesToHighlight.lineNumbers, [1]);
  assert.equal(block.parameters.group, '', 'groups are not supported for HTML code blocks');

  // live preview: Obsidian renders the block itself unless the cursor is inside
  assert.deepEqual(findCodeBlockPositions(state(doc, 0), settings), []);
  assert.equal(findCodeBlockPositions(state(doc, doc.indexOf('print')), settings).length, 1);
});
