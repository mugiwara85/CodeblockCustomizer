/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test file. */
// CSS classes set on <body> from the settings
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load.cjs');

const { updateSettingClasses, DEFAULT_SETTINGS } = load('src/Utils.ts', 'src/Settings.ts');

// the body classes the settings give, starting from the given classes
function bodyClasses(change, initial = []) {
  const classes = new Set(initial);
  const body = { classList: { add: (...names) => names.forEach(n => classes.add(n)), remove: (...names) => names.forEach(n => classes.delete(n)), contains: n => classes.has(n) } };
  const original = globalThis.document;
  globalThis.document = globalThis.activeDocument = { ...original, body };
  try {
    const settings = structuredClone(DEFAULT_SETTINGS.pluginSettings);
    change(settings);
    updateSettingClasses(settings);
  } finally {
    globalThis.document = globalThis.activeDocument = original;
  }
  return [...classes].filter(n => n.startsWith('codeblock-customizer')).map(n => n.replace('codeblock-customizer-', '')).sort();
}
const has = (classes, ...names) => names.every(n => classes.includes(n));

test('body classes: active line highlight inside, outside or both, language names always or on hover', () => {
  const activeLine = (editor, codeblock) => bodyClasses(s => { s.enableEditorActiveLineHighlight = editor; s.codeblock.enableActiveLineHighlight = codeblock; }).filter(n => n.startsWith('active-line'));
  assert.deepEqual(activeLine(true, true), ['active-line-highlight']);
  assert.deepEqual(activeLine(true, false), ['active-line-highlight-editor']);
  assert.deepEqual(activeLine(false, true), ['active-line-highlight-codeblock']);
  assert.deepEqual(activeLine(false, false), []);

  const langNames = (display, always) => bodyClasses(s => { s.header.displayCodeBlockLanguage = display; s.header.alwaysDisplayCodeblockLang = always; }).filter(n => n.startsWith('show-langnames'));
  assert.deepEqual(langNames(true, true), ['show-langnames-always']);
  assert.deepEqual(langNames(true, false), ['show-langnames']);
  assert.deepEqual(langNames(false, true), []);
});

test('body classes: exactly one class per style option, double-line is "doubleline", "both" semi-fold effect sets both', () => {
  const classes = bodyClasses(s => {
    s.header.collapseIconPosition = 'middle';
    s.codeblock.codeBlockBorderStylingPosition = 'disable';
    s.codeblock.lineNumberSeparatorStyle = 'double-line';
    s.codeblock.hiddenLinesStyle = 'zigzag';
    s.plugins.executeCode.executeCodeSeparatorStyle = 'dashed';
    s.semiFold.semifoldEffect = 'both';
  });
  assert.deepEqual(classes.filter(n => n.startsWith('collapseIcon')), ['collapseIconMiddle']);
  assert.deepEqual(classes.filter(n => n.startsWith('style-codeblock-border')), []);
  assert.deepEqual(classes.filter(n => n.startsWith('linenumberseparator')), ['linenumberseparator-doubleline']);
  assert.deepEqual(classes.filter(n => n.startsWith('hidden-lines')), ['hidden-lines-zigzag']);
  assert.deepEqual(classes.filter(n => n.startsWith('execute-code-separator')), ['execute-code-separator-dashed']);
  assert.deepEqual(classes.filter(n => n.startsWith('semifold-effect')), ['semifold-effect-blur', 'semifold-effect-opacity']);
  assert.deepEqual(bodyClasses(s => { s.semiFold.semifoldEffect = 'blur'; }).filter(n => n.startsWith('semifold-effect')), ['semifold-effect-blur']);
});

test('body classes: turning settings off removes the classes left from before', () => {
  const everything = bodyClasses(s => {
    for (const key of Object.keys(s.codeblock.buttons)) s.codeblock.buttons[key] = true;
    Object.assign(s.codeblock, { enableLineNumbers: true, showIndentationLines: true, codeBlockBorderStylingPosition: 'left' });
    Object.assign(s.inlineCode, { enableInlineCodeStyling: true, showIcons: true });
  });
  assert.ok(has(everything, 'show-line-numbers', 'show-indentation-lines', 'style-codeblock-border-left', 'show-wrap-code-button', 'style-inline-code', 'show-inline-code-icons'));

  const off = bodyClasses(s => {
    for (const key of Object.keys(s.codeblock.buttons)) s.codeblock.buttons[key] = false;
    Object.assign(s.codeblock, { enableLineNumbers: false, showIndentationLines: false, codeBlockBorderStylingPosition: 'right' });
    Object.assign(s.inlineCode, { enableInlineCodeStyling: false, showIcons: false });
  }, everything.map(n => n === 'codeblock-customizer' ? n : `codeblock-customizer-${n}`));
  for (const name of ['show-line-numbers', 'show-indentation-lines', 'style-codeblock-border-left', 'show-wrap-code-button', 'style-inline-code', 'show-inline-code-icons']) {
    assert.ok(!off.includes(name), `${name} is removed`);
  }
  assert.ok(off.includes('style-codeblock-border-right'));
});
