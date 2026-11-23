import { setIcon, editorLivePreviewField, Notice, MarkdownRenderer, App, TFile, CachedMetadata, EditorPosition, Editor, loadPrism, Component } from "obsidian";

import { EditorState } from "@codemirror/state";

import { manualLang, Icons, SVG_FILE_PATH, SVG_FOLDER_PATH, EXECUTE_CODE_SUPPORTED_LANGUAGES, fadeOutLineCount, Languages } from "./Const";
import { buildSvg, svgToDataUri } from "./CustomSvg";
import { generatePromptColorStyles } from "./PromptUtils";
import { generateSyntaxThemeStyles } from "./SyntaxThemeUtils";
import { CodeblockCustomizerSettings, Colors, HighlightStyle, LineNumberSeparatorStyle, PluginSettings, ThemeColors, SemiFoldEffect, CollapseIconStyle, HiddenLinesStyle, ExecuteCodeSeparatorStyle } from "./Settings";
import CodeBlockCustomizerPlugin from "./main";
import { CBCParameters } from "./Parsing";

import { toBlob } from 'html-to-image';

let cachedMode: "light" | "dark" | null = null;
const SETTING_STYLE_ID = 'codeblock-customizer-styles';

export function clearSettingStyles(app?: App): void {
  for (const doc of getTargetDocuments(app)) {
    doc.getElementById(SETTING_STYLE_ID)?.remove();
  }
}// clearSettingStyles

export function escapeRegex(text: string): string {
  return text.replace(/[-/\\^$*+?.()|[\]{}%]/g, '\\$&');
}// escapeRegex

export function getTargetDocuments(app?: App): Document[] {
  const docs = new Set<Document>([document, activeDocument]);
  const rootDoc = app?.workspace?.rootSplit?.doc;
  if (rootDoc) {
    docs.add(rootDoc);
  }
  app?.workspace?.iterateAllLeaves((leaf) => {
    const leafDoc = leaf.view?.containerEl?.doc;
    if (leafDoc) {
      docs.add(leafDoc);
    }
  });
  return Array.from(docs);
}// getTargetDocuments

function retrieveCurrentMode(): "light" | "dark" {
  for (const doc of getTargetDocuments()) {
    const body = doc.querySelector('body');
    if (body !== null) {
      if (body.classList.contains('theme-light')) {
        return "light";
      } else if (body.classList.contains('theme-dark')) {
        return "dark";
      }
    }
  }
  return 'dark'; // fall back to dark
}// retrieveCurrentMode

export function getCurrentMode(): "light" | "dark" {
  if (cachedMode === null) {
    cachedMode = retrieveCurrentMode();
  }
  return cachedMode;
}// getCurrentMode

export function refreshCachedMode(): void {
  cachedMode = retrieveCurrentMode();
}// refreshCachedMode

export function getDefaultParameters(): CBCParameters {
  return {
    defaultLinesToHighlight: { lineNumbers: [], words: [], lineSpecificWords: [] },
    outputLinesToHighlight: { lineNumbers: [], words: [], lineSpecificWords: [] },
    defaultTextToHighlight: { allWordsInLine: [], lineSpecificTextBetween: [], lineSpecificWords: [], textBetween: [], words: [] },
    outputTextToHighlight: { allWordsInLine: [], lineSpecificTextBetween: [], lineSpecificWords: [], textBetween: [], words: [] },
    alternativeLinesToHighlight: { lines: [], words: [], lineSpecificWords: [], outputLines: [], outputWords: [], outputLineSpecificWords: [] },
    alternativeTextToHighlight: { allWordsInLine: [], lineSpecificWords: [], words: [], textBetween: [], lineSpecificTextBetween: [], outputAllWordsInLine: [], outputWords: [], outputLineSpecificWords: [], outputTextBetween: [], outputLineSpecificTextBetween: [] },
    isSpecificNumber: false,
    lineNumberOffset: 0,
    lineNumberJumps: [],
    showNumbers: "",
    hasTitle: false,
    headerDisplayText: "",
    fold: false,
    unfold: false,
    language: "",
    displayLanguage: "",
    hasLangBorderColor: false,
    exclude: false,
    fenceChar: null,
    fenceCount: 0,
    indentLevel: 0,
    indentCharacter: 0,
    lineSeparator: '',
    textSeparator: '',
    prompt: { lineNumbers: [], text: "", values: { user: null, host: null, path: null, db: null, branch: null, module: null } },
    parsePromptId: null,
    noPrompt: false,
    noPromptLines: [],
    noParse: false,
    noParseLines: [],
    group: '',
    tab: '',
    output: false,
    hideLines: [],
    expand: false,
  }
}// getDefaultParameters

export function isSpecificHeader(parameters: CBCParameters, settings: CodeblockCustomizerSettings, isMemberOfTabbedGroup: boolean, lineCount: number, mode: "editor" | "reading"): boolean {
  // file or title specified
  if (parameters.hasTitle) {
    return true;
  }

  // block is a grouped code block
  if (isMemberOfTabbedGroup) {
    return true;
  }

  // inversefold
  const { foldByDefault } = determineDefaultFoldState(parameters, settings, lineCount, false, mode);
  if (foldByDefault) {
    return true;
  }

  // always show icon or language tag
  if (parameters.language.length > 0 && (settings.pluginSettings.header.alwaysDisplayCodeblockIcon || settings.pluginSettings.header.alwaysDisplayCodeblockLang)) {
    return true;
  }

  return false;
}// isSpecificHeader

export function getVisibleLineCount(parameters: CBCParameters, contentLineCount: number): number {
  if (parameters.hideLines.length === 0) {
    return contentLineCount;
  }

  const hiddenLines = new Set(parameters.hideLines);
  let visibleCount = 0;
  let displayedLineNumber = parameters.lineNumberOffset;
  let jumpIdx = 0;
  const jumps = (parameters.lineNumberJumps || []).filter(j => j.lineNumber > parameters.lineNumberOffset);

  for (let i = 0; i < contentLineCount; i++) {
    displayedLineNumber++;

    if (jumps && jumps.length > 0 && jumpIdx < jumps.length && displayedLineNumber === jumps[jumpIdx].lineNumber) {
      displayedLineNumber = jumps[jumpIdx].newStartNumber;
      jumpIdx++;
    }

    if (!hiddenLines.has(displayedLineNumber)) {
      visibleCount++;
    }
  }

  return visibleCount;
}// getVisibleLineCount

export function determineDefaultFoldState(parameters: CBCParameters, settings: CodeblockCustomizerSettings, lineCount: number, isSpecificHeader: boolean, mode: "editor" | "reading"): { foldByDefault: boolean; useSemiFold: boolean } {
  const { inverseFold, ignoreShortBlocksOnInverseFold } = settings.pluginSettings.codeblock.folding;
  const { enableSemiFold, visibleLines, autoFoldLongCodeblocks, longCodeBlockLines } = settings.pluginSettings.semiFold;

  const contentLineCount = mode === "editor" ? lineCount - 2 : lineCount;
  const visibleContentLineCount = getVisibleLineCount(parameters, contentLineCount);

  const canSemiFold = enableSemiFold && visibleContentLineCount >= visibleLines + fadeOutLineCount;
  const autoFold = isSpecificHeader && enableSemiFold && autoFoldLongCodeblocks && visibleContentLineCount >= longCodeBlockLines;

  let doInverseFold = false;
  if (inverseFold && !parameters.unfold) {
    if (enableSemiFold && ignoreShortBlocksOnInverseFold) {
      // ignoreShortBlocksOnInverseFold is true so only fold blocks which meet the criteria for semi-folding
      doInverseFold = canSemiFold;
    } else {
      // ignoreShortBlocksOnInverseFold is false ==> apply inverse fold
      doInverseFold = true;
    }
  }

  const foldByDefault = parameters.fold || doInverseFold || autoFold;

  return { foldByDefault: foldByDefault, useSemiFold: enableSemiFold };
}// determineDefaultFoldState

export function isFoldDisabled(parameters: CBCParameters, settings: CodeblockCustomizerSettings): boolean {
  if (!settings.pluginSettings.header.disableFoldUnlessSpecified) {
    return false;
  }
  
  return settings.pluginSettings.codeblock.folding.inverseFold ? !parameters.unfold : !parameters.fold;
}// isFoldDisabled

export function filterOccurrences(allMatches: { from: number, to: number }[], occurrencesFilter?: number[]): { from: number, to: number }[] {
  if (!occurrencesFilter || occurrencesFilter.length === 0) {
    return allMatches;
  }

  const totalMatches = allMatches.length;
  const filteredMatches: { from: number, to: number }[] = [];
  const selectedIndices = new Set<number>();

  for (const occurrence of occurrencesFilter) {
    let index: number;
    if (occurrence > 0) {
      // positive index => from start
      index = occurrence - 1;
    } else if (occurrence < 0) {
      // negative index => from end
      index = totalMatches + occurrence;
    } else {
      // 0 is invalid => skip
      continue;
    }

    if (index >= 0 && index < totalMatches && !selectedIndices.has(index)) {
      selectedIndices.add(index);
    }
  }

  // return matches in their original order
  const sortedIndices = Array.from(selectedIndices).sort((a, b) => a - b);

  for (const index of sortedIndices) {
    filteredMatches.push(allMatches[index]);
  }

  return filteredMatches;
}// filterOccurrences

export function getLanguageIcon(DisplayName: string) {
  if (!DisplayName)
    return "";

  if (Object.prototype.hasOwnProperty.call(Icons, DisplayName)) {
    return Icons[DisplayName];
  }

  return null;
}// getLanguageIcon

export const BLOBS: Record<string, string> = {};
export async function loadIcons(plugin: CodeBlockCustomizerPlugin) {
  for (const [key, value] of Object.entries(Icons)) {
    BLOBS[key.replace(/\s/g, "_")] = svgToDataUri(buildSvg(value));
  }
  await loadCustomIcons(plugin);
}// loadIcons

