import { setIcon, editorLivePreviewField, Notice, MarkdownRenderer, App, TFile, CachedMetadata, EditorPosition, Editor, MarkdownView } from "obsidian";
import { EditorState } from "@codemirror/state";

import { Languages, manualLang, Icons, SVG_FILE_PATH, SVG_FOLDER_PATH, DEFAULT_COLLAPSE_TEXT, DEFAULT_TEXT_SEPARATOR, DEFAULT_LINE_SEPARATOR } from "./Const";
import { CodeblockCustomizerSettings, Colors, ThemeColors, ThemeSettings } from "./Settings";
import validator from 'validator';
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
    const [, key, , value] = match;

    let cleanedValue = value ? value.trim() : '';
    // Remove surrounding quotes if present
    if ((cleanedValue.startsWith('"') && cleanedValue.endsWith('"')) || (cleanedValue.startsWith("'") && cleanedValue.endsWith("'"))) {
      cleanedValue = cleanedValue.slice(1, -1);
    }
    
    params[key.trim().toLowerCase()] = cleanedValue;
  }

  return params;
}// parseParameters

export function getBacktickCount(lineText: string) {
  return lineText.trim().match(/^`+(?!.*`)/)?.[0].length || 0
}// getBacktickCount

// inerfaces for highlight
interface LinesToHighlight {
  lineNumbers: number[];
  words: string[];
  lineSpecificWords: LineSpecificWords[];
}

type LineSpecificWords = {
  words: string[];
  lineNumber: number;
};

type TextBetween = {
  from: string;
  to: string;
};

type LineSpecificTextBetween = {
  from: string;
  to: string;
  lineNumber: number;
};

interface TextHighlight {
  allWordsInLine: number[];
  words: string[];
  lineSpecificWords: LineSpecificWords[];
  textBetween: TextBetween[];
  lineSpecificTextBetween: LineSpecificTextBetween[];
}

// inerfaces for alternative highlight
interface AlternativeLinesToHighlight {
  lines: AlternativeHighlightedLines[];
  words: AlternativeWords[];
  lineSpecificWords: AlternativeLineSpecificWords[];  
}

type AlternativeHighlightedLines = {
  lineNumbers: number[];
  colorName: string;
};

type AlternativeLineSpecificWords = LineSpecificWords & {
  colorName: string;
};

type AlternativeTextBetween = TextBetween & {
  colorName: string;
};

type AlternativeLineSpecificTextBetween = LineSpecificTextBetween & {
  colorName: string;
};

type AlternativeAllWordsInLine = {
  allWordsInLine: number[];
  colorName: string;
};

type AlternativeWords = {
  words: string[];
  colorName: string;
};

interface AlternativeTextHighlight {
  allWordsInLine: AlternativeAllWordsInLine[];
  words: AlternativeWords[];
  lineSpecificWords: AlternativeLineSpecificWords[];
  textBetween: AlternativeTextBetween[];
  lineSpecificTextBetween: AlternativeLineSpecificTextBetween[];
}

export interface Parameters {
  defaultLinesToHighlight: LinesToHighlight;
  defaultTextToHighlight: TextHighlight;
  alternativeLinesToHighlight: AlternativeLinesToHighlight;
  alternativeTextToHighlight: AlternativeTextHighlight;
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
  lineSeparator: string;
  textSeparator: string;
}

