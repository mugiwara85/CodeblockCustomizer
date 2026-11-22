/* eslint-disable @typescript-eslint/no-require-imports -- Use Node built-in test runner with bundled TypeScript helpers. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load.cjs');

const { extractCodeBlocksFromSection, getBlockLine, getHtmlCodeBlockData, findHtmlCodeBlocks, escapeHtml } = load('src/ReadingView/ReadingViewUtils.ts', 'src/HtmlCodeBlocks.ts');

test('blocks of a list section get their own line, not the section start', () => {
  const section = [
    '- item one',
    '  ```python title:"A"',
    '  a',
    '  ```',
    '- item two',
    '  ```js',
    '  b',
    '  ```',
  ];
  const blocks = extractCodeBlocksFromSection(section);

  assert.deepEqual(blocks.map(b => [b.firstLine, b.startLine, b.endLine]), [['```python title:"A"', 1, 3], ['```js', 5, 7]]);
  // the section starts on file line 10, the editor queues edits under the fence lines 11 and 15
  assert.deepEqual(blocks.map(b => getBlockLine(10, b)), [11, 15]);
});

test('blocks of a callout section get their own line', () => {
  const section = [
    '> [!note]',
    '> text',
    '> ```python hl:1',
    '> x',
    '> ```',
  ];
  const blocks = extractCodeBlocksFromSection(section);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].firstLine, '```python hl:1');
  assert.deepEqual(blocks[0].contentLines, ['```python hl:1', 'x', '```']);
  assert.equal(getBlockLine(3, blocks[0]), 5);
});

test('a standalone block keeps the section start as its line (remembered folds stay valid)', () => {
  const fenced = extractCodeBlocksFromSection(['```cpp fold', 'int a;', '```']);
  const indented = extractCodeBlocksFromSection(['    int a;', '    int b;']);

  assert.equal(getBlockLine(7, fenced[0]), 7);
  assert.equal(indented[0].isIndentedBlock, true);
  assert.equal(getBlockLine(7, indented[0]), 7);
});

test('HTML blocks use the line of the opening <code> tag, like the editor', () => {
  const section = [
    '<pre>',
    '<code class="language-python">x = 1',
    '</code>',
    '</pre>',
  ];
  const [block] = findHtmlCodeBlocks(i => section[i], section.length);
  const data = getHtmlCodeBlockData(block, i => section[i]);

  assert.equal(data.startLine, 0);
  assert.equal(data.firstLineOffset, 1);
  assert.equal(getBlockLine(20, data), 21);
});

test('escapeHtml: plain text (e.g. Execute Code output) stays text when parsed as HTML', () => {
  assert.equal(escapeHtml('a<b & c>d'), 'a&lt;b &amp; c&gt;d');
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml('&lt;'), '&amp;lt;', 'an entity in the output is shown as typed');
  assert.equal(escapeHtml('a b'), 'a&nbsp;b');
});