interface LanguageConfig {
  codeblockLanguages: string[];
  displayName: string;
  svgFile?: string;
  format?: string;
}

export interface customLanguageConfig {
  languages: LanguageConfig[];
}

async function loadCustomIcons(plugin: CodeBlockCustomizerPlugin) {
  const svgJsonExists = await plugin.app.vault.adapter.exists(plugin.app.vault.configDir + SVG_FILE_PATH);
  if (!svgJsonExists)
    return;

  const svgJsonContent = await plugin.app.vault.adapter.read(plugin.app.vault.configDir + SVG_FILE_PATH);
  if (!svgJsonContent)
    return;

  let languageConfig: customLanguageConfig;
  try {
    languageConfig = JSON.parse(svgJsonContent) as customLanguageConfig;
  } catch (error) {
    console.error("Invalid JSON content in the SVG configuration file:", error);
    return;
  }
  plugin.customLanguageConfig = languageConfig;

  for (const lang of languageConfig.languages) {
    if (lang.svgFile) {
      const svgFilePath = plugin.app.vault.configDir + SVG_FOLDER_PATH + lang.svgFile;
      const svgFileExists = await plugin.app.vault.adapter.exists(svgFilePath);
      if (svgFileExists) {
        const svgContent = await plugin.app.vault.adapter.read(svgFilePath);
        Icons[lang.displayName] = svgContent;
        BLOBS[lang.displayName.replace(/\s/g, "_")] = svgToDataUri(buildSvg(svgContent));
      }
    }
    for (const language of lang.codeblockLanguages) {
      manualLang[language] = lang.displayName;
    }
  }

}// loadCustomIcons

export function loadSyntaxHighlightForCustomLanguages(plugin: CodeBlockCustomizerPlugin, unload = false) {
  const customLanguageConfig = plugin.customLanguageConfig;
  if (!customLanguageConfig)
    return;

  for (const lang of customLanguageConfig.languages) {
    if (lang.format && lang.format.length > 0) {
      for (const language of lang.codeblockLanguages) {
        registerEditorSyntaxHighlightingForLanguage(language, lang.format, unload);
      }
    }
  }
}// loadSyntaxHighlightForCustomLanguages

const CUSTOM_PRISM_LANGUAGES_FILE = "customPrismLanguages.json";
let registeredCustomPrismLanguages: string[] = [];
let customPrismLanguageNames: Set<string> = new Set();
let customPrismDefinitions: Record<string, unknown> | null = null;

export interface PrismToken {
  type: string;
  content: string | PrismToken | Array<string | PrismToken>;
  alias?: string | string[];
}

export interface PrismInstance {
  languages: Record<string, unknown>;
  highlight: (text: string, grammar: unknown, language: string) => string;
  tokenize: (text: string, grammar: unknown) => Array<string | PrismToken>;
  hooks: { run: (name: string, env: object) => void };
}

// returns the same tokens as highlight() uses. tokenize() alone skips the hooks, which languages embedded in HTML need (PHP, Handlebars, Django, EJS, ...)
export function tokenizeWithHooks(prism: PrismInstance, code: string, grammar: unknown, language: string): Array<string | PrismToken> {
  const env: { code: string; grammar: unknown; language: string; tokens: Array<string | PrismToken> } = { code, grammar, language, tokens: [] };
  prism.hooks.run('before-tokenize', env);
  env.tokens = prism.tokenize(env.code, env.grammar);
  prism.hooks.run('after-tokenize', env);
  return env.tokens;
}// tokenizeWithHooks

export async function getPrism(): Promise<PrismInstance> {
  return (await loadPrism()) as PrismInstance;
}// getPrism

// replacement for "element.innerHTML = html"
export function parseTrustedHtmlBatch(htmls: string[]): DocumentFragment[] {
  const wrapped = htmls.map(html => `<template>${html}</template>`).join('');
  const body = new DOMParser().parseFromString(`<!DOCTYPE html><body>${wrapped}`, 'text/html').body;
  return Array.from(body.children, template => (template as HTMLTemplateElement).content);
}// parseTrustedHtmlBatch

export function parseTrustedHtml(html: string): DocumentFragment {
  return parseTrustedHtmlBatch([html])[0];
}// parseTrustedHtml

export function setTrustedHtml(targetEl: HTMLElement, html: string): void {
  targetEl.replaceChildren(parseTrustedHtml(html));
}// setTrustedHtml

function convertRegexStrings(value: unknown): unknown {
  if (typeof value === "string") {
    const regexMatch = value.match(/^\/(.+)\/([gimsuy]*)$/);
    if (regexMatch) {
      try {
        return new RegExp(regexMatch[1], regexMatch[2]);
      } catch (e) {
        new Notice(`Invalid regex "${value}" in ${CUSTOM_PRISM_LANGUAGES_FILE}: ${String(e)}`);
        return value;
      }
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(convertRegexStrings);
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = convertRegexStrings(val);
    }
    return result;
  }

  return value;
}// convertRegexStrings

export async function parseCustomPrismLanguages(plugin: CodeBlockCustomizerPlugin): Promise<void> {
  const path = `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}/${CUSTOM_PRISM_LANGUAGES_FILE}`;
  const fileExists = await plugin.app.vault.adapter.exists(path);
  if (!fileExists) {
    return;
  }

  let jsonContent: string;
  try {
    jsonContent = await plugin.app.vault.adapter.read(path);
  } catch (e) {
    new Notice(`Failed to read ${CUSTOM_PRISM_LANGUAGES_FILE}: ${String(e)}`);
    return;
  }

  let definitions: Record<string, unknown>;
  try {
    definitions = JSON.parse(jsonContent) as Record<string, unknown>;
  } catch (e) {
    new Notice(`Invalid JSON in ${CUSTOM_PRISM_LANGUAGES_FILE}: ${String(e)}`);
    return;
  }

  const converted: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(definitions)) {
    try {
      converted[name] = convertRegexStrings(definition);
    } catch (e) {
      new Notice(`Failed to parse language "${name}": ${String(e)}`);
    }
  }

  customPrismDefinitions = converted;
  customPrismLanguageNames = new Set(Object.keys(converted));
}// parseCustomPrismLanguages

export function loadCustomPrismLanguages(prism: PrismInstance): void {
  if (!customPrismDefinitions) {
    return;
  }

  for (const [name, definition] of Object.entries(customPrismDefinitions)) {
    try {
      prism.languages[name] = definition;
      registeredCustomPrismLanguages.push(name);
    } catch (e) {
      new Notice(`Failed to register language "${name}": ${String(e)}`);
    }
  }

  customPrismDefinitions = null;
}// loadCustomPrismLanguages

export function unloadCustomPrismLanguages() {
  const prism = (window as Window & { Prism?: PrismInstance }).Prism;
  if (prism) {
    for (const name of registeredCustomPrismLanguages) {
      delete prism.languages[name];
    }
  }

  registeredCustomPrismLanguages = [];
  customPrismLanguageNames.clear();
}// unloadCustomPrismLanguages

export function isCustomPrismLanguage(language: string): boolean {
  return customPrismLanguageNames.has(language);
}// isCustomPrismLanguage

export function getLanguageConfig(codeblockLanguage: string, plugin: CodeBlockCustomizerPlugin): LanguageConfig | undefined {
  codeblockLanguage = codeblockLanguage.toLowerCase();
  if (!plugin.customLanguageConfig)
    return undefined;

  return plugin.customLanguageConfig.languages.find((langConfig: LanguageConfig) =>
    langConfig.codeblockLanguages.includes(codeblockLanguage)
  );
}// getLanguageConfig

interface CM5Stream { start: number; pos: number; eol(): boolean; current(): string; }
interface CM5Mode { name?: string; startState?: () => unknown; token(stream: CM5Stream, state: unknown): string | null; }
interface CM5 {
  defaults: object;
  getMode(config: object, spec: string | undefined): CM5Mode;
  findModeByName(name: string): { mime?: string } | undefined;
  defineMode(name: string, factory: (config: object) => CM5Mode): void;
  StringStream: new (text: string) => CM5Stream;
}

export function getCM5(): CM5 {
  return (window as unknown as { CodeMirror: CM5 }).CodeMirror;
}// getCM5

function registerEditorSyntaxHighlightingForLanguage(codeblockLanguage: string, requiredSyntax: string, unload: boolean): void {
  if (!codeblockLanguage || codeblockLanguage.length === 0)
    return;

  if (!unload && (!requiredSyntax || requiredSyntax.length === 0))
    return;

  const cm5 = getCM5();
  cm5.defineMode(codeblockLanguage, config =>
    cm5.getMode(config, unload ? "null" : requiredSyntax)
  );
}// registerEditorSyntaxHighlightingForLanguage

const langNameToCodeMirrorMode: { [key: string]: string } = {
  bash: "shell",
  c: "clike",
  cpp: "clike",
  cs: "clike",
  csharp: "clike",
  fsharp: "mllike",
  hs: "haskell",
  java: "clike",
  kotlin: "clike",
  latex: "stex",
  nb: "mathematica",
  ocaml: "mllike",
  php: "php",
  py: "python",
  scala: "clike",
  swift: "clike",
  tex: "stex",
  wl: "mathematica",
  wolfram: "mathematica"
};

export function getExecuteCodeLanguages(additionalLanguages: string): string[] {
  const additional = additionalLanguages.split(/[\s,;]+/).map(lang => lang.toLowerCase().replace(/^run-/, '')).filter(lang => lang.length > 0);
  return [...new Set([...EXECUTE_CODE_SUPPORTED_LANGUAGES, ...additional])];
}// getExecuteCodeLanguages

export function registerExecuteCodeSyntaxHighlighting(languages: string[]) {
  for (const lang of languages) {
    const mode = langNameToCodeMirrorMode[lang] || lang;
    registerEditorSyntaxHighlightingForLanguage(`run-${lang}`, mode, false);
  }
}// registerExecuteCodeSyntaxHighlighting

