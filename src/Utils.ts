import { setIcon, editorLivePreviewField, Notice, MarkdownRenderer, App } from "obsidian";
import { EditorState } from "@codemirror/state";

import { Languages, manualLang, Icons, SVG_FILE_PATH, SVG_FOLDER_PATH, DEFAULT_COLLAPSE_TEXT } from "./Const";
import { CodeblockCustomizerSettings, Colors, ThemeColors, ThemeSettings } from "./Settings";
import CodeBlockCustomizerPlugin from "./main";

export function getCurrentMode() {
  const body = document.querySelector('body');
  if (body !== null){
    if (body.classList.contains('theme-light')) {
      return "light";
    } else if (body.classList.contains('theme-dark')) {
      return "dark";
    }
  } else {
    //console.log('Error - getCurrentTheme');
  }
  return 'dark'; // fall back to dark
}// getCurrentTheme

export function splitAndTrimString(str: string) {
  if (!str) {
    return [];
  }
  
  // Replace * with .*
  str = str.replace(/\*/g, '.*');
  
  if (!str.includes(",")) {
    return [str];
  }
  
  return str.split(",").map(s => s.trim());
}// splitAndTrimString

export function extractFileTitle(str: string): string {
  const file =  extractParameter(str, "file");
  const title =  extractParameter(str, "title");
  
  if (file && title)
    return file;
  else if (file && !title)
    return file;
  else if (!file && title)
    return title;
  else
    return '';
}// extractFileTitle

export function getCodeBlockLanguage(str: string): string {
  const searchTerm = "```";
  const originalStr = str;
  str = str.toLowerCase();

  function removeLeadingBackticks(input: string): string {
    let cleanedInput = input;
    while (cleanedInput.startsWith("`")) {
      cleanedInput = cleanedInput.substring(1);
    }
    return cleanedInput;
  }

  if (str.startsWith(searchTerm)) {
    const startIndex = searchTerm.length;
    const endIndex = str.indexOf(" ", startIndex);
    let word = "";
    if (endIndex !== -1) {
      word = originalStr.substring(startIndex, endIndex);
    } else {
      word = originalStr.substring(startIndex);
    }

    if (!word.includes(":")) {
      if (word.toLowerCase() === "fold" || word.toLowerCase() === "unfold") 
        return '';
      else
        return removeLeadingBackticks(word);
    }
  }
  return '';
}// getCodeBlockLanguage

export function isFoldDefined(str: string): boolean {
  return isParameterDefined("fold", str);
}// isFoldDefined

export function isUnFoldDefined(str: string): boolean {
  return isParameterDefined("unfold", str);
}// isUnFoldDefined

export function isParameterDefined(searchTerm: string, str: string): boolean {
  str = str.toLowerCase();
  searchTerm = searchTerm.toLowerCase();

  if (str.includes(` ${searchTerm} `)) {
    return true;
  }
  const index = str.indexOf(searchTerm);
  if (index !== -1 && index === str.length - searchTerm.length && str[index - 1] === " ") {
    return true;
  }
  if (str.includes("```" + searchTerm + " ")) {
    return true;
  }
  if (str.includes("```" + searchTerm) && str.indexOf("```" + searchTerm) + ("```" + searchTerm).length === str.length) {
    return true;
  }
  return false;
}// isParameterDefined

interface ParsedParams {
  [key: string]: string;
}

