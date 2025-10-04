import { defaultPrompts, PromptDefinition, PromptEnvironment, PromptKind, symbolClassMap } from "./PromptManager";
import { CodeblockCustomizerSettings, ColorTheme } from "./Settings";

const highlightMapCache = new WeakMap<PromptDefinition, Record<string, string>>();
type PromptReplacement = string | { text: string; class?: string }[];

export function generatePromptColorStyles(settings: CodeblockCustomizerSettings) {
  const baseThemeName = settings.SelectedTheme.baseTheme ?? 'Obsidian';
  const baseTheme = settings.Themes[baseThemeName];

  const allPromptIds = new Set<string>();
  const modes: ('light' | 'dark')[] = ['light', 'dark'];

  // gather all prompt IDs (regular + root)
  for (const mode of modes) {
    const light = settings.SelectedTheme.colors[mode].prompts;
    const base = baseTheme.colors[mode].prompts;

    Object.keys(base.promptColors ?? {}).forEach(id => allPromptIds.add(id));
    Object.keys(base.rootPromptColors ?? {}).forEach(id => allPromptIds.add(id));
    Object.keys(light.editedPromptColors ?? {}).forEach(id => allPromptIds.add(id));
    Object.keys(light.editedRootPromptColors ?? {}).forEach(id => allPromptIds.add(id));
  }

  const permanentClassRules = new Set<string>();
  const lightVars: string[] = [];
  const darkVars: string[] = [];

  for (const promptId of allPromptIds) {
    for (const mode of modes) {
      const isLight = mode === 'light';

      // regular prompt
      const resolved = getResolvedPromptColorsForMode(settings, baseTheme, promptId, mode, false);
      for (const [cls, color] of Object.entries(resolved)) {
        const selector = promptId === "global" ? `.${cls}` : `.codeblock-customizer-prompt-${promptId} .${cls}`;
        const varName = selectorToVariable(selector);
        const css = `--${varName}: ${color};`;
        if (isLight) 
          lightVars.push(css);
        else 
          darkVars.push(css);
        permanentClassRules.add(`${selector} { color: var(--${varName}); }`);
      }

      // root prompt (if applicable)
      const rootResolved = getResolvedPromptColorsForMode(settings, baseTheme, promptId, mode, true);
      for (const [cls, color] of Object.entries(rootResolved)) {
        const selector = promptId === "global" ? `.root .${cls}` : `.codeblock-customizer-prompt-${promptId}.is-root .${cls}`;
        const varName = selectorToVariable(selector);
        const css = `--${varName}: ${color};`;
        if (isLight) 
          lightVars.push(css);
        else 
          darkVars.push(css);
        permanentClassRules.add(`${selector} { color: var(--${varName}); }`);
      }
    }
  }

  return `
    ${Array.from(permanentClassRules).join('\n')}
    
    body.codeblock-customizer.theme-light {
      ${lightVars.join('\n')}
    }

    body.codeblock-customizer.theme-dark {
      ${darkVars.join('\n')}
    }
  `.trim();
}// generatePromptColorStyles

function selectorToVariable(selector: string): string {
  return selector
    .replace(/^\./, '')
    .replace(/\s*\.\s*/g, '-')
    .replace(/\s+/g, '-')
    .toLowerCase();
}// selectorToVariable

export function getCachedHighlightMap(def: PromptDefinition): Record<string, string> {
  let map = highlightMapCache.get(def);

  if (!map) {
    map = resolveHighlightClassMap(def);
    highlightMapCache.set(def, map);
  }

  return map;
}// getCachedHighlightMap