export function unregisterExecuteCodeSyntaxHighlighting(languages: string[]) {
  for (const lang of languages) {
    registerEditorSyntaxHighlightingForLanguage(`run-${lang}`, lang, true);
  }
}// unregisterExecuteCodeSyntaxHighlighting

// Functions for displaying header BEGIN
export function createContainer(specific: boolean, languageName: string, hasLangBorderColor: boolean, codeblockLanguageSpecificClass: string, cls?: string) {
  const lang = languageName.length > 0 ? languageName.toLowerCase() : "nolang"
  const container = createDiv({ cls: cls ? cls : `codeblock-customizer-header-container${specific ? '-specific' : ''}` });
  container.classList.add(`codeblock-customizer-language-${lang.toLowerCase()}`);

  if (codeblockLanguageSpecificClass)
    container.classList.add(codeblockLanguageSpecificClass);

  if (hasLangBorderColor)
    container.classList.add(`hasLangBorderColor`);

  return container;
}// createContainer

export function createCodeblockLang(lang: string, langClass?: string, tabName?: string) {
  let textToDisplay: string;

  if (tabName !== undefined) {
    textToDisplay = tabName;
  } else {
    textToDisplay = getDisplayLanguageName(lang);
  }
  const codeblockLang = createDiv({ cls: langClass ?? `codeblock-customizer-header-language-tag`, text: textToDisplay || "" });

  return codeblockLang;
}// createCodeblockLang

export function createCodeblockIcon(displayLang: string, cls?: string) {
  const div = createDiv({ cls: `codeblock-customizer-icon-container` });
  const img = createEl("img");
  img.classList.add(cls ? cls : "codeblock-customizer-icon");
  img.width = 28; //32
  img.src = BLOBS[displayLang.replace(/\s/g, "_")];

  div.appendChild(img);

  return div;
}// createCodeblockIcon

export function getCollapseIcons(style: CollapseIconStyle) {
  switch (style) {
    case CollapseIconStyle.Arrows:
      return { collapsed: "chevron-right", uncollapsed: "chevron-down" };
    case CollapseIconStyle.PlusMinus:
      return { collapsed: "plus", uncollapsed: "minus" };
    case CollapseIconStyle.CirclePlusMinus:
      return { collapsed: "plus-circle", uncollapsed: "minus-circle" };
    case CollapseIconStyle.SquarePlusMinus:
      return { collapsed: "plus-square", uncollapsed: "minus-square" };
    case CollapseIconStyle.Chevrons:
    default:
      return { collapsed: "chevrons-down-up", uncollapsed: "chevrons-up-down" };
  }
}// getCollapseIcons

export function createCodeblockCollapse(defaultFold: boolean, style: CollapseIconStyle = CollapseIconStyle.Chevrons) {
  const collapse = createDiv({ cls: `codeblock-customizer-header-collapse` });

  const icons = getCollapseIcons(style);
  if (defaultFold)
    setIcon(collapse, icons.collapsed);
  else
    setIcon(collapse, icons.uncollapsed);

  return collapse;
}// createCodeblockLang

export function createFileName(text: string, enableLinks: boolean, sourcePath: string, plugin: CodeBlockCustomizerPlugin, owner: Component) {
  const fileName = createDiv({ cls: "codeblock-customizer-header-text" });

  if (enableLinks) {
    const component = new Component();
    component.load();
    owner.addChild(component);
    void MarkdownRenderer.render(plugin.app, text, fileName, sourcePath, component);
  }
  else {
    fileName.innerText = text;
  }

  return fileName;
}// createFileName

export function createUncollapseCodeButton() {
  const uncollapseCodeButton = createSpan({ cls: `codeblock-customizer-uncollapse-code` });
  uncollapseCodeButton.setAttribute("aria-label", "Uncollapse code block");
  setIcon(uncollapseCodeButton, "chevron-down");

  return uncollapseCodeButton;
}// createUncollapseCodeButton

export function getBorderColorByLanguage(languageName: string, languageBorderColors: Record<string, string>): string {
  const lang = languageName.length > 0 ? languageName : "nolang"
  const lowercaseLanguageName = lang.toLowerCase();

  for (const key in languageBorderColors) {
    if (key.toLowerCase() === lowercaseLanguageName) {
      return languageBorderColors[key];
    }
  }

  return "";
}// getBorderColorByLanguage

// Functions for displaying header END
interface StylesDict {
  [key: string]: string;
}

const stylesDict: StylesDict = {
  "codeblock.activeLineColor": 'codeblock-active-line-color',
  "editorActiveLineColor": 'editor-active-line-color',
  "codeblock.backgroundColor": 'codeblock-background-color',
  "codeblock.highlightColor.backgroundColor": 'codeblock-highlight-color',
  "codeblock.bracketHighlightColorMatch": 'codeblock-bracket-highlight-color-match',
  "codeblock.bracketHighlightColorNoMatch": 'codeblock-bracket-highlight-color-nomatch',
  "codeblock.bracketHighlightBackgroundColorMatch": 'codeblock-bracket-highlight-background-color-match',
  "codeblock.bracketHighlightBackgroundColorNoMatch": 'codeblock-bracket-highlight-background-color-nomatch',
  "codeblock.selectionMatchHighlightColor": 'codeblock-selectionmatch-highlight-color',
  "header.backgroundColor": 'header-background-color',
  "header.textColor": 'header-text-color',
  "header.lineColor": 'header-line-color',
  "gutter.textColor": 'gutter-text-color',
  "gutter.backgroundColor": 'gutter-background-color',
  "header.codeBlockLangTextColor": 'header-language-tag-text-color',
  "header.codeBlockLangBackgroundColor": 'header-language-tag-background-color',
  "gutter.activeLineNrColor": 'gutter-active-linenr-color',
  "inlineCode.backgroundColor": 'inline-code-background-color',
  "inlineCode.textColor": 'inline-code-text-color',
  "groupedCodeBlocks.activeTabBackgroundColor": 'groupedcodeblock-active-tab-color',
  "groupedCodeBlocks.activeTabTextColor": 'groupedcodeblock-active-tab-text-color',
  "groupedCodeBlocks.hoverTabBackgroundColor": 'groupedcodeblock-hover-tab-background-color',
  "groupedCodeBlocks.hoverTabTextColor": 'groupedcodeblock-hover-tab-text-color',
  "groupedCodeBlocks.headerLineColor": 'groupedcodeblock-header-line-color',
  "annotations.colors.note": "annotations-note-color",
  "annotations.colors.warn": "annotations-warn-color",
  "annotations.colors.error": "annotations-error-color",
  "annotations.colors.todo": "annotations-todo-color",
  "annotations.colors.question": "annotations-question-color",
  "annotations.colors.see": "annotations-see-color",
  "frontmatter.colors.atom": 'frontmatter-atom-color',
  "frontmatter.colors.meta": 'frontmatter-meta-color',
  "frontmatter.colors.string": 'frontmatter-string-color',
  "frontmatter.colors.keyword": 'frontmatter-keyword-color',
  "frontmatter.colors.number": 'frontmatter-number-color',
  "frontmatter.colors.comment": 'frontmatter-comment-color',
  "frontmatter.colors.unclassed": 'frontmatter-unclassed-color',
}// stylesDict