export function getAllParameters(originalLineText: string, settings: CodeblockCustomizerSettings) {
  const lineText = originalLineText.trim();

  // backtickcount
  const backtickCount = getBacktickCount(originalLineText);

  // indentation
  const { level, characters } = getIndentationLevel(originalLineText);

  // get line separator
  const lsep = extractParameter(lineText, 'lsep')?.charAt(0);
  const lineSeparator = lsep || settings.SelectedTheme.settings.textHighlight.lineSeparator || DEFAULT_LINE_SEPARATOR;

  // get text separator
  const tsep = extractParameter(lineText, 'tsep')?.charAt(0);
  const textSeparator = tsep || settings.SelectedTheme.settings.textHighlight.textSeparator || DEFAULT_TEXT_SEPARATOR;

  // default highlight (lines)
  const defaultLinesToHighlight = getHighlightedLines(lineText, "HL", textSeparator, lineSeparator);

  // default text highlight (words, lineSpecificWords, from - to)
  const defaultTextToHighlight = getTextHighlight(lineText, "hlt", textSeparator, lineSeparator);

  // highlight with alternative colors (lines, words, lineSpecificWords, from - to)
  const {alternativeLinesToHighlight, alternativeTextToHighlight} = extractAlternativeHighlights(lineText, textSeparator, lineSeparator, settings);

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
      headerDisplayText = settings.SelectedTheme.settings.header.collapsedCodeText || DEFAULT_COLLAPSE_TEXT;
      if (!fold && !(language.length > 0 && (settings.SelectedTheme.settings.header.alwaysDisplayCodeblockIcon || settings.SelectedTheme.settings.header.alwaysDisplayCodeblockLang)))
        specificHeader = false;
    }
    hasLangBorderColor = getBorderColorByLanguage(language, getPropertyFromLanguageSpecificColors("codeblock.borderColor", settings)).length > 0 ? true : false;
  }

  return {
    defaultLinesToHighlight: defaultLinesToHighlight,
    defaultTextToHighlight: defaultTextToHighlight,
    alternativeLinesToHighlight: alternativeLinesToHighlight,
    alternativeTextToHighlight: alternativeTextToHighlight,
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
    lineSeparator,
    textSeparator
  };
}// getParameters

function sortAndRemoveDuplicates(numbers: number[]): number[] {
  // sort
  numbers.sort((a, b) => a - b);

  // remove duplicates
  const uniqueNumbers = numbers.filter((value, index, array) => {
    return index === 0 || value !== array[index - 1];
  });

  return uniqueNumbers;
}// sortAndRemoveDuplicates

function getHighlightedLines(lineText: string, parameter: string, textSeparator: string, lineSeparator: string) {
  const result: LinesToHighlight = {
    lineNumbers: [],
    words: [],
    lineSpecificWords: [],
  };

  const parameterValue = extractParameter(lineText, parameter);
  if (!parameterValue) {
    return result;
  }

  const trimmedParams = parameterValue.trim();
  const segments = trimmedParams.split(",");

  for (const segment of segments) {
    const { line, range, word, from, to } = parseSegment(segment, textSeparator, lineSeparator);
    // lines or ranges
    if ((line || range) && !word && !from && !to) {
      if (line) {
        result.lineNumbers = result.lineNumbers.concat(getLineRanges(line));
      }
      if (range) {
        result.lineNumbers = result.lineNumbers.concat(getLineRanges(range));
      }
    }

    // words
    if (word && !line && !range && !from && !to){
      result.words.push(word);
    }
    // lineSpecificWords
    if (word && (line || range) && !from && !to){
      getLineSpecificWords(result, line, range, word);
    }
  }

  result.lineNumbers = sortAndRemoveDuplicates(result.lineNumbers);

  return result;
}// getHighlightedLines