export function addClassesToPrompt(promptData: string | { text: string; class?: string }[], promptType: string, promptDef: PromptDefinition | undefined, settings: CodeblockCustomizerSettings, isRoot = false): HTMLElement {
  const meta = getPromptDetails(promptType, settings);
  const { kind, baseClass } = meta;
  const promptWrapper = createSpan({ cls: baseClass });
  const fragment = document.createDocumentFragment();

  const endsWithSpace = Array.isArray(promptData) ? promptData.length > 0 && promptData[promptData.length - 1].text?.endsWith(" ") : (promptData as string).endsWith(" ");

  if (Array.isArray(promptData)) {
    if (isRoot && promptDef?.supportsRootStyling) {
      promptWrapper.classList.add("is-root");
    }

    const parts = mergeAdjacentParts(promptData);
    for (const part of parts) {
      fragment.appendChild(createSpan({ cls: part.class ?? "prompt-symbol", text: part.text }));
    }

    if (!endsWithSpace) {
      fragment.appendChild(createSpan({ cls: "prompt-part prompt-space", text: " " }));
    }

    promptWrapper.appendChild(fragment);
    return promptWrapper;
  }

  const promptStr = promptData as string;

  if (kind === PromptKind.Predefined) {
    if (!promptDef) promptDef = defaultPrompts[promptType];

    const match = promptDef?.parsePromptRegex?.exec(promptStr);
    const parts: HTMLElement[] = [];

    if (match?.groups?.user?.trim() === "root" && promptDef?.supportsRootStyling) {
      promptWrapper.classList.add("is-root");
    }

    if (match) {
      const resolvedMap = getCachedHighlightMap(promptDef);
      const ranges = getMatchRanges(promptStr, match, promptDef.highlightGroups ?? {});
      let cursor = 0;

      const classCache: Record<string, string> = {};
      const getSymbolClass = (char: string): string =>
        classCache[char] ??= (symbolClassMap[char] ?? "prompt-symbol") + " prompt-part";

      for (const { start, end, groupName } of ranges) {
        if (groupName === "status") continue;

        if (cursor < start) {
          parts.push(...batchSpans(promptStr.slice(cursor, start), getSymbolClass));
        }

        const slice = promptStr.slice(start, end);
        const cls = resolvedMap[groupName] ?? `prompt-part prompt-${groupName}`;
        parts.push(createSpan({ cls, text: slice }));
        cursor = end;
      }

      if (cursor < promptStr.length) {
        parts.push(...batchSpans(promptStr.slice(cursor), getSymbolClass));
      }
    } else {
      parts.push(...batchSpans(promptStr, (char) =>
        resolvePromptClass(char, { type: "symbol" })
      ));
    }

    fragment.append(...parts);
    if (!endsWithSpace) {
      fragment.appendChild(createSpan({ cls: "prompt-part prompt-space", text: " " }));
    }

    promptWrapper.appendChild(fragment);
    return promptWrapper;
  }

  if (kind === PromptKind.Plain) {
    fragment.append( ...batchSpans(promptStr, (char) => resolvePromptClass(char, { type: "symbol" })));
    if (!endsWithSpace) {
      fragment.appendChild(createSpan({ cls: "prompt-part prompt-space", text: " " }));
    }

    promptWrapper.appendChild(fragment);
    return promptWrapper;
  }

  return promptWrapper;
}// addClassesToPrompt

function batchSpans(text: string, getClass: (char: string) => string): HTMLElement[] {
  const spans: HTMLElement[] = [];
  
  if (!text) 
    return spans;

  let buffer = "";
  let currentClass = getClass(text[0]);

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const cls = getClass(char);
    if (cls === currentClass) {
      buffer += char;
    } else {
      spans.push(createSpan({ cls: currentClass, text: buffer }));
      buffer = char;
      currentClass = cls;
    }
  }

  if (buffer) {
    spans.push(createSpan({ cls: currentClass, text: buffer }));
  }

  return spans;
}// batchSpans

function mergeAdjacentParts(parts: { text: string; class?: string }[]): { text: string; class?: string }[] {
  const merged: { text: string; class?: string }[] = [];

  for (const p of parts) {
    const cls = p.class ?? "prompt-symbol";
    if (merged.length > 0 && merged[merged.length - 1].class === cls) {
      merged[merged.length - 1].text += p.text;
    } else {
      merged.push({ text: p.text, class: cls });
    }
  }
  return merged;
}// mergeAdjacentParts

export function getPromptType(promptText: string): PromptKind {
  const promptDef = defaultPrompts[promptText];

  if (promptDef) 
    return PromptKind.Predefined;

  if (/\{.*?\}/.test(promptText)) 
    return PromptKind.Template;

  return PromptKind.Plain;
}// getPromptType

function getPromptDetails(promptType: string, settings: CodeblockCustomizerSettings): { kind: PromptKind, name: string, baseClass: string, isCustom: boolean } {
  const { isCustom } = getPromptDefinition(promptType, settings);

  const isCustomTemplate = /\{.+?\}/.test(promptType);
  const isDefinedPrompt = promptType in defaultPrompts || isCustom;

  if (isDefinedPrompt) {
    // predefined or saved custom
    return {kind: PromptKind.Predefined, name: promptType, baseClass: `codeblock-customizer-prompt-${promptType}`, isCustom: isCustom};
  }

  if (isCustomTemplate) {
    // on the fly, custom with template
    return {kind: PromptKind.Template, name: promptType, baseClass: `codeblock-customizer-prompt-custom`, isCustom: true};
  } else {
    // on the fly, custom plain (without template)
    return {kind: PromptKind.Plain, name: promptType, baseClass: `codeblock-customizer-prompt-custom`, isCustom: true};
  }
}// getPromptDetails

