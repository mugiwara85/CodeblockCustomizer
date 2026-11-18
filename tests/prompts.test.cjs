/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test file. */
// Terminal prompts: prompt lines, simulated shell commands, prompt definitions (built-in, edited, custom, on-the-fly) and parsing of raw CLI output
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load.cjs');

const { getAllParameters, PromptManager, getPromptDefinition, getPromptType, DEFAULT_SETTINGS } = load('src/Parsing.ts', 'src/PromptManager.ts', 'src/PromptUtils.ts', 'src/Settings.ts');

function settings({ customPrompts = {}, editedDefaults = {} } = {}) {
  const s = structuredClone(DEFAULT_SETTINGS);
  Object.assign(s.pluginSettings.prompts, { customPrompts, editedDefaults });
  return s;
}
function manager(fence, totalLines, s = settings()) {
  return new PromptManager(getAllParameters(fence, s), totalLines, s);
}
// prompt shown in front of each line, and the simulated output of pwd / whoami
function session(fence, lines, s) {
  const m = manager(fence, lines.length, s);
  return lines.map(line => {
    const { prompt, output } = m.getPromptAndOutputTextForLine(line);
    return output.length > 0 ? [prompt, output] : prompt;
  });
}
const custom = (name, extra = {}) => ({ [name]: { name, basePrompt: '$', isWindowsShell: false, ...extra } });

test('prompt lines: all lines, given lines, noprompt, line number offset', () => {
  assert.deepEqual([...manager('```bash prompt:bash', 3).promptLines], [1, 2, 3]);
  assert.deepEqual([...manager('```bash prompt:1,3|bash', 3).promptLines], [1, 3]);
  assert.deepEqual([...manager('```bash prompt:bash noprompt:2', 3).promptLines], [1, 3]);
  assert.deepEqual([...manager('```bash prompt:bash noprompt', 3).promptLines], []);
  assert.deepEqual([...manager('```bash prompt:bash ln:5', 3).promptLines], [5, 6, 7]);
  assert.deepEqual([...manager('```bash', 3).promptLines], []);
});

test('auto-use prompt by language', () => {
  const s = settings({ customPrompts: custom('auto', { autoUsePrompt: true, autoUseLanguages: ['shell'] }) });
  assert.deepEqual([...manager('```shell', 2, s).promptLines], [1, 2]);
  assert.deepEqual([...manager('```bash', 2, s).promptLines], []);
});

test('bash: cd, cd -, pwd, su, whoami, exit, root prompt', () => {
  assert.deepEqual(session('```bash prompt:bash', ['cd /tmp', 'pwd', 'cd -', 'su', 'whoami', 'exit', 'cd ../..', 'cd ~/docs', 'x']), [
    'user@localhost:~/$',
    ['user@localhost:/tmp$', ['/tmp']],
    'user@localhost:/tmp$',
    'user@localhost:~/$',
    ['root@localhost:~/#', ['root']],
    'root@localhost:~/#',
    'user@localhost:~/$',
    'user@localhost:/$',
    'user@localhost:~/docs$',
  ]);
});

test('prompt values from parameters', () => {
  assert.deepEqual(session('```bash prompt:bash user:root host:box path:/srv', ['x']), ['root@box:/srv#']);
});

test('git branch, database and metasploit module switches', () => {
  assert.deepEqual(session('```bash prompt:zshgit', ['git checkout dev', 'git switch main', 'x']),
    ['➜ ~/projects git:(main) ✗', '➜ ~/projects git:(dev) ✗', '➜ ~/projects git:(main) ✗']);
  assert.deepEqual(session('```sql prompt:postgres', ['\\c mydb', 'x']), ['postgres=#', 'mydb=#']);
  assert.deepEqual(session('```sql prompt:postgres db:shop', ['x']), ['shop=#']);
  assert.deepEqual(session('```msf prompt:msf module:""', ['use exploit/multi/handler', 'x']), ['msf6 >', 'msf6 exploit(multi/handler) >']);
});

test('windows paths: drives, root relative, quoted, UNC', () => {
  assert.deepEqual(session('```ps prompt:ps', ['cd ..', 'cd D:\\work', 'cd \\temp', 'cd "C:\\Program Files"', 'cd \\\\srv\\share\\a', 'x']), [
    'PS C:\\Users\\Administrator>',
    'PS C:\\Users>',
    'PS D:\\work>',
    'PS D:\\temp>',
    'PS C:\\Program Files>',
    'PS \\\\srv\\share\\a>',
  ]);
});

test('on-the-fly template and plain prompts', () => {
  assert.equal(getPromptType('bash'), 'predefined');
  assert.equal(getPromptType('{user}@{host}>'), 'template');
  assert.equal(getPromptType('>'), 'plain');
  assert.deepEqual(session('```bash prompt:"{user}@{host}>" user:bob', ['x']), ['bob@localhost>']);
  assert.deepEqual(session('```bash prompt:">"', ['x']), ['>']);
});

test('prompt definitions: edited built-in, custom (case-insensitive, #188), regex stored as string', () => {
  const s = settings({
    editedDefaults: { bash: { basePrompt: '{user}>' } },
    customPrompts: custom('MyShell', { basePrompt: '{user}%', parsePromptRegexString: '^(?<user>\\w+)%\\s*' }),
  });
  assert.deepEqual(session('```bash prompt:bash', ['x'], s), ['user>']);
  assert.deepEqual(getPromptDefinition('bash', settings()).def.basePrompt, '{user}@{host}:{path}$', 'edits are not stored in the defaults');

  const { def, isCustom } = getPromptDefinition('myshell', s);
  assert.equal(isCustom, true);
  assert.equal(def.parsePromptRegex.source, '^(?<user>\\w+)%\\s*');
  assert.deepEqual(session('```sh prompt:MYSHELL', ['x'], s), ['user%']);

  const invalid = settings({ customPrompts: custom('bad', { parsePromptRegexString: '(' }) });
  assert.equal(getPromptDefinition('bad', invalid).def.parsePromptRegex, undefined);

  assert.deepEqual(getPromptDefinition('unknown', settings()), { def: { name: 'unknown', basePrompt: 'unknown', isWindowsShell: false }, isCustom: false });
});

test('parse mode: prompt in raw output is styled, root detected, noparse lines skipped', () => {
  const m = manager('```bash parse:bash noparse:2', 3);
  assert.deepEqual([...m.promptLines], [], 'no prompt is added in parse mode');

  const root = m.renderLine('root@srv:/etc# ls', 1);
  assert.equal(root.matchedLength, 'root@srv:/etc# '.length);
  assert.equal(root.isRoot, true);
  assert.equal(root.lineClassName, 'codeblock-customizer-prompt-bash');
  assert.deepEqual(root.styledParts.slice(0, 3), [
    { from: 0, to: 4, className: 'prompt-part prompt-user' },
    { from: 4, to: 5, className: 'prompt-part prompt-at' },
    { from: 5, to: 8, className: 'prompt-part prompt-host' },
  ]);

  const empty = { styledParts: [], output: [], matchedLength: 0, lineClassName: null, isRoot: false };
  assert.deepEqual(m.renderLine('user@x:~$ ignored', 2), empty);
  assert.deepEqual(m.renderLine('plain output', 3), empty);

  const user = manager('```bash parse:bash', 1).renderLine('user@srv:~$ ls', 1);
  assert.equal(user.isRoot, false);
});