function getTextHighlight(lineText: string, parameter: string | null, textSeparator: string, lineSeparator: string): TextHighlight {
  const result: TextHighlight = {
    allWordsInLine: [],
    words: [],
    lineSpecificWords: [],
    textBetween: [],
    lineSpecificTextBetween: [],
  };

  if (!parameter){
    return result;
  }

  const parameterValue = extractParameter(lineText, parameter);
  if (!parameterValue) {
    return result;
  }

  const trimmedParams = parameterValue.trim();
  const segments = trimmedParams.split(",");

  for (const segment of segments) {
    const { line, range, word, from, to } = parseSegment(segment, textSeparator, lineSeparator);

    // allWordsInLine
    if ((line || range ) && !word && !from && !to ){
      getAllWordsInLine(result, line, range);
    }

    // words
    if (word && !line && !range && !from && !to){
      result.words.push(word);
    }
    // lineSpecificWords
    if (word && (line || range) && !from && !to){
      getLineSpecificWords(result, line, range, word);
    }

    // textBetween
    if ((from || to) && !word && !line && !range){
      result.textBetween.push({ from: from, to: to });
    }
    // lineSpecificTextBetween
    if ((from || to ) && !word && (line || range)){
      getLineSpecificTextBetween(result, line, range, from, to);
    }
  }

  result.allWordsInLine = sortAndRemoveDuplicates(result.allWordsInLine);

  return result;
}// getTextHighlight

function getAllWordsInLine(result: TextHighlight, line: string, range: string) {
  if (line && isWholeNumber(line)) { // number only
    result.allWordsInLine.push(Number(line));
  } else if (range){
    const ranges = getLineRanges(range);
    result.allWordsInLine.push(...ranges);
  }
}// getAllWordsInLine

function getLineSpecificWords(result: TextHighlight | LinesToHighlight, line: string, range: string, word: string) {
  if (range !== '') { // range with text
    processRange(range, word, result.lineSpecificWords);
  } else { // number with text
    const lineNum = Number(line);
    const existingEntry = result.lineSpecificWords.find(entry => entry.lineNumber === lineNum);
    const words = word.split(',');

    if (existingEntry) {
      existingEntry.words.push(...words);
    } else {
      result.lineSpecificWords.push({ lineNumber: lineNum, words: words });
    }
  }
}// getLineSpecificWords

function getLineSpecificTextBetween(result: TextHighlight, line: string, range: string, from: string, to: string) {
  if (range !== '') {
    const ranges = getLineRanges(range);
    ranges.forEach((num) => {
      result.lineSpecificTextBetween.push({ lineNumber: num, from: from, to: to });
    });
  } else if (!isNaN(Number(line))) {
    const lineNum = Number(line);
    result.lineSpecificTextBetween.push({ lineNumber: lineNum, from: from, to: to });
  }
}// getLineSpecificTextBetween

function isWholeNumber(input: string): boolean {
  return validator.isInt(input, { allow_leading_zeroes: false });
}

function parseSegment(segment: string, textSeparator: string, lineSeparator: string): { line: string, range: string, word: string, from: string, to: string } {
  let from = '';
  let to = '';
  let line = '';
  let range = '';
  let word = '';

  const lineSeparatorIndex = segment.indexOf(lineSeparator);
  const fromToSeparatorIndex = segment.indexOf(textSeparator);

  if (lineSeparatorIndex !== -1 && fromToSeparatorIndex !== -1) { // string contains both : and | 
    if (lineSeparatorIndex > fromToSeparatorIndex){ // hlt::|
      from = segment.substring(0, fromToSeparatorIndex).trim();
      to = segment.substring(fromToSeparatorIndex + 1).trim();
    } else{ // hlt:|:
      const lineOrRange = segment.substring(0, lineSeparatorIndex).trim();
      const val = segment.substring(lineSeparatorIndex + 1).trim();
      if (lineOrRange.includes("-"))
        range = lineOrRange;
      else if (isWholeNumber(lineOrRange))
        line = lineOrRange;

      //if (val.includes(":")) {
      const valFromToSeparatorIndex = val.indexOf(textSeparator);
      if (valFromToSeparatorIndex !== -1) {
        from = val.substring(0, valFromToSeparatorIndex ).trim();
        to = val.substring(valFromToSeparatorIndex  + 1).trim();
      } else {
        word = val;
      }
    }
  } else if (fromToSeparatorIndex !== -1 && lineSeparatorIndex === -1){ // only contains :
    from = segment.substring(0, fromToSeparatorIndex).trim();
    to = segment.substring(fromToSeparatorIndex + 1).trim();
  } else if (lineSeparatorIndex !== -1 && fromToSeparatorIndex === -1){ // only contains |
    const lineOrRange = segment.substring(0, lineSeparatorIndex).trim();
    const val = segment.substring(lineSeparatorIndex + 1).trim();
    if (lineOrRange.includes("-"))
      range = lineOrRange;
    else if (isWholeNumber(lineOrRange))
      line = lineOrRange;

    word = val;
  } else { // does not contains : nor |
    if (segment.includes("-"))
      range = segment.trim();
    else if (isWholeNumber(segment))
      line = segment.trim();
    else
      word = segment.trim();
  }

  return { line, range, word, from, to };
}// parseSegment