function resolvePromptClass(token: string, context: {type: 'symbol' | 'template' | 'regex'; groupName?: string;}): string {
  if (context.type === 'symbol') {
    const baseCls = symbolClassMap[token] ?? 'prompt-symbol';
    return `prompt-part ${baseCls}`;
  }

  if ((context.type === 'template' || context.type === 'regex') && context.groupName) {
    return `prompt-part prompt-${context.groupName}`;
  }

  return 'prompt-symbol';
}// resolvePromptClass

export function getMatchRanges(promptText: string, match: RegExpExecArray, groupMap: Record<string, string>): { start: number; end: number; groupName: string }[] {
  const ranges: { start: number; end: number; groupName: string }[] = [];
  let lastIndex = 0;

  for (const key of Object.keys(groupMap)) {
    const value = match.groups?.[key];
    if (!value) 
      continue;

    const idx = promptText.indexOf(value, lastIndex);
    if (idx === -1) 
      continue;

    ranges.push({
      start: idx,
      end: idx + value.length,
      groupName: groupMap[key] ?? key,
    });

    lastIndex = idx + value.length;
  }

  return ranges.sort((a, b) => a.start - b.start);
}// getMatchRanges

function shouldSimplifyHomePath(promptDef: PromptDefinition | undefined): boolean {
  if (!promptDef) 
    return true; // assume Linux
  
  // if promptDef is Windows don't simplify
  return !(promptDef.isWindowsShell);
}// shouldSimplifyHomePath

export function replacePromptTemplate(promptKind: PromptKind, promptType: string, promptDef: PromptDefinition | undefined, env: PromptEnvironment): PromptReplacement {
  const simplify = shouldSimplifyHomePath(promptDef);
  const dir = env.dir ?? "~";
  const finalPath = simplify ? simplifyHomePath(dir, env.homeDir) : dir;

  if (promptDef?.name === 'Metasploit') {
    if (env.msfKeyword && env.msfModule) {
      return `msf6 ${env.msfKeyword}(${env.msfModule}) >`;
    }
    return 'msf6 >';
  }

  if (promptKind === PromptKind.Predefined) {
    let promptText = promptDef?.basePrompt ?? promptType;

    promptText = promptText
      .replace("{user}", env.user)
      .replace("{host}", env.host)
      .replace("{path}", finalPath)
      .replace("{db}", env.db)
      .replace("{branch}", env.branch);

    if (env.user === "root" && /[$%](?!\S)/.test(promptText)) {
      promptText = promptText
        .replace(/\$(?!\S)/, "#")
        .replace(/%(?!\S)/, "#");
    }

    return promptText;
  }

  if (promptKind === PromptKind.Template) {
    const parts: { text: string; class?: string }[] = [];

    const placeholderMap: Record<string, string> = {
      user: env.user,
      host: env.host,
      path: finalPath,
      db: env.db,
      branch: env.branch,
    };

    for (const token of parsePromptTemplate(promptType)) {
      if (token.isPlaceholder) {
        const value = placeholderMap[token.text] ?? `{${token.text}}`;
        parts.push({text: value, class: resolvePromptClass(value, { type: "template", groupName: token.text })});
      } else {
        for (let i = 0; i < token.text.length; i++) {
          const char = token.text[i];
          const cls = resolvePromptClass(char, { type: "symbol" });
          parts.push({ text: char, class: cls });
        }
      }
    }

    return parts;
  }

  // plain prompt
  return promptType;
}// replacePromptTemplate

function* parsePromptTemplate(template: string): Generator<{ text: string; isPlaceholder: boolean }> {
  let cursor = 0;

  while (cursor < template.length) {
    const start = template.indexOf("{", cursor);
    if (start === -1) {
      yield { text: template.slice(cursor), isPlaceholder: false };
      break;
    }

    if (start > cursor) {
      yield { text: template.slice(cursor, start), isPlaceholder: false };
    }

    const end = template.indexOf("}", start);
    if (end === -1) {
      yield { text: template.slice(start), isPlaceholder: false };
      break;
    }

    yield { text: template.slice(start + 1, end), isPlaceholder: true };
    cursor = end + 1;
  }
}// parsePromptTemplate

