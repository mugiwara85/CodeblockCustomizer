/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test file. */
// Header language name and icon, Prism tokens in the editor, Execute Code languages, inline code syntax, links in code and header
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load.cjs');

const {
  getDisplayLanguageName, getLanguageIcon, getExecuteCodeLanguages, getTextValues, walkPrismTokens,
  INLINE_CODE_LANG_REGEX, LINK_REGEX, EXECUTE_CODE_SUPPORTED_LANGUAGES,
} = load('src/Utils.ts', 'src/Const.ts', 'src/EditorView/PrismHighlight.ts');

test('display language name: known names, capitalized fallback', () => {
  assert.equal(getDisplayLanguageName('CPP'), 'C++');
  assert.equal(getDisplayLanguageName('mylang'), 'Mylang');
  assert.equal(getDisplayLanguageName(''), '');
  assert.equal(getDisplayLanguageName(null), '');
});

test('language icon by display name', () => {
  assert.ok(getLanguageIcon('Lisp').includes('<path'));
  assert.equal(getLanguageIcon('Mylang'), null);
  assert.equal(getLanguageIcon(''), '');
});

test('Prism tokens become ranges with token classes and aliases, nested tokens included', () => {
  const tokens = [
    'let ',
    { type: 'variable', content: 'x', alias: 'name' },
    ' = ',
    { type: 'string', content: ['"', { type: 'interpolation', content: 'y', alias: ['a', 'b'] }, '"'] },
    { type: 'empty', content: '' },
  ];
  const ranges = [];
  assert.equal(walkPrismTokens(tokens, 0, ranges), 'let x = "y"'.length);
  assert.deepEqual(ranges, [
    { from: 4, to: 5, classes: 'token variable name' },
    { from: 9, to: 10, classes: 'token interpolation a b' },
    { from: 8, to: 11, classes: 'token string' },
  ]);
});

test('Execute Code languages: supported ones plus additional, lower-cased, run- prefix removed, no duplicates', () => {
  const langs = getExecuteCodeLanguages('MyLang, run-other;python  ');
  assert.deepEqual(langs.slice(-2), ['mylang', 'other']);
  assert.equal(langs.filter(l => l === 'python').length, 1);
  assert.equal(getExecuteCodeLanguages('').length, new Set(EXECUTE_CODE_SUPPORTED_LANGUAGES).size);
});

test('inline code: {parameters} prefix and code', () => {
  assert.deepEqual('{ python hl } print(1)'.match(INLINE_CODE_LANG_REGEX).slice(1), ['python hl', 'print(1)']);
  assert.deepEqual('{js}x'.match(INLINE_CODE_LANG_REGEX).slice(1), ['js', 'x']);
  assert.equal('no params'.match(INLINE_CODE_LANG_REGEX), null);
  assert.equal('{} x'.match(INLINE_CODE_LANG_REGEX), null);
});

test('links: wiki links with alias, markdown links, URLs', () => {
  const links = text => [...text.matchAll(LINK_REGEX)].map(m => m.slice(1).filter(Boolean));
  assert.deepEqual(links('see [[Note]] and [[Other|alias]]'), [['Note'], ['Other', 'alias']]);
  assert.deepEqual(links('[site](https://a.b) https://x.y/z?q=1 text'), [['site', 'https://a.b'], ['https://x.y/z?q=1']]);
  assert.deepEqual(links('plain [text] only'), []);

  assert.deepEqual(getTextValues('Note|shown'), { displayText: 'shown', linkText: 'Note' });
  assert.deepEqual(getTextValues('Note'), { displayText: 'Note', linkText: 'Note' });
});
