import { CBCParameters, HighlightedWord } from "./Parsing";

export interface TextBetweenRule {
  from: string;
  to: string;
  fromLower: string;
  toLower: string;
  occurrences: number[];
}

export interface AltTextBetweenRule extends TextBetweenRule {
  colorName: string;
}

export interface HighlightRules {
  // line highlight with default color
  defaultLinesToHighlight: Set<number>;
  defaultLinesToHighlightByWords: string[];
  defaultLineSpecificWords: Map<number, string[]>;
  // text highlight with default color
  defaultTextToHighlight: HighlightedWord[];
  defaultTextLineSpecificWords: Map<number, { words: HighlightedWord[] }[]>;
  defaultTextBetween: TextBetweenRule[];
  defaultTextLineSpecificBetween: Map<number, TextBetweenRule[]>;
  defaultTextAllWordsInLine: Set<number>;
  // line highlight with alternative color
  alternativeLinesToHighlight: Map<number, string[]>;
  alternativeLinesToHighlightByWords: { words: string[]; colorName: string }[];
  alternativeLineSpecificWords: Map<number, { words: string[]; colorName: string }[]>;
  // text highlight with alternative color
  alternativeTextToHighlight: { words: HighlightedWord[]; colorName: string }[];
  alternativeTextLineSpecificWords: Map<number, { words: HighlightedWord[]; colorName: string }[]>;
  alternativeTextBetween: AltTextBetweenRule[];
  alternativeTextLineSpecificBetween: Map<number, AltTextBetweenRule[]>;
  alternativeTextAllWordsInLine: Map<number, string>;
}