export function getPromptDefinition(promptId: string, settings: CodeblockCustomizerSettings): { def: PromptDefinition, isCustom: boolean } {
  const customs = settings.pluginSettings.prompts.customPrompts;
  const edits  = settings.pluginSettings.prompts.editedDefaults;
  const base   = defaultPrompts[promptId];

  let def: PromptDefinition;
  const isCustom = !!customs[promptId];

  if (isCustom && customs[promptId]) {
    //def = structuredClone(customs[promptId]);
    def = { ...customs[promptId] };
  } else if (edits[promptId] && base) {
    // merge only the changed fields onto a clone of the base
    //def = structuredClone({ ...base, ...edits[promptId] });
    def = { ...base, ...edits[promptId] };
  } else if (base) {
    //def = structuredClone(base);
    def = { ...base };
  } else {
    // ultimate fallback
    def = {
      name: promptId,
      basePrompt: promptId,
      isWindowsShell: false
    };
  }

  // rebuild the RegExp if it is stored as a string
  if (def.parsePromptRegexString) {
    try { 
      def.parsePromptRegex = new RegExp(def.parsePromptRegexString); 
    }
    catch { 
      def.parsePromptRegex = undefined; 
    }
  }

  return { def, isCustom };
}// getPromptDefinition

export function getPWD(env: PromptEnvironment) {
  let path = env.dir ?? "~";

  if (path === "~" && env.originalHomeDir) {
    path = env.originalHomeDir;
  } else if (path.startsWith("~/") && env.originalHomeDir) {
    path = env.originalHomeDir + path.slice(1);
  }

  return path;
}// getPWD

export function collectAllPromptClasses(settings: CodeblockCustomizerSettings): string[] {
  const classSet = new Set<string>();

  // highlightGroups
  const allPromptDefs = {...defaultPrompts, ...settings.pluginSettings.prompts.customPrompts};
  for (const def of Object.values(allPromptDefs)) {
    for (const cls of Object.values(def.highlightGroups ?? {})) {
      classSet.add(`prompt-${cls}`);
    }
  }

  // basePrompt placeholders
  const placeholders = ['user', 'host', 'path', 'db', 'branch'];
  for (const key of Object.keys(allPromptDefs)) {
    const basePrompt = allPromptDefs[key].basePrompt;
    for (const ph of placeholders) {
      if (basePrompt.includes(`{${ph}}`)) {
        classSet.add(`prompt-${ph}`);
      }
    }
  }

  // symbol class map
  for (const cls of Object.values(symbolClassMap)) {
    classSet.add(cls);
  }

  // fallback
  classSet.add("prompt-symbol");

  return Array.from(classSet).sort();
}// collectAllPromptClasses

function resolveHighlightClassMap(def: PromptDefinition): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [group, className] of Object.entries(def.highlightGroups ?? {})) {
    map[group] = `prompt-part prompt-${className}`;
  }
  return map;
}// resolveHighlightClassMap

function getResolvedPromptColorsForMode(settings: CodeblockCustomizerSettings, baseTheme: ColorTheme, promptId: string, mode: 'light' | 'dark', editingRoot: boolean): Record<string, string> {
  const base = baseTheme.colors[mode].prompts;

  const edited = editingRoot ? settings.SelectedTheme.colors[mode].prompts.editedRootPromptColors?.[promptId] ?? {} : settings.SelectedTheme.colors[mode].prompts.editedPromptColors?.[promptId] ?? {};
  const globalDefaults = editingRoot ? base?.rootPromptColors?.['global'] ?? {} : base?.promptColors?.['global'] ?? {};
  const defaults = editingRoot ? base?.rootPromptColors?.[promptId] ?? {} : base?.promptColors?.[promptId] ?? {};

  return { ...globalDefaults, ...defaults, ...edited };
}// getResolvedPromptColorsForMode

function simplifyHomePath(path: string, homeDir: string | undefined): string {
  if (!homeDir) 
    return path;

  // handle / or \ correctly
  const sep = homeDir.includes("\\") ? "\\" : "/";

  if (path === homeDir) 
    return "~";

  if (path.startsWith(homeDir + sep)) 
    return "~" + path.slice(homeDir.length);

  return path; // do not simplify if not inside new home
}// simplifyHomePath
