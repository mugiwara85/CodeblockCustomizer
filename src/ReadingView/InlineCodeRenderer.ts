import { MarkdownPostProcessorContext, loadPrism, MarkdownRenderChild } from "obsidian";

import { getLanguageIcon, getInlineCodeIcon, addTextToClipboard, loadCustomPrismLanguages } from "../Utils";
import CodeBlockCustomizerPlugin from "../main";
import { INLINE_CODE_LANG_REGEX } from "../Const";
import { InlineCodeModifierKeys } from "../Settings";
import { getDisplayLanguageName } from "../Utils";
import { parseInlineCodeHighlightParams, getInlineCodeBgClass, InlineCodeHighlightParameters, HighlightedWord } from "../Parsing";
import { HighlightRules, TextBetweenRule, AltTextBetweenRule } from "../HighlightRules";
import { getHighlightedLineHtml } from "./ReadingViewUtils";

export class InlineCodeRenderer extends MarkdownRenderChild {
  plugin: CodeBlockCustomizerPlugin;
  context: MarkdownPostProcessorContext;
  clickHandler: ((event: MouseEvent) => void) | null = null;

  constructor(containerEl: HTMLElement, plugin: CodeBlockCustomizerPlugin, context: MarkdownPostProcessorContext) {
    super(containerEl);
    this.plugin = plugin;
    this.context = context;
  }

  async onload() {
    if (this.containerEl.dataset.cbcProcessed) {
      return;
    }

    this.containerEl.classList.add('codeblock-customizer-inline-code');
    const isPrinting = !!this.containerEl.closest('.print');

    if (isPrinting && !this.plugin.settings.pluginSettings.printing.enablePrintToPDFStyling) {
      // remove class during printing, so it does not gets styled
      this.containerEl.classList.remove('codeblock-customizer-inline-code');
      return;
    }

    const text = this.containerEl.textContent ?? "";
    const match = text.match(INLINE_CODE_LANG_REGEX);
    const settings = this.plugin.settings.pluginSettings.inlineCode;
    // fix for #147
    const isValidMatch = match && match[1] && !match[1].trim().startsWith('{') && match[2];

    let inlineParams: InlineCodeHighlightParameters | null = null;
    if (isValidMatch) {
      inlineParams = parseInlineCodeHighlightParams(match[1], this.plugin.settings);

      // background highlight is always applied, even if enableSyntaxHighlight is enabled or not
      if (inlineParams.backgroundColorClass !== null) {
        const bgClass = getInlineCodeBgClass(inlineParams.backgroundColorClass);
        this.containerEl.classList.add(bgClass);
      }
    }

    const hasLanguage = !!(inlineParams?.language);
    const hasTextHighlight = !!(inlineParams && (inlineParams.textHighlight.words.length > 0 || inlineParams.textHighlight.textBetween.length > 0 || inlineParams.textHighlight.lineSpecificWords.length > 0 || inlineParams.textHighlight.allWordsInLine.length > 0 || inlineParams.alternativeTextHighlights.length > 0));

    if (isValidMatch && ((settings.enableSyntaxHighlight && hasLanguage) || hasTextHighlight)) {
      const prism = await loadPrism();
      loadCustomPrismLanguages(prism);
      this.processInlineCodeElement(prism, match, inlineParams!);
    } else {
      if (settings.enableCopyOnClick) {
        this.clickHandler = this.createInlineCodeClickHandler(() => this.containerEl.textContent ?? "");
        this.containerEl.addEventListener('click', this.clickHandler);
      }
    }

    this.containerEl.dataset.cbcProcessed = 'true';
  }// onload

  onunload() {
    if (this.clickHandler) {
      this.containerEl.removeEventListener('click', this.clickHandler);
    }
  }// onunload

  private processInlineCodeElement(prism: any, match: RegExpMatchArray, inlineParams: InlineCodeHighlightParameters) {
    const text = this.containerEl.textContent?.trim();
    if (!text) {
      return;
    }

    if (!match || !match[1] || !match[2]) {
      return;
    }

    const language = inlineParams.language ?? '';
    const code = match[2];
    const settings = this.plugin.settings.pluginSettings.inlineCode;
    const displayLanguage = language ? getDisplayLanguageName(language) : '';

    this.containerEl.innerHTML = '';

    if (settings.enableCopyOnClick) {
      this.clickHandler = this.createInlineCodeClickHandler(() => code);
      this.containerEl.addEventListener('click', this.clickHandler, true);
    }

    if (language) {
      const iconSpan = this.createInlineCodeIcon(displayLanguage);
      if (iconSpan) {
        this.containerEl.appendChild(iconSpan);
      }
    }

    const codeContentSpan = this.createCodeContentSpan(code, settings.enableSyntaxHighlight ? language : '', prism, inlineParams);
    this.containerEl.appendChild(codeContentSpan);
  }// processInlineCodeElement

  private createInlineCodeClickHandler(getTextToCopy: () => string): (event: MouseEvent) => void {
    return (event: MouseEvent) => {
      const requiredKey = this.plugin.settings.pluginSettings.inlineCode.copyModifierKey;
      if ((requiredKey === InlineCodeModifierKeys.CTRL && !event.ctrlKey && !event.metaKey) || (requiredKey === InlineCodeModifierKeys.ALT && !event.altKey)) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      addTextToClipboard(getTextToCopy());
    };
  }// createInlineCodeClickHandler

  private createInlineCodeIcon(displayLanguage: string): HTMLSpanElement | null {
    const Icon = getLanguageIcon(displayLanguage);
    if (Icon) {
      return getInlineCodeIcon(displayLanguage);
    }
    return null;
  }// createInlineCodeIcon