interface AlternativeHighlight {
  alternativeLinesToHighlight: AlternativeLinesToHighlight;
  alternativeTextToHighlight: AlternativeTextHighlight;
}

function extractAlternativeHighlights(lineText: string, textSeparator: string, lineSeparator: string, settings: CodeblockCustomizerSettings): AlternativeHighlight {
  const currentMode = getCurrentMode();
  const alternateColors = settings.SelectedTheme.colors[currentMode].codeblock.alternateHighlightColors || {};

  const alternativeTextToHighlight: AlternativeTextHighlight = {
    allWordsInLine: [],
    words: [],
    lineSpecificWords: [],
    textBetween: [],
    lineSpecificTextBetween: [],
  };

  //const alternativeLinesToHighlight: AlternativeLinesToHighlight[] = [];
  const alternativeLinesToHighlight: AlternativeLinesToHighlight = {
    lines: [],
    words: [],
    lineSpecificWords: [],
  };

  for (const [alternateColorName] of Object.entries(alternateColors)) {
    const lineHighlight = getHighlightedLines(lineText, alternateColorName, textSeparator, lineSeparator);
    const textHighlight = getTextHighlight(lineText, `${alternateColorName}t`, textSeparator, lineSeparator);

    // lines or ranges
    if (lineHighlight.lineNumbers.length > 0) {
      alternativeLinesToHighlight.lines.push({lineNumbers: lineHighlight.lineNumbers, colorName: alternateColorName});
    }
    if (lineHighlight.words.length > 0) {
      alternativeLinesToHighlight.words.push({words: lineHighlight.words, colorName: alternateColorName});
    }
    if (lineHighlight.lineSpecificWords.length > 0) {
      lineHighlight.lineSpecificWords.forEach((lineSpecificWord) => {
        alternativeLinesToHighlight.lineSpecificWords.push({ ...lineSpecificWord, colorName: alternateColorName });
      });
    }

    // allWordsInLine
    if (textHighlight.allWordsInLine.length > 0) {
      alternativeTextToHighlight.allWordsInLine.push({ allWordsInLine: textHighlight.allWordsInLine, colorName: alternateColorName });
    }

    // lineSpecificWords
    if (textHighlight.lineSpecificWords.length > 0) {
      textHighlight.lineSpecificWords.forEach((lineSpecificWord) => {
        alternativeTextToHighlight.lineSpecificWords.push({ ...lineSpecificWord, colorName: alternateColorName });
      });
    }

    // words
    if (textHighlight.words.length > 0) {
      alternativeTextToHighlight.words.push({ words: textHighlight.words, colorName: alternateColorName });
    }

    // textBetween
    if (textHighlight.textBetween.length > 0) {
      textHighlight.textBetween.forEach((textBetween) => {
        alternativeTextToHighlight.textBetween.push({ ...textBetween, colorName: alternateColorName });
      });
    }

    // lineSpecificTextBetween
    if (textHighlight.lineSpecificTextBetween.length > 0) {
      textHighlight.lineSpecificTextBetween.forEach((lineSpecificTextBetween) => {
        alternativeTextToHighlight.lineSpecificTextBetween.push({ ...lineSpecificTextBetween, colorName: alternateColorName });
      });
    }
  }

  return {alternativeLinesToHighlight, alternativeTextToHighlight};
}// extractAlternativeHighlights

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

