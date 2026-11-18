/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test file. */
// Color themes (light/dark), language specific colors, border colors, snapshot colors and syntax themes
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load.cjs');

const {
  getBorderColorByLanguage, getLanguageSpecificColorClass, getPropertyFromLanguageSpecificColors, mergeBorderColorsToLanguageSpecificColors,
  getSnapshotColors, generateSyntaxThemeStyles, getCurrentMode, refreshCachedMode, getAllParameters, DEFAULT_SETTINGS,
} = load('src/Utils.ts', 'src/SyntaxThemeUtils.ts', 'src/Parsing.ts', 'src/Settings.ts');

const settings = () => structuredClone(DEFAULT_SETTINGS);

// switches the body theme class read by getCurrentMode()
function withMode(mode, fn) {
  const original = document.querySelector;
  document.querySelector = () => ({ classList: { contains: cls => cls === `theme-${mode}` } });
  refreshCachedMode();
  try {
    return fn();
  } finally {
    document.querySelector = original;
    refreshCachedMode();
  }
}

test('current mode follows the body theme class, dark is the fallback', () => {
  assert.equal(getCurrentMode(), 'dark');
  assert.equal(withMode('light', getCurrentMode), 'light');
  assert.equal(getCurrentMode(), 'dark');
});

test('language specific color class: case-insensitive, nolang for blocks without language, empty without colors', () => {
  const colors = { JS: { 'codeblock.backgroundColor': '#111' }, nolang: { 'header.textColor': '#222' }, py: {} };
  assert.equal(getLanguageSpecificColorClass('js', colors), 'codeblock-customizer-languageSpecific-js');
  assert.equal(getLanguageSpecificColorClass('', colors), 'codeblock-customizer-languageSpecific-nolang');
  assert.equal(getLanguageSpecificColorClass('py', colors), '');
  assert.equal(getLanguageSpecificColorClass('cpp', null), '');
});

test('border color by language and language specific property lookup use the current mode', () => {
  assert.equal(getBorderColorByLanguage('Python', { python: '#f00' }), '#f00');
  assert.equal(getBorderColorByLanguage('', { nolang: '#0f0' }), '#0f0');
  assert.equal(getBorderColorByLanguage('cpp', { python: '#f00' }), '');

  const s = settings();
  s.SelectedTheme.colors.dark.languageSpecificColors = { js: { 'codeblock.borderColor': '#d00' }, py: {} };
  s.SelectedTheme.colors.light.languageSpecificColors = { js: { 'codeblock.borderColor': '#100' } };
  assert.deepEqual(getPropertyFromLanguageSpecificColors('codeblock.borderColor', s), { js: '#d00' });
  assert.deepEqual(withMode('light', () => getPropertyFromLanguageSpecificColors('codeblock.borderColor', s)), { js: '#100' });

  // the parsed border color comes from the language specific colors
  assert.equal(getAllParameters('```JS', s).language, 'JS');
  assert.equal(getAllParameters('```js', s).hasLangBorderColor, true);
  assert.equal(getAllParameters('```py', s).hasLangBorderColor, false);
});

test('old languageBorderColors are moved into language specific colors for both modes', () => {
  const s = settings();
  s.SelectedTheme.colors.dark.codeblock.languageBorderColors = { js: '#d00' };
  s.SelectedTheme.colors.light.codeblock.languageBorderColors = { js: '#100' };
  s.SelectedTheme.colors.dark.languageSpecificColors = { js: { 'header.textColor': '#fff' } };
  let saved = 0;
  mergeBorderColorsToLanguageSpecificColors({ saveSettings: () => saved++ }, s);

  assert.deepEqual(s.SelectedTheme.colors.dark.languageSpecificColors.js, { 'header.textColor': '#fff', 'codeblock.borderColor': '#d00' });
  assert.deepEqual(s.SelectedTheme.colors.light.languageSpecificColors.js, { 'codeblock.borderColor': '#100' });
  assert.deepEqual(s.SelectedTheme.colors.dark.codeblock.languageBorderColors, {});
  assert.deepEqual(s.SelectedTheme.colors.light.codeblock.languageBorderColors, {});
  assert.equal(saved, 1);
});

test('snapshot colors: theme colors, overridden by language specific colors', () => {
  const s = settings();
  Object.assign(s.SelectedTheme.colors.dark.codeblock, { backgroundColor: '#000001' });
  Object.assign(s.SelectedTheme.colors.dark.gutter, { backgroundColor: '#000002' });
  s.SelectedTheme.colors.dark.languageSpecificColors = { js: { 'codeblock.backgroundColor': '#00000a' } };
  assert.deepEqual(getSnapshotColors(s, 'py'), { gutterBgColor: '#000002', codeBgColor: '#000001' });
  assert.deepEqual(getSnapshotColors(s, 'JS'), { gutterBgColor: '#000002', codeBgColor: '#00000a' });
});

test('syntax themes: global and language specific variables and token rules, nothing without a theme', () => {
  const s = settings();
  assert.equal(generateSyntaxThemeStyles(s), '');

  s.SyntaxThemes = {
    Mine: { colors: { light: { keyword: '#l1', comment: '' }, dark: { keyword: '#d1' } } },
    Other: { colors: { light: { string: '#l2' }, dark: { string: '#d2' } } },
  };
  s.pluginSettings.syntaxThemes.globalSyntaxTheme = 'Mine';
  s.pluginSettings.syntaxThemes.languageSpecificSyntaxThemes = { Python: 'Other', go: 'Missing' };
  const css = generateSyntaxThemeStyles(s);

  assert.match(css, /theme-light \{ --cbc-syntax-keyword: #l1; --cbc-syntax-python-string: #l2; \}/);
  assert.match(css, /theme-dark \{ --cbc-syntax-keyword: #d1; --cbc-syntax-python-string: #d2; \}/);
  assert.match(css, /\.print body \{ --cbc-syntax-keyword: #d1; --cbc-syntax-python-string: #d2; \}/, 'print uses the current mode colors');
  assert.match(css, /\.codeblock-customizer-language-python \.codeblock-customizer-line-text \.token\.string/);
  assert.doesNotMatch(css, /--cbc-syntax-comment:|-go-/, 'empty colors and missing themes are skipped');
});
