/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test file. */
// Header visibility, default fold state, semi-fold and the line count used for them (hidden lines are not counted)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load.cjs');

const { getAllParameters, isSpecificHeader, determineDefaultFoldState, getVisibleLineCount, isFoldDisabled, DEFAULT_SETTINGS } = load('src/Parsing.ts', 'src/Utils.ts', 'src/Settings.ts');

function settings({ inverseFold = false, ignoreShort = false, semiFold = false, visibleLines = 5, autoFold = false, longLines = 30, alwaysLang = false, alwaysIcon = false, disableFold = false } = {}) {
  const s = structuredClone(DEFAULT_SETTINGS);
  Object.assign(s.pluginSettings.codeblock.folding, { inverseFold, ignoreShortBlocksOnInverseFold: ignoreShort });
  Object.assign(s.pluginSettings.semiFold, { enableSemiFold: semiFold, visibleLines, autoFoldLongCodeblocks: autoFold, longCodeBlockLines: longLines });
  Object.assign(s.pluginSettings.header, { alwaysDisplayCodeblockLang: alwaysLang, alwaysDisplayCodeblockIcon: alwaysIcon, disableFoldUnlessSpecified: disableFold });
  return s;
}
const params = (line, s) => getAllParameters(line, s);
// reading view counts content lines only, editor counts the two fence lines as well
const fold = (line, s, lines, specificHeader = false, mode = 'reading') => determineDefaultFoldState(params(line, s), s, lines, specificHeader, mode);

test('getVisibleLineCount: hidden lines are not counted, line number offset and jumps are respected', () => {
  const s = settings();
  assert.equal(getVisibleLineCount(params('```js', s), 10), 10);
  assert.equal(getVisibleLineCount(params('```js hide:2,4-5', s), 10), 7);
  // ln:5 => displayed numbers are 5..14, hide:2 is not displayed so nothing is hidden
  assert.equal(getVisibleLineCount(params('```js ln:5 hide:2,6', s), 10), 9);
  // ln:3:20 => displayed 1,2,20,21,...
  assert.equal(getVisibleLineCount(params('```js ln:3:20 hide:3,20', s), 5), 4);
});

test('fold, unfold and inverse fold', () => {
  assert.equal(fold('```js', settings(), 3).foldByDefault, false);
  assert.equal(fold('```js fold', settings(), 3).foldByDefault, true);
  assert.equal(fold('```js', settings({ inverseFold: true }), 3).foldByDefault, true);
  assert.equal(fold('```js unfold', settings({ inverseFold: true }), 3).foldByDefault, false);
  assert.equal(fold('```js fold unfold', settings({ inverseFold: true }), 3).foldByDefault, true);
});

test('ignore short blocks on inverse fold needs semi-fold and only folds blocks that can semi-fold', () => {
  // can semi-fold: visible lines >= visibleLines + fadeOutLineCount (5 + 4)
  const s = settings({ inverseFold: true, ignoreShort: true, semiFold: true });
  assert.equal(fold('```js', s, 8).foldByDefault, false);
  assert.equal(fold('```js', s, 9).foldByDefault, true);
  assert.equal(fold('```js hide:1', s, 9).foldByDefault, false, 'hidden lines do not count');
  assert.equal(fold('```js', s, 10, false, 'editor').foldByDefault, false, 'editor line count includes the fences');
  assert.equal(fold('```js', s, 11, false, 'editor').foldByDefault, true);

  // without semi-fold the setting is ignored and every block is folded
  assert.equal(fold('```js', settings({ inverseFold: true, ignoreShort: true }), 2).foldByDefault, true);
});

test('semi-fold flag and auto fold of long code blocks', () => {
  assert.equal(fold('```js', settings({ semiFold: true }), 3).useSemiFold, true);
  assert.equal(fold('```js', settings(), 3).useSemiFold, false);

  const s = settings({ semiFold: true, autoFold: true, longLines: 20 });
  assert.equal(fold('```js', s, 20, true).foldByDefault, true);
  assert.equal(fold('```js', s, 19, true).foldByDefault, false);
  assert.equal(fold('```js', s, 20, false).foldByDefault, false, 'auto fold needs a header');
  assert.equal(fold('```js', settings({ autoFold: true, longLines: 20 }), 50, true).foldByDefault, false, 'auto fold needs semi-fold');
});

test('header is shown for title, group member, fold, and language with always display settings', () => {
  const header = (line, s, grouped = false) => isSpecificHeader(params(line, s), s, grouped, 5, 'reading');
  assert.equal(header('```js', settings()), false);
  assert.equal(header('```js title:a.js', settings()), true);
  assert.equal(header('```js file:a.js', settings()), true);
  assert.equal(header('```js', settings(), true), true);
  assert.equal(header('```js fold', settings()), true);
  assert.equal(header('```js', settings({ inverseFold: true })), true);
  assert.equal(header('```js', settings({ alwaysLang: true })), true);
  assert.equal(header('```js', settings({ alwaysIcon: true })), true);
  assert.equal(header('```', settings({ alwaysLang: true, alwaysIcon: true })), false, 'no language, nothing to display');
});

test('disable folding unless specified: only fold (or unfold with inverse fold) makes a block foldable', () => {
  const disabled = (line, opts) => { const s = settings(opts); return isFoldDisabled(params(line, s), s); };
  // setting off: everything is foldable
  for (const line of ['```js', '```js fold', '```js unfold']) {
    assert.equal(disabled(line, {}), false);
    assert.equal(disabled(line, { inverseFold: true }), false);
  }
  // inverse fold off: only fold
  assert.equal(disabled('```js', { disableFold: true }), true);
  assert.equal(disabled('```js fold', { disableFold: true }), false);
  assert.equal(disabled('```js unfold', { disableFold: true }), true);
  // inverse fold on: only unfold
  assert.equal(disabled('```js', { disableFold: true, inverseFold: true }), true);
  assert.equal(disabled('```js fold', { disableFold: true, inverseFold: true }), true);
  assert.equal(disabled('```js unfold', { disableFold: true, inverseFold: true }), false);
  // auto semi-fold doesn't make a block foldable
  assert.equal(disabled('```js title:x', { disableFold: true, semiFold: true, autoFold: true }), true);
});