export function createHighlightRules(parameters: CBCParameters): HighlightRules {
  // default lines to highlight by linenumbers
  const defaultLinesToHighlight = new Set(parameters.defaultLinesToHighlight.lineNumbers);

  // default lines to highlight by words
  const defaultLinesToHighlightByWords = parameters.defaultLinesToHighlight.words.map(w => w.toLowerCase());

  // default lines to highlight by lineSpecificWords
  const defaultLineSpecificWords = new Map<number, string[]>();
  for (const lsw of parameters.defaultLinesToHighlight.lineSpecificWords) {
    const existing = defaultLineSpecificWords.get(lsw.lineNumber);
    const lowered = lsw.words.map(w => w.toLowerCase());
    if (existing) {
      existing.push(...lowered);
    } else {
      defaultLineSpecificWords.set(lsw.lineNumber, lowered);
    }
  }

  // default text to highlight by words
  const defaultTextToHighlight = parameters.defaultTextToHighlight.words;

  // default text to highlight by lineSpecificWords
  const defaultTextLineSpecificWords = new Map<number, { words: HighlightedWord[] }[]>();
  for (const rule of parameters.defaultTextToHighlight.lineSpecificWords) {
    const arr = defaultTextLineSpecificWords.get(rule.lineNumber);
    const entry = { words: rule.words };
    if (arr) {
      arr.push(entry);
    } else {
      defaultTextLineSpecificWords.set(rule.lineNumber, [entry]);
    }
  }

  // default text to highlight by textBetween
  const defaultTextBetween: TextBetweenRule[] = parameters.defaultTextToHighlight.textBetween.map(tb => ({
    from: tb.from, to: tb.to, fromLower: tb.from.toLowerCase(), toLower: tb.to.toLowerCase(), occurrences: tb.occurrences
  }));

  // default text to highlight by lineSpecificTextBetween
  const defaultTextLineSpecificBetween = new Map<number, TextBetweenRule[]>();
  for (const rule of parameters.defaultTextToHighlight.lineSpecificTextBetween) {
    const entry: TextBetweenRule = { from: rule.from, to: rule.to, fromLower: rule.from.toLowerCase(), toLower: rule.to.toLowerCase(), occurrences: rule.occurrences };
    const arr = defaultTextLineSpecificBetween.get(rule.lineNumber);
    if (arr) {
      arr.push(entry);
    } else {
      defaultTextLineSpecificBetween.set(rule.lineNumber, [entry]);
    }
  }

  // default text to highlight by allWordsInLine
  const defaultTextAllWordsInLine = new Set(parameters.defaultTextToHighlight.allWordsInLine);

  // alternativ lines to highlight by linenumbers
  const alternativeLinesToHighlight = new Map<number, string[]>();
  for (const hl of parameters.alternativeLinesToHighlight.lines) {
    for (const ln of hl.lineNumbers) {
      const arr = alternativeLinesToHighlight.get(ln);
      if (arr) {
        arr.push(hl.colorName);
      } else {
        alternativeLinesToHighlight.set(ln, [hl.colorName]);
      }
    }
  }

  // alternativ lines to highlight by words
  const alternativeLinesToHighlightByWords = parameters.alternativeLinesToHighlight.words.map(aw => ({
    words: aw.words.map(w => w.toLowerCase()), colorName: aw.colorName
  }));

  // alternativ lines to highlight by lineSpecificWords
  const alternativeLineSpecificWords = new Map<number, { words: string[]; colorName: string }[]>();
  for (const lsw of parameters.alternativeLinesToHighlight.lineSpecificWords) {
    const entry = { words: lsw.words.map(w => w.toLowerCase()), colorName: lsw.colorName };
    const arr = alternativeLineSpecificWords.get(lsw.lineNumber);
    if (arr) {
      arr.push(entry);
    } else {
      alternativeLineSpecificWords.set(lsw.lineNumber, [entry]);
    }
  }

  // alternativ text to highlight by words
  const alternativeTextToHighlight = parameters.alternativeTextToHighlight.words.filter(e => e.words.length > 0);

  // alternativ text to highlight by lineSpecificWords
  const alternativeTextLineSpecificWords = new Map<number, { words: HighlightedWord[]; colorName: string }[]>();
  for (const rule of parameters.alternativeTextToHighlight.lineSpecificWords) {
    const entry = { words: rule.words, colorName: rule.colorName };
    const arr = alternativeTextLineSpecificWords.get(rule.lineNumber);
    if (arr) {
      arr.push(entry);
    } else {
      alternativeTextLineSpecificWords.set(rule.lineNumber, [entry]);
    }
  }

  // alternativ text to highlight by textBetween
  const alternativeTextBetween: AltTextBetweenRule[] = parameters.alternativeTextToHighlight.textBetween.map(tb => ({
    from: tb.from, to: tb.to, fromLower: tb.from.toLowerCase(), toLower: tb.to.toLowerCase(), colorName: tb.colorName, occurrences: tb.occurrences
  }));

  // alternativ text to highlight by lineSpecificTextBetween
  const alternativeTextLineSpecificBetween = new Map<number, AltTextBetweenRule[]>();
  for (const rule of parameters.alternativeTextToHighlight.lineSpecificTextBetween) {
    const entry: AltTextBetweenRule = { from: rule.from, to: rule.to, fromLower: rule.from.toLowerCase(), toLower: rule.to.toLowerCase(), colorName: rule.colorName, occurrences: rule.occurrences };
    const arr = alternativeTextLineSpecificBetween.get(rule.lineNumber);
    if (arr) {
      arr.push(entry);
    } else {
      alternativeTextLineSpecificBetween.set(rule.lineNumber, [entry]);
    }
  }

  // alternativ text to highlight by allWordsInLine
  const alternativeTextAllWordsInLine = new Map<number, string>();
  for (const item of parameters.alternativeTextToHighlight.allWordsInLine) {
    for (const ln of item.allWordsInLine) {
      alternativeTextAllWordsInLine.set(ln, item.colorName);
    }
  }

  return {
    defaultLinesToHighlight, defaultLinesToHighlightByWords, defaultLineSpecificWords,
    defaultTextToHighlight, defaultTextLineSpecificWords, defaultTextBetween, defaultTextLineSpecificBetween, defaultTextAllWordsInLine,
    alternativeLinesToHighlight, alternativeLinesToHighlightByWords, alternativeLineSpecificWords,
    alternativeTextToHighlight, alternativeTextLineSpecificWords, alternativeTextBetween, alternativeTextLineSpecificBetween, alternativeTextAllWordsInLine,
  };
}// createHighlightRules