export function updateSettingStyles(settings: CodeblockCustomizerSettings, app: App) {
  const currentMode = getCurrentMode();

  const codeblockBackgroundColor = settings.SelectedTheme.colors[currentMode].codeblock.backgroundColor;
  const codeblockBackgroundValue = codeblockBackgroundColor.startsWith('--') ? `var(${codeblockBackgroundColor})` : codeblockBackgroundColor;
  const codeblockBackgroundFallback = `var(--codeblock-background-color, var(--codeblock-customizer-codeblock-background-color, ${codeblockBackgroundValue}))`;

  const getHighlightTextStyleProperties = (style: HighlightStyle): string => {
    const textDecorations: string[] = [];
    if (style.underline) {
      textDecorations.push('underline');
    }
    if (style.strikethrough) {
      textDecorations.push('line-through');
    }

    return [
      style.bold ? `font-weight: bold` : '',
      style.italic ? `font-style: italic` : '',
      style.fontFamily ? `font-family: ${style.fontFamily}` : '',
      style.useTextColor ? `color: ${style.textColor || '#000000'}` : '',
      textDecorations.length ? `text-decoration: ${textDecorations.join(' ')}` : '',
    ].filter(Boolean).map(prop => `${prop} !important`).join('; ');
  };

  // highlight of the whole inline code (e.g. `{cpp hl}code` or `{cpp imp}code`)
  const buildInlineCodeHighlightRules = (bgClass: string, backgroundValue: string | null, textStyleProperties: string): string => {
    let css = '';

    if (backgroundValue) {
      const backgroundSelectors = [
        `.${bgClass}`,
        `.codeblock-customizer.codeblock-customizer-style-inline-code .cm-s-obsidian span.cm-inline-code.${bgClass}`,
        `.codeblock-customizer.codeblock-customizer-style-inline-code .cm-s-obsidian span.cm-inline-code:has(.${bgClass})`,
        `.codeblock-customizer .cm-s-obsidian span.cm-inline-code.${bgClass}`,
        `.codeblock-customizer .cm-s-obsidian span.cm-inline-code:has(.${bgClass})`,
      ].join(', ');
      css += ` ${backgroundSelectors} { background-color: ${backgroundValue} !important; }`;
    }

    if (textStyleProperties) {
      const tokenSelectors = [
        `.${bgClass}`,
        `.markdown-source-view .${bgClass} [class^="cm-"]`,
        `.markdown-source-view .${bgClass} [class*="token"]`,
        `.markdown-rendered .${bgClass} .codeblock-customizer-inline-code-content`,
        `.markdown-rendered .${bgClass} [class*="token"]`,
        `.print .${bgClass} .codeblock-customizer-inline-code-content`,
        `.print .${bgClass} [class*="token"]`,
      ].join(', ');
      css += ` ${tokenSelectors} { ${textStyleProperties}; }`;
    }

    return css;
  };

  // highlighted lines in code blocks (hl:2) and highlighted text in code blocks and inline code (hlt:word)
  const buildLineAndTextHighlightRules = (lineClass: string, textClass: string, lineBackgroundColor: string, textSpanBackgroundColor: string, style: HighlightStyle): string => {
    const textStyleProperties = getHighlightTextStyleProperties(style);

    // line wrapper background
    let css = `.${lineClass} { ${lineBackgroundColor}; }`;

    if (textStyleProperties) {
      const tokenSelectors = [
        `.markdown-source-view .${lineClass} [class^="cm-"]`,
        `.markdown-source-view .${lineClass} [class*="token"]`,
        `.markdown-reading-view .${lineClass} .codeblock-customizer-indentation-guide`,
        `.markdown-reading-view .${lineClass} .codeblock-customizer-line-text`,
        `.markdown-reading-view .${lineClass} [class*="token"]`,
        `.print .${lineClass} .codeblock-customizer-indentation-guide`,
        `.print .${lineClass} .codeblock-customizer-line-text`,
        `.print .${lineClass} [class*="token"]`,
      ].join(', ');
      css += ` ${tokenSelectors} { ${textStyleProperties}; }`;
    }

    let textSpanProperties = textStyleProperties ? `${textSpanBackgroundColor}; ${textStyleProperties}` : textSpanBackgroundColor;
    // subscript only for highlighted text, relative positioning does not change the line height
    if (style.subscript) {
      textSpanProperties += `; font-size: 0.8em !important; position: relative !important; top: 0.1em !important`;
    }
    css += ` .${textClass} { ${textSpanProperties}; }`;

    return css;
  };

  let altHighlightStyling = '';
  for (const [colorName, style] of Object.entries(settings.SelectedTheme.colors[currentMode].codeblock.alternateHighlightColors || {})) {
    const cssColorName = colorName.replace(/\s+/g, '-').toLowerCase();
    const cssVariableName = `--codeblock-customizer-highlight-${cssColorName}-color`;
    const backgroundValue = style.backgroundColor.startsWith('--') ? `var(${cssVariableName})` : `var(${cssVariableName}, ${style.backgroundColor})`;
    const lineBackgroundColor = style.useBackgroundColor ? `background-color: ${backgroundValue} !important` : `background-color: ${codeblockBackgroundFallback} !important`;
    const textSpanBackgroundColor = style.useBackgroundColor ? `background-color: ${backgroundValue} !important` : `background-color: transparent !important`;

    altHighlightStyling += buildLineAndTextHighlightRules(
      `codeblock-customizer-line-highlighted-${cssColorName}`,
      `codeblock-customizer-highlighted-text-${cssColorName}`,
      lineBackgroundColor,
      textSpanBackgroundColor,
      style
    );
    altHighlightStyling += buildInlineCodeHighlightRules(
      `codeblock-customizer-inline-code-highlighted-${cssColorName}`,
      style.useBackgroundColor ? backgroundValue : null,
      getHighlightTextStyleProperties(style)
    );
  }

  const mainHighlightStyle = settings.SelectedTheme.colors[currentMode].codeblock.highlightColor;
  const mainBackgroundValue = 'var(--codeblock-customizer-codeblock-highlight-color)';
  const mainLineBackgroundColor = mainHighlightStyle.useBackgroundColor ? `background-color: ${mainBackgroundValue} !important` : `background-color: ${codeblockBackgroundFallback} !important`;
  const mainTextSpanBackgroundColor = mainHighlightStyle.useBackgroundColor ? `background-color: ${mainBackgroundValue} !important` : `background-color: transparent !important`;

  let mainHighlightExtraRules = buildLineAndTextHighlightRules(
    'codeblock-customizer-line-highlighted',
    'codeblock-customizer-highlighted-text',
    mainLineBackgroundColor,
    mainTextSpanBackgroundColor,
    mainHighlightStyle
  );
  mainHighlightExtraRules += buildInlineCodeHighlightRules(
    'codeblock-customizer-inline-code-highlighted',
    mainHighlightStyle.useBackgroundColor ? mainBackgroundValue : null,
    getHighlightTextStyleProperties(mainHighlightStyle)
  );

  const languageSpecificStyling = Object.entries(settings.SelectedTheme.colors[currentMode].languageSpecificColors || {}).reduce((styling, [language, attributes]) => {
    const languageStyling = Object.entries(attributes || {}).reduce((languageStyling, [attribute, hexValue]) => {
      const attributeName = attribute.toLowerCase().replace(/\./g, '-');

      const mappedAttributeName = stylesDict[attribute] || attributeName;
      let selector = `.codeblock-customizer-languageSpecific-${language.toLowerCase()}`;
      //.markdown-source-view .codeblock-customizer-languageSpecific-${language.toLowerCase()},
      let style = `${mappedAttributeName}: ${hexValue}`;
      if (mappedAttributeName === "codeblock-textcolor") {
        selector += `, 
            .markdown-source-view .codeblock-customizer-languageSpecific-${language.toLowerCase()} [class^="cm-"], 
            .markdown-reading-view .codeblock-customizer-languageSpecific-${language.toLowerCase()} .codeblock-customizer-line-text, 
            .markdown-reading-view .codeblock-customizer-languageSpecific-${language.toLowerCase()} .token,
            .print .codeblock-customizer-languageSpecific-${language.toLowerCase()} .codeblock-customizer-line-text,
            .print .codeblock-customizer-languageSpecific-${language.toLowerCase()} .token`;
        style = `color: ${hexValue} !important`;
      }
      if (mappedAttributeName === "codeblock-bracket-highlight-color-match" || mappedAttributeName === "codeblock-bracket-highlight-background-color-match") {
        selector += ` .codeblock-customizer-bracket-highlight-match`;
      }
      if (mappedAttributeName === "codeblock-bracket-highlight-color-nomatch" || mappedAttributeName === "codeblock-bracket-highlight-background-color-nomatch") {
        selector += ` .codeblock-customizer-bracket-highlight-nomatch`;
      }

      return languageStyling + `
          ${selector} {
            ${mappedAttributeName === "codeblock-textcolor" ? '' : '--'}${style};
          }
        `;
    }, '');

    return styling + languageStyling;
  }, '');

  const groupedHeaderStyles = `
    .codeblock-customizer-header-group-container,
    .codeblock-customizer-header-container-specific:has(.codeblock-customizer-header-group-tabs) {
      --codeblock-customizer-header-line-color: var(--codeblock-customizer-groupedcodeblock-header-line-color);
    }
  `;

  const textSettingsStyles = `
    body.codeblock-customizer .codeblock-customizer-header-language-tag,
    body.codeblock-customizer .codeblock-customizer-header-group-tab {
      --codeblock-customizer-language-tag-text-bold: ${settings.pluginSettings.header.codeblockLangBoldText ? 'bold' : 'normal'};
      --codeblock-customizer-language-tag-text-italic: ${settings.pluginSettings.header.codeblockLangItalicText ? 'italic' : 'normal'};
    }
    body.codeblock-customizer .codeblock-customizer-header-text {
      --codeblock-customizer-header-text-bold: ${settings.pluginSettings.header.boldText ? 'bold' : 'normal'};
      --codeblock-customizer-header-text-italic: ${settings.pluginSettings.header.italicText ? 'italic' : 'normal'};
    }
  `;

  const theme = ((app.vault as typeof app.vault & { getConfig: (key: string) => string | undefined }).getConfig("cssTheme")) ?? "";
  let minimalSpecificStyling: string;
  if (theme.toLowerCase() === "minimal") {
    minimalSpecificStyling = `
    .markdown-source-view.is-readable-line-width .indented-line {
      left: calc(var(--list-indent) * calc(var(--level) * 0.5)) !important;
      width: calc(var(--line-width) - calc(var(--list-indent) * var(--level))) !important;
    }
    `;
  } else {
    minimalSpecificStyling = `
    .markdown-source-view.is-readable-line-width .indented-line {
      left: calc(var(--list-indent) * var(--level));
      width: calc(100% - var(--list-indent) * var(--level));
    }
    `;
  }
  const promptColorStyles = generatePromptColorStyles(settings);

  const annotationColors = settings.SelectedTheme.colors[currentMode].annotations?.colors || {};
  const annotationVars = Object.entries(annotationColors).map(([type, hexValue]) => {
    const varName = `--codeblock-customizer-annotations-${type}-color`;
    return `${varName}: ${hexValue};`;
  }).join(' ');

  const annotationRules = Object.keys(annotationColors).map(type => {
    const varName = `--codeblock-customizer-annotations-${type}-color`;
    return `
      .codeblock-customizer-annotation-icon-${type},
      .codeblock-customizer-annotation-title-${type} {
        color: var(${varName});
      }
      .codeblock-customizer-tooltip-${type} {
        border-top: 3px solid var(${varName});
      }
    `;
  }).join(' ');

  const defaultAnnotationCommentStyle = `
    .codeblock-customizer-annotation-source-comment {
      display: none;
      user-select: none;
      -webkit-user-select: none;
    }
  `;

  let printRules: string;
  if (settings.pluginSettings.printing.printAnnotationsAsComments) {
    printRules = `
      .print .codeblock-customizer-annotation-icon {
        display: none !important;
      }
      .print .codeblock-customizer-annotation-source-comment {
        display: inline !important;
      }
    `;
  } else {
    printRules = Object.keys(annotationColors).map(type => {
      const varName = `--codeblock-customizer-annotations-${type}-color`;
      return `
        .print .codeblock-customizer-annotation-icon-${type} {
          color: var(${varName}) !important;
          -webkit-print-color-adjust: exact !important;
        }
      `;
    }).join('') + `
      .print .codeblock-customizer-annotation-source-comment {
        display: none !important;
      }
    `;
  }

  const annotationStyling = `
    body.codeblock-customizer.theme-${currentMode} {
      ${annotationVars}
    }
    .print body {
      ${annotationVars}
    }
    ${annotationRules}
    ${defaultAnnotationCommentStyle}
    ${printRules}
  `;

  const syntaxThemeStyles = generateSyntaxThemeStyles(settings);

  let inlineCodeExtraRules = '';
  if (settings.pluginSettings.inlineCode.enableInlineCodeStyling) {
    const inlineCode = settings.SelectedTheme.colors[currentMode].inlineCode;
    const inlineCodeDecorations: string[] = [];

    if (inlineCode.underline) {
      inlineCodeDecorations.push('underline');
    }
    if (inlineCode.strikethrough) {
      inlineCodeDecorations.push('line-through');
    }

    const inlineCodeStyles = [
      inlineCode.bold ? `font-weight: bold` : '',
      inlineCode.italic ? `font-style: italic` : '',
      inlineCode.fontFamily ? `font-family: ${inlineCode.fontFamily}` : '',
      inlineCodeDecorations.length ? `text-decoration: ${inlineCodeDecorations.join(' ')}` : '',
    ].filter(Boolean).map(p => `${p} !important`).join('; ');

    if (inlineCodeStyles) {
      const inlineCodeSelector = `.codeblock-customizer.codeblock-customizer-style-inline-code`;
      inlineCodeExtraRules = `${inlineCodeSelector} .cm-s-obsidian span.cm-inline-code, ${inlineCodeSelector} .markdown-rendered :not(pre)>code.codeblock-customizer-inline-code { ${inlineCodeStyles}; }`;
    }
  }

  const cssText = (formatStyles(settings.SelectedTheme.colors, settings.pluginSettings, settings.pluginSettings.printing.forceCurrentColorUse) + mainHighlightExtraRules + altHighlightStyling + languageSpecificStyling + groupedHeaderStyles + textSettingsStyles + minimalSpecificStyling + promptColorStyles + annotationStyling + syntaxThemeStyles + inlineCodeExtraRules).trim().replace(/[\r\n\s]+/g, ' ');

  for (const doc of getTargetDocuments(app)) {
    let styleTag = doc.getElementById(SETTING_STYLE_ID);
    if (!styleTag) {
      const head = doc.head || doc.getElementsByTagName('head')[0];
      if (!head) {
        continue;
      }
      // Dynamic user CSS variables, highlights, language rules, and syntax themes require a <style> tag so Obsidian's Export to PDF preserves styling (adoptedStyleSheets is ignored by PDF export)
      styleTag = head.createEl('style', { attr: { id: SETTING_STYLE_ID } });
    }
    styleTag.textContent = cssText;
  }

  updateSettingClasses(settings.pluginSettings, app);
}// updateSettingStyles