function processRange<T>(segment: string, segmentValue: string, result: T): void {
  const range = getLineRanges(segment);
  const words = segmentValue.split(',');

  range.forEach((num) => {
    const existingEntry = (result as LineSpecificWords[]).find(entry => entry.lineNumber === num);

    if (existingEntry) {
      existingEntry.words.push(...words);
    } else {
      (result as LineSpecificWords[]).push({
        lineNumber: num,
        words: words,
      });
    }
  });
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
      if (isNaN(start) || isNaN(end)) {
        return [];
      }
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
    const number = parseInt(line, 10);
    if (isNaN(number)) {
      return [];
    }
    return number;
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
        const base64SVG = `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 32 32">${svgContent}</svg>`)}`;
        Icons[lang.displayName] = svgContent;
        BLOBS[lang.displayName.replace(/\s/g, "_")] = `${base64SVG}`;
      }
    }
    for (const language of lang.codeblockLanguages) {
      manualLang[language] = lang.displayName as string;
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

export function getLanguageConfig(codeblockLanguage: string, plugin: CodeBlockCustomizerPlugin): LanguageConfig | undefined {
  codeblockLanguage = codeblockLanguage.toLowerCase();
  if (!plugin.customLanguageConfig) 
    return undefined;

  return plugin.customLanguageConfig.languages.find((langConfig: LanguageConfig) => 
    langConfig.codeblockLanguages.includes(codeblockLanguage)
  );
}// getLanguageConfig

function registerEditorSyntaxHighlightingForLanguage(codeblockLanguage: string, requiredSyntax: string, unload: boolean): void {
  if (!codeblockLanguage || codeblockLanguage.length === 0)
    return;

  if (!unload && (!requiredSyntax || requiredSyntax.length === 0))
    return;

  window.CodeMirror.defineMode(codeblockLanguage, config =>
    window.CodeMirror.getMode(config, unload ? "null" : requiredSyntax)
  );
}// registerEditorSyntaxHighlightingForLanguage

// Functions for displaying header BEGIN
export function createContainer(specific: boolean, languageName: string, hasLangBorderColor: boolean, codeblockLanguageSpecificClass: string) {
  const lang = languageName.length > 0 ? languageName.toLowerCase() : "nolang"
  const container = createDiv({cls: `codeblock-customizer-header-container${specific ? '-specific' : ''}`});
  container.classList.add(`codeblock-customizer-language-${lang.toLowerCase()}`);

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
      .codeblock-customizer-highlighted-text-${colorName.replace(/\s+/g, '-').toLowerCase()}{
        background-color: var(--codeblock-customizer-highlight-${colorName.replace(/\s+/g, '-').toLowerCase()}-color, ${hexValue}) !important;
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
  styleTag.innerText = (formatStyles(settings.SelectedTheme.colors, settings.SelectedTheme.settings, settings.SelectedTheme.colors[currentMode].codeblock.alternateHighlightColors, settings.SelectedTheme.settings.printing.forceCurrentColorUse) + altHighlightStyling + languageSpecificStyling + textSettingsStyles + minimalSpecificStyling).trim().replace(/[\r\n\s]+/g, ' ');

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

  if (settings.codeblock.enableSelectCodeButton) {
    document.body.classList.add('codeblock-customizer-show-select-code-button');
  } else{
    document.body.classList.remove('codeblock-customizer-show-select-code-button');
  }

  if (settings.codeblock.enableWrapCodeButton) {
    document.body.classList.add('codeblock-customizer-show-wrap-code-button');
  } else{
    document.body.classList.remove('codeblock-customizer-show-wrap-code-button');
  }

}// updateSettingStyles

function formatStyles(colors: ThemeColors, settings: ThemeSettings, alternateColors: Record<string, string>, forceCurrentColorUse: boolean) {
  return `
    body.codeblock-customizer {
      --wrap-code:${settings.codeblock.unwrapcode ? 'pre' : 'pre-wrap'}
    }
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
     
    return {
      level: indentationLevel,
      characters: additionalCharacters,
      //margin: margin
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

export function mergeBorderColorsToLanguageSpecificColors(app: CodeBlockCustomizerPlugin ,settings: CodeblockCustomizerSettings) {
  const borderColors = settings.SelectedTheme.colors[getCurrentMode()].codeblock.languageBorderColors;

  Object.entries(borderColors).forEach(([languageName, borderColor]) => {
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
  (async () => {await app.saveSettings()})();

}// mergeBorderColorsToLanguageSpecificColors

export function getPropertyFromLanguageSpecificColors(propertyName: string, settings: CodeblockCustomizerSettings): Record<string, string> {
  const languageColors: Record<string, Record<string, string>> = settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors;
  const result: Record<string, string> = {};

  Object.entries(languageColors).forEach(([languageName, properties]) => {
    if ((properties as Record<string, string>)[propertyName]) {
      result[languageName] = (properties as Record<string, string>)[propertyName];
    }
  });

  return result;
}// getPropertyFromLanguageSpecificColors

export async function getFileCacheAndContentLines(plugin: CodeBlockCustomizerPlugin, filePath: string): Promise<{ cache: CachedMetadata | null, fileContentLines: string[] | null }> {
  if (filePath === '')
    return {cache: null, fileContentLines: null};
  
  const cache = plugin.app.metadataCache.getCache(filePath);
  if (!cache)
    return {cache: null, fileContentLines: null};

  const file = plugin.app.vault.getAbstractFileByPath(filePath);
  if (!file) {
    console.error(`File not found: ${filePath}`);
    return { cache, fileContentLines: null };
  }

  const fileContent = await plugin.app.vault.cachedRead(<TFile>file).catch((error) => {
    console.error(`Error reading file: ${error.message}`);
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

export async function indentCodeBlock(editor: Editor, view: MarkdownView){
  const cursorPos = editor.getCursor();
  const { cache, fileContentLines } = await getFileCacheAndContentLines(this, view.file?.path ?? '')
  if (!cache || !fileContentLines)
    return;

  if (cache?.sections) {
    for (const sections of cache.sections) {
      if (sections.type === "code" && cursorPos.line >= sections.position.start.line && cursorPos.line <= sections.position.end.line) {
        const codeBlockLines = fileContentLines.slice(sections.position.start.line, sections.position.end.line + 1);
        const indentedLines = addIndentation(codeBlockLines);
        const pos: EditorPosition = {line: sections.position.start.line, ch: 0};
        const endPos: EditorPosition = {line: sections.position.end.line, ch: sections.position.end.col};
        editor.replaceRange(indentedLines.join('\n'), pos, endPos);
        view.save();
      }
    }
  }
}// indentCodeBlock

export async function unIndentCodeBlock(editor: Editor, view: MarkdownView) {
  const cursorPos = editor.getCursor();
  const { cache, fileContentLines } = await getFileCacheAndContentLines(this, view.file?.path ?? '')
  if (!cache || !fileContentLines)
    return;

  if (cache?.sections) {
    for (const sections of cache.sections) {
      if (sections.type === "code" && cursorPos.line >= sections.position.start.line && cursorPos.line <= sections.position.end.line) {
        const codeBlockLines = fileContentLines.slice(sections.position.start.line, sections.position.end.line + 1);
        const indentedLines = removeIndentation(codeBlockLines);
        const pos: EditorPosition = {line: sections.position.start.line, ch: 0};
        const endPos: EditorPosition = {line: sections.position.end.line, ch: sections.position.end.col};
        editor.replaceRange(indentedLines.join('\n'), pos, endPos);
        view.save();
      }
    }
  }
}// unIndentCodeBlock