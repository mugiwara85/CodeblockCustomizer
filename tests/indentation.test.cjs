/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test file. */
// Indented and nested code blocks: indent/unindent commands, removing the fence indentation, indentation guides in reading view
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load.cjs');

const { addIndentation, removeIndentation, normalizeIndentation, removeFenceIndentation, trackIndentation } = load('src/Utils.ts', 'src/ReadingView/ReadingViewUtils.ts');

test('indent and unindent code block commands add or remove four spaces', () => {
  assert.deepEqual(addIndentation(['```js', 'a', '```']), ['    ```js', '    a', '    ```']);
  assert.deepEqual(removeIndentation(['    ```js', '      a', '  b', '\tc']), ['```js', '  a', '  b', '\tc']);
});

test('fence indentation is removed from the code lines, at most as much as the fence has', () => {
  assert.deepEqual(removeFenceIndentation(['  a', '    b', 'c'], '  ```js'), ['a', '  b', 'c']);
  assert.deepEqual(removeFenceIndentation(['\ta', '\t\tb'], '\t```js'), ['a', '\tb']);
  assert.deepEqual(removeFenceIndentation(['  a'], '```js'), ['  a']);
});

test('normalizeIndentation removes the common indentation, blank lines are ignored', () => {
  assert.deepEqual(normalizeIndentation(['    a', '', '      b']), ['a', '', '  b']);
  assert.deepEqual(normalizeIndentation(['a', '  b']), ['a', '  b']);
  assert.deepEqual(normalizeIndentation(['', '  ']), ['', '  ']);
});

test('indentation guides: level per line (tab = 4), blank lines take the next level, collapse marker where the next line is deeper', () => {
  const lines = ['if (a) {', '    b();', '', '\tif (c) {', '        d();', '    }', '}'];
  assert.deepEqual(trackIndentation(lines), [
    { indentationLevels: 0, insertCollapse: true },
    { indentationLevels: 1, insertCollapse: false },
    { indentationLevels: 1, insertCollapse: false },
    { indentationLevels: 1, insertCollapse: true },
    { indentationLevels: 2, insertCollapse: false },
    { indentationLevels: 1, insertCollapse: false },
    { indentationLevels: 0, insertCollapse: false },
  ]);
});