export function updateSettingClasses(settings: PluginSettings, app?: App) {
  for (const doc of getTargetDocuments(app)) {
    const body = doc.body;
    if (!body) {
      continue;
    }
    applySettingClassesToBody(body, settings);
  }
}// updateSettingClasses

function applySettingClassesToBody(body: HTMLElement, settings: PluginSettings) {
  body.classList.add('codeblock-customizer');
  body.classList.remove("codeblock-customizer-active-line-highlight", "codeblock-customizer-active-line-highlight-codeblock", "codeblock-customizer-active-line-highlight-editor")
  if (settings.enableEditorActiveLineHighlight && settings.codeblock.enableActiveLineHighlight) {
    // Inside and outside of codeblocks with different colors
    body.classList.add("codeblock-customizer-active-line-highlight");
  } else if (settings.enableEditorActiveLineHighlight && !settings.codeblock.enableActiveLineHighlight) {
    // Only outside codeblocks
    body.classList.add("codeblock-customizer-active-line-highlight-editor");
  } else if (!settings.enableEditorActiveLineHighlight && settings.codeblock.enableActiveLineHighlight) {
    // Only inside codeblocks
    body.classList.add("codeblock-customizer-active-line-highlight-codeblock");
  }

  if (settings.codeblock.enableLineNumbers) {
    body.classList.add("codeblock-customizer-show-line-numbers");
  } else {
    body.classList.remove("codeblock-customizer-show-line-numbers");
  }

  body.classList.remove("codeblock-customizer-show-langnames", "codeblock-customizer-show-langnames-always");
  if (settings.header.alwaysDisplayCodeblockLang && settings.header.displayCodeBlockLanguage) {
    body.classList.add("codeblock-customizer-show-langnames-always");
  } else if (settings.header.displayCodeBlockLanguage) {
    body.classList.add("codeblock-customizer-show-langnames");
  }

  body.classList.remove("codeblock-customizer-show-langicons", "codeblock-customizer-show-langicons-always");
  if (settings.header.alwaysDisplayCodeblockIcon && settings.header.displayCodeBlockIcon) {
    body.classList.add("codeblock-customizer-show-langicons-always");
  } else if (settings.header.displayCodeBlockIcon) {
    body.classList.add("codeblock-customizer-show-langicons");
  }

  if (settings.gutter.enableHighlight) {
    body.classList.add('codeblock-customizer-gutter-highlight');
  } else {
    body.classList.remove('codeblock-customizer-gutter-highlight');
  }

  if (settings.gutter.highlightActiveLineNr)
    body.classList.add('codeblock-customizer-gutter-active-line');
  else
    body.classList.remove('codeblock-customizer-gutter-active-line');

  if (settings.header.collapseIconPosition === "hide") {
    body.classList.add('codeblock-customizer-collapseIconNone');
    body.classList.remove('codeblock-customizer-collapseIconMiddle');
    body.classList.remove('codeblock-customizer-collapseIconRight');
  } else if (settings.header.collapseIconPosition === "middle") {
    body.classList.remove('codeblock-customizer-collapseIconNone');
    body.classList.remove('codeblock-customizer-collapseIconRight');
    body.classList.add('codeblock-customizer-collapseIconMiddle');
  } else if (settings.header.collapseIconPosition === "right") {
    body.classList.remove('codeblock-customizer-collapseIconNone');
    body.classList.remove('codeblock-customizer-collapseIconMiddle');
    body.classList.add('codeblock-customizer-collapseIconRight');
  }

  if (settings.codeblock.buttons.enableDeleteCodeButton)
    body.classList.add('codeblock-customizer-show-delete-code-button');
  else
    body.classList.remove('codeblock-customizer-show-delete-code-button');

  if (settings.inlineCode.enableInlineCodeStyling) {
    body.classList.add('codeblock-customizer-style-inline-code');
  } else {
    body.classList.remove('codeblock-customizer-style-inline-code');
  }

  if (settings.codeblock.codeBlockBorderStylingPosition === "disable") {
    body.classList.remove('codeblock-customizer-style-codeblock-border-left');
    body.classList.remove('codeblock-customizer-style-codeblock-border-right');
  } else if (settings.codeblock.codeBlockBorderStylingPosition === "left") {
    body.classList.remove('codeblock-customizer-style-codeblock-border-right');
    body.classList.add('codeblock-customizer-style-codeblock-border-left');
  } else if (settings.codeblock.codeBlockBorderStylingPosition === "right") {
    body.classList.remove('codeblock-customizer-style-codeblock-border-left');
    body.classList.add('codeblock-customizer-style-codeblock-border-right');
  }

  if (settings.semiFold.enableSemiFold) {
    body.classList.add('codeblock-customizer-use-semifold');
  } else {
    body.classList.remove('codeblock-customizer-use-semifold');
  }

  body.classList.remove('codeblock-customizer-semifold-effect-opacity');
  body.classList.remove('codeblock-customizer-semifold-effect-blur');
  if (settings.semiFold.semifoldEffect === SemiFoldEffect.Opacity) {
    body.classList.add('codeblock-customizer-semifold-effect-opacity');
  } else if (settings.semiFold.semifoldEffect === SemiFoldEffect.Blur) {
    body.classList.add('codeblock-customizer-semifold-effect-blur');
  } else {
    body.classList.add('codeblock-customizer-semifold-effect-opacity');
    body.classList.add('codeblock-customizer-semifold-effect-blur');
  }

  if (settings.semiFold.showAdditionalUncollapseButon) {
    body.classList.add('codeblock-customizer-show-uncollapse-code-button');
  } else {
    body.classList.remove('codeblock-customizer-show-uncollapse-code-button');
  }

  if (settings.codeblock.showIndentationLines) {
    body.classList.add('codeblock-customizer-show-indentation-lines');
  } else {
    body.classList.remove('codeblock-customizer-show-indentation-lines');
  }

  if (settings.codeblock.buttons.enableSelectCodeButton) {
    body.classList.add('codeblock-customizer-show-select-code-button');
  } else {
    body.classList.remove('codeblock-customizer-show-select-code-button');
  }

  if (settings.codeblock.buttons.enableWrapCodeButton) {
    body.classList.add('codeblock-customizer-show-wrap-code-button');
  } else {
    body.classList.remove('codeblock-customizer-show-wrap-code-button');
  }

  if (settings.codeblock.buttons.alwaysShowCopyCodeButton) {
    body.classList.add('codeblock-customizer-always-show-copy-code-button');
  } else {
    body.classList.remove('codeblock-customizer-always-show-copy-code-button');
  }

  if (settings.inlineCode.showIcons) {
    body.classList.add('codeblock-customizer-show-inline-code-icons');
  } else {
    body.classList.remove('codeblock-customizer-show-inline-code-icons');
  }

  if (settings.plugins.executeCode.styleOutput) {
    body.classList.add('codeblock-customizer-style-execute-code-output');
  } else {
    body.classList.remove('codeblock-customizer-style-execute-code-output');
  }

  if (settings.codeblock.buttons.enableSnapshotButton) {
    body.classList.add('codeblock-customizer-show-snapshot-code-button');
  } else {
    body.classList.remove('codeblock-customizer-show-snapshot-code-button');
  }

  if (settings.groupedCodeBlocks.showAddRemoveButtons) {
    body.classList.add('codeblock-customizer-show-grouped-add-remove-buttons');
  } else {
    body.classList.remove('codeblock-customizer-show-grouped-add-remove-buttons');
  }

  if (settings.plugins.executeCode.enabled) {
    body.classList.add('codeblock-customizer-support-execute-code');
  } else {
    body.classList.remove('codeblock-customizer-support-execute-code');
  }

  if (settings.codeblock.lineNumberSeparatorStyle === LineNumberSeparatorStyle.Zigzag) {
    body.classList.remove('codeblock-customizer-linenumberseparator-dashed');
    body.classList.remove('codeblock-customizer-linenumberseparator-doubleline');
    body.classList.add('codeblock-customizer-linenumberseparator-zigzag');
  } else if (settings.codeblock.lineNumberSeparatorStyle === LineNumberSeparatorStyle.DoubleLine) {
    body.classList.remove('codeblock-customizer-linenumberseparator-dashed');
    body.classList.remove('codeblock-customizer-linenumberseparator-zigzag');
    body.classList.add('codeblock-customizer-linenumberseparator-doubleline');
  } else if (settings.codeblock.lineNumberSeparatorStyle === LineNumberSeparatorStyle.Dashed) {
    body.classList.remove('codeblock-customizer-linenumberseparator-zigzag');
    body.classList.remove('codeblock-customizer-linenumberseparator-doubleline');
    body.classList.add('codeblock-customizer-linenumberseparator-dashed');
  }

  if (settings.codeblock.hiddenLinesStyle === HiddenLinesStyle.Zigzag) {
    body.classList.remove('codeblock-customizer-hidden-lines-dashed');
    body.classList.remove('codeblock-customizer-hidden-lines-doubleline');
    body.classList.add('codeblock-customizer-hidden-lines-zigzag');
  } else if (settings.codeblock.hiddenLinesStyle === HiddenLinesStyle.DoubleLine) {
    body.classList.remove('codeblock-customizer-hidden-lines-dashed');
    body.classList.remove('codeblock-customizer-hidden-lines-zigzag');
    body.classList.add('codeblock-customizer-hidden-lines-doubleline');
  } else if (settings.codeblock.hiddenLinesStyle === HiddenLinesStyle.Dashed) {
    body.classList.remove('codeblock-customizer-hidden-lines-zigzag');
    body.classList.remove('codeblock-customizer-hidden-lines-doubleline');
    body.classList.add('codeblock-customizer-hidden-lines-dashed');
  }

  if (settings.plugins.executeCode.executeCodeSeparatorStyle === ExecuteCodeSeparatorStyle.Zigzag) {
    body.classList.remove('codeblock-customizer-execute-code-separator-dashed');
    body.classList.remove('codeblock-customizer-execute-code-separator-doubleline');
    body.classList.add('codeblock-customizer-execute-code-separator-zigzag');
  } else if (settings.plugins.executeCode.executeCodeSeparatorStyle === ExecuteCodeSeparatorStyle.DoubleLine) {
    body.classList.remove('codeblock-customizer-execute-code-separator-dashed');
    body.classList.remove('codeblock-customizer-execute-code-separator-zigzag');
    body.classList.add('codeblock-customizer-execute-code-separator-doubleline');
  } else if (settings.plugins.executeCode.executeCodeSeparatorStyle === ExecuteCodeSeparatorStyle.Dashed) {
    body.classList.remove('codeblock-customizer-execute-code-separator-zigzag');
    body.classList.remove('codeblock-customizer-execute-code-separator-doubleline');
    body.classList.add('codeblock-customizer-execute-code-separator-dashed');
  }

  if (settings.frontmatter.enableFrontmatterStyling) {
    body.classList.add('codeblock-customizer-style-frontmatter');
  } else {
    body.classList.remove('codeblock-customizer-style-frontmatter');
  }

  if (settings.common.disableEditorSyntaxHighlight) {
    body.classList.add('codeblock-customizer-disable-editor-syntax-highlight');
  } else {
    body.classList.remove('codeblock-customizer-disable-editor-syntax-highlight');
  }

}// applySettingClassesToBody

