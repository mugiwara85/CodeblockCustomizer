import { MarkdownPostProcessorContext, MarkdownRenderChild } from "obsidian";

import { getLanguageIcon, getInlineCodeIcon, addTextToClipboard, loadCustomPrismLanguages, getPrism, PrismInstance, setTrustedHtml } from "../Utils";
import CodeBlockCustomizerPlugin from "../main";
import { INLINE_CODE_LANG_REGEX } from "../Const";
import { InlineCodeModifierKeys } from "../Settings";
import { getDisplayLanguageName } from "../Utils";
import { parseInlineCodeHighlightParams, getInlineCodeBgClass, InlineCodeHighlightParameters } from "../Parsing";
import { createInlineHighlightRules } from "../HighlightRules";
import { applyHighlightsToElement } from "./ReadingViewUtils";
import { combineInlineCodeParameters, getInlineCodeAttributeParameters } from "../HtmlCodeBlocks";

export class InlineCodeRenderer extends MarkdownRenderChild {
  plugin: CodeBlockCustomizerPlugin;
  context: MarkdownPostProcessorContext;
  clickHandler: ((event: MouseEvent) => void) | null = null;

  attributeParameters: string | undefined;

  constructor(containerEl: HTMLElement, plugin: CodeBlockCustomizerPlugin, context: MarkdownPostProcessorContext, attributeParameters?: string) {
    super(containerEl);
    this.plugin = plugin;
    this.context = context;
    this.attributeParameters = attributeParameters;
  }

  onload() {
    void this.render();
  }// onload

  private async render() {
    if (this.containerEl.dataset.cbcProcessed) {
      return;
    }

    if (this.containerEl.className.includes('language-')) {
      void getPrism().then(() => this.containerEl.classList.remove('is-loaded'));
    }

    this.containerEl.classList.add('codeblock-customizer-inline-code');
    const isPrinting = !!this.containerEl.closest('.print');

    if (isPrinting && !this.plugin.settings.pluginSettings.printing.enablePrintToPDFStyling) {
      // remove class during printing, so it does not gets styled
      this.containerEl.classList.remove('codeblock-customizer-inline-code');
      return;
    }

    const text = this.containerEl.textContent ?? "";
    const match = this.getMatch(text);
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
    const hasBackgroundHighlight = inlineParams?.backgroundColorClass != null;

    if (isValidMatch && (hasLanguage || hasTextHighlight || hasBackgroundHighlight)) {
      const prism = await getPrism();
      loadCustomPrismLanguages(prism);
      this.processInlineCodeElement(prism, match, inlineParams!);
    } else {
      if (settings.enableCopyOnClick) {
        this.clickHandler = this.createInlineCodeClickHandler(() => this.containerEl.textContent ?? "");
        this.containerEl.addEventListener('click', this.clickHandler);
      }
    }

    this.containerEl.dataset.cbcProcessed = 'true';
  }// render

  private getMatch(text: string): RegExpMatchArray | null {
    const prefixMatch = text.match(INLINE_CODE_LANG_REGEX);
    if (!this.plugin.settings.pluginSettings.common.enableHtmlCodeBlocks) {
      return prefixMatch;
    }

    const attributeParameters = this.attributeParameters ?? getInlineCodeAttributeParameters(this.containerEl.className, this.containerEl.getAttribute('data-cbc') ?? '');
    if (attributeParameters.length === 0) {
      return prefixMatch;
    }

    // fix for #147
    const hasPrefix = prefixMatch && !prefixMatch[1].trim().startsWith('{');
    const parameters = combineInlineCodeParameters(hasPrefix ? prefixMatch[1] : null, attributeParameters);
    const code = hasPrefix ? prefixMatch[2] : text;

    return Object.assign([hasPrefix ? prefixMatch[0] : text, parameters, code], { index: 0, input: text }) as RegExpMatchArray;
  }// getMatch

  onunload() {
    if (this.clickHandler) {
      this.containerEl.removeEventListener('click', this.clickHandler);
    }
  }// onunload

  private processInlineCodeElement(prism: PrismInstance, match: RegExpMatchArray, inlineParams: InlineCodeHighlightParameters) {
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

      void addTextToClipboard(getTextToCopy());
    };
  }// createInlineCodeClickHandler

  private createInlineCodeIcon(displayLanguage: string): HTMLSpanElement | null {
    const Icon = getLanguageIcon(displayLanguage);
    if (Icon) {
      return getInlineCodeIcon(displayLanguage);
    }
    return null;
  }// createInlineCodeIcon

  private createCodeContentSpan(code: string, language: string, prism: PrismInstance, inlineParams?: InlineCodeHighlightParameters): HTMLSpanElement {
    const langClass = language ? `language-${language} codeblock-customizer-language-${language.toLowerCase()}` : '';
    const codeContentSpan = createSpan({ cls: `codeblock-customizer-inline-code-content${langClass ? ' ' + langClass : ''}` });
    const isLanguageSupportedByPrism = language && prism.languages[language];

    if (isLanguageSupportedByPrism) {
      const highlightedHtml = prism.highlight(code, prism.languages[language], language);
      setTrustedHtml(codeContentSpan, highlightedHtml);
    } else {
      codeContentSpan.textContent = code;
    }

    if (inlineParams && (inlineParams.textHighlight.words.length > 0 || inlineParams.textHighlight.textBetween.length > 0 || inlineParams.textHighlight.lineSpecificWords.length > 0 || inlineParams.textHighlight.allWordsInLine.length > 0 || inlineParams.alternativeTextHighlights.length > 0)) {
      const rules = createInlineHighlightRules(inlineParams);
      applyHighlightsToElement(codeContentSpan, rules, 1);
    }

    return codeContentSpan;
  }// createCodeContentSpan
}