  private createCodeContentSpan(code: string, language: string, prism: any, inlineParams?: InlineCodeHighlightParameters): HTMLSpanElement {
    const langClass = language ? `language-${language}` : '';
    const codeContentSpan = createSpan({ cls: `codeblock-customizer-inline-code-content${langClass ? ' ' + langClass : ''}` });
    const isLanguageSupportedByPrism = language && prism.languages[language];

    if (isLanguageSupportedByPrism) {
      const highlightedHtml = prism.highlight(code, prism.languages[language], language);
      codeContentSpan.innerHTML = highlightedHtml;
    } else {
      codeContentSpan.textContent = code;
    }

    if (inlineParams && (inlineParams.textHighlight.words.length > 0 || inlineParams.textHighlight.textBetween.length > 0 || inlineParams.textHighlight.lineSpecificWords.length > 0 || inlineParams.textHighlight.allWordsInLine.length > 0 || inlineParams.alternativeTextHighlights.length > 0)) {
      const rules = buildInlineHighlightRules(inlineParams);
      codeContentSpan.innerHTML = getHighlightedLineHtml(codeContentSpan.innerHTML, rules, 1);
    }

    return codeContentSpan;
  }// createCodeContentSpan
}

function buildInlineHighlightRules(params: InlineCodeHighlightParameters): HighlightRules {
  const defaultTextLineSpecificWords = new Map<number, { words: HighlightedWord[] }[]>();
  for (const rule of params.textHighlight.lineSpecificWords) {
    const entry = { words: rule.words };
    const arr = defaultTextLineSpecificWords.get(rule.lineNumber);
    if (arr) {
      arr.push(entry); 
    } else {
      defaultTextLineSpecificWords.set(rule.lineNumber, [entry]);
    }
  }

  const defaultTextLineSpecificBetween = new Map<number, TextBetweenRule[]>();
  for (const rule of params.textHighlight.lineSpecificTextBetween) {
    const entry: TextBetweenRule = { from: rule.from, to: rule.to, fromLower: rule.from.toLowerCase(), toLower: rule.to.toLowerCase(), occurrences: rule.occurrences };
    const arr = defaultTextLineSpecificBetween.get(rule.lineNumber);
    if (arr) {
      arr.push(entry); 
    } else {
      defaultTextLineSpecificBetween.set(rule.lineNumber, [entry]);
    }
  }

  const alternativeTextToHighlight = params.alternativeTextHighlights.map(a => ({ words: a.highlight.words, colorName: a.colorName }));

  const alternativeTextLineSpecificWords = new Map<number, { words: HighlightedWord[]; colorName: string }[]>();
  for (const a of params.alternativeTextHighlights) {
    for (const rule of a.highlight.lineSpecificWords) {
      const entry = { words: rule.words, colorName: a.colorName };
      const arr = alternativeTextLineSpecificWords.get(rule.lineNumber);
      if (arr) {
        arr.push(entry);
      } else {
        alternativeTextLineSpecificWords.set(rule.lineNumber, [entry]);
      }
    }
  }

  const alternativeTextBetween: AltTextBetweenRule[] = params.alternativeTextHighlights.flatMap(a =>
    a.highlight.textBetween.map(tb => ({
      from: tb.from, to: tb.to,
      fromLower: tb.from.toLowerCase(), toLower: tb.to.toLowerCase(),
      colorName: a.colorName, occurrences: tb.occurrences
    }))
  );

  const alternativeTextLineSpecificBetween = new Map<number, AltTextBetweenRule[]>();
  for (const a of params.alternativeTextHighlights) {
    for (const rule of a.highlight.lineSpecificTextBetween) {
      const entry: AltTextBetweenRule = {
        from: rule.from, to: rule.to,
        fromLower: rule.from.toLowerCase(), toLower: rule.to.toLowerCase(),
        colorName: a.colorName, occurrences: rule.occurrences
      };
      const arr = alternativeTextLineSpecificBetween.get(rule.lineNumber);
      if (arr) {
        arr.push(entry);
      } else {
        alternativeTextLineSpecificBetween.set(rule.lineNumber, [entry]);
      }
    }
  }

  const alternativeTextAllWordsInLine = new Map<number, string>();
  for (const a of params.alternativeTextHighlights) {
    for (const ln of a.highlight.allWordsInLine) {
      alternativeTextAllWordsInLine.set(ln, a.colorName);
    }
  }

  return {
    defaultLinesToHighlight: new Set(),
    defaultLinesToHighlightByWords: [],
    defaultLineSpecificWords: new Map(),
    defaultTextToHighlight: params.textHighlight.words,
    defaultTextLineSpecificWords,
    defaultTextBetween: params.textHighlight.textBetween.map(tb => ({
      from: tb.from, to: tb.to,
      fromLower: tb.from.toLowerCase(), toLower: tb.to.toLowerCase(),
      occurrences: tb.occurrences
    })),
    defaultTextLineSpecificBetween,
    defaultTextAllWordsInLine: new Set(params.textHighlight.allWordsInLine),
    alternativeLinesToHighlight: new Map(),
    alternativeLinesToHighlightByWords: [],
    alternativeLineSpecificWords: new Map(),
    alternativeTextToHighlight,
    alternativeTextLineSpecificWords,
    alternativeTextBetween,
    alternativeTextLineSpecificBetween,
    alternativeTextAllWordsInLine,
  };
}// buildInlineHighlightRules