function formatStyles(colors: ThemeColors, settings: PluginSettings, forceCurrentColorUse: boolean) {
  return `
    body.codeblock-customizer {
      --wrap-code:${settings.codeblock.unwrapcode ? 'pre' : 'pre-wrap'}
    }
    body.codeblock-customizer.theme-light {
      ${Object.keys(stylesDict).reduce((variables, key) => {
    const cssVariable = `--codeblock-customizer-${stylesDict[key]}`;
    let cssValue = accessSetting(key, forceCurrentColorUse ? colors[getCurrentMode()] : colors.light);

    if (cssValue != null) {
      if (cssValue.toString().startsWith("--")) {
        cssValue = "var(" + cssValue + ")";
      }
      return variables + `${cssVariable}: ${cssValue};`;
    } else {
      return variables;
    }
  }, addAltHighlightColors(colors.light.codeblock.alternateHighlightColors))}
    } 
    body.codeblock-customizer.theme-dark {
      ${Object.keys(stylesDict).reduce((variables, key) => {
    const cssVariable = `--codeblock-customizer-${stylesDict[key]}`;
    let cssValue = accessSetting(key, forceCurrentColorUse ? colors[getCurrentMode()] : colors.dark);

    if (cssValue != null) {
      if (cssValue.toString().startsWith("--")) {
        cssValue = "var(" + cssValue + ")";
      }
      return variables + `${cssVariable}: ${cssValue};`;
    } else {
      return variables;
    }
  }, addAltHighlightColors(colors.dark.codeblock.alternateHighlightColors))}
    }
  `;
}// formatStyles

export function getColorOfCssVariable(cssVariable: string) {
  const body = getTargetDocuments()[0]?.body ?? activeDocument.body;
  const computedStyle = (body.ownerDocument?.defaultView ?? window).getComputedStyle(body);
  const colorValue = computedStyle.getPropertyValue(cssVariable).trim();

  if (colorValue.startsWith("rgb"))
    return rgbOrRgbaToHex(colorValue);
  if (colorValue.startsWith("hsl"))
    return hslOrHslaToHex(colorValue);
  if (colorValue.startsWith("#"))
    return colorValue;
  else
    return "";
}// getColorOfCssVariable

function rgbOrRgbaToHex(color: string): string {
  const matchRGBA = color.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d*\.?\d+)\s*\)$/);
  const matchRGB = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);

  if (matchRGBA) {
    const red = Number(matchRGBA[1]);
    const green = Number(matchRGBA[2]);
    const blue = Number(matchRGBA[3]);
    const alpha = parseFloat(matchRGBA[4]); // Convert alpha to float

    if (isNaN(alpha) || alpha < 0 || alpha > 1) {
      throw new Error('Invalid alpha value in rgba format.');
    }

    const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, '0');
    return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}${alphaHex}`;
  } else if (matchRGB) {
    const red = Number(matchRGB[1]);
    const green = Number(matchRGB[2]);
    const blue = Number(matchRGB[3]);

    return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;
  } else {
    return "";
  }
}// rgbOrRgbaToHex

function hslOrHslaToHex(hslColor: string): string {
  const matchHSLA = hslColor.match(/^hsla?\((\d+),\s*(\d+)%,\s*(\d+)%,?\s*(\d*\.?\d+)?\)$/i);

  if (!matchHSLA) {
    return "";
  }

  const h = Number(matchHSLA[1]);
  const s = Number(matchHSLA[2]);
  const l = Number(matchHSLA[3]);
  const a = matchHSLA[4] !== undefined ? Number(matchHSLA[4]) : 1;

  // Convert HSLA to HSL (remove alpha component)
  const hsl = `hsl(${h}, ${s}%, ${l}%)`;

  // Convert HSL to hex
  const hexColor = hslToHex(hsl, a);

  // Append the alpha value to the hex string if it's not fully opaque
  if (a < 1) {
    const alphaHex = Math.round(a * 255).toString(16).padStart(2, '0');
    return `${hexColor}${alphaHex}`;
  }

  return hexColor;
}//hslOrHslaToHex

function hslToHex(hslColor: string, alpha: number): string {
  const matchHSL = hslColor.match(/^hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)$/i);

  if (!matchHSL) {
    return "";
  }

  const h = Number(matchHSL[1]);
  const s = Number(matchHSL[2]);
  const l = Number(matchHSL[3]);

  // Convert the hue to a value between 0 and 360
  const hue = (h % 360 + 360) % 360;

  // Ensure the saturation and lightness values are within the valid range [0, 100]
  const saturation = Math.max(0, Math.min(100, s));
  const lightness = Math.max(0, Math.min(100, l));

  // Convert the saturation and lightness values to the range [0, 1]
  const normalizedSaturation = saturation / 100;
  const normalizedLightness = lightness / 100;

  // Calculate the chroma and intermediate values
  const chroma = (1 - Math.abs(2 * normalizedLightness - 1)) * normalizedSaturation;
  const hPrime = hue / 60;
  const x = chroma * (1 - Math.abs((hPrime % 2) - 1));

  // Calculate RGB values based on the hue value
  let r, g, b;
  if (0 <= hPrime && hPrime < 1) {
    [r, g, b] = [chroma, x, 0];
  } else if (1 <= hPrime && hPrime < 2) {
    [r, g, b] = [x, chroma, 0];
  } else if (2 <= hPrime && hPrime < 3) {
    [r, g, b] = [0, chroma, x];
  } else if (3 <= hPrime && hPrime < 4) {
    [r, g, b] = [0, x, chroma];
  } else if (4 <= hPrime && hPrime < 5) {
    [r, g, b] = [x, 0, chroma];
  } else {
    [r, g, b] = [chroma, 0, x];
  }

  // Calculate m (brightness adjustment)
  const m = normalizedLightness - chroma / 2;

  // Scale the RGB values and convert them to the range [0, 255]
  const red = Math.round((r + m) * 255);
  const green = Math.round((g + m) * 255);
  const blue = Math.round((b + m) * 255);

  // Convert the RGB values to hexadecimal
  const hexColor = `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;

  // Append the alpha value to the hex string if it's not fully opaque
  if (alpha < 1) {
    const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, '0');
    return `${hexColor}${alphaHex}`;
  }

  return hexColor;
}// hslToHex

