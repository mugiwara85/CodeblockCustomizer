/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test file, same as wrapping.test.cjs. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load.cjs');

const { htmlLineToFenceLine, findHtmlCodeBlocks, getHtmlCodeBlockCode, decodeHtmlEntities, countHtmlCodeElements, findHtmlInlineCodes, combineInlineCodeParameters, getInlineCodeAttributeParameters } = load('src/HtmlCodeBlocks.ts');

function find(text) {
  const lines = text.split('\n');
  return findHtmlCodeBlocks(i => lines[i], lines.length);
}

test('opening tag line is converted to a fence line with language and data-cbc parameters', () => {
  assert.equal(htmlLineToFenceLine('<pre><code class="language-python">'), '```python');
  assert.equal(htmlLineToFenceLine('<pre><code class="language-python" data-cbc="title:example.py hl:2">'), '```python title:example.py hl:2');
  assert.equal(htmlLineToFenceLine("<code data-cbc='fold' class='foo language-js'>"), '```js fold');
  assert.equal(htmlLineToFenceLine('<pre><code data-cbc="title:&quot;a b&quot;">x'), '``` title:"a b"');
  assert.equal(htmlLineToFenceLine('<pre><code>'), '```');
  assert.equal(htmlLineToFenceLine('```python'), null);
  assert.equal(htmlLineToFenceLine('text <code class="language-python">'), null);
  assert.equal(htmlLineToFenceLine('<pre>'), null);
});

test('all three layouts are found', () => {
  const ownLines = find('<pre><code class="language-python">\na = 0\nprint(a)\n</code></pre>');
  assert.deepEqual(ownLines, [{ preStartLine: 0, codeOpenLine: 0, codeCloseLine: 3, preEndLine: 3, firstLine: '```python' }]);

  const split = find('<pre>\n<code class="language-python">\na = 0\n</code>\n</pre>');
  assert.deepEqual(split, [{ preStartLine: 0, codeOpenLine: 1, codeCloseLine: 3, preEndLine: 4, firstLine: '```python' }]);

  const sameLine = find('<pre><code class="language-python">a = 0\nprint(a)</code></pre>');
  assert.deepEqual(sameLine, [{ preStartLine: 0, codeOpenLine: 0, codeCloseLine: 1, preEndLine: 1, firstLine: '```python' }]);
});

test('blocks which are not top-level HTML code blocks are ignored', () => {
  assert.deepEqual(find('```html\n<pre><code class="language-python">\na\n</code></pre>\n```'), []);
  assert.deepEqual(find('~~~~\n```\n<pre><code>\na\n</code></pre>\n~~~~'), []);
  assert.deepEqual(find('<details>\n<pre><code>\na\n</code></pre>\n</details>'), []);
  assert.deepEqual(find('---\nx: <pre><code>\n---\ntext'), []);
  assert.deepEqual(find('> <pre><code>\n> a\n> </code></pre>'), []);
  assert.deepEqual(find('    <pre><code>\n    a\n    </code></pre>'), []);
  assert.deepEqual(find('<pre>plain text\n</pre>'), []);
  assert.deepEqual(find('<pre><code>a</code></pre>'), []);
  assert.deepEqual(find('<pre><code>\nnever closed'), []);
});

test('blocks after fenced blocks and paragraphs are found', () => {
  const blocks = find('```js\nx\n```\n<pre><code>\na\n</code></pre>\n\nsome text\n<pre><code class="language-css">\nb\n</code></pre>');
  assert.deepEqual(blocks.map(b => [b.codeOpenLine, b.codeCloseLine, b.firstLine]), [[3, 5, '```'], [8, 10, '```css']]);
});

test('a block directly after the closing line of another block (no empty line between them) is found', () => {
  const blocks = find('<pre><code class="language-css">\na\n</code></pre>\n<pre><code class="language-js">\nb\n</code></pre>');
  assert.deepEqual(blocks.map(b => [b.preStartLine, b.preEndLine, b.firstLine]), [[0, 2, '```css'], [3, 5, '```js']]);
});

test('code is extracted as displayed: tags removed, entities decoded, newlines after <code> and before </code> trimmed', () => {
  assert.equal(getHtmlCodeBlockCode(['<pre><code class="language-python">', 'if a &lt; b:', '    print(&quot;x&quot;)', '</code></pre>']), 'if a < b:\n    print("x")');
  assert.equal(getHtmlCodeBlockCode(['<pre><code>a = 0', 'print(a)</code></pre>']), 'a = 0\nprint(a)');
  assert.equal(getHtmlCodeBlockCode(['<code class="language-js">', '<b>bold</b> &amp;&#38;&#x26;', '</code>']), 'bold &&&');
});

test('entities', () => {
  assert.equal(decodeHtmlEntities('&lt;&gt;&amp;&quot;&#39;&#x41;&unknown;'), '<>&"\'A&unknown;');
});

test('code elements in an HTML section are counted', () => {
  assert.equal(countHtmlCodeElements('<pre><code>\na\n</code></pre>'), 1);
  assert.equal(countHtmlCodeElements('<details>\n<pre>\n<code>a</code>\n</pre>\n<pre>no code</pre>\n</details>'), 1);
  assert.equal(countHtmlCodeElements('<div>text</div>'), 0);
});

test('inline code elements are found with their content range and attribute parameters', () => {
  const line = 'text <code>print(a)</code> and <code class="language-c" data-cbc="hl:a">a = 0</code>';
  const codes = findHtmlInlineCodes(line);
  assert.equal(codes.length, 2);
  assert.equal(line.substring(codes[0].from, codes[0].to), '<code>print(a)</code>');
  assert.equal(line.substring(codes[0].contentFrom, codes[0].contentTo), 'print(a)');
  assert.equal(codes[0].parameters, '');
  assert.equal(line.substring(codes[1].contentFrom, codes[1].contentTo), 'a = 0');
  assert.equal(codes[1].parameters, 'c hl:a');

  assert.equal(findHtmlInlineCodes('<code>{cpp} x</code>')[0].parameters, '');
  assert.equal(findHtmlInlineCodes('<code></code>').length, 1);
  assert.deepEqual(findHtmlInlineCodes('<pre><code>x</code></pre>'), []);
  assert.deepEqual(findHtmlInlineCodes('<codex>x</codex>'), []);
  assert.deepEqual(findHtmlInlineCodes('<code>unclosed'), []);
});

test('inline code parameters of the prefix and the attributes are combined, the language of the prefix comes first', () => {
  assert.equal(getInlineCodeAttributeParameters('language-c', 'impt:hello'), 'c impt:hello');
  assert.equal(getInlineCodeAttributeParameters('language-js', 'i mpt:html_inline'), 'js i mpt:html_inline');
  assert.equal(getInlineCodeAttributeParameters('foo', ''), '');
  assert.equal(combineInlineCodeParameters('cpp', 'c impt:hello'), 'cpp c impt:hello');
  assert.equal(combineInlineCodeParameters(null, 'c impt:hello'), 'c impt:hello');
  assert.equal(combineInlineCodeParameters(' cpp ', ''), 'cpp');
});
