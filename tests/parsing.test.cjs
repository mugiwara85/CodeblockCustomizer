/* eslint-disable @typescript-eslint/no-require-imports -- Use Node built-in test runner with bundled TypeScript helpers. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load.cjs');

const parsingPromise = Promise.resolve(load('src/Parsing.ts'));

function makeSettings({ altColors = ['info', 'Warn'], excludeLangs = '', lineSeparator = '', textSeparator = '', html = false, customPrompts = {} } = {}) {
  const colors = {
    codeblock: { alternateHighlightColors: Object.fromEntries(altColors.map(name => [name, {}])) },
    languageSpecificColors: {},
  };
  return {
    ExcludeLangs: excludeLangs,
    pluginSettings: {
      common: { enableHtmlCodeBlocks: html },
      textHighlight: { lineSeparator, textSeparator },
      prompts: { customPrompts, editedDefaults: {} },
    },
    SelectedTheme: { colors: { dark: colors, light: colors } },
  };
}

async function parse(line, settingsOptions, isReadingView = false) {
  const { getAllParameters } = await parsingPromise;
  return getAllParameters(line, makeSettings(settingsOptions), isReadingView);
}

const w = (text, occurrences = []) => ({ text, occurrences });
const noLines = { lineNumbers: [], words: [], lineSpecificWords: [] };
const noText = { allWordsInLine: [], words: [], lineSpecificWords: [], textBetween: [], lineSpecificTextBetween: [] };

// ---------------------------------------------------------------- fence, language, indentation

test('fence character, count and language', async () => {
  let p = await parse('```cpp');
  assert.equal(p.fenceChar, '`');
  assert.equal(p.fenceCount, 3);
  assert.equal(p.language, 'cpp');
  assert.equal(p.displayLanguage, 'C++');

  p = await parse('~~~~python');
  assert.equal(p.fenceChar, '~');
  assert.equal(p.fenceCount, 4);
  assert.equal(p.language, 'python');

  p = await parse('```');
  assert.equal(p.language, '');
  assert.equal(p.displayLanguage, 'Plain text');

  p = await parse('```mylang');
  assert.equal(p.displayLanguage, 'Mylang');
});

test('no language when the first word is a parameter or a flag', async () => {
  assert.equal((await parse('```hl:1')).language, '');
  assert.equal((await parse('```title=x')).language, '');
  assert.equal((await parse('```fold')).language, '');
  assert.equal((await parse('```unfold')).language, '');
  assert.equal((await parse('```expand')).language, '');
});

test('run- prefix is removed from the language only in reading view', async () => {
  assert.equal((await parse('```run-python', {}, true)).language, 'python');
  assert.equal((await parse('```run-python', {}, false)).language, 'run-python');
});

test('indentation with spaces and tabs', async () => {
  let p = await parse('```js');
  assert.deepEqual([p.indentLevel, p.indentCharacter], [0, 0]);
  p = await parse('    ```js');
  assert.deepEqual([p.indentLevel, p.indentCharacter], [1, 4]);
  p = await parse('\t```js');
  assert.deepEqual([p.indentLevel, p.indentCharacter], [1, 1]);
  p = await parse('        ```js');
  assert.deepEqual([p.indentLevel, p.indentCharacter], [2, 8]);
  assert.equal(p.language, 'js');
});

test('parameters can be defined with : or = and keys are case-insensitive', async () => {
  assert.deepEqual((await parse('```cpp hl=5')).defaultLinesToHighlight.lineNumbers, [5]);
  assert.deepEqual((await parse('```cpp HL:5')).defaultLinesToHighlight.lineNumbers, [5]);
  assert.equal((await parse('```cpp Title:x')).headerDisplayText, 'x');
});

test('HTML code block opening line is parsed like a fence line when enabled', async () => {
  const line = '<pre><code class="language-python" data-cbc="title:example.py hl:2">';
  const on = await parse(line, { html: true });
  assert.equal(on.language, 'python');
  assert.equal(on.headerDisplayText, 'example.py');
  assert.deepEqual(on.defaultLinesToHighlight.lineNumbers, [2]);

  const off = await parse(line, { html: false });
  assert.equal(off.language, '');
  assert.equal(off.hasTitle, false);
});

// ---------------------------------------------------------------- flags

test('fold, unfold, expand, output flags', async () => {
  let p = await parse('```cpp');
  assert.deepEqual([p.fold, p.unfold, p.expand, p.output], [false, false, false, false]);
  p = await parse('```cpp fold unfold expand output');
  assert.deepEqual([p.fold, p.unfold, p.expand, p.output], [true, true, true, true]);
  assert.equal((await parse('```fold')).fold, true);
  assert.equal((await parse('```cpp fold title:x')).fold, true);
  assert.equal((await parse('```cpp FOLD')).fold, true);
  assert.equal((await parse('```cpp folded')).fold, false);
});

test('exclude flag and excluded languages with wildcards', async () => {
  assert.equal((await parse('```cpp exclude')).exclude, true);
  assert.equal((await parse('```cpp')).exclude, false);
  assert.equal((await parse('```python', { excludeLangs: 'py*, js' })).exclude, true);
  assert.equal((await parse('```JS', { excludeLangs: 'py*, js' })).exclude, true);
  assert.equal((await parse('```cpp', { excludeLangs: 'py*, js' })).exclude, false);
  assert.equal((await parse('```', { excludeLangs: '*' })).exclude, false);
});

// ---------------------------------------------------------------- file / title

test('file and title', async () => {
  let p = await parse('```cpp');
  assert.equal(p.hasTitle, false);
  assert.equal(p.headerDisplayText, '');

  p = await parse('```cpp file:test.cpp');
  assert.equal(p.hasTitle, true);
  assert.equal(p.headerDisplayText, 'test.cpp');

  assert.equal((await parse('```cpp title:test.py')).headerDisplayText, 'test.py');
  assert.equal((await parse('```cpp title:b file:a')).headerDisplayText, 'a');
  assert.equal((await parse('```cpp file:"long filename.cpp"')).headerDisplayText, 'long filename.cpp');
  assert.equal((await parse("```cpp file:'single quoted'")).headerDisplayText, 'single quoted');
  assert.equal((await parse('```cpp file:"Hello \\" World!"')).headerDisplayText, 'Hello " World!');
  assert.equal((await parse('```cpp file:say\\"hi')).headerDisplayText, 'say"hi');
  assert.equal((await parse('```cpp title:"a","b"')).headerDisplayText, 'a');
});

// ---------------------------------------------------------------- ln

test('ln parameter', async () => {
  let p = await parse('```cpp');
  assert.deepEqual([p.showNumbers, p.isSpecificNumber, p.lineNumberOffset, p.lineNumberJumps], ['', false, 0, []]);

  p = await parse('```cpp ln:true');
  assert.deepEqual([p.showNumbers, p.isSpecificNumber], ['specific', false]);
  p = await parse('```cpp ln:FALSE');
  assert.deepEqual([p.showNumbers, p.isSpecificNumber], ['hide', false]);

  p = await parse('```cpp ln:5');
  assert.deepEqual([p.showNumbers, p.isSpecificNumber, p.lineNumberOffset], ['specific', true, 4]);
  assert.equal((await parse('```cpp ln:0')).lineNumberOffset, -1);

  p = await parse('```cpp ln:10:20');
  assert.deepEqual([p.isSpecificNumber, p.lineNumberOffset], [true, 0]);
  assert.deepEqual(p.lineNumberJumps, [{ lineNumber: 10, newStartNumber: 20 }]);

  p = await parse('```cpp ln:5,10:50,3:7,8');
  assert.equal(p.lineNumberOffset, 4);
  assert.deepEqual(p.lineNumberJumps, [{ lineNumber: 3, newStartNumber: 7 }, { lineNumber: 10, newStartNumber: 50 }]);

  p = await parse('```cpp ln:abc');
  assert.deepEqual([p.showNumbers, p.isSpecificNumber], ['', false]);
});

// ---------------------------------------------------------------- hl (line highlight)

test('hl: numbers, ranges, lists, duplicates', async () => {
  const hl = async v => (await parse(`\`\`\`cpp hl:${v}`)).defaultLinesToHighlight;
  assert.deepEqual(await hl('5'), { ...noLines, lineNumbers: [5] });
  assert.deepEqual(await hl('5-7'), { ...noLines, lineNumbers: [5, 6, 7] });
  assert.deepEqual(await hl('1,3,4-6'), { ...noLines, lineNumbers: [1, 3, 4, 5, 6] });
  assert.deepEqual(await hl('6,1,3,1,2-3'), { ...noLines, lineNumbers: [1, 2, 3, 6] });
  assert.deepEqual(await hl('7-5'), noLines);
  assert.deepEqual(await hl('"1,2,3"'), { ...noLines, lineNumbers: [1, 2, 3] }); // backward compatibility
  assert.deepEqual(await hl('"5 - 7"'), { ...noLines, lineNumbers: [5, 6, 7] });
  assert.deepEqual((await parse('```cpp')).defaultLinesToHighlight, noLines);
});

test('hl: words and line specific words', async () => {
  const hl = async v => (await parse(`\`\`\`cpp hl:${v}`)).defaultLinesToHighlight;
  assert.deepEqual(await hl('test'), { ...noLines, words: ['test'] });
  assert.deepEqual(await hl('"hello world"'), { ...noLines, words: ['hello world'] });
  assert.deepEqual(await hl('5|test'), { ...noLines, lineSpecificWords: [{ lineNumber: 5, words: ['test'] }] });
  assert.deepEqual(await hl('5-6|test'), {
    ...noLines,
    lineSpecificWords: [{ lineNumber: 5, words: ['test'] }, { lineNumber: 6, words: ['test'] }],
  });
  assert.deepEqual(await hl('5|a,5|b'), { ...noLines, lineSpecificWords: [{ lineNumber: 5, words: ['a', 'b'] }] });
  assert.deepEqual(await hl('5|"a,b"'), { ...noLines, lineSpecificWords: [{ lineNumber: 5, words: ['a,b'] }] });
  assert.deepEqual(await hl('5-6|"a,b"'), {
    ...noLines,
    lineSpecificWords: [{ lineNumber: 5, words: ['a,b'] }, { lineNumber: 6, words: ['a,b'] }],
  });
});

test('hl: quoted comma as a word', async () => {
  const hl = async v => (await parse(`\`\`\`cpp hl:${v}`)).defaultLinesToHighlight;
  assert.deepEqual(await hl('","'), { ...noLines, words: [','] });
  assert.deepEqual(await hl('",",x,2'), { ...noLines, lineNumbers: [2], words: [',', 'x'] });
  assert.deepEqual(await hl('5|","'), { ...noLines, lineSpecificWords: [{ lineNumber: 5, words: [','] }] });
  assert.deepEqual(await hl('"1,2,3"'), { ...noLines, lineNumbers: [1, 2, 3] }); // backward compatibility still works
});

test('hl: README combined example', async () => {
  const p = await parse('```cpp hl:test,3,5-6,9|abc,test1,test2,10-15|test3');
  assert.deepEqual(p.defaultLinesToHighlight, {
    lineNumbers: [3, 5, 6],
    words: ['test', 'test1', 'test2'],
    lineSpecificWords: [
      { lineNumber: 9, words: ['abc'] },
      ...[10, 11, 12, 13, 14, 15].map(lineNumber => ({ lineNumber, words: ['test3'] })),
    ],
  });
});

test('hlo highlights execute code output lines', async () => {
  const p = await parse('```python hlo:2,out');
  assert.deepEqual(p.outputLinesToHighlight, { ...noLines, lineNumbers: [2], words: ['out'] });
  assert.deepEqual(p.defaultLinesToHighlight, noLines);
});

// ---------------------------------------------------------------- hlt (text highlight)

test('hlt: words, all words in line, line specific words', async () => {
  const hlt = async v => (await parse(`\`\`\`cpp hlt:${v}`)).defaultTextToHighlight;
  assert.deepEqual(await hlt('test'), { ...noText, words: [w('test')] });
  assert.deepEqual(await hlt('5'), { ...noText, allWordsInLine: [5] });
  assert.deepEqual(await hlt('5-7,2'), { ...noText, allWordsInLine: [2, 5, 6, 7] });
  assert.deepEqual(await hlt('9|print'), { ...noText, lineSpecificWords: [{ lineNumber: 9, words: [w('print')] }] });
  assert.deepEqual(await hlt('6-7|print'), {
    ...noText,
    lineSpecificWords: [{ lineNumber: 6, words: [w('print')] }, { lineNumber: 7, words: [w('print')] }],
  });
  assert.deepEqual((await parse('```cpp')).defaultTextToHighlight, noText);
});

test('hlt: text between', async () => {
  const hlt = async v => (await parse(`\`\`\`cpp hlt:${v}`)).defaultTextToHighlight;
  assert.deepEqual(await hlt('abc:xyz'), { ...noText, textBetween: [{ from: 'abc', to: 'xyz', occurrences: [] }] });
  assert.deepEqual(await hlt('abc:'), { ...noText, textBetween: [{ from: 'abc', to: '', occurrences: [] }] });
  assert.deepEqual(await hlt(':xyz'), { ...noText, textBetween: [{ from: '', to: 'xyz', occurrences: [] }] });
  assert.deepEqual(await hlt('5|abc:xyz'), {
    ...noText,
    lineSpecificTextBetween: [{ lineNumber: 5, from: 'abc', to: 'xyz', occurrences: [] }],
  });
  assert.deepEqual(await hlt('5-6|abc:'), {
    ...noText,
    lineSpecificTextBetween: [
      { lineNumber: 5, from: 'abc', to: '', occurrences: [] },
      { lineNumber: 6, from: 'abc', to: '', occurrences: [] },
    ],
  });
});

test('hlt: occurrences', async () => {
  const hlt = async v => (await parse(`\`\`\`cpp hlt:${v}`)).defaultTextToHighlight;
  assert.deepEqual(await hlt('5[2,5-8]|test'), { ...noText, lineSpecificWords: [{ lineNumber: 5, words: [w('test', [2, 5, 6, 7, 8])] }] });
  assert.deepEqual(await hlt('5[1,3-5,-1]|test'), { ...noText, lineSpecificWords: [{ lineNumber: 5, words: [w('test', [-1, 1, 3, 4, 5])] }] });
  assert.deepEqual(await hlt('5-6[2]|test'), {
    ...noText,
    lineSpecificWords: [{ lineNumber: 5, words: [w('test', [2])] }, { lineNumber: 6, words: [w('test', [2])] }],
  });
  assert.deepEqual(await hlt('[2]|test'), { ...noText, words: [w('test', [2])] });
  assert.deepEqual(await hlt('5[1]|abc:xyz'), {
    ...noText,
    lineSpecificTextBetween: [{ lineNumber: 5, from: 'abc', to: 'xyz', occurrences: [1] }],
  });
  assert.deepEqual(await hlt('5[1,2]|a,5|b'), {
    ...noText,
    lineSpecificWords: [{ lineNumber: 5, words: [w('a', [1, 2]), w('b')] }],
  });
});

test('hlt: quotes, escaped quotes and commas', async () => {
  const hlt = async v => (await parse(`\`\`\`cpp hlt:${v}`)).defaultTextToHighlight;
  assert.deepEqual(await hlt('"hello world"'), { ...noText, words: [w('hello world')] });
  assert.deepEqual(await hlt('","'), { ...noText, words: [w(',')] });
  assert.deepEqual(await hlt('"a,b",c'), { ...noText, words: [w('a,b'), w('c')] });
  assert.deepEqual(await hlt('\\"'), { ...noText, words: [w('"')] });
  assert.deepEqual(await hlt("\\'"), { ...noText, words: [w("'")] });
  assert.deepEqual(await hlt('/'), { ...noText, words: [w('/')] });
  assert.deepEqual(await hlt('.'), { ...noText, words: [w('.')] });
  assert.deepEqual(await hlt('start\\"text:end\\"text'), { ...noText, textBetween: [{ from: 'start"text', to: 'end"text', occurrences: [] }] });
  assert.deepEqual(await hlt('"start \\" text:end \\" text"'), { ...noText, textBetween: [{ from: 'start " text', to: 'end " text', occurrences: [] }] });
});

test('hlto highlights execute code output text', async () => {
  const p = await parse('```python hlto:3|err');
  assert.deepEqual(p.outputTextToHighlight, { ...noText, lineSpecificWords: [{ lineNumber: 3, words: [w('err')] }] });
  assert.deepEqual(p.defaultTextToHighlight, noText);
});

// ---------------------------------------------------------------- lsep / tsep

test('lsep and tsep redefine the separators, only the first character is used', async () => {
  let p = await parse('```cpp hlt:5^|ˇ: lsep:^ tsep:ˇ');
  assert.deepEqual([p.lineSeparator, p.textSeparator], ['^', 'ˇ']);
  assert.deepEqual(p.defaultTextToHighlight, { ...noText, lineSpecificTextBetween: [{ lineNumber: 5, from: '|', to: ':', occurrences: [] }] });

  p = await parse('```cpp hlt:a|b lsep:#');
  assert.deepEqual(p.defaultTextToHighlight, { ...noText, words: [w('a|b')] });

  p = await parse('```cpp lsep:"#!" tsep:~~');
  assert.deepEqual([p.lineSeparator, p.textSeparator], ['#', '~']);

  p = await parse('```cpp');
  assert.deepEqual([p.lineSeparator, p.textSeparator], ['|', ':']);
});

test('global separators from settings, parameters override them', async () => {
  let p = await parse('```cpp hlt:2#a;b', { lineSeparator: '#', textSeparator: ';' });
  assert.deepEqual(p.defaultTextToHighlight, { ...noText, lineSpecificTextBetween: [{ lineNumber: 2, from: 'a', to: 'b', occurrences: [] }] });

  p = await parse('```cpp lsep:@', { lineSeparator: '#' });
  assert.equal(p.lineSeparator, '@');
});

// ---------------------------------------------------------------- alternative colors

test('alternative colors: line and text highlight, output variants', async () => {
  const p = await parse('```cpp info:2,foo infot:5|bar infoo:3 infoto:baz warnt:a:b');
  assert.deepEqual(p.alternativeLinesToHighlight, {
    lines: [{ lineNumbers: [2], colorName: 'info' }],
    words: [{ words: ['foo'], colorName: 'info' }],
    lineSpecificWords: [],
    outputLines: [{ lineNumbers: [3], colorName: 'info' }],
    outputWords: [],
    outputLineSpecificWords: [],
  });
  const t = p.alternativeTextToHighlight;
  assert.deepEqual(t.lineSpecificWords, [{ lineNumber: 5, words: [w('bar')], colorName: 'info' }]);
  assert.deepEqual(t.outputWords, [{ words: [w('baz')], colorName: 'info' }]);
  assert.deepEqual(t.textBetween, [{ from: 'a', to: 'b', occurrences: [], colorName: 'Warn' }]);
  assert.deepEqual(p.defaultLinesToHighlight, noLines);
});

test('alternative colors: names are case-insensitive, unknown colors are ignored', async () => {
  const p = await parse('```cpp WARN:4-5 error:1');
  assert.deepEqual(p.alternativeLinesToHighlight.lines, [{ lineNumbers: [4, 5], colorName: 'Warn' }]);
});

test('alternative colors: quoted comma as text (impt="," from #165)', async () => {
  const p = await parse('```cpp impt=","', { altColors: ['imp'] });
  assert.deepEqual(p.alternativeTextToHighlight.words, [{ words: [w(',')], colorName: 'imp' }]);
});

// ---------------------------------------------------------------- prompt / parse / noprompt / noparse

test('prompt with and without lines, prompt values', async () => {
  let p = await parse('```bash prompt:kali');
  assert.deepEqual([p.prompt.lineNumbers, p.prompt.text], [[], 'kali']);

  p = await parse('```bash prompt:1-2,4|bash');
  assert.deepEqual([p.prompt.lineNumbers, p.prompt.text], [[1, 2, 4], 'bash']);

  p = await parse('```bash prompt:bash user:root host:"my host" path:/tmp db:pg branch:main module:exploit');
  assert.deepEqual(p.prompt.values, { user: 'root', host: 'my host', path: '/tmp', db: 'pg', branch: 'main', module: 'exploit' });

  p = await parse('```bash');
  assert.deepEqual(p.prompt, { lineNumbers: [], text: '', values: { user: null, host: null, path: null, db: null, branch: null, module: null } });
});

test('parse, auto-parse by language, noparse', async () => {
  const customPrompts = { myshell: { name: 'myshell', basePrompt: '$', isWindowsShell: false, autoParsePrompt: true, autoParseLanguages: ['shell'] } };
  assert.equal((await parse('```bash parse:bash')).parsePromptId, 'bash');
  assert.equal((await parse('```bash')).parsePromptId, null);
  assert.equal((await parse('```shell', { customPrompts })).parsePromptId, 'myshell');
  assert.equal((await parse('```shell parse:zsh', { customPrompts })).parsePromptId, 'zsh');

  let p = await parse('```shell noparse', { customPrompts });
  assert.deepEqual([p.parsePromptId, p.noParse, p.noParseLines], [null, true, []]);

  p = await parse('```shell noparse:1-2', { customPrompts });
  assert.deepEqual(p.noParseLines, [1, 2]);
});

test('noprompt with and without lines', async () => {
  let p = await parse('```bash noprompt');
  assert.deepEqual([p.noPrompt, p.noPromptLines], [true, []]);
  p = await parse('```bash noprompt:1-3,5');
  assert.deepEqual(p.noPromptLines, [1, 2, 3, 5]);
  p = await parse('```bash');
  assert.deepEqual([p.noPrompt, p.noPromptLines], [false, []]);
});

// ---------------------------------------------------------------- hide, group, tab

test('hide, group, tab', async () => {
  const p = await parse('```cpp hide:3,5,7-10 group:g1 tab:"My Tab"');
  assert.deepEqual(p.hideLines, [3, 5, 7, 8, 9, 10]);
  assert.equal(p.group, 'g1');
  assert.equal(p.tab, 'My Tab');

  const empty = await parse('```cpp');
  assert.deepEqual([empty.hideLines, empty.group, empty.tab], [[], '', '']);
});

// ---------------------------------------------------------------- inline code

test('inline code: language and background class', async () => {
  const { parseInlineCodeHighlightParams, getInlineCodeBgClass } = await parsingPromise;
  const settings = makeSettings();
  const inline = s => parseInlineCodeHighlightParams(s, settings);

  assert.deepEqual([inline('cpp').language, inline('cpp').backgroundColorClass], ['cpp', null]);
  assert.deepEqual([inline('cpp hl').language, inline('cpp hl').backgroundColorClass], ['cpp', '']);
  assert.deepEqual([inline('hl cpp').language, inline('hl cpp').backgroundColorClass], ['cpp', '']);
  assert.deepEqual([inline('cpp warn').language, inline('cpp warn').backgroundColorClass], ['cpp', 'warn']);
  assert.deepEqual([inline('').language, inline('').backgroundColorClass], [null, null]);

  assert.equal(getInlineCodeBgClass(''), 'codeblock-customizer-inline-code-highlighted');
  assert.equal(getInlineCodeBgClass('My Color'), 'codeblock-customizer-inline-code-highlighted-my-color');
});

test('inline code: text highlight and alternative text highlight', async () => {
  const { parseInlineCodeHighlightParams } = await parsingPromise;
  const p = parseInlineCodeHighlightParams('cpp hlt:foo,a:b infot:"x y"', makeSettings());
  assert.equal(p.language, 'cpp');
  assert.deepEqual(p.textHighlight, { ...noText, words: [w('foo')], textBetween: [{ from: 'a', to: 'b', occurrences: [] }] });
  assert.deepEqual(p.alternativeTextHighlights, [{ colorName: 'info', highlight: { ...noText, words: [w('x y')] } }]);
});

// ---------------------------------------------------------------- #165: dashes and digits as text

test('#165 dash: words containing a dash are text, not ranges', async () => {
  const hlt = async v => (await parse(`\`\`\`cpp hlt:${v}`)).defaultTextToHighlight;
  assert.deepEqual(await hlt('-'), { ...noText, words: [w('-')] });
  assert.deepEqual(await hlt('foo-bar'), { ...noText, words: [w('foo-bar')] });
  assert.deepEqual(await hlt('--verbose'), { ...noText, words: [w('--verbose')] });
  assert.deepEqual(await hlt('-5'), { ...noText, words: [w('-5')] });
  assert.deepEqual(await hlt('"-"'), { ...noText, words: [w('-')] });
  assert.deepEqual(await hlt('3|-'), { ...noText, lineSpecificWords: [{ lineNumber: 3, words: [w('-')] }] });
  assert.deepEqual(await hlt('-:x'), { ...noText, textBetween: [{ from: '-', to: 'x', occurrences: [] }] });

  const hl = async v => (await parse(`\`\`\`cpp hl:${v}`)).defaultLinesToHighlight;
  assert.deepEqual(await hl('foo-bar,2-3'), { ...noLines, lineNumbers: [2, 3], words: ['foo-bar'] });
  assert.deepEqual(await hl('-'), { ...noLines, words: ['-'] });
  assert.deepEqual(await hl('5-'), { ...noLines, words: ['5-'] }); // was an empty range before #165

  const { parseInlineCodeHighlightParams } = await parsingPromise;
  assert.deepEqual(parseInlineCodeHighlightParams('cpp hlt:a-b', makeSettings()).textHighlight, { ...noText, words: [w('a-b')] });
});

test('#165 digits: a backslash escaped number or range is text', async () => {
  const hlt = async v => (await parse(`\`\`\`cpp hlt:${v}`)).defaultTextToHighlight;
  assert.deepEqual(await hlt('\\5'), { ...noText, words: [w('5')] });
  assert.deepEqual(await hlt('\\42,7'), { ...noText, allWordsInLine: [7], words: [w('42')] });
  assert.deepEqual(await hlt('\\1-3'), { ...noText, words: [w('1-3')] });
  assert.deepEqual(await hlt('\\n'), { ...noText, words: [w('\\n')] }); // not a number, backslash is kept
  assert.deepEqual(await hlt('3|5'), { ...noText, lineSpecificWords: [{ lineNumber: 3, words: [w('5')] }] });

  const hl = async v => (await parse(`\`\`\`cpp hl:${v}`)).defaultLinesToHighlight;
  assert.deepEqual(await hl('\\5,5'), { ...noLines, lineNumbers: [5], words: ['5'] });
});
