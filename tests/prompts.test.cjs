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
  assert.equal(manager('```shell', 1, s).getPromptAndOutputTextForLine('x').prompt, '$', 'a fresh manager draws the auto-used prompt');
  // case-insensitive, run- prefix ignored in Live Preview too
  assert.deepEqual([...manager('```Shell', 2, s).promptLines], [1, 2]);
  assert.deepEqual([...manager('```run-shell', 2, s).promptLines], [1, 2]);
  const upper = settings({ customPrompts: custom('auto', { autoUsePrompt: true, autoUseLanguages: ['Shell', 'run-zsh'] }) });
  assert.deepEqual([...manager('```shell', 2, upper).promptLines], [1, 2]);
  assert.deepEqual([...manager('```zsh', 2, upper).promptLines], [1, 2]);
});

test('bash: cd, cd -, pwd, su, whoami, exit, root prompt', () => {
  assert.deepEqual(session('```bash prompt:bash', ['cd /tmp', 'pwd', 'cd -', 'su', 'whoami', 'exit', 'cd ../..', 'cd ~/docs', 'x']), [
    'user@localhost:~/$',
    ['user@localhost:/tmp$', ['/tmp']],
    'user@localhost:/tmp$',
    'user@localhost:~/$',
    ['root@localhost:/home/user#', ['root']], // plain su keeps the folder, which is not under root's home
    'root@localhost:/home/user#',
    'user@localhost:~/$',
    'user@localhost:/$',
    'user@localhost:~/docs$',
  ]);
});

test('bash: sudo / cdk are not su / cd, su - goes home, exit returns to the folder, root home is /root', () => {
  assert.deepEqual(session('```bash prompt:bash', ['sudo apt update', 'cdk deploy', 'su -', 'cd', 'pwd', 'exit', 'su -l', 'exit', 'su - bob', 'whoami', 'x']), [
    'user@localhost:~/$',
    'user@localhost:~/$',
    'user@localhost:~/$',
    'root@localhost:~#',
    ['root@localhost:~#', ['/root']],
    'root@localhost:~#',
    'user@localhost:~/$',
    'root@localhost:~#',
    'user@localhost:~/$',
    ['bob@localhost:~$', ['bob']],
    'bob@localhost:~$',
  ]);
});

test('su: plain su keeps the folder (kali), su -c does not switch user', () => {
  assert.deepEqual(session('```bash prompt:kali', ['su', 'cd Desktop', 'pwd']), [
    '(kali㉿kali)-[~]$',
    '(root㉿kali)-[/home/kali]#',
    ['(root㉿kali)-[/home/kali/Desktop]#', ['/home/kali/Desktop']],
  ]);
  assert.deepEqual(session('```bash prompt:bash', ['su -c "apt update"', 'su -c whoami bob', 'x']), ['user@localhost:~/$', 'user@localhost:~/$', 'user@localhost:~/$']);
});

test('cd with chained commands, git checkout -b / switch -c', () => {
  assert.deepEqual(session('```bash prompt:bash', ['cd myapp && npm install', 'cd /tmp; ls', 'x']), ['user@localhost:~/$', 'user@localhost:~/myapp$', 'user@localhost:/tmp$']);
  assert.deepEqual(session('```zsh prompt:zshgit', ['git checkout -b feature', 'git switch -c fix', 'git checkout -- file.txt', 'x']),
    ['➜ ~/projects git:(main) ✗', '➜ ~/projects git:(feature) ✗', '➜ ~/projects git:(fix) ✗', '➜ ~/projects git:(fix) ✗']);
});

test('windows: bare drive, PowerShell goes there, CMD stays', () => {
  assert.deepEqual(session('```powershell prompt:ps', ['cd D:', 'x']), ['PS C:\\Users\\Administrator>', 'PS D:\\>']);
  assert.deepEqual(session('```bat prompt:cmd', ['cd D:', 'x']), ['C:\\Users\\Administrator>', 'C:\\Users\\Administrator>']);
});

test('metasploit: edited base prompt, {module} placeholder', () => {
  assert.deepEqual(session('```msf prompt:msf', ['use exploit/x/y', 'x'], settings({ editedDefaults: { msf: { basePrompt: 'msf5 >' } } })),
    ['msf5 exploit(multi/handler) >', 'msf5 exploit(x/y) >']);
  const s = settings({ customPrompts: custom('mine', { basePrompt: 'msf6 {module} >' }) });
  assert.deepEqual(session('```msf prompt:mine module:exploit/a/b', ['use exploit/x/y', 'x'], s), ['msf6 exploit/a/b >', 'msf6 exploit/x/y >']);
  assert.deepEqual(session('```msf prompt:mine', ['use exploit/x/y', 'x'], s), ['msf6 >', 'msf6 exploit/x/y >'], 'no module yet: no double space');
  assert.deepEqual(session('```msf prompt:"msf6 {module} >"', ['x']), ['msf6 >'], 'on-the-fly template too');
  assert.deepEqual(session('```msf prompt:msf', ['back', 'x'], settings({ editedDefaults: { msf: { basePrompt: 'msf6 {module} >' } } })).slice(-1), ['msf6 >'], 'edited built-in uses the msf path');
});

