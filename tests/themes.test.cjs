/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test file. */
// Color themes (light/dark), language specific colors, border colors, snapshot colors and syntax themes
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load.cjs');

const {
  getBorderColorByLanguage, getLanguageSpecificColorClass, getPropertyFromLanguageSpecificColors, mergeBorderColorsToLanguageSpecificColors,
  getSnapshotColors, generateSyntaxThemeStyles, getCurrentMode, refreshCachedMode, getAllParameters, updateSettingStyles, dropDeletedColors, DEFAULT_SETTINGS,
} = load('src/Utils.ts', 'src/SyntaxThemeUtils.ts', 'src/Parsing.ts', 'src/Settings.ts');

const settings = () => structuredClone(DEFAULT_SETTINGS);

// captures the CSS written into the <style> tag; getComputedStyle gives darkValues (the test environment is in dark mode)
function stubDocument(darkValues = {}) {
  const styleTag = { textContent: '' };
  const body = { classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, ownerDocument: { defaultView: { getComputedStyle: () => ({ getPropertyValue: name => darkValues[name] ?? '' }) } } };
  Object.assign(document, { getElementById: () => styleTag, head: {}, body });
  return styleTag;
}

test('PDF colors: light rules (used by the PDF) take light colors, or the current mode colors with "Use current theme colours"', () => {
  const styleTag = stubDocument();
  const app = { vault: { getConfig: () => '' }, workspace: { iterateAllLeaves() {} } };
  const css = (force) => {
    const s = settings();
    s.pluginSettings.printing.forceCurrentColorUse = force;
    const hl = (bg, text) => ({ backgroundColor: bg, useBackgroundColor: true, textColor: text, useTextColor: true });
    s.SelectedTheme.colors.light.codeblock.alternateHighlightColors = { red: hl('#lredbg', '#lredtext') };
    s.SelectedTheme.colors.dark.codeblock.alternateHighlightColors = { red: hl('#dredbg', '#dredtext') };
    s.SelectedTheme.colors.light.languageSpecificColors = { python: { 'codeblock.textColor': '#lpy' } };
    s.SelectedTheme.colors.dark.languageSpecificColors = { python: { 'codeblock.textColor': '#dpy' } };
    s.SelectedTheme.colors.light.annotations = { colors: { note: '#lann' } };
    s.SelectedTheme.colors.dark.annotations = { colors: { note: '#dann' } };
    updateSettingStyles(s, app);
    return styleTag.textContent;
  };
  const rule = (text, mode, cls) => text.match(new RegExp(`:where\\(body\\.theme-${mode}\\) \\.${cls}[^{]*\\{([^}]*)\\}`))?.[1] ?? '';

  const off = css(false);
  assert.match(rule(off, 'light', 'codeblock-customizer-highlighted-text-red'), /#lredtext/);
  assert.match(rule(off, 'dark', 'codeblock-customizer-highlighted-text-red'), /#dredtext/);
  assert.match(rule(off, 'light', 'codeblock-customizer-languageSpecific-python'), /#lpy/);
  assert.match(off, /theme-light \{[^}]*--codeblock-customizer-highlight-red-color: #lredbg/);
  assert.match(off, /theme-light \{ --codeblock-customizer-annotations-note-color: #lann;/);
  assert.doesNotMatch(off, /\.print body/);

  const on = css(true);
  assert.match(rule(on, 'light', 'codeblock-customizer-highlighted-text-red'), /#dredtext/);
  assert.match(rule(on, 'light', 'codeblock-customizer-languageSpecific-python'), /#dpy/);
  assert.match(on, /theme-light \{[^}]*--codeblock-customizer-highlight-red-color: #dredbg/);
  assert.match(on, /theme-light \{ --codeblock-customizer-annotations-note-color: #dann;/);
});

test('PDF colors: "Use current theme colours" in dark mode writes the dark values of Obsidian colour variables into the PDF rules', () => {
  // the dark values Obsidian gives its variables right now
  const styleTag = stubDocument({ '--text-normal': 'rgb(221, 221, 221)', '--code-normal': '#eeeeee', '--text-muted': '#999999', '--highlight-background': 'color-mix(in oklch, rgb(224, 172, 0) 30%, transparent)' });
  const app = { vault: { getConfig: () => '' }, workspace: { iterateAllLeaves() {} } };
  const css = (force) => {
    const s = settings();
    s.pluginSettings.printing.forceCurrentColorUse = force;
    s.SelectedTheme.colors.light.header.textColor = '--text-normal';
    s.SelectedTheme.colors.dark.header.textColor = '--text-normal';
    s.SelectedTheme.colors.dark.gutter.textColor = '--unknown-variable';
    updateSettingStyles(s, app);
    return styleTag.textContent;
  };
  const vars = (text, mode) => text.match(new RegExp(`body\\.codeblock-customizer\\.theme-${mode} \\{([^}]*)\\}`))?.[1] ?? '';
  try {
    const off = css(false);
    assert.match(vars(off, 'light'), /--codeblock-customizer-header-text-color: var\(--text-normal\);/, 'setting off: the PDF uses the light value of the variable');
    assert.match(vars(off, 'light'), /--codeblock-customizer-codeblock-highlight-color: var\(--text-highlight-bg, var\(--highlight-background\)\);/, 'Obsidian 1.14+ has no --text-highlight-bg: falls back to --highlight-background');
    assert.doesNotMatch(off, /body\.theme-light \.print/);

    const on = css(true);
    assert.match(vars(on, 'light'), /--codeblock-customizer-header-text-color: rgb\(221, 221, 221\);/, 'setting on: the dark value is written in');
    assert.match(vars(on, 'light'), /--codeblock-customizer-gutter-text-color: var\(--unknown-variable\);/, 'a variable without a value stays a variable');
    assert.match(vars(on, 'dark'), /--codeblock-customizer-header-text-color: var\(--text-normal\);/, 'on screen, dark mode keeps the live variable');
    assert.match(on, /body\.theme-light \.print \{ --code-normal: #eeeeee; \}/, "Obsidian's code colours in the PDF");
    assert.match(on, /body\.theme-light \.print \.codeblock-customizer-pre-parent \{ --text-normal: rgb\(221, 221, 221\); --text-muted: #999999; \}/, 'UI colours only inside code blocks');
    assert.match(vars(on, 'light'), /--codeblock-customizer-codeblock-highlight-color: color-mix\(in oklch, rgb\(224, 172, 0\) 30%, transparent\);/, 'the replacement variable gives the value, in any CSS colour format');
  } finally {
    delete document.body;
  }
});

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

test('loading settings: colors deleted in the working copy stay deleted after merging it onto the saved theme', () => {
  const { merge } = require('es-toolkit/compat');
  const hl = (bg) => ({ backgroundColor: bg, useBackgroundColor: true });
  const saved = settings().SelectedTheme;
  const working = structuredClone(saved);
  for (const mode of ['light', 'dark']) {
    // saved theme ("Update theme" was clicked while these existed)
    Object.assign(saved.colors[mode].codeblock.alternateHighlightColors, { info: hl('#1'), warn: hl('#2') });
    saved.colors[mode].languageSpecificColors = { python: { 'codeblock.backgroundColor': '#3', 'codeblock.textColor': '#4' }, js: { 'codeblock.textColor': '#5' } };
    saved.colors[mode].prompts.editedPromptColors = { bash: { 'prompt-user': '#6', 'prompt-host': '#7' }, zsh: { 'prompt-user': '#8' } };
    // working copy: info, js and zsh deleted, python text color and bash host color reset
    working.colors[mode].codeblock.alternateHighlightColors = { warn: hl('#2') };
    working.colors[mode].languageSpecificColors = { python: { 'codeblock.backgroundColor': '#3' } };
    working.colors[mode].prompts.editedPromptColors = { bash: { 'prompt-user': '#6' } };
  }
  delete working.colors.dark.prompts.editedRootPromptColors; // older data without it: nothing is dropped

  const loaded = merge({}, saved, working);
  dropDeletedColors(loaded, working);

  for (const mode of ['light', 'dark']) {
    assert.deepEqual(Object.keys(loaded.colors[mode].codeblock.alternateHighlightColors), ['warn']);
    assert.deepEqual(loaded.colors[mode].languageSpecificColors, { python: { 'codeblock.backgroundColor': '#3' } });
    assert.deepEqual(loaded.colors[mode].prompts.editedPromptColors, { bash: { 'prompt-user': '#6' } });
  }
  assert.deepEqual(loaded.colors.dark.prompts.editedRootPromptColors, saved.colors.dark.prompts.editedRootPromptColors);
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
  assert.doesNotMatch(css, /\.print body/, 'the PDF uses the light rule (Obsidian prints in light mode, .print is inside body)');
  s.pluginSettings.printing.forceCurrentColorUse = true;
  assert.match(generateSyntaxThemeStyles(s), /theme-light \{ --cbc-syntax-keyword: #d1; --cbc-syntax-python-string: #d2; \}/, '"Use current theme colours": the light (PDF) rule gets the current (dark) mode colors');
  assert.match(css, /\.codeblock-customizer-language-python \.codeblock-customizer-line-text \.token\.string/);
  assert.doesNotMatch(css, /--cbc-syntax-comment:|-go-/, 'empty colors and missing themes are skipped');
});