function addAltHighlightColors(alternateColors: Record<string, HighlightStyle>) {
  return Object.entries(alternateColors).reduce((result, [colorName, style]) => {
    const cssName = colorName.replace(/\s+/g, '-').toLowerCase();
    const backgroundColor = style.backgroundColor.startsWith('--') ? `var(${style.backgroundColor})` : style.backgroundColor;
    return result + `--codeblock-customizer-highlight-${cssName}-color: ${backgroundColor};`;
  }, '');
}// addAltHighlightColors

function accessSetting(key: string, settings: Colors): string | null {
  const keys = key.split('.');
  let value: Record<string, unknown> | Colors = settings;
  for (const k of keys) {
    if (value && k in value) {
      value = (value as Record<string, unknown>)[k] as Record<string, unknown>;
    } else {
      return null;
    }
  }
  return value as unknown as string | null;
}// accessSetting

export function removeCharFromStart(input: string, charToRemove: string): string {
  let startIndex = 0;
  while (startIndex < input.length && (input[startIndex] === charToRemove || input[startIndex] === ' ')) {
    startIndex++;
  }

  return input.slice(startIndex);
}// removeCharFromStart

export function isSourceMode(state: EditorState): boolean {
  if (!state.field(editorLivePreviewField))
    return true;
  return false;
}// isSourceMode

export async function addTextToClipboard(content: string) {
  try {
    await navigator.clipboard.writeText(content);
    new Notice("Copied to your clipboard");
  } catch (error) {
    console.error(error);
    new Notice("Could not copy to your clipboard");
  }
}// addTextToClipboard

export function getLanguageSpecificColorClass(codeblockLanguage: string, languageSpecificColors: Record<string, Record<string, string>> | null, languageSpecificColor?: Record<string, string>) {
  let codeblockLanguageSpecificClass = "";
  const language = codeblockLanguage.length > 0 ? codeblockLanguage : "nolang";
  const lowerCaseLanguage = language.toLowerCase();

  // Check if languageSpecificColors contains properties
  if (languageSpecificColors) {
    const result = Object.keys(languageSpecificColors).find(key => key.toLowerCase() === lowerCaseLanguage);

    if (result && Object.keys(languageSpecificColors[result]).length > 0) {
      codeblockLanguageSpecificClass = "codeblock-customizer-languageSpecific-" + lowerCaseLanguage;
    }
  }

  // Check if additionalColors contains properties
  if (languageSpecificColor && Object.keys(languageSpecificColor).length > 0) {
    codeblockLanguageSpecificClass += "codeblock-customizer-languageSpecific-" + lowerCaseLanguage;
  }

  return codeblockLanguageSpecificClass;
}// getLanguageSpecificColorClass

export function findAllOccurrences(mainString: string, substring: string): number[] {
  const indices: number[] = [];
  let currentIndex = mainString.indexOf(substring);

  while (currentIndex !== -1) {
    indices.push(currentIndex);
    currentIndex = mainString.indexOf(substring, currentIndex + substring.length);
  }

  return indices;
}// findAllOccurrences

export function mergeBorderColorsToLanguageSpecificColors(app: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings) {
  const borderColors = settings.SelectedTheme.colors[getCurrentMode()].codeblock.languageBorderColors;

  Object.entries(borderColors).forEach(([languageName]) => {
    if (!settings.SelectedTheme.colors.light.languageSpecificColors[languageName]) {
      settings.SelectedTheme.colors.light.languageSpecificColors[languageName] = {};
    }
    if (!settings.SelectedTheme.colors.dark.languageSpecificColors[languageName]) {
      settings.SelectedTheme.colors.dark.languageSpecificColors[languageName] = {};
    }

    settings.SelectedTheme.colors.light.languageSpecificColors[languageName]['codeblock.borderColor'] = settings.SelectedTheme.colors.light.codeblock.languageBorderColors[languageName];
    settings.SelectedTheme.colors.dark.languageSpecificColors[languageName]['codeblock.borderColor'] = settings.SelectedTheme.colors.dark.codeblock.languageBorderColors[languageName];

    delete settings.SelectedTheme.colors.light.codeblock.languageBorderColors[languageName];
    delete settings.SelectedTheme.colors.dark.codeblock.languageBorderColors[languageName];
  });
  void app.saveSettings();

}// mergeBorderColorsToLanguageSpecificColors

export function getPropertyFromLanguageSpecificColors(propertyName: string, settings: CodeblockCustomizerSettings): Record<string, string> {
  const languageColors: Record<string, Record<string, string>> = settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors;
  const result: Record<string, string> = {};

  Object.entries(languageColors).forEach(([languageName, properties]) => {
    if ((properties)[propertyName]) {
      result[languageName] = (properties)[propertyName];
    }
  });

  return result;
}// getPropertyFromLanguageSpecificColors

export async function getFileCacheAndContentLines(plugin: CodeBlockCustomizerPlugin, filePath: string): Promise<{ cache: CachedMetadata | null, fileContentLines: string[] | null }> {
  if (filePath === '')
    return { cache: null, fileContentLines: null };

  const cache = plugin.app.metadataCache.getCache(filePath);
  if (!cache)
    return { cache: null, fileContentLines: null };

  const file = plugin.app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) {
    console.error(`File not found: ${filePath}`);
    return { cache, fileContentLines: null };
  }

  const fileContent = await plugin.app.vault.cachedRead(file).catch((error: unknown) => {
    console.error(`Error reading file: ${error instanceof Error ? error.message : String(error)}`);
    return '';
  });

  const fileContentLines = fileContent.split(/\n/g);

  return { cache, fileContentLines };
}// getFileCacheAndContentLines

export function addIndentation(input: string[]): string[] {
  const addSpaces = (line: string) => '    ' + line; // Add 4 spaces

  return input.map(addSpaces);
}// addIndentation

export function removeIndentation(input: string[]): string[] {
  const removeSpaces = (line: string) => line.startsWith('    ') ? line.slice(4) : line;

  return input.map(removeSpaces);
}// removeIndentation

function findCodeBlockLinesInEditor(editor: Editor, line: number): { start: number, end: number } | null {
  let openFence: { line: number, fence: string } | null = null;

  for (let i = 0; i < editor.lineCount(); i++) {
    const lineText = editor.getLine(i);
    const fence = lineText.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (!fence) {
      continue;
    }

    if (!openFence) {
      openFence = { line: i, fence };
    } else if (fence[0] === openFence.fence[0] && fence.length >= openFence.fence.length && lineText.trim() === fence) {
      if (line >= openFence.line && line <= i) {
        return { start: openFence.line, end: i };
      }
      openFence = null;
    }
  }

  return null;
}// findCodeBlockLinesInEditor

async function changeCodeBlockIndentation(editor: Editor, changeIndentation: (lines: string[]) => string[]) {
  const block = findCodeBlockLinesInEditor(editor, editor.getCursor().line);
  if (!block) {
    return;
  }

  const codeBlockLines: string[] = [];
  for (let i = block.start; i <= block.end; i++) {
    codeBlockLines.push(editor.getLine(i));
  }

  const pos: EditorPosition = { line: block.start, ch: 0 };
  const endPos: EditorPosition = { line: block.end, ch: editor.getLine(block.end).length };
  editor.replaceRange(changeIndentation(codeBlockLines).join('\n'), pos, endPos);
}// changeCodeBlockIndentation

export async function indentCodeBlock(editor: Editor) {
  await changeCodeBlockIndentation(editor, addIndentation);
}// indentCodeBlock

export async function unIndentCodeBlock(editor: Editor) {
  await changeCodeBlockIndentation(editor, removeIndentation);
}// unIndentCodeBlock

export function getInlineCodeIcon(displayLanguage: string, additionalClass?: string) {
  const container = createSpan({ cls: `codeblock-customizer-inline-code-icon-container` });
  if (additionalClass)
    container.classList.add(additionalClass);

  const iconSpan = createSpan({ cls: `codeblock-customizer-inline-icon-wrapper` }); // these icons must be in an SPAN not a DIV... have to change this later
  const iconDiv = createCodeblockIcon(displayLanguage, `codeblock-customizer-inline-code-icon`);
  if (iconDiv.firstChild) {
    iconSpan.appendChild(iconDiv.firstChild);
  }
  container.appendChild(iconSpan);

  return container;
}// getInlineCodeIcon

export function isPluginLoaded(pluginId: string, plugin: CodeBlockCustomizerPlugin) {
  type AppWithPlugins = App & { plugins?: { plugins?: Record<string, unknown> } };
  if ((plugin?.app as AppWithPlugins | undefined)?.plugins?.plugins?.[pluginId])
    return true;

  return false;
}// isPluginLoaded

export interface RenderOptions {
  htmlLines: string[],
  textLines: string[],
  lineCount: number,
  parameters: CBCParameters;
  plugin: CodeBlockCustomizerPlugin;
  settings: PluginSettings;
  sourcePath: string;
  target?: 'code' | 'codeOutput';
  handleAnnotations?: boolean;
  processPrompts?: boolean;
  addIndentationGuides?: boolean;
  parseLinks?: boolean;
  isPrinting?: boolean;
}