function parseParameters(input: string): ParsedParams {
  const params: ParsedParams = {};
  const backticks = '`'.repeat(getBacktickCount(input));
  const backtickRegex = new RegExp(`^${backticks}`);
  const cleanedLine = input.replace(backtickRegex, '').trim();
  const regex = /(\S+?)([:=])(["'][^"']*["']|[^"'\s]+)?/g;
  let match;

  while ((match = regex.exec(cleanedLine)) !== null) {
    let [, key, , value] = match;

    if (value) {
      value = value.trim();
      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
    } else {
      value = '';
    }

    params[key.trim().toLowerCase()] = value;
  }

  return params;
}// parseParameters
export function getBacktickCount(lineText: string) {
  return lineText.trim().match(/^`+(?!.*`)/)?.[0].length || 0
}// getBacktickCount

interface AlternativeHighlight {
  name: string;
  lineNumber: number;
}

interface AlternativeWords {
  name: string;
  words: string;
}

interface AlternativeLinesToHighlight {
  lines: AlternativeHighlight[];
  lineSpecificWords: AlternativeHighlight[];
  words: AlternativeWords[];
}

export interface Parameters {
  linesToHighlight: HighlightLines;
  alternativeLinesToHighlight: AlternativeLinesToHighlight;
  isSpecificNumber: boolean;
  lineNumberOffset: number;
  showNumbers: string;
  headerDisplayText: string;
  fold: boolean;
  unfold: boolean;
  language: string;
  displayLanguage: string;
  specificHeader: boolean;
  hasLangBorderColor: boolean;
  exclude: boolean;
  backtickCount: number;
  indentLevel: number;
  indentCharacter: number;
}

export function getParameters(originalLineText: string, settings: CodeblockCustomizerSettings) {
  const lineText = originalLineText.trim();

  // backtickcount
  const backtickCount = getBacktickCount(originalLineText);

  // indentation
  const { level, characters, margin } = getIndentationLevel(originalLineText);

  // default highlight (lines, words, lineSpecificWords)
  const linesToHighlight = extractHighlightedLines(lineText, "HL");
  //const { lines, lineSpecificWords, words } = linesToHighlight;

  // highlight with alternative colors (lines, words, lineSpecificWords)
  const alternateHighlights = extractAlternateHighlights(lineText, settings);
  //const { altHL, altLineSpecificWords, altWords } = alternateHighlights;

  // isSpecificNumber and showNumbers
  const { isSpecificNumber, showNumbers, lineNumberOffset } = determineLineNumberDisplay(lineText);

  // fileName/Title
  let headerDisplayText = extractFileTitle(lineText);
  
  // fold
  let fold = isFoldDefined(lineText);

  // unfold
  const unfold = isUnFoldDefined(lineText);
  if (settings.SelectedTheme.settings.codeblock.inverseFold) {
    fold = unfold ? false : true;
  }

  // language
  const language = getCodeBlockLanguage(lineText);

  // displayLanguage
  const displayLanguage = getDisplayLanguageName(language);

  // isExcluded
  const exclude = isExcluded(lineText, settings.ExcludeLangs);

  // specificHeader and hasLangBorderColor
  let specificHeader = true;
  let hasLangBorderColor = false;
  if (!exclude) {
    if (headerDisplayText === null || headerDisplayText === "") {
      headerDisplayText = DEFAULT_COLLAPSE_TEXT;
      if (!fold)
        specificHeader = false;
    }
    hasLangBorderColor = getBorderColorByLanguage(language || "", settings.SelectedTheme.colors[getCurrentMode()].codeblock.languageBorderColors).length > 0 ? true : false;
  }

  return {
    linesToHighlight: linesToHighlight,
    alternativeLinesToHighlight: alternateHighlights,
    isSpecificNumber: isSpecificNumber,
    lineNumberOffset: lineNumberOffset,
    showNumbers: showNumbers,
    headerDisplayText: headerDisplayText,
    fold: fold,
    unfold: unfold,
    language: language,
    displayLanguage: displayLanguage,
    specificHeader: specificHeader,
    hasLangBorderColor: hasLangBorderColor,
    exclude: exclude,
    backtickCount: backtickCount,
    indentLevel: level,
    indentCharacter: characters,
  };
}// getParameters

function extractHighlightedLines(lineText: string, param: string): HighlightLines {
  const params = extractParameter(lineText, param);
  return getHighlightedLines(params);
}// extractHighlightedLines

function extractAlternateHighlights(lineText: string, settings: CodeblockCustomizerSettings): AlternativeLinesToHighlight {
  const currentMode = getCurrentMode();
  const alternateColors = settings.SelectedTheme.colors[currentMode].codeblock.alternateHighlightColors || {};
  
  const altHL: AlternativeHighlight[] = [];
  const altLineSpecificWords: AlternativeHighlight[] = [];
  const altWords: AlternativeWords[] = [];

  for (const [name, hexValue] of Object.entries(alternateColors)) {
    const altParams = extractParameter(lineText, name);
    const altLines = getHighlightedLines(altParams);
    altHL.push(...altLines.lines.map(lineNumber => ({ name, lineNumber })));
    altLineSpecificWords.push(...Object.entries(altLines.lineSpecificWords).map(([lineNumber, value]) => ({ name, lineNumber: parseInt(lineNumber), value })));
    altWords.push({ name, words: altLines.words });
  }

  return {lines: altHL, lineSpecificWords: altLineSpecificWords, words: altWords };
}// extractAlternateHighlights

function determineLineNumberDisplay(lineText: string) {
  const specificLN = extractParameter(lineText, "ln") || "";
  let isSpecificNumber = false;
  let showNumbers = "";
  let lineNumberOffset = 0;

  if (specificLN.toLowerCase() === "true") {
    showNumbers = "specific";
  } else if (specificLN.toLowerCase() === "false") {
    showNumbers = "hide";
  } else {
    lineNumberOffset = parseInt(specificLN);
    if (!isNaN(lineNumberOffset) && lineNumberOffset >= 0) {
      showNumbers = "specific";
      isSpecificNumber = true;
    } else {
      lineNumberOffset = 0;
    }
  }

  lineNumberOffset = lineNumberOffset === 0 ? lineNumberOffset : lineNumberOffset - 1;

  return { isSpecificNumber, showNumbers, lineNumberOffset };
}// determineLineNumberDisplay

export function extractParameter(input: string, searchTerm: string): string | null {
  const params = parseParameters(input);
  return params[searchTerm.toLowerCase()] || null;
}// extractParameter

export interface HighlightLines {
  lines: number[];
  words: string;
  lineSpecificWords: Record<number, string>;
}

export function getHighlightedLines(params: string | null): HighlightLines {
  if (!params) {
    return {
      lines: [],
      words: '',
      lineSpecificWords: {},
    };
  }

  const trimmedParams = params.trim();
  const result: HighlightLines = {
    lines: [],
    words: '',
    lineSpecificWords: {},
  };

  const segments = trimmedParams.split(",");
  segments.forEach(segment => {
    let lineSegment = '';
    let segmentValue = '';

    if (segment.includes("|")) {
      const [lineOrRange, val] = segment.split("|");
      lineSegment = lineOrRange.trim();
      segmentValue = val.trim();
    } else {
      lineSegment = segment.trim();
    }

    if (lineSegment !== '' && segmentValue === '') {
      const isNumber = (value: string): boolean => !isNaN(Number(value));
      if (isNumber(lineSegment)) { // number only
        result.lines.push(Number(lineSegment));
      } else {
        if (lineSegment.includes("-")) { // range without text
          processRange(lineSegment, segmentValue, result.lines);
        } else { // text only
          result.words += result.words ? "," + lineSegment : lineSegment;
        }
      }
    } else if (lineSegment !== '' && segmentValue !== '') {
      if (lineSegment.includes("-")) { // range with text
        processRange(lineSegment, segmentValue, result.lineSpecificWords);
      } else { // number with text
        result.lineSpecificWords[Number(lineSegment)] = result.lineSpecificWords.hasOwnProperty(Number(lineSegment)) ? result.lineSpecificWords[Number(lineSegment)] + ',' + segmentValue : segmentValue;
      }
    }
  });

  return result;
}// getHighlightedLines

function processRange<T>(segment: string, segmentValue: string, result: T): void {
  const range = getLineRanges(segment);
  // Assuming T is either number[] or Record<number, string>
  if (Array.isArray(result)) {
    result.push(...range);
  } else {
    range.forEach((num) => {
      const existingValue = (result as Record<number, string>)[num];
      const updatedValue = existingValue ? `${existingValue},${segmentValue}` : segmentValue;
      (result as Record<number, string>)[num] = updatedValue;
    });
  }
}//processRange

export function getLineRanges(params: string | null): number[] {
  if (!params) {
    return [];
  }

  const trimmedParams = params.trim();
  const lines = trimmedParams.split(",");

  return lines.map(line => {
    if (line.includes("-")) {
      const range = line.split("-");
      const start = parseInt(range[0], 10);
      const end = parseInt(range[1], 10);
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
    return parseInt(line, 10);
  }).flat();
}// getLineRanges

export function isExcluded(lineText: string, excludeLangs: string) : boolean {
  if (isParameterDefined("exclude", lineText))
    return true;
  
  const codeBlockLang = getCodeBlockLanguage(lineText);
  const regexLangs = splitAndTrimString(excludeLangs).map(lang => new RegExp(`^${lang.replace(/\*/g, '.*')}$`, 'i'));
  
  for (const regexLang of regexLangs) {
    if (codeBlockLang && regexLang.test(codeBlockLang)) {
      return true;
    }
  }
  
  return false;
}// isExcluded

export function getLanguageIcon(DisplayName: string) {
  if (!DisplayName)
    return "";

  if (Icons.hasOwnProperty(DisplayName)) {
    return Icons[DisplayName];
  }
  
  return null;
}// getLanguageIcon

export function getDisplayLanguageName(code: string | null) {
  if (!code)
    return "";
  
  code = code.toLowerCase();
  
  if (Languages.hasOwnProperty(code)) {
    return Languages[code];
  } else if (manualLang.hasOwnProperty(code)) {
    return manualLang[code];
  } else if (code){
      return code.charAt(0).toUpperCase() + code.slice(1);
  }
  
  return "";
}// getDisplayLanguageName

export const BLOBS: Record<string, string> = {};
export async function loadIcons(plugin: CodeBlockCustomizerPlugin){
  /*for (const [key, value] of Object.entries(Icons)) {
    BLOBS[key.replace(/\s/g, "_")] = URL.createObjectURL(new Blob([`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 32 32">${value}</svg>`], { type: "image/svg+xml" }));
  }*/
  for (const [key, value] of Object.entries(Icons)) {
    BLOBS[key.replace(/\s/g, "_")] = `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 32 32">${value}</svg>`)}`;
  }
  await loadCustomIcons(plugin);
}// loadIcons

async function loadCustomIcons(plugin: CodeBlockCustomizerPlugin) {
  try {
    if (await plugin.app.vault.adapter.exists(plugin.app.vault.configDir + SVG_FILE_PATH)) {
      const svgJsonContent: string = await plugin.app.vault.adapter.read(plugin.app.vault.configDir + SVG_FILE_PATH);
      if (svgJsonContent) {
        const { Languages }: { Languages: Record<string, string> } = JSON.parse(svgJsonContent);
        for (const [codeblockLanguage, displayLanguage] of Object.entries(Languages)) {
          const svgFileName = `${displayLanguage}.svg`;
          try {
            const svgFilePath: string = plugin.app.vault.configDir + SVG_FOLDER_PATH + svgFileName;
            const svgFileExists: boolean = await plugin.app.vault.adapter.exists(svgFilePath);
            if (svgFileExists) {
              const svgContent: string = await plugin.app.vault.adapter.read(svgFilePath);
              const base64SVG = `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 32 32">${svgContent}</svg>`)}`;
              manualLang[codeblockLanguage] = displayLanguage as string;
              Icons[displayLanguage] = svgContent;
              BLOBS[displayLanguage.replace(/\s/g, "_")] = `${base64SVG}`;
            }
          } catch (fileError) {
            console.error(`Error reading SVG file ${svgFileName}:`, fileError);
          }
        }
      }
    }
  } catch (jsonError) {
    console.error('Error parsing SVG JSON content:', jsonError);
  }
}// loadCustomIcons

