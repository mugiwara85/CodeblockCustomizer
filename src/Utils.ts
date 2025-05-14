import { setIcon, editorLivePreviewField, Notice, MarkdownRenderer, App, TFile, CachedMetadata, EditorPosition, Editor, MarkdownView } from "obsidian";
import { EditorState } from "@codemirror/state";

import { Languages, manualLang, Icons, SVG_FILE_PATH, SVG_FOLDER_PATH, DEFAULT_COLLAPSE_TEXT, DEFAULT_TEXT_SEPARATOR, DEFAULT_LINE_SEPARATOR } from "./Const";
import { CodeblockCustomizerSettings, Colors, Theme, ThemeColors, ThemeSettings } from "./Settings";
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

export function extractFileTitle(parsedParameters: ParsedParams): string {
  const file =  extractParameter(parsedParameters, "file");
  const title =  extractParameter(parsedParameters, "title");
  
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
  //const regex = /(\S+?)([:=])(["'][^"']*["']|[^"'\s]+)?/g; // old
  const regex = /(\S+?)([:=])(["'](?:\\.|[^\\])*?["']|(?:\\.|[^\\\s])+)/g;
  let match;

  while ((match = regex.exec(cleanedLine)) !== null) {
    const [, key, , value] = match;

    let cleanedValue = value ? value.trim() : '';
    // Remove surrounding quotes if present
    if ((cleanedValue.startsWith('"') && cleanedValue.endsWith('"')) || (cleanedValue.startsWith("'") && cleanedValue.endsWith("'"))) {
      cleanedValue = cleanedValue.slice(1, -1);
    }
    cleanedValue = cleanedValue.replace(/\\(["'])/g, '$1');
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

interface PromptLines {
  lineNumbers: number[];
  text: string;
  values: PromptValues;
}

interface PromptValues {
  user: string | null;
  host: string | null;
  path: string | null;
  db: string | null;
  branch: string | null;
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
  prompt: PromptLines;
}

export function getAllParameters(originalLineText: string, settings: CodeblockCustomizerSettings) {
  const lineText = originalLineText.trim();
  const parsedParameters = parseParameters(lineText);

  // backtickcount
  const backtickCount = getBacktickCount(originalLineText);

  // indentation
  const { level, characters } = getIndentationLevel(originalLineText);

  // get line separator
  const lsep = extractParameter(parsedParameters, 'lsep')?.charAt(0);
  const lineSeparator = lsep || settings.SelectedTheme.settings.textHighlight.lineSeparator || DEFAULT_LINE_SEPARATOR;

  // get text separator
  const tsep = extractParameter(parsedParameters, 'tsep')?.charAt(0);
  const textSeparator = tsep || settings.SelectedTheme.settings.textHighlight.textSeparator || DEFAULT_TEXT_SEPARATOR;

  // default highlight (lines)
  const defaultLinesToHighlight = getHighlightedLines(parsedParameters, "HL", textSeparator, lineSeparator);

  // default text highlight (words, lineSpecificWords, from - to)
  const defaultTextToHighlight = getTextHighlight(parsedParameters, "hlt", textSeparator, lineSeparator);

  // highlight with alternative colors (lines, words, lineSpecificWords, from - to)
  const {alternativeLinesToHighlight, alternativeTextToHighlight} = extractAlternativeHighlights(parsedParameters, textSeparator, lineSeparator, settings);

  // isSpecificNumber and showNumbers
  const { isSpecificNumber, showNumbers, lineNumberOffset } = determineLineNumberDisplay(parsedParameters);

  // fileName/Title
  let headerDisplayText = extractFileTitle(parsedParameters);

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

  // prompt
  const prompt = getPromptLines(parsedParameters, "prompt", textSeparator, lineSeparator);
  prompt.values = prompt.values = {
    user: extractParameter(parsedParameters, "user"),
    host: extractParameter(parsedParameters, "host"),
    path: extractParameter(parsedParameters, "path"),
    db: extractParameter(parsedParameters, "db"),
    branch: extractParameter(parsedParameters, "branch")
  };

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
    textSeparator,
    prompt
  };
}// getParameters

export function getDefaultParameters() {
  return {
    defaultLinesToHighlight: {lineNumbers: [], words: [], lineSpecificWords: []},
    defaultTextToHighlight: {allWordsInLine: [], lineSpecificTextBetween: [], lineSpecificWords: [], textBetween: [], words: []},
    alternativeLinesToHighlight: {lines: [], words: [], lineSpecificWords: []},
    alternativeTextToHighlight: { allWordsInLine: [], lineSpecificWords: [], words: [], textBetween: [], lineSpecificTextBetween: []},
    isSpecificNumber: false,
    lineNumberOffset: 0,
    showNumbers: "",
    headerDisplayText: "",
    fold: false,
    unfold: false,
    language: "",
    displayLanguage: "",
    specificHeader: false,
    hasLangBorderColor: false,
    exclude: false,
    backtickCount: 0,
    indentLevel: 0,
    indentCharacter: 0,
    lineSeparator: '',
    textSeparator: '',
    prompt: { lineNumbers: [], text: "", values: { user: null, host: null, path: null, db: null, branch: null}
    }
  }
}// getDefaultParameters

function sortAndRemoveDuplicates(numbers: number[]): number[] {
  // sort
  numbers.sort((a, b) => a - b);

  // remove duplicates
  const uniqueNumbers = numbers.filter((value, index, array) => {
    return index === 0 || value !== array[index - 1];
  });

  return uniqueNumbers;
}// sortAndRemoveDuplicates

function getPromptLines(parsedParameters: ParsedParams, parameter: string, textSeparator: string, lineSeparator: string) {
  const result: PromptLines = {
    lineNumbers: [],
    text: "",
    values: {
      user: null,
      host: null,
      path: null,
      db: null,
      branch: null
    }
  };  

  const parameterValue = extractParameter(parsedParameters, parameter);
  if (!parameterValue) {
    return result;
  }

  const trimmedParams = parameterValue.trim();
  const separatorIndex = trimmedParams.indexOf(lineSeparator);
  if (separatorIndex === -1) {
    // no | present, treat as only prompt text
    result.text = trimmedParams;
    return result;
  }

  const beforeSeparator = trimmedParams.substring(0, separatorIndex).trim();  // line numbers or ranges
  const afterSeparator = trimmedParams.substring(separatorIndex + 1).trim();  // promptText

  const ranges = getLineRanges(beforeSeparator);
  result.lineNumbers.push(...ranges);
  result.text = afterSeparator;

  result.lineNumbers = sortAndRemoveDuplicates(result.lineNumbers);

  return result;
}// getPromptLines

function getHighlightedLines(parsedParameters: ParsedParams, parameter: string, textSeparator: string, lineSeparator: string) {
  const result: LinesToHighlight = {
    lineNumbers: [],
    words: [],
    lineSpecificWords: [],
  };

  const parameterValue = extractParameter(parsedParameters, parameter);
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

function getTextHighlight(parsedParameters: ParsedParams, parameter: string | null, textSeparator: string, lineSeparator: string): TextHighlight {
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

  const parameterValue = extractParameter(parsedParameters, parameter);
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
}// isWholeNumber

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

function extractAlternativeHighlights(parsedParameters: ParsedParams, textSeparator: string, lineSeparator: string, settings: CodeblockCustomizerSettings): AlternativeHighlight {
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
    const lineHighlight = getHighlightedLines(parsedParameters, alternateColorName, textSeparator, lineSeparator);
    const textHighlight = getTextHighlight(parsedParameters, `${alternateColorName}t`, textSeparator, lineSeparator);

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

function determineLineNumberDisplay(parsedParameters: ParsedParams) {
  const specificLN = extractParameter(parsedParameters, "ln") || "";
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

export function extractParameter(parsedParameters: ParsedParams, searchTerm: string): string | null {
  return parsedParameters[searchTerm.toLowerCase()] || null;
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
}// processRange

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
  const promptColorStyles = generatePromptColorStyles(settings);

  styleTag.innerText = (formatStyles(settings.SelectedTheme.colors, settings.SelectedTheme.settings, settings.SelectedTheme.settings.printing.forceCurrentColorUse) + altHighlightStyling + languageSpecificStyling + textSettingsStyles + minimalSpecificStyling + promptColorStyles).trim().replace(/[\r\n\s]+/g, ' ');

  updateSettingClasses(settings.SelectedTheme.settings);
}// updateSettingStyles

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

  if (settings.codeblock.buttons.enableDeleteCodeButton)
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

  if (settings.codeblock.buttons.enableSelectCodeButton) {
    document.body.classList.add('codeblock-customizer-show-select-code-button');
  } else{
    document.body.classList.remove('codeblock-customizer-show-select-code-button');
  }

  if (settings.codeblock.buttons.enableWrapCodeButton) {
    document.body.classList.add('codeblock-customizer-show-wrap-code-button');
  } else{
    document.body.classList.remove('codeblock-customizer-show-wrap-code-button');
  }

  if (settings.codeblock.buttons.alwaysShowCopyCodeButton) {
    document.body.classList.add('codeblock-customizer-always-show-copy-code-button');
  } else{
    document.body.classList.remove('codeblock-customizer-always-show-copy-code-button');
  }

}// updateSettingStyles

function formatStyles(colors: ThemeColors, settings: ThemeSettings, forceCurrentColorUse: boolean) {
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
      },addAltHighlightColors(colors.light.codeblock.alternateHighlightColors))}
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
      },addAltHighlightColors(colors.dark.codeblock.alternateHighlightColors))}
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

function addAltHighlightColors(alternateColors: Record<string, string>) {
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

export type ParsedPrompt = Record<string, string>;

export type PromptDefinition = {
  name: string;
  basePrompt: string;                         // Optional: example prompt for preview or fallback
  highlightGroups?: Record<string, string>;   // e.g., { user: "user", host: "host" }
  supportsRootStyling?: boolean;
  parsePromptRegex?: RegExp;                  // optional named-group regex
  parsePromptRegexString?: string;            // regex as string
  defaultDir?: string;
  defaultDb?: string;
  defaultUser?: string;
  defaultHost?: string;
  defaultBranch?: string;
  isWindowsShell: boolean;
};// PromptDefinition

export const defaultPrompts: Record<string, PromptDefinition> = {
  bash: {
    name: "Bash",
    basePrompt: "{user}@{host}:{path}$",
    defaultDir: "~/",
    defaultUser: "user",
    defaultHost: "localhost",
    parsePromptRegex: /^(?<user>[^@]+)@(?<host>[^:]+):(?<path>.+?)([$#])$/,
    highlightGroups: {
      user: "user",
      host: "host",
      path: "path"
    },
    supportsRootStyling: true,
    isWindowsShell: false,
  },

  bashalt: {
    name: "Bash (alt)",
    basePrompt: "[{user}@{host} {path}]$",
    defaultDir: "~",
    defaultUser: "user",
    defaultHost: "localhost",
    parsePromptRegex: /^\[(?<user>[^@]+)@(?<host>[^ ]+) (?<path>.+?)\]([$#])$/,
    highlightGroups: {
      user: "user",
      host: "host",
      path: "path"
    },
    supportsRootStyling: true,
    isWindowsShell: false,
  },

  zshgit: {
    name: "Zsh + Git",
    basePrompt: "➜ {path} git:({branch}) ✗",
    defaultDir: "~/projects",
    defaultBranch: "main",
    defaultUser: "user",
    defaultHost: "localhost",
    parsePromptRegex: /^\s*(?<symbol>➜)\s+(?<path>.+?)\s+git:\((?<branch>.+?)\)(\s+(?<status>[✗✓]))?\s*$/,
    highlightGroups: {
      symbol: "zsh-symbol",
      path: "path",
      branch: "branch",
    },
    isWindowsShell: false,
  },

  zsh: {
    name: "Zsh",
    basePrompt: "{user}@{host} {path} %",
    defaultDir: "~/myapp",
    defaultUser: "user",
    defaultHost: "localhost",
    parsePromptRegex: /^(?<user>[^@]+)@(?<host>[^ ]+) (?<path>.+?)[%#]$/,
    highlightGroups: {
      user: "user",
      host: "host",
      path: "path",
    },
    supportsRootStyling: true,
    isWindowsShell: false,
  },

  kali: {
    name: "Kali Linux",
    basePrompt: "({user}㉿{host})-[{path}] $",
    defaultDir: "~",
    defaultUser: "kali",
    defaultHost: "kali",
    parsePromptRegex: /^\((?<user>[^㉿]+)㉿(?<host>[^)]+)\)-\[(?<path>[^\]]+)\]\s*([$#])$/,
    highlightGroups: {
      user: "user",
      host: "host",
      path: "path"
    },
    supportsRootStyling: true,
    isWindowsShell: false,
  },

  fish: {
    name: "Fish",
    basePrompt: "{path}>",
    defaultUser: "user",
    defaultHost: "localhost",
    defaultDir: "~/projects/myapp",
    parsePromptRegex: /^(?<path>.+)>$/,
    highlightGroups: {
      path: "path"
    },
    isWindowsShell: false,
  },

  ps: {
    name: "PowerShell",
    basePrompt: "PS {path}>",
    defaultUser: "Administrator",
    defaultHost: "localhost",
    defaultDir: "C:\\Users\\Administrator",
    parsePromptRegex: /^PS (?<path>.+)>$/,
    highlightGroups: {
      path: "path"
    },
    isWindowsShell: true,
  },

  cmd: {
    name: "CMD",
    basePrompt: "{path}>",
    defaultUser: "Administrator",
    defaultHost: "localhost",
    defaultDir: "C:\\Users\\Administrator",
    parsePromptRegex: /^(?<path>.+)>$/,
    highlightGroups: {
      path: "path"
    },
    isWindowsShell: true,
  },

  docker: {
    name: "Docker shell",
    basePrompt: "{user}@{host}:{path}$",
    defaultDir: "/var/www/html",
    defaultUser: "user",
    defaultHost: "container",
    parsePromptRegex: /^(?<user>[^@]+)@(?<host>[^:]+):(?<path>.+?)([$#])$/,
    highlightGroups: {
      user: "user",
      host: "host",
      path: "path"
    },
    supportsRootStyling: true,
    isWindowsShell: false,
  },

  postgres: {
    name: "PostgreSQL",
    basePrompt: "{db}=#",
    defaultDb: "postgres",
    parsePromptRegex: /^(?<db>.+)=#$/,
    highlightGroups: {
      db: "db"
    },
    isWindowsShell: false,
  }
};// defaultPrompts

// used for settingspage
export const promptClassDisplayNames: Record<string, string> = {
  "prompt-user": "User",
  "prompt-host": "Host",
  "prompt-path": "Path",
  "prompt-db": "Database",
  "prompt-branch": "Branch",
  "prompt-symbol": "Symbol (fallback)",
  "prompt-dollar": "Dollar ($)",
  "prompt-at": "At (@)",
  "prompt-colon": "Colon (:)",
  "prompt-dash": "Dash (-)",
  "prompt-hash": "Hash (#)",
  "prompt-greater-than": "Greater Than (>)",
  "prompt-zsh-symbol": "ZSH Arrow (➜)",
  "prompt-zsh-status-error": "ZSH Error (✗)",
  "prompt-zsh-status-ok": "ZSH Ok (✓)",
  "prompt-kali-symbol": "Kali Symbol (㉿)",
  "prompt-square-open": "Square Bracket [",
  "prompt-square-close": "Square Bracket ]",
  "prompt-bracket-open": "Round Bracket (",
  "prompt-bracket-close": "Round Bracket )",
  "prompt-percent": "Percentage (%)",
};// promptClassDisplayNames

export const symbolClassMap: Record<string, string> = {
  "(": "prompt-bracket-open",
  ")": "prompt-bracket-close",
  "[": "prompt-square-open",
  "]": "prompt-square-close",
  "$": "prompt-dollar",
  ":": "prompt-colon",
  "@": "prompt-at",
  "-": "prompt-dash",
  "➜": "prompt-zsh-symbol",
  "✗": "prompt-zsh-status-error",
  "✓": "prompt-zsh-status-ok",
  ">": "prompt-greater-than",
  "#": "prompt-hash",
  "㉿": "prompt-kali-symbol",
  "%": "prompt-percent",
};// symbolClassMap

const highlightMapCache = new WeakMap<PromptDefinition, Record<string, string>>();

function getCachedHighlightMap(def: PromptDefinition): Record<string, string> {
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
    fragment.append(
      ...batchSpans(promptStr, (char) => resolvePromptClass(char, { type: "symbol" }))
    );
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

export enum PromptKind {
  Predefined = "predefined",
  Template = "template",
  Plain = "plain",
}// PromptKind

export function getPromptType(promptText: string): PromptKind {
  const promptDef = defaultPrompts[promptText];

  if (promptDef) 
    return PromptKind.Predefined;

  if (/\{.*?\}/.test(promptText)) 
    return PromptKind.Template;

  return PromptKind.Plain;
}// getPromptType

export function getPromptDetails(promptType: string, settings: CodeblockCustomizerSettings): { kind: PromptKind, name: string, baseClass: string, isCustom: boolean } {
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

export function resolvePromptClass(token: string, context: {type: 'symbol' | 'template' | 'regex'; groupName?: string;}): string {
  if (context.type === 'symbol') {
    const baseCls = symbolClassMap[token] ?? 'prompt-symbol';
    return `prompt-part ${baseCls}`;
  }

  if ((context.type === 'template' || context.type === 'regex') && context.groupName) {
    return `prompt-part prompt-${context.groupName}`;
  }

  return 'prompt-symbol';
}// resolvePromptClass

function getMatchRanges(promptText: string, match: RegExpExecArray, groupMap: Record<string, string>): { start: number; end: number; groupName: string }[] {
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

export function resolvePath(current: string, target: string, homeDir?: string): string {
  if (!target || target === "~") 
    return "~";

  const isWindows = /^[a-zA-Z]:[\\/]/.test(current);
  const separator = isWindows ? "\\" : "/";

  const normalize = (path: string): string => {
    let preservedPrefix = "";
  
    if (isWindows && path.startsWith("\\\\")) {
      preservedPrefix = "\\\\";
      path = path.slice(2);
    }
  
    path = path.replace(/[\\/]+/g, separator);
  
    // prevent stripping the only slash (root)
    if (path === separator) 
      return preservedPrefix + separator;
  
    // otherwise strip trailing slashes
    return preservedPrefix + path.replace(new RegExp(`${escapeForRegex(separator)}+$`), "");
  };
    
  // handle ~
  if (target.startsWith("~")) {
    /*const home = "~";
    const suffix = target.length > 1 ? target.slice(1) : "";
    return normalize(home + separator + suffix);*/
    const suffix = target.length > 1 ? target.slice(1) : "";
    if (homeDir) {
      return normalize(homeDir + suffix);
    }
    return normalize("/home/user" + suffix);
  }
  
  // handle network paths
  if (isWindows) {
    if (/^\\\\[^\\]+\\[^\\]+/.test(target)) {
      return normalize(target); // proper UNC
    }
  
    // UNC with forward slashes (e.g., //server/share)
    if (/^\/\/[^/]+\/[^/]+/.test(target)) {
      return normalize(current + "\\" + target.replace(/[\\/]+/g, "\\"));
    }
  } else {
    // linux shell: replace backslashes with forward slashes
    target = target.replace(/\\/g, "/");
  }  

  // absolute paths
  if (/^[a-zA-Z]:[\\/]/.test(target) || (!isWindows && target.startsWith("/"))) {
    return normalize(target);
  }

  // normalize current path
  const normalizedCurrent = normalize(current);
  /*const isAtHome = normalizedCurrent === "~";
  if (isAtHome && homeDir) {
    normalizedCurrent = normalize(homeDir);
  }*/

  let drive = "";
  let currentParts: string[];

  if (isWindows) {
    const match = normalizedCurrent.match(/^([a-zA-Z]:)(.*)/);
    drive = match?.[1] ?? "";
    currentParts = match?.[2].split(separator).filter(Boolean) ?? [];
  } else {
    currentParts = normalizedCurrent.split(separator).filter(Boolean);
  }

  const targetParts = target.split(/[\\/]/).filter(Boolean);
  const resolvedParts: string[] = [...currentParts];

  for (const part of targetParts) {
    if (part === "..") {
      if (resolvedParts.length > 0) {
        resolvedParts.pop();
      }
      // if empty, stay at root (C:\ for Windows, / for Unix)
    } else if (part !== ".") {
      resolvedParts.push(part);
    }
  }

  if (isWindows) {
    return drive + (resolvedParts.length > 0 ? "\\" + resolvedParts.join("\\") : "\\");
  } else {
    return "/" + resolvedParts.join("/");
  }
}// resolvePath

function escapeForRegex(s: string): string {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}// escapeForRegex

export function simplifyHomePath(path: string, homeDir: string | undefined): string {
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

export function shouldSimplifyHomePath(promptDef: PromptDefinition | undefined): boolean {
  if (!promptDef) 
    return true; // assume Linux
  
  // if promptDef is Windows don't simplify
  return !(promptDef.isWindowsShell);
}// shouldSimplifyHomePath

type PromptReplacement = string | { text: string; class?: string }[];

export function replacePromptTemplate(promptKind: PromptKind, promptType: string, promptDef: PromptDefinition | undefined, env: PromptEnvironment): PromptReplacement {
  const simplify = shouldSimplifyHomePath(promptDef);
  const dir = env.dir ?? "~";
  const finalPath = simplify ? simplifyHomePath(dir, env.homeDir) : dir;

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
  const customs = settings.SelectedTheme.settings.prompts.customPrompts;
  const edits  = settings.SelectedTheme.settings.prompts.editedDefaults;
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

export type PromptEnvironment = {
  dir: string;
  previousDir: string;
  user: string;
  host: string;
  db: string;
  branch: string;
  userStack?: string[];
  homeDir: string;
  originalHomeDir: string;
};// PromptEnvironment

export function parsePromptCommands(lineText: string, promptDef: PromptDefinition | undefined, env: PromptEnvironment): PromptEnvironment {
  const envCopy = { ...env };
  envCopy.userStack = [...(env.userStack ?? [])];

  const isWindowsShell = promptDef?.isWindowsShell ?? false;

  // cd
  const cdMatch = lineText.match(/^\s*cd\s*(.*)$/i);
  if (cdMatch) {
    let cdTarget = cdMatch[1].trim();
    if ((cdTarget.startsWith('"') && cdTarget.endsWith('"')) || (cdTarget.startsWith("'") && cdTarget.endsWith("'"))) {
      cdTarget = cdTarget.slice(1, -1);
    }

    let newDir = env.dir;
    if (cdTarget === "" || cdTarget === "~") {
      newDir = env.homeDir;
    } else if (cdTarget === "-") {
      const temp = env.dir;
      newDir = env.previousDir;
      envCopy.previousDir = temp;
    } else if (cdTarget === ".." || cdTarget === "cd..") {
      newDir = resolvePath(env.dir, "..");
    } else {
      newDir = resolvePath(env.dir, cdTarget, env.homeDir);
    }

    if (newDir !== env.dir && cdTarget !== "-") {
      envCopy.previousDir = env.dir;
    }
    envCopy.dir = newDir;
  }

  // su
  const suMatch = lineText.match(/^\s*su\s*(\S*)/i);
  if (suMatch) {
    if (envCopy.userStack.length < 5) {
      envCopy.userStack.push(env.user);
    }
    
    envCopy.user = suMatch[1] || "root";
    if (isWindowsShell) {
      envCopy.homeDir = `C:\\Users\\${envCopy.user}`;
    } else {
      envCopy.homeDir = `/home/${envCopy.user}`;
    }
  }

  // exit
  if (/^\s*exit\s*$/i.test(lineText)) {
    if (envCopy.userStack.length > 0) {
      const prevUser = envCopy.userStack.pop();
      if (prevUser !== undefined) {
        envCopy.user = prevUser;
        if (isWindowsShell) {
          envCopy.homeDir = `C:\\Users\\${prevUser}`;
        } else {
          envCopy.homeDir = `/home/${prevUser}`;
        }
      }
    }
  }

  // db switch
  const dbMatch = lineText.match(/^\\c\s+(\S+)/);
  if (dbMatch) {
    envCopy.db = dbMatch[1];
  }

  // git branch switch
  const gitCheckout = lineText.match(/^\s*git\s+(checkout|switch)\s+(\S+)/i);
  if (gitCheckout) {
    envCopy.branch = gitCheckout[2];
  }

  return envCopy;
}// parsePromptCommands

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
  const allPromptDefs = {
    ...defaultPrompts,
    ...settings.SelectedTheme.settings.prompts.customPrompts
  };
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

export function resolveHighlightClassMap(def: PromptDefinition): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [group, className] of Object.entries(def.highlightGroups ?? {})) {
    map[group] = `prompt-part prompt-${className}`;
  }
  return map;
}// resolveHighlightClassMap

function getResolvedPromptColorsForMode(settings: CodeblockCustomizerSettings, baseTheme: Theme, promptId: string, mode: 'light' | 'dark', editingRoot: boolean): Record<string, string> {
  const base = baseTheme.colors[mode].prompts;

  const edited = editingRoot
    ? settings.SelectedTheme.colors[mode].prompts.editedRootPromptColors?.[promptId] ?? {}
    : settings.SelectedTheme.colors[mode].prompts.editedPromptColors?.[promptId] ?? {};

  const defaults = editingRoot
    ? base?.rootPromptColors?.[promptId] ?? {}
    : base?.promptColors?.[promptId] ?? {};

  return { ...defaults, ...edited };
}// getResolvedPromptColorsForMode

export type PromptCache = { key: string; node: HTMLElement | null };

interface PromptContext {
  promptType: string;
  promptDef: PromptDefinition;
  isCustom: boolean;
  actualPrompt: string;
  promptKind: PromptKind;
  settings: CodeblockCustomizerSettings;
}// PromptContext

interface PromptResult {
  promptData: string | { text: string; class?: string }[];
  newEnv: PromptEnvironment;
  newCache: PromptCache;
  node: HTMLElement;
}// PromptResult

export function createPromptContext(parameters: Parameters, settings: CodeblockCustomizerSettings): { context: PromptContext; initialEnv: PromptEnvironment } {
  const promptType = parameters.prompt.text;
  const { def: promptDef, isCustom } = getPromptDefinition(promptType, settings);
  const promptKind = getPromptType(!isCustom ? promptType : promptDef.basePrompt);
  const actualPrompt = promptDef.basePrompt ?? promptType;
  const isWindowsShell = promptDef.isWindowsShell ?? false;
  const user = parameters.prompt.values?.user ?? promptDef.defaultUser ?? "user";
  const homeDir = isWindowsShell ? `C:\\Users\\${user}` : `/home/${user}`;
  const defaultDir = parameters.prompt.values?.path ?? promptDef.defaultDir ?? homeDir;

  const initialEnv: PromptEnvironment = {
    user,
    host: parameters.prompt.values?.host ?? promptDef.defaultHost ?? "localhost",
    dir: defaultDir,
    previousDir: defaultDir,
    db: parameters.prompt.values?.db ?? promptDef.defaultDb ?? "postgres",
    branch: parameters.prompt.values?.branch ?? "main",
    homeDir,
    originalHomeDir: homeDir,
    userStack: [],
  };

  return { context: { promptType, promptDef, isCustom, actualPrompt, promptKind, settings, }, initialEnv, };
}// createPromptContext

export function renderPromptLine(lineText: string, snapshotEnv: PromptEnvironment, cache: PromptCache, ctx: PromptContext): PromptResult {
  const shellCmdRegex = /\b(cd|su|exit|git|\\c)\b/;

  // cache key
  const key = `${ctx.actualPrompt}|${promptEnvKey(snapshotEnv)}`;

  // re-render promptData
  const promptContent = replacePromptTemplate(ctx.promptKind, ctx.actualPrompt, ctx.promptDef, snapshotEnv);

  let node: HTMLElement;
  if (cache.key === key && cache.node) {
    node = cache.node.cloneNode(true) as HTMLElement;
  } else {
    const isRoot = snapshotEnv.user === "root";
    const newNode = addClassesToPrompt(promptContent, ctx.isCustom ? ctx.promptDef.name : ctx.promptType, ctx.promptDef, ctx.settings, isRoot);
    cache = { key, node: newNode };
    node = newNode.cloneNode(true) as HTMLElement;
  }

  const newEnv = shellCmdRegex.test(lineText) ? parsePromptCommands(lineText, ctx.promptDef, snapshotEnv) : snapshotEnv;

  return { promptData: promptContent, newEnv, newCache: cache, node};
}// renderPromptLine

function promptEnvKey(env: PromptEnvironment): string {
  return [env.user, env.dir, env.db, env.branch, env.host, env.previousDir].join('|');
}// promptEnvKey

export function computePromptLines(parameters: Parameters, totalLines: number): Set<number> {
  const lines = new Set<number>();
  
  if (!parameters.prompt.text) 
    return lines;

  if (parameters.prompt.lineNumbers.length > 0) {
    for (const ln of parameters.prompt.lineNumbers) {
      lines.add(ln);
    }
  } else {
    for (let i = 1; i <= totalLines; i++) {
      lines.add(i);
    }
  }

  return lines;
}// computePromptLines
