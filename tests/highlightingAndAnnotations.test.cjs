/* eslint-disable @typescript-eslint/no-require-imports -- Use Node built-in test runner with bundled TypeScript helpers. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load.cjs');

const helpersPromise = Promise.resolve(load('src/Utils.ts'));
const { getAllParameters, createHighlightRules, createInlineHighlightRules, parseInlineCodeHighlightParams, filterOccurrences, findAllOccurrences, escapeRegex, ANNOTATION_PATTERN, DEFAULT_SETTINGS } = load('src/Parsing.ts', 'src/HighlightRules.ts', 'src/Utils.ts', 'src/Const.ts', 'src/Settings.ts');

function rules(line) {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.SelectedTheme.colors.dark.codeblock.alternateHighlightColors = { info: {}, warn: {} };
  return createHighlightRules(getAllParameters(line, s));
}

test('highlight rules: line highlight by number, word and line specific word, lower-cased for matching', () => {
  const r = rules('```js hl:1,3,Foo,4|Bar,4|baz info:2,5|Qux warn:2');
  assert.deepEqual([...r.defaultLinesToHighlight], [1, 3]);
  assert.deepEqual(r.defaultLinesToHighlightByWords, ['foo']);
  assert.deepEqual([...r.defaultLineSpecificWords], [[4, ['bar', 'baz']]]);
  assert.deepEqual([...r.alternativeLinesToHighlight], [[2, ['info', 'warn']]], 'one line can get several alternative colors');
  assert.deepEqual([...r.alternativeLineSpecificWords], [[5, [{ words: ['qux'], colorName: 'info' }]]]);
});

test('highlight rules: text highlight words, text between, all words in line, alternative colors', () => {
  const r = rules('```js hlt:x,A:B,7,2|y,2|C:D infot:3,z,4|E:F');
  assert.deepEqual(r.defaultTextToHighlight.map(w => w.text), ['x']);
  assert.deepEqual(r.defaultTextBetween, [{ from: 'A', to: 'B', fromLower: 'a', toLower: 'b', occurrences: [] }]);
  assert.deepEqual([...r.defaultTextAllWordsInLine], [7]);
  assert.deepEqual([...r.defaultTextLineSpecificWords.keys()], [2]);
  assert.deepEqual(r.defaultTextLineSpecificBetween.get(2).map(t => [t.fromLower, t.toLower]), [['c', 'd']]);
  assert.deepEqual([...r.alternativeTextAllWordsInLine], [[3, 'info']]);
  assert.deepEqual(r.alternativeTextToHighlight.map(e => [e.colorName, e.words.map(w => w.text)]), [['info', ['z']]]);
  assert.deepEqual(r.alternativeTextLineSpecificBetween.get(4).map(t => [t.colorName, t.from, t.to]), [['info', 'E', 'F']]);
});

test('inline code highlight rules: the same rules as a code block with the same text highlight parameters', () => {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.SelectedTheme.colors.dark.codeblock.alternateHighlightColors = { info: {}, warn: {} };
  const params = 'hlt:x,A:B,7,2|y,2|C:D infot:3,z,4|E:F,5|v warnt:w,G:H';
  const inline = createInlineHighlightRules(parseInlineCodeHighlightParams(params, s));
  assert.deepEqual(inline, createHighlightRules(getAllParameters('```js ' + params, s)));
  assert.deepEqual(inline.alternativeTextToHighlight.map(e => e.colorName), ['info', 'warn']);
  assert.deepEqual([...inline.alternativeTextLineSpecificWords.keys()], [5]);
});

test('occurrences: positive from start, negative from end, 0 and out of range ignored, original order kept', () => {
  const matches = [0, 1, 2, 3, 4].map(i => ({ from: i * 10, to: i * 10 + 1 }));
  assert.deepEqual(filterOccurrences(matches, []), matches);
  assert.deepEqual(filterOccurrences(matches, [3, 1]), [matches[0], matches[2]]);
  assert.deepEqual(filterOccurrences(matches, [-1, 5, 0, 9, -9]), [matches[4]]);
  assert.deepEqual(findAllOccurrences('aaaa', 'aa'), [0, 2], 'matches do not overlap');
  assert.deepEqual(findAllOccurrences('abc', 'x'), []);
});

test('annotation pattern: type, optional title, content', () => {
  assert.deepEqual({ ...'[!note] Some text'.match(ANNOTATION_PATTERN).groups }, { type: 'note', title: undefined, content: 'Some text' });
  assert.deepEqual({ ...'[!warn|Careful] Two\nlines'.match(ANNOTATION_PATTERN).groups }, { type: 'warn', title: 'Careful', content: 'Two\nlines' });
  assert.equal('[note] text'.match(ANNOTATION_PATTERN), null);
});

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

test('escapeRegex: special characters match literally (group names, highlighted words)', () => {
  for (const name of ['c++', 'my (tabs)', 'a.b', 'Price $$', '[x]*']) {
    assert.equal(new RegExp(`^${escapeRegex(name)}$`).test(name), true, name);
  }
  assert.equal(new RegExp(escapeRegex('a.b')).test('aXb'), false);
});
