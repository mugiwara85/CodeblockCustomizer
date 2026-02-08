import { DEFAULT_COLLAPSE_TEXT, DEFAULT_LINE_SEPARATOR, DEFAULT_TEXT_SEPARATOR } from "./Const";
import { defaultPrompts, PromptLines } from "./PromptManager";
import { getPromptDefinition } from "./PromptUtils";
import { CodeblockCustomizerSettings } from "./Settings";
import { getBorderColorByLanguage, getCurrentMode, getDisplayLanguageName, getPropertyFromLanguageSpecificColors } from "./Utils";

import validator from 'validator';

export interface ParsedParams {
  [key: string]: string;
}

interface AlternativeHighlight {
  alternativeLinesToHighlight: AlternativeLinesToHighlight;
  alternativeTextToHighlight: AlternativeTextHighlight;
}

// inerfaces for highlight
export type HighlightedWord = {
  text: string;
  occurrences: number[];
};

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
  occurrences: number[];
};

type LineSpecificTextBetween = {
  from: string;
  to: string;
  lineNumber: number;
  occurrences: number[];
};

type TextHighlightLineSpecificWords = {
  words: HighlightedWord[];
  lineNumber: number;
};

interface TextHighlight {
  allWordsInLine: number[];
  words: HighlightedWord[];
  lineSpecificWords: TextHighlightLineSpecificWords[];
  textBetween: TextBetween[];
  lineSpecificTextBetween: LineSpecificTextBetween[];
}