// Functions for displaying header BEGIN
export function createContainer(specific: boolean, languageName: string, hasLangBorderColor: boolean, codeblockLanguageSpecificClass: string) {
  const container = createDiv({cls: `codeblock-customizer-header-container${specific ? '-specific' : ''}`});
  
  if (languageName) {
    container.classList.add(`codeblock-customizer-language-${languageName.toLowerCase()}`);
  }
  if (codeblockLanguageSpecificClass)
    container.classList.add(codeblockLanguageSpecificClass);

  if (hasLangBorderColor)
    container.classList.add(`hasLangBorderColor`);

  return container;
}// createContainer

export function createCodeblockLang(lang: string) {
  const codeblockLang = createDiv({cls: `codeblock-customizer-header-language-tag`, text: getDisplayLanguageName(lang)});
  //codeblockLang.innerText = getDisplayLanguageName(lang);
  return codeblockLang;
}// createCodeblockLang

export function createCodeblockIcon(displayLang: string) {
  const div = createDiv({cls: `codeblock-customizer-icon-container`});
  const img = document.createElement("img");
  img.classList.add("codeblock-customizer-icon");
  img.width = 28; //32
  img.src = BLOBS[displayLang.replace(/\s/g, "_")];

  div.appendChild(img);
  
  return div;
}// createCodeblockIcon