export function normalizeIndentation(lines: string[]): string[] {
  const getLeadingWhitespace = (s: string) => s.match(/^\s*/)?.[0] || '';
  const nonEmptyLines = lines.filter(line => line.trim() !== '');

  if (nonEmptyLines.length === 0) {
    return lines;
  }

  const minIndentLength = Math.min(...nonEmptyLines.map(line => getLeadingWhitespace(line).length));

  if (minIndentLength > 0) {
    return lines.map(line => line.substring(minIndentLength));
  }

  return lines;
}// normalizeIndentation

export function removeFenceIndentation(lines: string[], fenceLine: string): string[] {
  const fenceIndent = fenceLine.match(/^[ \t]*/)?.[0].length ?? 0;
  if (fenceIndent === 0) {
    return lines;
  }

  return lines.map(line => {
    let i = 0;
    while (i < fenceIndent && (line[i] === ' ' || line[i] === '\t')) {
      i++;
    }
    return line.substring(i);
  });
}// removeFenceIndentation

export async function generateSnapshot(elementToSnapshot: HTMLElement, originalElement: HTMLElement, appendTo: HTMLElement, settings: CodeblockCustomizerSettings, parameters: CBCParameters, options?: Parameters<typeof toBlob>[1]): Promise<void> {
  const offscreenWrapper = createDiv({ cls: 'codeblock-customizer-snapshot-offscreen' });
  const { gutterBgColor, codeBgColor } = getSnapshotColors(settings, parameters.language);

  try {
    const userMaxWidth = settings.pluginSettings.codeblock.buttons.snapshotMaxWidth;
    elementToSnapshot.style.width = `${userMaxWidth ?? originalElement.clientWidth}px`;

    offscreenWrapper.appendChild(elementToSnapshot);
    appendTo.appendChild(offscreenWrapper);

    // the '+' and 'x' buttons on grouped code blocks must be removed so they don't take up any space
    elementToSnapshot.querySelectorAll(
      '.codeblock-customizer-tab-remove, ' +
      '.codeblock-customizer-tab-add'
    ).forEach(el => el.remove());

    // restore original padding
    if (settings.pluginSettings.groupedCodeBlocks.showAddRemoveButtons) {
      elementToSnapshot.querySelectorAll('.codeblock-customizer-header-group-tab')
        .forEach(tab => {
          tab.classList.add('codeblock-customizer-snapshot-restore-tab-padding');
        });
    }

    const gutterEl = elementToSnapshot.querySelector<HTMLElement>('.codeblock-customizer-line-number, .codeblock-customizer-line-number-specific');
    const gutterWidth = gutterEl?.offsetWidth;

    if (gutterWidth && gutterWidth > 0) {
      const gradientBackground = `linear-gradient(to right, ${gutterBgColor} ${gutterWidth}px, ${codeBgColor} ${gutterWidth}px)`;
      elementToSnapshot.style.background = gradientBackground;

      elementToSnapshot.querySelectorAll<HTMLElement>('.cm-line, [class*="codeblock-customizer-line-"]').forEach(line => {
        const isHighlighted = line.matches('[class*="codeblock-customizer-line-highlighted"]');

        if (isHighlighted) {
          const highlightColor = window.getComputedStyle(line).backgroundColor;

          if (settings.pluginSettings.gutter.enableHighlight) {
            line.style.background = highlightColor;
          } else {
            line.style.background = `linear-gradient(to right, ${gutterBgColor} ${gutterWidth}px, ${highlightColor} ${gutterWidth}px)`;
          }
        } /*else {
          line.style.background = 'transparent';
        }*/
      });
    } else {
      // gutter is hidden
      elementToSnapshot.style.backgroundColor = codeBgColor;
    }

    const width = elementToSnapshot.clientWidth;
    const height = elementToSnapshot.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const pixelRatio = (dpr === 1) ? 1 : Math.max(Math.ceil(dpr), 2);// 3 would be for 250% or 300% scaling

    const blobOptions = { pixelRatio: pixelRatio, width: width, height: height, ...options, };

    const dataBlob = await toBlob(elementToSnapshot, blobOptions);
    if (!dataBlob) {
      throw new Error("Failed to generate image blob.");
    }

    const canvasWidth = width * pixelRatio;
    const canvasHeight = height * pixelRatio;
    const canvas = createEl('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error("Could not create canvas context.");
    }

    const borderRadius = 5 * pixelRatio;
    ctx.beginPath();
    ctx.moveTo(borderRadius, 0);
    ctx.lineTo(canvasWidth - borderRadius, 0);
    ctx.arcTo(canvasWidth, 0, canvasWidth, borderRadius, borderRadius);
    ctx.lineTo(canvasWidth, canvasHeight - borderRadius);
    ctx.arcTo(canvasWidth, canvasHeight, canvasWidth - borderRadius, canvasHeight, borderRadius);
    ctx.lineTo(borderRadius, canvasHeight);
    ctx.arcTo(0, canvasHeight, 0, canvasHeight - borderRadius, borderRadius);
    ctx.lineTo(0, borderRadius);
    ctx.arcTo(0, 0, borderRadius, 0, borderRadius);
    ctx.closePath();
    ctx.clip();

    const image = await createImageBitmap(dataBlob);
    ctx.drawImage(image, 0, 0, canvasWidth, canvasHeight);

    const finalBlob = await getCanvasBlob(canvas);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': finalBlob })]);

    new Notice("Snapshot copied to clipboard!");

  } catch (error) {
    console.error("Snapshot creation failed:", error);
    new Notice(`Error: Could not create snapshot. ${(error as Error).message || String(error)}`);
  } finally {
    if (offscreenWrapper.parentElement) {
      offscreenWrapper.parentElement.removeChild(offscreenWrapper);
    }
  }
}// generateSnapshot

export function getSnapshotColors(settings: CodeblockCustomizerSettings, language: string): { gutterBgColor: string, codeBgColor: string } {
  const baseColors = settings.SelectedTheme.colors[getCurrentMode()];

  let codeBgColor = baseColors.codeblock.backgroundColor;
  let gutterBgColor = baseColors.gutter.backgroundColor;

  const langOverrides = baseColors.languageSpecificColors[language.toLowerCase()];
  if (langOverrides) {
    codeBgColor = langOverrides['codeblock.backgroundColor'] || codeBgColor;
    gutterBgColor = langOverrides['gutter.backgroundColor'] || gutterBgColor;
  }

  if (codeBgColor.startsWith('--')) {
    codeBgColor = getColorOfCssVariable(codeBgColor);
  }
  if (gutterBgColor.startsWith('--')) {
    gutterBgColor = getColorOfCssVariable(gutterBgColor);
  }

  return { gutterBgColor, codeBgColor };
}// getSnapshotColors

function getCanvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not create final canvas blob."));
      }
    }, 'image/png');
  });
}// getCanvasBlob

export function getDisplayLanguageName(code: string | null) {
  if (!code)
    return "";

  code = code.toLowerCase();

  if (Object.prototype.hasOwnProperty.call(Languages, code)) {
    return Languages[code];
  } else if (Object.prototype.hasOwnProperty.call(manualLang, code)) {
    return manualLang[code];
  } else if (code) {
    return code.charAt(0).toUpperCase() + code.slice(1);
  }

  return "";
}// getDisplayLanguageName

export interface HighlightMarkRange {
  from: number;
  to: number;
  className: string;
  order: number;
}

// resolves overlapping text-highlight mark ranges on a line into sorted segments
export function layerHighlightRanges(ranges: HighlightMarkRange[]): { from: number; to: number; className: string }[] {
  const valid = ranges.filter(r => r.to > r.from);
  if (valid.length === 0) {
    return [];
  }

  const boundaries = Array.from(new Set(valid.flatMap(r => [r.from, r.to]))).sort((a, b) => a - b);
  const result: { from: number; to: number; className: string }[] = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const segFrom = boundaries[i];
    const segTo = boundaries[i + 1];
    let winner: HighlightMarkRange | null = null;

    for (const r of valid) {
      if (r.from <= segFrom && r.to >= segTo) {
        if (!winner || r.order >= winner.order) {
          winner = r;
        }
      }
    }

    if (winner) {
      const prev = result[result.length - 1];
      if (prev && prev.to === segFrom && prev.className === winner.className) {
        prev.to = segTo;
      } else {
        result.push({ from: segFrom, to: segTo, className: winner.className });
      }
    }
  }

  return result;
}// layerHighlightRanges

export function removeAnnotationRangesFromCode(codeText: string, rangesToRemove: { from: number; to: number }[]): string {
  if (rangesToRemove.length === 0) {
    return codeText;
  }

  const sortedRanges = [...rangesToRemove]
    .filter(r => r.to > r.from)
    .sort((a, b) => a.from - b.from);
  if (sortedRanges.length === 0) {
    return codeText;
  }

  const eol = codeText.includes('\r\n') ? '\r\n' : '\n';
  const rawLines = codeText.split(/\r?\n/);
  const keptLines: string[] = [];
  let offset = 0;

  for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx++) {
    const line = rawLines[lineIdx];
    const lineStart = offset;
    const lineEnd = lineStart + line.length;
    offset = lineEnd + (codeText.slice(lineEnd, lineEnd + 2) === '\r\n' ? 2 : 1);

    const overlapping = sortedRanges.filter(r => r.from < lineEnd && r.to > lineStart);
    if (overlapping.length === 0) {
      keptLines.push(line);
      continue;
    }

    let cleaned = '';
    let localCursor = 0;
    for (const range of overlapping) {
      const localFrom = Math.max(range.from, lineStart) - lineStart;
      const localTo = Math.min(range.to, lineEnd) - lineStart;
      if (localFrom > localCursor) {
        cleaned += line.slice(localCursor, localFrom).replace(/[ \t]+$/, '');
      }
      localCursor = Math.max(localCursor, localTo);
    }
    if (localCursor < line.length) {
      cleaned += line.slice(localCursor);
    }

    keptLines.push(cleaned.trim().length > 0 ? cleaned : '');
  }

  return keptLines.join(eol);
}// removeAnnotationRangesFromCode