// inerfaces for alternative highlight
interface AlternativeLinesToHighlight {
  lines: AlternativeHighlightedLines[];
  words: AlternativeWords[];
  lineSpecificWords: AlternativeLineSpecificWords[];
  outputLines: AlternativeHighlightedLines[];
  outputWords: AlternativeWords[];
  outputLineSpecificWords: AlternativeLineSpecificWords[];
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

type AlternativeTextHighlightWords = {
  words: HighlightedWord[];
  colorName: string;
};

type AlternativeTextHighlightLineSpecificWords = TextHighlightLineSpecificWords & {
  colorName: string;
};

interface AlternativeTextHighlight {
  allWordsInLine: AlternativeAllWordsInLine[];
  words: AlternativeTextHighlightWords[];
  lineSpecificWords: AlternativeTextHighlightLineSpecificWords[];
  textBetween: AlternativeTextBetween[];
  lineSpecificTextBetween: AlternativeLineSpecificTextBetween[];
  outputAllWordsInLine: AlternativeAllWordsInLine[];
  outputWords: AlternativeTextHighlightWords[];
  outputLineSpecificWords: AlternativeTextHighlightLineSpecificWords[];
  outputTextBetween: AlternativeTextBetween[];
  outputLineSpecificTextBetween: AlternativeLineSpecificTextBetween[];
}

export interface LineNumberJump {
  lineNumber: number;
  newStartNumber: number;
}

export interface CBCParameters {
  defaultLinesToHighlight: LinesToHighlight;
  defaultTextToHighlight: TextHighlight;
  outputLinesToHighlight: LinesToHighlight;
  outputTextToHighlight: TextHighlight;
  alternativeLinesToHighlight: AlternativeLinesToHighlight;
  alternativeTextToHighlight: AlternativeTextHighlight;
  isSpecificNumber: boolean;
  lineNumberOffset: number;
  lineNumberJumps: LineNumberJump[];
  showNumbers: string;
  hasTitle: boolean;            // this is just a boolean if file or title was specified or not
  headerDisplayText: string;    // this is the actual text resulting from file/title or default
  fold: boolean;
  unfold: boolean;
  language: string;
  displayLanguage: string;
  hasLangBorderColor: boolean;
  exclude: boolean;
  fenceChar: '`' | '~' | null;
  fenceCount: number;
  indentLevel: number;
  indentCharacter: number;
  lineSeparator: string;
  textSeparator: string;
  prompt: PromptLines;
  parsePromptId: string | null;
  noPrompt: boolean;
  noPromptLines: number[];
  noParse: boolean;
  noParseLines: number[];
  group: string;
  tab: string;
  output: boolean;
}

export function getAllParameters(originalLineText: string, settings: CodeblockCustomizerSettings, isReadingView = false): CBCParameters {
  const lineText = originalLineText.trim();
  const parsedParameters = parseParameters(lineText);

  // backtickcount
  const { char: fenceChar, count: fenceCount } = getFenceDetails(originalLineText);

  // indentation
  const { level, characters } = getIndentationLevel(originalLineText);

  // get line separator
  const lsep = extractParameter(parsedParameters, 'lsep')?.charAt(0);
  const lineSeparator = lsep || settings.pluginSettings.textHighlight.lineSeparator || DEFAULT_LINE_SEPARATOR;

  // get text separator
  const tsep = extractParameter(parsedParameters, 'tsep')?.charAt(0);
  const textSeparator = tsep || settings.pluginSettings.textHighlight.textSeparator || DEFAULT_TEXT_SEPARATOR;

  // default highlight (lines)
  const defaultLinesToHighlight = getHighlightedLines(parsedParameters, "HL", textSeparator, lineSeparator);

  // default highlight (lines) - execute code output
  const outputLinesToHighlight = getHighlightedLines(parsedParameters, "hlo", textSeparator, lineSeparator);

  // default text highlight (words, lineSpecificWords, from - to)
  const defaultTextToHighlight = getTextHighlight(parsedParameters, "hlt", textSeparator, lineSeparator);

  // default text highlight (words, lineSpecificWords, from - to) - execude code output
  const outputTextToHighlight = getTextHighlight(parsedParameters, "hlto", textSeparator, lineSeparator);

  // highlight with alternative colors (lines, words, lineSpecificWords, from - to)
  const { alternativeLinesToHighlight, alternativeTextToHighlight } = extractAlternativeHighlights(parsedParameters, textSeparator, lineSeparator, settings);

  // isSpecificNumber and showNumbers
  const { isSpecificNumber, showNumbers, lineNumberOffset, lineNumberJumps } = determineLineNumberDisplay(parsedParameters);

  // fileName/Title
  let headerDisplayText = extractFileTitle(parsedParameters);
  const hasTitle = !!headerDisplayText;

  // fold
  const fold = isFoldDefined(lineText);

  // unfold
  const unfold = isUnFoldDefined(lineText);

  // language
  const language = getCodeBlockLanguage(lineText, isReadingView);

  // displayLanguage
  const displayLanguage = getDisplayLanguageName(language);

  // isExcluded
  const exclude = isExcluded(lineText, settings.ExcludeLangs);

  // group 
  const group = extractParameter(parsedParameters, "group") ?? '';

  // tab
  const tab = extractParameter(parsedParameters, "tab") ?? '';

  // specificHeader and hasLangBorderColor
  let hasLangBorderColor = false;
  if (!exclude) {
    if (headerDisplayText === null || headerDisplayText === "") {
      headerDisplayText = settings.pluginSettings.header.collapsedCodeText || DEFAULT_COLLAPSE_TEXT;
      if (group)
        headerDisplayText = ''; // if tabs are in use, header should not display any text by default
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
    branch: extractParameter(parsedParameters, "branch"),
    module: extractParameter(parsedParameters, "module")
  };

  let parsePromptId = extractParameter(parsedParameters, "parse");

  // noprompt
  const noPrompt = isParameterDefined("noprompt", lineText);
  const noPromptLines = getLineRanges(extractParameter(parsedParameters, "noprompt"));

  // noparse
  const noParse = isParameterDefined("noparse", lineText);
  const noParseLines = getLineRanges(extractParameter(parsedParameters, "noparse"));

  if (!parsePromptId && language && !noParse) {
    const allPrompts = { ...defaultPrompts, ...settings.pluginSettings.prompts.customPrompts };
    for (const promptId in allPrompts) {
      const { def: promptDef } = getPromptDefinition(promptId, settings);

      if (promptDef.autoParsePrompt && promptDef.autoParseLanguages?.includes(language)) {
        parsePromptId = promptId;
        break;
      }
    }
  }

  const output = isParameterDefined("output", lineText);

  return {
    defaultLinesToHighlight: defaultLinesToHighlight,
    outputLinesToHighlight: outputLinesToHighlight,
    defaultTextToHighlight: defaultTextToHighlight,
    outputTextToHighlight: outputTextToHighlight,
    alternativeLinesToHighlight: alternativeLinesToHighlight,
    alternativeTextToHighlight: alternativeTextToHighlight,
    isSpecificNumber: isSpecificNumber,
    lineNumberOffset: lineNumberOffset,
    lineNumberJumps,
    showNumbers: showNumbers,
    hasTitle: hasTitle,
    headerDisplayText: headerDisplayText,
    fold: fold,
    unfold: unfold,
    language: language,
    displayLanguage: displayLanguage,
    hasLangBorderColor: hasLangBorderColor,
    exclude: exclude,
    fenceChar: fenceChar,
    fenceCount: fenceCount,
    indentLevel: level,
    indentCharacter: characters,
    lineSeparator,
    textSeparator,
    prompt,
    parsePromptId,
    noPrompt,
    noPromptLines,
    noParse,
    noParseLines,
    group,
    tab,
    output
  };
}// getParameters

function parseParameters(input: string): ParsedParams {
  const params: ParsedParams = {};
  const { char, count } = getFenceDetails(input);
  if (!char) {
    return params;
  }

  const fence = char.repeat(count);
  const fenceRegex = new RegExp(`^${fence}`);
  const cleanedLine = input.replace(fenceRegex, '').trim();
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

function getFenceDetails(lineText: string): { char: '`' | '~' | null, count: number } {
  const trimmed = lineText.trimStart();
  const match = trimmed.match(/^(?:`|~)+/);
  if (match) {
    const fence = match[0];
    const char = fence[0] as '`' | '~';
    return { char, count: fence.length };
  }
  return { char: null, count: 0 };
}// getFenceDetails

function getIndentationLevel(line: string) {
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

function extractFileTitle(parsedParameters: ParsedParams): string {
  const file = extractParameter(parsedParameters, "file");
  const title = extractParameter(parsedParameters, "title");

  if (file && title)
    return file;
  else if (file && !title)
    return file;
  else if (!file && title)
    return title;
  else
    return '';
}// extractFileTitle

function extractParameter(parsedParameters: ParsedParams, searchTerm: string): string | null {
  return parsedParameters[searchTerm.toLowerCase()] || null;
}// extractParameter

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
    if (word && !line && !range && !from && !to) {
      result.words.push(word);
    }
    // lineSpecificWords
    if (word && (line || range) && !from && !to) {
      getLineSpecificWords(result, line, range, word);
    }
  }

  result.lineNumbers = sortAndRemoveDuplicates(result.lineNumbers);

  return result;
}// getHighlightedLines

function parseSegment(segment: string, textSeparator: string, lineSeparator: string): { line: string, range: string, word: string, from: string, to: string, occurrences: string } {
  let from = '';
  let to = '';
  let line = '';
  let range = '';
  let word = '';
  let occurrences = '';

  const lineSeparatorIndex = segment.indexOf(lineSeparator);
  const fromToSeparatorIndex = segment.indexOf(textSeparator);

  if (lineSeparatorIndex !== -1 && fromToSeparatorIndex !== -1) { // string contains both : and | 
    if (lineSeparatorIndex > fromToSeparatorIndex) { // hlt::|
      from = segment.substring(0, fromToSeparatorIndex).trim();
      to = segment.substring(fromToSeparatorIndex + 1).trim();
    } else { // hlt:|:
      const lineOrRange = segment.substring(0, lineSeparatorIndex).trim();
      const val = segment.substring(lineSeparatorIndex + 1).trim();

      const occurrenceMatch = lineOrRange.match(/\[(.*?)\]/);
      occurrences = occurrenceMatch ? occurrenceMatch[1] : '';
      const cleanedLineOrRange = lineOrRange.replace(/\[.*?\]/, '').trim();

      if (cleanedLineOrRange.includes("-"))
        range = cleanedLineOrRange;
      else if (isWholeNumber(cleanedLineOrRange))
        line = cleanedLineOrRange;

      //if (val.includes(":")) {
      const valFromToSeparatorIndex = val.indexOf(textSeparator);
      if (valFromToSeparatorIndex !== -1) {
        from = val.substring(0, valFromToSeparatorIndex).trim();
        to = val.substring(valFromToSeparatorIndex + 1).trim();
      } else {
        word = val;
      }
    }
  } else if (fromToSeparatorIndex !== -1 && lineSeparatorIndex === -1) { // only contains :
    from = segment.substring(0, fromToSeparatorIndex).trim();
    to = segment.substring(fromToSeparatorIndex + 1).trim();
  } else if (lineSeparatorIndex !== -1 && fromToSeparatorIndex === -1) { // only contains |
    const lineOrRange = segment.substring(0, lineSeparatorIndex).trim();
    const val = segment.substring(lineSeparatorIndex + 1).trim();
    const occurrenceMatch = lineOrRange.match(/\[(.*?)\]/);
    occurrences = occurrenceMatch ? occurrenceMatch[1] : '';
    const cleanedLineOrRange = lineOrRange.replace(/\[.*?\]/, '').trim();

    if (cleanedLineOrRange.includes("-"))
      range = cleanedLineOrRange;
    else if (isWholeNumber(cleanedLineOrRange))
      line = cleanedLineOrRange;

    word = val;
  } else { // does not contains : nor |
    if (segment.includes("-"))
      range = segment.trim();
    else if (isWholeNumber(segment))
      line = segment.trim();
    else
      word = segment.trim();
  }

  return { line, range, word, from, to, occurrences };
}// parseSegment

function getLineRanges(params: string | null): number[] {
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

function isWholeNumber(input: string): boolean {
  return validator.isInt(input, { allow_leading_zeroes: false });
}// isWholeNumber

function getLineSpecificWords(result: TextHighlight | LinesToHighlight, line: string, range: string, word: string | HighlightedWord) {
  if (range !== '') { // range with text
    processRange(range, word, result.lineSpecificWords);
  } else { // number with text
    const lineNum = Number(line);
    const lineSpecificWords = (result as any).lineSpecificWords;
    const existingEntry = lineSpecificWords.find((entry: { lineNumber: number; }) => entry.lineNumber === lineNum);

    let wordsToAdd: any[];
    if (typeof word === 'string') {
      wordsToAdd = word.split(',');
    } else {
      wordsToAdd = [word];
    }

    if (existingEntry) {
      existingEntry.words.push(...wordsToAdd);
    } else {
      result.lineSpecificWords.push({ lineNumber: lineNum, words: wordsToAdd });
    }
  }
}// getLineSpecificWords

function sortAndRemoveDuplicates(numbers: number[]): number[] {
  // sort
  numbers.sort((a, b) => a - b);

  // remove duplicates
  const uniqueNumbers = numbers.filter((value, index, array) => {
    return index === 0 || value !== array[index - 1];
  });

  return uniqueNumbers;
}// sortAndRemoveDuplicates

function processRange<T>(segment: string, segmentValue: string | HighlightedWord, result: T): void {
  const range = getLineRanges(segment);
  let wordsToAdd: string[] | HighlightedWord[];
  if (typeof segmentValue === 'string') {
    wordsToAdd = segmentValue.split(',');
  } else {
    wordsToAdd = [segmentValue];
  }

  range.forEach((num) => {
    const existingEntry = (result as { lineNumber: number, words: any[] }[]).find(entry => entry.lineNumber === num);

    if (existingEntry) {
      existingEntry.words.push(...wordsToAdd);
    } else {
      (result as { lineNumber: number, words: any[] }[]).push({ lineNumber: num, words: wordsToAdd, });
    }
  });
}// processRange

function getTextHighlight(parsedParameters: ParsedParams, parameter: string | null, textSeparator: string, lineSeparator: string): TextHighlight {
  const result: TextHighlight = {
    allWordsInLine: [],
    words: [],
    lineSpecificWords: [],
    textBetween: [],
    lineSpecificTextBetween: [],
  };

  if (!parameter) {
    return result;
  }

  const parameterValue = extractParameter(parsedParameters, parameter);
  if (!parameterValue) {
    return result;
  }

  const trimmedParams = parameterValue.trim();
  const segments = trimmedParams.split(/,(?![^[]*\])/g);

  for (const segment of segments) {
    const trimmedSegment = segment.trim();
    if (!trimmedSegment) {
      continue;
    }

    const { line, range, word, from, to, occurrences } = parseSegment(trimmedSegment, textSeparator, lineSeparator);
    const occurrenceNumbers = getOccurrences(occurrences);

    // allWordsInLine
    if ((line || range) && !word && !from && !to) {
      getAllWordsInLine(result, line, range);
    }

    // words
    if (word && !line && !range && !from && !to) {
      result.words.push({ text: word, occurrences: occurrenceNumbers });
    }
    // lineSpecificWords
    if (word && (line || range) && !from && !to) {
      getLineSpecificWords(result, line, range, { text: word, occurrences: occurrenceNumbers });
    }

    // textBetween
    if ((from || to) && !word && !line && !range) {
      result.textBetween.push({ from: from, to: to, occurrences: occurrenceNumbers });
    }
    // lineSpecificTextBetween
    if ((from || to) && !word && (line || range)) {
      getLineSpecificTextBetween(result, line, range, from, to, occurrenceNumbers);
    }
  }

  result.allWordsInLine = sortAndRemoveDuplicates(result.allWordsInLine);

  return result;
}// getTextHighlight

function getOccurrences(params: string | null): number[] {
  if (!params) {
    return [];
  }

  const trimmedParams = params.trim();
  if (trimmedParams === "") {
    return [];
  }

  const parts = trimmedParams.split(",");
  const occurrences: number[] = [];

  for (const part of parts) {
    const trimmedPart = part.trim();
    const rangeMatch = trimmedPart.match(/^(-?\d+)-(-?\d+)$/);

    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);

      if (!isNaN(start) && !isNaN(end) && start <= end) {
        for (let i = start; i <= end; i++) {
          occurrences.push(i);
        }
      } else {
        console.warn(`Invalid occurrence range detected: ${trimmedPart}`);
      }
    } else {
      const number = parseInt(trimmedPart, 10);
      if (!isNaN(number)) {
        occurrences.push(number);
      } else {
        console.warn(`Invalid occurrence number detected: ${trimmedPart}`);
      }
    }
  }

  const uniqueOccurrences = [...new Set(occurrences)].sort((a, b) => a - b);

  return uniqueOccurrences;
}// getOccurrences

function getAllWordsInLine(result: TextHighlight, line: string, range: string) {
  if (line && isWholeNumber(line)) { // number only
    result.allWordsInLine.push(Number(line));
  } else if (range) {
    const ranges = getLineRanges(range);
    result.allWordsInLine.push(...ranges);
  }
}// getAllWordsInLine

function getLineSpecificTextBetween(result: TextHighlight, line: string, range: string, from: string, to: string, occurrences: number[]) {
  if (range !== '') {
    const ranges = getLineRanges(range);
    ranges.forEach((num) => {
      result.lineSpecificTextBetween.push({ lineNumber: num, from: from, to: to, occurrences: occurrences });
    });
  } else if (!isNaN(Number(line))) {
    const lineNum = Number(line);
    result.lineSpecificTextBetween.push({ lineNumber: lineNum, from: from, to: to, occurrences: occurrences });
  }
}// getLineSpecificTextBetween

function extractAlternativeHighlights(parsedParameters: ParsedParams, textSeparator: string, lineSeparator: string, settings: CodeblockCustomizerSettings): AlternativeHighlight {
  const currentMode = getCurrentMode();
  const alternateColors = settings.SelectedTheme.colors[currentMode].codeblock.alternateHighlightColors || {};

  const alternativeTextToHighlight: AlternativeTextHighlight = {
    allWordsInLine: [], words: [], lineSpecificWords: [], textBetween: [], lineSpecificTextBetween: [],
    outputAllWordsInLine: [], outputWords: [], outputLineSpecificWords: [], outputTextBetween: [], outputLineSpecificTextBetween: []
  };

  //const alternativeLinesToHighlight: AlternativeLinesToHighlight[] = [];
  const alternativeLinesToHighlight: AlternativeLinesToHighlight = {
    lines: [], words: [], lineSpecificWords: [],
    outputLines: [], outputWords: [], outputLineSpecificWords: []
  };

  for (const [alternateColorName] of Object.entries(alternateColors)) {
    const lineHighlight = getHighlightedLines(parsedParameters, alternateColorName, textSeparator, lineSeparator);
    const textHighlight = getTextHighlight(parsedParameters, `${alternateColorName}t`, textSeparator, lineSeparator);

    // lines or ranges
    if (lineHighlight.lineNumbers.length > 0) {
      alternativeLinesToHighlight.lines.push({ lineNumbers: lineHighlight.lineNumbers, colorName: alternateColorName });
    }
    if (lineHighlight.words.length > 0) {
      alternativeLinesToHighlight.words.push({ words: lineHighlight.words, colorName: alternateColorName });
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

    const outputLineHighlight = getHighlightedLines(parsedParameters, `${alternateColorName}o`, textSeparator, lineSeparator);
    const outputTextHighlight = getTextHighlight(parsedParameters, `${alternateColorName}to`, textSeparator, lineSeparator);

    // for 'warno', 'erroro', etc.
    if (outputLineHighlight.lineNumbers.length > 0) {
      alternativeLinesToHighlight.outputLines.push({ lineNumbers: outputLineHighlight.lineNumbers, colorName: alternateColorName });
    }
    if (outputLineHighlight.words.length > 0) {
      alternativeLinesToHighlight.outputWords.push({ words: outputLineHighlight.words, colorName: alternateColorName });
    }
    if (outputLineHighlight.lineSpecificWords.length > 0) {
      outputLineHighlight.lineSpecificWords.forEach((lsw) => {
        alternativeLinesToHighlight.outputLineSpecificWords.push({ ...lsw, colorName: alternateColorName });
      });
    }

    // for 'warnto', 'errorto', etc.
    if (outputTextHighlight.allWordsInLine.length > 0) {
      alternativeTextToHighlight.outputAllWordsInLine.push({
        allWordsInLine: outputTextHighlight.allWordsInLine, colorName: alternateColorName
      });
    }
    if (outputTextHighlight.words.length > 0) {
      alternativeTextToHighlight.outputWords.push({ words: outputTextHighlight.words, colorName: alternateColorName });
    }
    if (outputTextHighlight.lineSpecificWords.length > 0) {
      outputTextHighlight.lineSpecificWords.forEach((lsw) => {
        alternativeTextToHighlight.outputLineSpecificWords.push({ ...lsw, colorName: alternateColorName });
      });
    }
    if (outputTextHighlight.textBetween.length > 0) {
      outputTextHighlight.textBetween.forEach((tb) => {
        alternativeTextToHighlight.outputTextBetween.push({ ...tb, colorName: alternateColorName });
      });
    }
    if (outputTextHighlight.lineSpecificTextBetween.length > 0) {
      outputTextHighlight.lineSpecificTextBetween.forEach((lstb) => {
        alternativeTextToHighlight.outputLineSpecificTextBetween.push({ ...lstb, colorName: alternateColorName });
      });
    }
  }

  return { alternativeLinesToHighlight, alternativeTextToHighlight };
}// extractAlternativeHighlights

function determineLineNumberDisplay(parsedParameters: ParsedParams) {
  const specificLN = extractParameter(parsedParameters, "ln") || "";
  let isSpecificNumber = false;
  let showNumbers = "";
  let lineNumberOffset = 0;
  const lineNumberJumps: LineNumberJump[] = [];

  if (specificLN.toLowerCase() === "true") {
    showNumbers = "specific";
  } else if (specificLN.toLowerCase() === "false") {
    showNumbers = "hide";
  } else {
    const parts = specificLN.split(",");
    let foundConfig = false;
    let startNumberFound = false;

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) {
        continue;
      }

      if (trimmed.includes(":")) {
        // jump definition (e.g. 10:50)
        const [indexStr, newNumStr] = trimmed.split(":");
        const lineNumber = parseInt(indexStr, 10);
        const newStartNumber = parseInt(newNumStr, 10);

        if (!isNaN(lineNumber) && !isNaN(newStartNumber)) {
          lineNumberJumps.push({ lineNumber, newStartNumber });
          foundConfig = true;
        }
      } else {
        // simple offset definition (e.g. 5)
        if (!startNumberFound) {
          const startNum = parseInt(trimmed, 10);
          if (!isNaN(startNum) && startNum >= 0) {
            lineNumberOffset = startNum - 1;
            foundConfig = true;
            startNumberFound = true;
          }
        }
      }
    }

    if (foundConfig) {
      showNumbers = "specific";
      isSpecificNumber = true;
    }

    lineNumberJumps.sort((a, b) => a.lineNumber - b.lineNumber);
  }

  return { isSpecificNumber, showNumbers, lineNumberOffset, lineNumberJumps };
}// determineLineNumberDisplay

function isFoldDefined(str: string): boolean {
  return isParameterDefined("fold", str);
}// isFoldDefined

function isUnFoldDefined(str: string): boolean {
  return isParameterDefined("unfold", str);
}// isUnFoldDefined

function isParameterDefined(searchTerm: string, str: string): boolean {
  str = str.toLowerCase();
  searchTerm = searchTerm.toLowerCase();

  if (str.includes(` ${searchTerm} `)) {
    return true;
  }
  // check if parameter is at end of string with space before it
  if (str.endsWith(' ' + searchTerm)) {
    return true;
  }
  const fenceAndLangRegex = new RegExp(`^(?:\`|~){3,}\\w*\\s*${searchTerm}\\s`);
  if (fenceAndLangRegex.test(str)) {
    return true;
  }
  const fenceAndLangEndRegex = new RegExp(`^(?:\`|~){3,}\\w*\\s*${searchTerm}$`);
  if (fenceAndLangEndRegex.test(str)) {
    return true;
  }
  return false;
}// isParameterDefined

function getCodeBlockLanguage(str: string, isReadingView = false): string {
  const originalStr = str;
  str = str.toLowerCase();
  const fenceMatch = str.match(/^(?:`|~){3,}/);

  function removeLeadingFenceChars(input: string): string {
    let cleanedInput = input;
    while (cleanedInput.startsWith("`") || cleanedInput.startsWith("~")) {
      cleanedInput = cleanedInput.substring(1);
    }
    return cleanedInput;
  }

  if (fenceMatch) {
    const fence = fenceMatch[0];
    const startIndex = fence.length;
    const endIndex = str.indexOf(" ", startIndex);
    let word = "";
    if (endIndex !== -1) {
      word = originalStr.substring(startIndex, endIndex);
    } else {
      word = originalStr.substring(startIndex);
    }

    if (!word.includes(":") && !word.includes("=")) {
      if (word.toLowerCase() === "fold" || word.toLowerCase() === "unfold") {
        return '';
      }
      else {
        const lang = removeLeadingFenceChars(word);

        // only override the language in ReadingView
        if (isReadingView && lang.toLowerCase().startsWith("run-")) {
          return lang.substring(4);
        }

        return lang;
      }
    }
  }
  return '';
}// getCodeBlockLanguage

function isExcluded(lineText: string, excludeLangs: string): boolean {
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

function splitAndTrimString(str: string) {
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

function getPromptLines(parsedParameters: ParsedParams, parameter: string, textSeparator: string, lineSeparator: string) {
  const result: PromptLines = {
    lineNumbers: [],
    text: "",
    values: {
      user: null,
      host: null,
      path: null,
      db: null,
      branch: null,
      module: null,
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