export function createCodeblockCollapse(defaultFold: boolean) {
  const collapse = createDiv({ cls: `codeblock-customizer-header-collapse`});
  //collapse.innerText = defaultFold ? "+" : "-";
  if (defaultFold)
    setIcon(collapse, "chevrons-down-up");
  else
    setIcon(collapse, "chevrons-up-down");

  return collapse;
}// createCodeblockLang

export function createFileName(text: string, enableLinks: boolean, sourcePath: string, plugin: CodeBlockCustomizerPlugin) {
  const fileName = createDiv({cls: "codeblock-customizer-header-text"});

  if (enableLinks) {
    MarkdownRenderer.render(plugin.app, text, fileName, sourcePath, plugin);
  }
  else {
    fileName.innerText = text;
  }
  
  return fileName;
}// createFileName

export function createUncollapseCodeButton() {
  const uncollapseCodeButton = createSpan( {cls: `codeblock-customizer-uncollapse-code`});
  uncollapseCodeButton.setAttribute("aria-label", "Uncollapse code block");
  setIcon(uncollapseCodeButton, "chevron-down");

  return uncollapseCodeButton;
}// createUncollapseCodeButton

export function getBorderColorByLanguage(languageName: string, languageBorderColors: Record<string, string>): string {
  const lowercaseLanguageName = languageName.toLowerCase();

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
  "codeblock.highlightColor": 'codeblock-highlight-color',
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
}// stylesDict

