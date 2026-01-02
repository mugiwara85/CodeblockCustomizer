import { MarkdownPostProcessorContext, loadPrism, MarkdownRenderChild } from "obsidian";

import { getLanguageIcon, getInlineCodeIcon, addTextToClipboard } from "./Utils";
import CodeBlockCustomizerPlugin from "./main";
import { INLINE_CODE_LANG_REGEX } from "./Const";
import { InlineCodeModifierKeys } from "./Settings";
import { getDisplayLanguageName } from "./Utils";

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
    const isPdfExport = !this.context.getSectionInfo(this.containerEl);

    if (isPdfExport && !this.plugin.settings.pluginSettings.printing.enablePrintToPDFStyling) {
      // remove class during printing, so it does not gets styled
      this.containerEl.classList.remove('codeblock-customizer-inline-code');
      return;
    }

    const text = this.containerEl.textContent ?? "";
    const match = text.match(INLINE_CODE_LANG_REGEX);
    const settings = this.plugin.settings.pluginSettings.inlineCode;
    // fix for #147
    const isValidMatch = match && match[1] && !match[1].trim().startsWith('{') && match[2];

    if (settings.enableSyntaxHighlight && isValidMatch) {
      const prism = await loadPrism();
      this.processInlineCodeElement(prism, match);
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

  private processInlineCodeElement(prism: any, match: RegExpMatchArray) {
    const text = this.containerEl.textContent?.trim();
    if (!text) {
      return;
    }

    if (!match || !match[1] || !match[2]) {
      return;
    }
    
    const language = match[1].toLowerCase();
    const code = match[2];
    const settings = this.plugin.settings.pluginSettings.inlineCode;
    const displayLanguage = getDisplayLanguageName(language);
    
    this.containerEl.innerHTML = '';
    
    if (settings.enableCopyOnClick) {
      this.clickHandler = this.createInlineCodeClickHandler(() => code);
      this.containerEl.addEventListener('click', this.clickHandler, true);
    }

    const iconSpan = this.createInlineCodeIcon(displayLanguage);
    if (iconSpan) {
      this.containerEl.appendChild(iconSpan);
    }

    const codeContentSpan = this.createCodeContentSpan(code, language, prism);
    this.containerEl.appendChild(codeContentSpan);
  }// processInlineCodeElement

  private createInlineCodeClickHandler(getTextToCopy: () => string): (event: MouseEvent) => void {
    return (event: MouseEvent) => {
      const requiredKey = this.plugin.settings.pluginSettings.inlineCode.copyModifierKey;
      if ((requiredKey === InlineCodeModifierKeys.CTRL && !event.ctrlKey) || (requiredKey === InlineCodeModifierKeys.ALT && !event.altKey)) {
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

  private createCodeContentSpan(code: string, language: string, prism: any): HTMLSpanElement {
    const codeContentSpan = createSpan({ cls: `codeblock-customizer-inline-code-content language-${language}` });
    const isLanguageSupportedByPrism = prism.languages[language];

    if (isLanguageSupportedByPrism) {
      const highlightedHtml = prism.highlight(code, prism.languages[language], language);
      codeContentSpan.innerHTML = highlightedHtml;
    } else {
      codeContentSpan.textContent = code;
      //codeContentSpan.classList.add('codeblock-customizer-no-highlight');
    }
    return codeContentSpan;
  }// createCodeContentSpan
}