test('custom prompt names with spaces get a CSS-safe class', () => {
  const regex = '^(?<user>[^@]+)@(?<host>[^:]+):(?<path>.+?)[$#]\\s*';
  const s = settings({ customPrompts: custom('My Shell', { basePrompt: '$', parsePromptRegexString: regex }) });
  assert.equal(manager('```bash parse:"My Shell"', 1, s).renderLine('bob@srv:/tmp$ ls', 1).lineClassName, 'codeblock-customizer-prompt-My-Shell');
});

test('template prompts (custom and on-the-fly) switch $ to # for root', () => {
  const s = settings({ customPrompts: custom('mine', { basePrompt: '{user}@{host}:{path}$' }) });
  assert.deepEqual(session('```bash prompt:mine', ['su', 'x'], s), ['user@localhost:~$', 'root@localhost:/home/user#']);
  assert.deepEqual(session('```bash prompt:"{user}@{host}:{path}$"', ['su', 'x']), ['user@localhost:~$', 'root@localhost:/home/user#']);
});

test('more shell commands: escaped space, su -c after the user, git checkout ., msf back, relative start folder, CMD bare cd', () => {
  assert.deepEqual(session('```bash prompt:bash', ['cd My\\ Docs', 'pwd']), ['user@localhost:~/$', ['user@localhost:~/My Docs$', ['/home/user/My Docs']]]);
  assert.deepEqual(session('```bash prompt:bash', ['su - postgres -c psql', 'su --command=ls bob', 'x']), ['user@localhost:~/$', 'user@localhost:~/$', 'user@localhost:~/$']);
  assert.deepEqual(session('```zsh prompt:zshgit', ['git checkout .', 'x']), ['➜ ~/projects git:(main) ✗', '➜ ~/projects git:(main) ✗']);
  assert.deepEqual(session('```msf prompt:msf', ['use exploit/multi/handler', 'back', 'x']), ['msf6 exploit(multi/handler) >', 'msf6 exploit(multi/handler) >', 'msf6 >']);
  assert.deepEqual(session('```bash prompt:bash path:myproj', ['cd src', 'pwd']), ['user@localhost:myproj$', ['user@localhost:myproj/src$', ['myproj/src']]]);
  assert.deepEqual(session('```bat prompt:cmd', ['cd D:\\x', 'cd', 'x']), ['C:\\Users\\Administrator>', 'D:\\x>', 'D:\\x>']);});

test('cmd: cd /d changes drive and folder', () => {
  assert.deepEqual(session('```bat prompt:cmd', ['cd /d D:\\work', 'cd /D "E:\\my dir"', 'x']), ['C:\\Users\\Administrator>', 'D:\\work>', 'E:\\my dir>']);
  assert.deepEqual(session('```bash prompt:bash', ['cd /d', 'x']), ['user@localhost:~/$', 'user@localhost:/d$'], 'only Windows shells treat /d as a flag');
});

test('edited default branch is used, branch parameter wins', () => {
  const s = settings({ editedDefaults: { zshgit: { defaultBranch: 'develop' } } });
  assert.deepEqual(session('```zsh prompt:zshgit', ['x'], s), ['➜ ~/projects git:(develop) ✗']);
  assert.deepEqual(session('```zsh prompt:zshgit branch:feat', ['x'], s), ['➜ ~/projects git:(feat) ✗']);
});

test('custom prompt: regex saved as {} by older versions is dropped, default regex string parses the prompt', () => {
  const s = settings({ customPrompts: {
    ...custom('old', { parsePromptRegex: {} }),
    ...custom('mine', { basePrompt: '{user}@{host}:{path}$', parsePromptRegexString: '^(?<user>[^@]+)@(?<host>[^:]+):(?<path>.+?)[$#]\\s*' }),
  } });
  assert.equal(getPromptDefinition('old', s).def.parsePromptRegex, undefined);
  assert.equal(manager('```bash parse:old', 1, s).renderLine('cat file', 1).matchedLength, 0, 'no crash, nothing matched');
  assert.equal(manager('```bash parse:mine', 1, s).renderLine('bob@srv:/tmp$ ls -la', 1).matchedLength, 'bob@srv:/tmp$ '.length);
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