export function updateSettingStyles(settings: CodeblockCustomizerSettings, app: App) {
  const styleId = 'codeblock-customizer-styles';
  let styleTag = document.getElementById(styleId);
  if (typeof(styleTag) == 'undefined' || styleTag == null) {
    styleTag = document.createElement('style');
    styleTag.id = styleId;
    document.getElementsByTagName('head')[0].appendChild(styleTag);
  }
  const currentMode = getCurrentMode();

  const altHighlightStyling = Object.entries(settings.SelectedTheme.colors[currentMode].codeblock.alternateHighlightColors || {}).reduce((styling, [colorName, hexValue]) => {
    return styling + `
      .codeblock-customizer-line-highlighted-${colorName.replace(/\s+/g, '-').toLowerCase()} {
        background-color: var(--codeblock-customizer-highlight-${colorName.replace(/\s+/g, '-').toLowerCase()}-color, ${hexValue}) !important;
      }
    ` + 
    `
      .codeblock-customizer-highlight-text-enabled .codeblock-customizer-highlighted-text-${colorName.replace(/\s+/g, '-').toLowerCase()},
      body:not(.codeblock-customizer-highlight-text-enabled) .codeblock-customizer-highlighted-text-line-${colorName.replace(/\s+/g, '-').toLowerCase()} {
        background-color: var(--codeblock-customizer-highlight-${colorName.replace(/\s+/g, '-').toLowerCase()}-color, ${hexValue}) !important;
      }
    `;
  }, '');

  const borderLangColorStyling = Object.entries(settings.SelectedTheme.colors[currentMode].codeblock.languageBorderColors || {}).reduce((styling, [colorName, hexValue]) => {
    return styling + `
    .codeblock-customizer-language-${colorName.toLowerCase()} {
      --border-color: ${hexValue};
    }
    `;
  }, '');

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
            .markdown-reading-view .codeblock-customizer-languageSpecific-${language.toLowerCase()} .token`;
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

  const textSettingsStyles = `
    body.codeblock-customizer .codeblock-customizer-header-language-tag {
      --codeblock-customizer-language-tag-text-bold: ${settings.SelectedTheme.settings.header.codeblockLangBoldText ? 'bold' : 'normal'};
      --codeblock-customizer-language-tag-text-italic: ${settings.SelectedTheme.settings.header.codeblockLangItalicText ? 'italic' : 'normal'};
    }
    body.codeblock-customizer .codeblock-customizer-header-text {
      --codeblock-customizer-header-text-bold: ${settings.SelectedTheme.settings.header.boldText ? 'bold' : 'normal'};
      --codeblock-customizer-header-text-italic: ${settings.SelectedTheme.settings.header.italicText ? 'italic' : 'normal'};
    }
  `;

  // @ts-ignore
  const theme = app.vault.getConfig("cssTheme");
  let minimalSpecificStyling = "";
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
  styleTag.innerText = (formatStyles(settings.SelectedTheme.colors, settings.SelectedTheme.colors[currentMode].codeblock.alternateHighlightColors, settings.SelectedTheme.settings.printing.forceCurrentColorUse) + altHighlightStyling + borderLangColorStyling + languageSpecificStyling + textSettingsStyles + minimalSpecificStyling).trim().replace(/[\r\n\s]+/g, ' ');

  updateSettingClasses(settings.SelectedTheme.settings);
}// updateSettingStyles

function updateSettingClasses(settings: ThemeSettings) {
  document.body.classList.remove("codeblock-customizer-active-line-highlight", "codeblock-customizer-active-line-highlight-codeblock", "codeblock-customizer-active-line-highlight-editor")
  if (settings.enableEditorActiveLineHighlight && settings.codeblock.enableActiveLineHighlight) {
    // Inside and outside of codeblocks with different colors
    document.body.classList.add("codeblock-customizer-active-line-highlight");
  } else if (settings.enableEditorActiveLineHighlight && !settings.codeblock.enableActiveLineHighlight) {
    // Only outside codeblocks
    document.body.classList.add("codeblock-customizer-active-line-highlight-editor");
  } else if (!settings.enableEditorActiveLineHighlight && settings.codeblock.enableActiveLineHighlight) {
    // Only inside codeblocks
    document.body.classList.add("codeblock-customizer-active-line-highlight-codeblock");
  }
  
  if (settings.codeblock.enableLineNumbers) {
    document.body.classList.add("codeblock-customizer-show-line-numbers");
  } else {
    document.body.classList.remove("codeblock-customizer-show-line-numbers");
  }

  document.body.classList.remove("codeblock-customizer-show-langnames","codeblock-customizer-show-langnames-always");
  if (settings.header.alwaysDisplayCodeblockLang && settings.header.displayCodeBlockLanguage) {
    document.body.classList.add("codeblock-customizer-show-langnames-always");
  } else if (settings.header.displayCodeBlockLanguage) {
    document.body.classList.add("codeblock-customizer-show-langnames");
  }

  document.body.classList.remove("codeblock-customizer-show-langicons","codeblock-customizer-show-langicons-always");
  if (settings.header.alwaysDisplayCodeblockIcon && settings.header.displayCodeBlockIcon) {
    document.body.classList.add("codeblock-customizer-show-langicons-always");
  } else if (settings.header.displayCodeBlockIcon) {
    document.body.classList.add("codeblock-customizer-show-langicons");
  }

  if (settings.gutter.enableHighlight) {
    document.body.classList.add('codeblock-customizer-gutter-highlight');
  } else {
    document.body.classList.remove('codeblock-customizer-gutter-highlight');
  }
  
  if (settings.gutter.highlightActiveLineNr)
		document.body.classList.add('codeblock-customizer-gutter-active-line');
	else
		document.body.classList.remove('codeblock-customizer-gutter-active-line');

  if (settings.header.collapseIconPosition === "hide") {
      document.body.classList.add('codeblock-customizer-collapseIconNone');
      document.body.classList.remove('codeblock-customizer-collapseIconMiddle');
      document.body.classList.remove('codeblock-customizer-collapseIconRight');
  } else if (settings.header.collapseIconPosition === "middle") {
    document.body.classList.remove('codeblock-customizer-collapseIconNone');
    document.body.classList.remove('codeblock-customizer-collapseIconRight');
    document.body.classList.add('codeblock-customizer-collapseIconMiddle');
  } else if (settings.header.collapseIconPosition === "right") {
    document.body.classList.remove('codeblock-customizer-collapseIconNone');
    document.body.classList.remove('codeblock-customizer-collapseIconMiddle');
    document.body.classList.add('codeblock-customizer-collapseIconRight');
  }

  if (settings.codeblock.enableCopyCodeButton)
    document.body.classList.add('codeblock-customizer-show-copy-code-button');
  else
    document.body.classList.remove('codeblock-customizer-show-copy-code-button');

  if (settings.codeblock.enableDeleteCodeButton)
    document.body.classList.add('codeblock-customizer-show-delete-code-button');
	else
		document.body.classList.remove('codeblock-customizer-show-delete-code-button');

  if (settings.inlineCode.enableInlineCodeStyling){
    document.body.classList.add('codeblock-customizer-style-inline-code');
  } else{
    document.body.classList.remove('codeblock-customizer-style-inline-code');
  }

  if (settings.codeblock.codeBlockBorderStylingPosition === "disable") {
    document.body.classList.remove('codeblock-customizer-style-codeblock-border-left');
    document.body.classList.remove('codeblock-customizer-style-codeblock-border-right');
  } else if (settings.codeblock.codeBlockBorderStylingPosition === "left") {
    document.body.classList.remove('codeblock-customizer-style-codeblock-border-right');
    document.body.classList.add('codeblock-customizer-style-codeblock-border-left');
  } else if (settings.codeblock.codeBlockBorderStylingPosition === "right") {
    document.body.classList.remove('codeblock-customizer-style-codeblock-border-left');
    document.body.classList.add('codeblock-customizer-style-codeblock-border-right');
  }

  if (settings.semiFold.enableSemiFold) {
    document.body.classList.add('codeblock-customizer-use-semifold');
  } else{
    document.body.classList.remove('codeblock-customizer-use-semifold');
  }

  if (settings.semiFold.showAdditionalUncollapseButon) {
    document.body.classList.add('codeblock-customizer-show-uncollapse-code-button');
  } else{
    document.body.classList.remove('codeblock-customizer-show-uncollapse-code-button');
  }

  if (settings.codeblock.showIndentationLines) {
    document.body.classList.add('codeblock-customizer-show-indentation-lines');
  } else{
    document.body.classList.remove('codeblock-customizer-show-indentation-lines');
  }

  if (settings.codeblock.textHighlight) {
    document.body.classList.add('codeblock-customizer-highlight-text-enabled');
  } else{
    document.body.classList.remove('codeblock-customizer-highlight-text-enabled');
  }
}// updateSettingStyles

function formatStyles(colors: ThemeColors, alternateColors: Record<string, string>, forceCurrentColorUse: boolean) {
  return `
    body.codeblock-customizer.theme-light {
      ${Object.keys(stylesDict).reduce((variables, key) => {
        const cssVariable = `--codeblock-customizer-${stylesDict[key]}`;
        let cssValue = accessSetting(key, forceCurrentColorUse ? colors[getCurrentMode()] : colors.light);

        if (cssValue.toString().startsWith("--"))
          cssValue = "var(" + cssValue + ")";

        if (cssValue != null) {
          return variables + `${cssVariable}: ${cssValue};`;
        } else {
          return variables;
        }
      },addAltHighlightColors(alternateColors, true))}
    } 
    body.codeblock-customizer.theme-dark {
      ${Object.keys(stylesDict).reduce((variables, key) => {
        const cssVariable = `--codeblock-customizer-${stylesDict[key]}`;
        let cssValue = accessSetting(key, forceCurrentColorUse ? colors[getCurrentMode()] : colors.dark);

        if (cssValue.toString().startsWith("--"))
          cssValue = "var(" + cssValue + ")";

        if (cssValue != null) {
          return variables + `${cssVariable}: ${cssValue};`;
        } else {
          return variables;
        }
      },addAltHighlightColors(alternateColors, false))}
    }
  `;
}// formatStyles

export function getColorOfCssVariable(cssVariable: string) {
  const body = document.body;
  const computedStyle = getComputedStyle(body);
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
    //throw new Error('Invalid color format. Use "rgba(r, g, b, a)" or "rgb(r, g, b)".');
    return "";
  }
}// rgbOrRgbaToHex

function hslOrHslaToHex(hslColor: string): string {
  const matchHSLA = hslColor.match(/^hsla?\((\d+),\s*(\d+)%,\s*(\d+)%,?\s*(\d*\.?\d+)?\)$/i);

  if (!matchHSLA) {
    //throw new Error('Invalid HSL or HSLA color format. Use "hsl(h, s%, l%)" or "hsla(h, s%, l%, a)".');
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
    //throw new Error('Invalid HSL color format. Use "hsl(h, s%, l%)".');
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

function addAltHighlightColors(alternateColors: Record<string, string>, lightTheme: boolean) {
  const altHighlightStyles = Object.entries(alternateColors).reduce((altHighlightStyles, [colorName, hexValue]) => {
    return altHighlightStyles + `--codeblock-customizer-highlight-${colorName.replace(/\s+/g, '-').toLowerCase()}-color: ${hexValue};`;
  }, '');

  return altHighlightStyles;
}// addAltHighlightColors

function accessSetting(key: string, settings: Colors) {
  const keys = key.split('.');
  let value: any = settings;
  for (const k of keys) {
    if (value && k in value) {
      value = value[k];
    } else {
      return null;
    }
  }
  return value;
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

export function getTextValues(rawText: string) {
  let pipedText, displayText, linkText;
  if (rawText.includes("|")) {
    pipedText = extractText(rawText);
    if (typeof pipedText === 'string') {
      displayText = pipedText;
      linkText = pipedText;
    } else {
      displayText = pipedText.after;
      linkText = pipedText.before;
    }
  } else {
    displayText = rawText;
    linkText = rawText;
  }

  return { displayText, linkText };
}// getTextValues

function extractText(input: string): { before: string, after: string } | string {
  if (input.includes('|')) {
      const [before, after] = input.split('|');
      return { before, after };
  } else {
      return input;
  }
}// extractText

export function getIndentationLevel(line: string) {
  const indentationMatch = line.match(/^( {4}|\t)*/);
  if (indentationMatch) {
    const indentation = indentationMatch[0];
    const spacesCount = (indentation.match(/ {4}/g) || []).length;
    const tabsCount = (indentation.match(/\t/g) || []).length;

    const indentationLevel = spacesCount + tabsCount;
    const additionalCharacters = spacesCount * 4 + tabsCount;
    const spaceWidth = 38; // 19
    /*const body = document.body;
    const computedStyle = getComputedStyle(body);
    const colorValue = computedStyle.getPropertyValue("--list-indent").trim();
    const spaceWidth = colorValue;*/

    let margin = 0;
    if (spacesCount > 0 && tabsCount === 0)
      margin = (spacesCount * spaceWidth);
    else if (spacesCount === 0 && tabsCount > 0)
      margin = (20 + ((tabsCount - 1) * 32));
    else if (spacesCount > 0 && tabsCount > 0)
      margin = (spacesCount * spaceWidth) + (20 + ((tabsCount - 1) * 32));
    
    return {
      level: indentationLevel,
      characters: additionalCharacters,
      margin: margin
    };
  }
  return {
    level: 0,
    characters: 0,
    margin: 0
  };
}// getIndentationLevel

export function getLanguageSpecificColorClass(codeblockLanguage: string, languageSpecificColors: Record<string, Record<string, string>> | null, languageSpecificColor?: Record<string, string>) {
  let codeblockLanguageSpecificClass = "";
  const language = codeblockLanguage.length > 0 ? codeblockLanguage : "nolang";

  // Check if languageSpecificColors contains properties
  if (languageSpecificColors !== null && languageSpecificColors[language] && Object.keys(languageSpecificColors[language]).length > 0) {
    codeblockLanguageSpecificClass = "codeblock-customizer-languageSpecific-" + language.toLowerCase();
  }

  // Check if additionalColors contains properties
  if (languageSpecificColor && Object.keys(languageSpecificColor).length > 0) {
    codeblockLanguageSpecificClass += "codeblock-customizer-languageSpecific-" + language.toLowerCase();
  }

  return codeblockLanguageSpecificClass;
}// getLanguageSpecificColorClass

export function createObjectCopy(object: Record<string, string>){
  const newObject: Record<string, string> = {};
  for (const [property, value] of Object.entries(object)) {
    newObject[property] = value;
  }
  return newObject;
}//createObjectCopy

export function getValueNameByLineNumber(lineNumber: number, altLineSpecificWords: { name: string; lineNumber: number; value?: string }[]): { extractedValues: { value: string | undefined, name: string }[] } {
  const matchingItems = altLineSpecificWords.filter(item => item.lineNumber === lineNumber);
  const extractedValues = matchingItems.map(item => ({ value: item.value, name: item.name }));
  return { extractedValues };
}// getValueNameByLineNumber

export function findAllOccurrences(mainString: string, substring: string): number[] {
  const indices: number[] = [];
  let currentIndex = mainString.indexOf(substring);

  while (currentIndex !== -1) {
    indices.push(currentIndex);
    currentIndex = mainString.indexOf(substring, currentIndex + substring.length);
  }
  
  return indices;
}// findAllOccurrences

export function removeFirstLine(inputString: string): string {
  const lines = inputString.split('\n');
  
  if (lines.length > 1) {
    const modifiedLines = lines.slice(1);
    const resultString = modifiedLines.join('\n');
    
    return resultString;
  } else {
    // If there's only one line or the input is empty, return an empty string
    return '';
  }
}// removeFirstLine