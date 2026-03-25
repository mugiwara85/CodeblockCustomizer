import { MarkdownRenderChild, MarkdownPostProcessorContext, MarkdownSectionInformation, MarkdownPreviewRenderer, loadPrism, CachedMetadata, SectionCache } from "obsidian";

import { getLanguageIcon, createContainer, createCodeblockLang, createCodeblockIcon, createFileName, createCodeblockCollapse, getCurrentMode, getBorderColorByLanguage, getLanguageSpecificColorClass, getPropertyFromLanguageSpecificColors, getLanguageConfig, getFileCacheAndContentLines, isPluginLoaded, normalizeIndentation, isSpecificHeader, determineDefaultFoldState, getVisibleLineCount } from "../Utils";
import CodeBlockCustomizerPlugin from "../main";
import { CodeblockCustomizerSettings, FoldingScope } from "../Settings";
import { DEFAULT_COLLAPSE_TEXT, EXECUTE_CODE_SUPPORTED_LANGUAGES, fadeOutLineCount } from "../Const";
import { FoldCommand, FoldingState } from "../EditorView/EditorEffects";
import { createButtons, toggleFold, extractLinesFromHTML, attachEventListeners, renderCodeBlockLines, CodeBlockData, extractCodeBlocksFromSection, extractCodeBlocksFromAdmonition, reassignFadeOutClasses } from "./ReadingViewUtils";
import { CBCParameters, getAllParameters } from "../Parsing";

const DataSource = {
  Dataset: 'dataset',
  API: 'api',
  Fallback: 'fallback',
} as const;
type DataSource = (typeof DataSource)[keyof typeof DataSource];

export class CodeBlockRenderer extends MarkdownRenderChild {
  plugin: CodeBlockCustomizerPlugin;
  context: MarkdownPostProcessorContext;
  observer: MutationObserver | null = null;
  allPreElements: HTMLElement[] | null = null;
  codeBlockSectionInfo: MarkdownSectionInformation | null = null;

  constructor(containerEl: HTMLElement, plugin: CodeBlockCustomizerPlugin, context: MarkdownPostProcessorContext) {
    super(containerEl);
    this.plugin = plugin;
    this.context = context;
  }

  async onload() {
    await this.render();
  }// onload

  onunload() {
    if (this.observer) {
      this.observer.disconnect();
    }

    if (this.allPreElements) {
      for (const preElement of this.allPreElements) {
        if (this.plugin.executeCodeObservers.has(preElement)) {
          this.plugin.executeCodeObservers.get(preElement)?.disconnect();
          this.plugin.executeCodeObservers.delete(preElement);
        }
      }
    }
  }// onunload

  public async renderExternal(firstLine: string, contentLines: string[], sectionInfo: MarkdownSectionInformation, allFileLines: string[]) {
    this.codeBlockSectionInfo = sectionInfo;

    const preElement = this.containerEl;

    if (!preElement || preElement.tagName.toLowerCase() !== 'pre') {
      console.error("CodeBlockRenderer.renderExternal called on an invalid element.", preElement);
      return;
    }

    this.allPreElements = [preElement];

    const charPos = this.getCharPos(allFileLines);
    const blockData: CodeBlockData = {
      firstLine: firstLine,
      contentLines: contentLines,
      startLine: sectionInfo.lineStart,
      endLine: sectionInfo.lineEnd
    };
    await this.processSingleCodeBlock(preElement, blockData, { charPos, isPrinting: false });
  }// renderExternal

  private async render() {
    const codeBlockElement = this.containerEl;

    // remove execute code output
    const leftoverOutputs = codeBlockElement.querySelectorAll('.has-run-code-button code.language-output, .clear-button');
    leftoverOutputs.forEach(el => el.remove());

    if (!codeBlockElement.querySelector("pre > code")) {
      return;
    }

    const { codeBlockSectionInfo, source } = await this.getSectionInfo(codeBlockElement);
    const isPrinting = !!codeBlockElement.closest('.print');

    if (isPrinting && !this.plugin.settings.pluginSettings.printing.enablePrintToPDFStyling) {
      return;
    }

    if (!codeBlockSectionInfo) {
      if (isPrinting) {
        this.allPreElements = await this.getPreElements(codeBlockElement);
        if (this.allPreElements && this.allPreElements.length > 0) {
          await this.handlePDFExport();
        }
      }
      return;
    }

    this.codeBlockSectionInfo = codeBlockSectionInfo;
    if (source === DataSource.Fallback) {
      codeBlockElement.dataset.sectioninfo = JSON.stringify(this.codeBlockSectionInfo);
    }

    this.allPreElements = await this.getPreElements(codeBlockElement);
    if (!this.allPreElements || this.allPreElements.length === 0) {
      return;
    }

    await this.processCodeBlockSection();
  }// render

  private async getSectionInfo(codeBlockElement: HTMLElement): Promise<{ codeBlockSectionInfo: MarkdownSectionInformation | null, source: DataSource | null }> {
    if (codeBlockElement.dataset.sectioninfo) {
      try {
        return { codeBlockSectionInfo: JSON.parse(codeBlockElement.dataset.sectioninfo), source: DataSource.Dataset };
      } catch (e) {
        /* ignore */
      }
    }

    const codeElm = codeBlockElement.querySelector('pre > code');
    if (!codeElm) {
      return { codeBlockSectionInfo: null, source: null };
    }

    const sectionInfo = this.context.getSectionInfo(codeElm as HTMLElement);
    if (sectionInfo) {
      return { codeBlockSectionInfo: sectionInfo, source: DataSource.API };
    }

    if (this.plugin.settings.pluginSettings.plugins.executeCode.enabled && isPluginLoaded("execute-code", this.plugin)) {
      const fallbackInfo = await this.waitForExecuteCodeToFinish(codeBlockElement);
      if (fallbackInfo) {
        return { codeBlockSectionInfo: fallbackInfo, source: DataSource.Fallback };
      }
    }

    return { codeBlockSectionInfo: null, source: null };
  }// getSectionInfo

  private waitForExecuteCodeToFinish(codeBlockElement: HTMLElement, maxFrames = 10): Promise<MarkdownSectionInformation | null> {
    if (!codeBlockElement || !this.context) {
      return Promise.resolve(null);
    }

    return new Promise<MarkdownSectionInformation | null>((resolve) => {
      let frames = 0;
      const context = this.context;
      function check() {
        const codeEl = codeBlockElement.querySelector('pre > code');
        if (codeEl) {
          const sectionInfo = context.getSectionInfo(codeEl as HTMLElement);
          if (sectionInfo) {
            resolve(sectionInfo);
            return;
          }
        }

        if (frames >= maxFrames) {
          resolve(null);
        } else {
          frames++;
          requestAnimationFrame(check);
        }
      }
      requestAnimationFrame(check);
    });
  }// waitForExecuteCodeToFinish

  private async processCodeBlockSection() {
    if (!this.codeBlockSectionInfo) {
      return;
    }

    const fileContentLines = await this.getFileContentLines();
    if (!fileContentLines) {
      console.error(`Failed to resolve source content for code block at line ${this.codeBlockSectionInfo.lineStart}.`);
      return;
    }

    const sectionContent = fileContentLines.slice(this.codeBlockSectionInfo.lineStart, this.codeBlockSectionInfo.lineEnd + 1);
    const firstLine = sectionContent.find(line => line.trim() !== '');
    if (isPluginLoaded('obsidian-admonition', this.plugin) && firstLine && firstLine.trim().match(/^(?:`{3,}|~{3,})\s*ad-\w+/)) {
      // this is an admonition. admonitionPostProcessor handles it through renderExternal. if the admonition plugin is not installed, then just simply process it as any other code block
      return;
    }

    const allBlocks = extractCodeBlocksFromSection(sectionContent);
    if (allBlocks.length === 0) {
      return;
    }

    const charPos = this.getCharPos(fileContentLines);

    await this.processCodeBlockFirstLines(allBlocks, charPos);
  }// processCodeBlockSection

  private async getFileContentLines() {
    if (!this.codeBlockSectionInfo) {
      return;
    }

    const initialLines = this.codeBlockSectionInfo.text.split('\n');
    const allInitialLinesUndefined = initialLines.slice(this.codeBlockSectionInfo.lineStart, this.codeBlockSectionInfo.lineEnd + 1).every(line => line === undefined);

    if (initialLines.length <= 1 || allInitialLinesUndefined) {
      console.warn("Line data is insufficient or invalid. Falling back to getFileCacheAndContentLines.");
      const { fileContentLines } = await getFileCacheAndContentLines(this.plugin, this.context.sourcePath);

      return fileContentLines;
    } else {
      return initialLines;
    }
  }// getFileContentLines

  private getCharPos(fileContentLines: string[]) {
    if (!this.codeBlockSectionInfo) {
      return -1;
    }

    let charPos = 0;
    for (let i = 0; i < this.codeBlockSectionInfo.lineStart; i++) {
      if (typeof fileContentLines[i] !== 'string') {
        console.error(`Inconsistent data for file ${this.context.sourcePath}. Could not calculate character position.`);
        charPos = -1;
        break;
      }
      charPos += fileContentLines[i].length + 1; // +1 for the newline character
    }

    return charPos !== -1 ? charPos : undefined;
  }// getCharPos

  private async processCodeBlockFirstLines(allBlocks: CodeBlockData[], charPos?: number) {
    if (!this.allPreElements) {
      return;
    }

    if (this.allPreElements.length !== allBlocks.length) {
      console.error("[processCodeBlockFirstLines] Mismatch detected! PreElements length = " + this.allPreElements.length + " codeBlockFistLines length = " + allBlocks.length);
      return;
    }

    for (const [key, preElement] of this.allPreElements.entries()) {
      const isRerenderQueued = this.codeBlockSectionInfo && this.plugin.rerenderQueue.has(this.codeBlockSectionInfo.lineStart);

      if (preElement.classList.contains('codeblock-customizer-pre') && !isRerenderQueued) {
        continue;
      }

      const currentBlock = allBlocks[key];
      if (!currentBlock) {
        continue;
      }

      await this.processSingleCodeBlock(preElement, currentBlock, { charPos, isPrinting: false });
    }
  }// processCodeBlockFirstLines

  private waitForClass(targetElement: HTMLElement, className: string): Promise<void> {
    return new Promise((resolve) => {
      if (targetElement.classList.contains(className)) {
        resolve();
        return;
      }

      const observer = new MutationObserver(() => {
        if (targetElement.classList.contains(className)) {
          observer.disconnect();
          resolve();
        }
      });

      observer.observe(targetElement, {
        attributes: true,
        attributeFilter: ['class']
      });
    });
  }// waitForClass

  private async processSingleCodeBlock(preElement: HTMLElement, blockData: CodeBlockData, options: { charPos?: number; isParameterRerender?: boolean; isPrinting: boolean; }) {
    const { firstLine: codeBlockFirstLine, contentLines, isIndentedBlock } = blockData;
    const { charPos, isParameterRerender = false, isPrinting } = options;

    const originalCodeEl = preElement.querySelector('code:not(.codeblock-customizer-displayed-code)') as HTMLElement;
    if (!originalCodeEl) {
      return;
    }

    if (/(^|\s)language-\S+/.test(originalCodeEl.className)) {
      await this.waitForClass(originalCodeEl, "is-loaded");
    }

    let firstLine = codeBlockFirstLine;
    let isRerender = isParameterRerender;
    const lineStart = this.codeBlockSectionInfo?.lineStart;

    if (!isPrinting && lineStart !== undefined) {
      const result = this.handleRerenderOverride(lineStart, codeBlockFirstLine, isParameterRerender);
      firstLine = result.firstLine;
      isRerender = result.isRerender;
    }

    if (isPrinting && preElement.querySelector("code.codeblock-customizer-displayed-code [class*='codeblock-customizer-line']")) { // just for print or both?
      return;
    }

    const parameters = getAllParameters(firstLine, this.plugin.settings, true);
    if (parameters.exclude) {
      originalCodeEl.classList.remove('codeblock-customizer-hidden-code');
      preElement.querySelector('code.codeblock-customizer-displayed-code')?.remove();
      return;
    }

    if (isPrinting && this.plugin.settings.pluginSettings.printing.uncollapseDuringPrint) {
      parameters.fold = false;
    }

    if (!isPrinting && parameters.group && parameters.group.length > 0) {
      this.setGroupedCodeBlockAttributes(preElement, parameters, charPos);
    }

    const isExecutable = this.plugin.settings.pluginSettings.plugins.executeCode.enabled && isPluginLoaded('execute-code', this.plugin) && EXECUTE_CODE_SUPPORTED_LANGUAGES.includes(parameters.language.toLowerCase());
    let codeElToProcess: HTMLElement;

    if (isExecutable) {
      preElement.querySelector('code.codeblock-customizer-displayed-code')?.remove();
      originalCodeEl.classList.add('codeblock-customizer-hidden-code');

      const displayedCodeEl = preElement.createEl('code', { cls: 'codeblock-customizer-displayed-code' });
      originalCodeEl.classList.forEach(cls => {
        if (cls !== 'codeblock-customizer-hidden-code') {
          displayedCodeEl.classList.add(cls);
        }
      });

      codeElToProcess = displayedCodeEl;
    } else {
      originalCodeEl.classList.remove('codeblock-customizer-hidden-code');
      preElement.querySelector('code.codeblock-customizer-displayed-code')?.remove();

      codeElToProcess = originalCodeEl;
    }

    await this.checkCustomSyntaxHighlight(contentLines, parameters, originalCodeEl, isRerender);

    const codeblockLanguageSpecificClass = getLanguageSpecificColorClass(parameters.language, this.plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors);
    await this.addClasses(preElement, parameters, contentLines, codeElToProcess, codeblockLanguageSpecificClass, originalCodeEl, charPos, isIndentedBlock || false, isRerender, isPrinting);
  }// processSingleCodeBlock

  private handleRerenderOverride(lineStart: number, initialFirstLine: string, initialIsRerender: boolean): { firstLine: string; isRerender: boolean } {
    let firstLine = initialFirstLine;
    let isRerender = initialIsRerender;

    const override = this.plugin.rerenderQueue.get(lineStart);
    if (override) {
      isRerender = true;
      firstLine = override.content;
      const newCount = override.count - 1;

      if (newCount > 0) {
        this.plugin.rerenderQueue.set(lineStart, { content: override.content, count: newCount });
      } else {
        this.plugin.rerenderQueue.delete(lineStart);
      }
    }

    return { firstLine, isRerender };
  }// handleRerenderOverride

  private setGroupedCodeBlockAttributes(preElement: HTMLElement, parameters: CBCParameters, charPos: number | undefined) {
    preElement.setAttribute('groupname', parameters.group);
    preElement.setAttribute('sourcepath', this.context.sourcePath);
    const paramsJsonString = JSON.stringify(parameters);
    preElement.dataset.parameters = paramsJsonString;
    preElement.classList.add('codeblock-customizer-grouped');
    if (charPos !== undefined && charPos !== -1) {
      preElement.dataset.charPos = String(charPos);
    }
  }// handleGroupedCodeBlocks

  private async checkCustomSyntaxHighlight(codeblockLines: string[], parameters: CBCParameters, preCodeElm: HTMLElement, isRerender: boolean) {
    const customLangConfig = getLanguageConfig(parameters.language, this.plugin);
    const customFormat = customLangConfig?.format ?? undefined;
    if (customFormat) {
      const highlightedLines = await this.addCustomSyntaxHighlight(codeblockLines, customFormat);
      if (highlightedLines.length > 0 && !isRerender) {
        preCodeElm.innerHTML = highlightedLines;
      }
    }
  }// checkCustomSyntaxHighlight

  private async addCustomSyntaxHighlight(codeblockLines: string[], language: string) {
    if (codeblockLines.length > 1) {
      codeblockLines = codeblockLines.slice(1);
    } else {
      codeblockLines = [];
    }

    if (codeblockLines.length === 0)
      return "";

    const prism = await loadPrism();
    const langDefinition = prism.languages[language];

    const html = await prism.highlight(codeblockLines.join('\n'), langDefinition, language);

    return html || "";
  }// addCustomSyntaxHighlight

  private async addClasses(preElement: HTMLElement, parameters: CBCParameters, codeblockLines: string[], preCodeElm: HTMLElement, codeblockLanguageSpecificClass: string, htmlSourceEl: HTMLElement, charPos?: number, isIndentedBlock = false, isParameterRerender = false, isPrinting = false) {
    const frag = document.createDocumentFragment();

    this.applyBaseStyling(preElement, parameters, codeblockLanguageSpecificClass, isPrinting);

    if (preElement.parentElement) {
      preElement.parentElement.classList.add(`codeblock-customizer-pre-parent`);
      const parentContainer = preElement.parentElement;
      if (this.plugin.executeCodeObservers.has(parentContainer)) {
        this.plugin.executeCodeObservers.get(parentContainer)?.disconnect();
        this.plugin.executeCodeObservers.delete(parentContainer);
      }
    }

    this.cleanupPreviousElements(preElement);
    const specificHeader = isSpecificHeader(parameters, this.plugin.settings, false, codeblockLines.length - 2, "reading");
    const header = this.HeaderWidget(preElement, parameters, this.plugin.settings, specificHeader, charPos);
    const { container: buttons, observer } = createButtons(parameters, codeblockLines, this.plugin, preElement);
    this.observer = observer;

    if (specificHeader || !isPrinting) {
      frag.appendChild(header);
    }
    frag.appendChild(buttons);

    preElement.insertBefore(frag, preElement.firstChild);

    await this.applyInitialFoldState(preElement, parameters, charPos, codeblockLines);
    await this.highlightLines(preCodeElm, parameters, codeblockLines, isIndentedBlock || false, isParameterRerender, isPrinting, htmlSourceEl);
  }// addClasses

  private applyBaseStyling(preElement: HTMLElement, parameters: CBCParameters, codeblockLanguageSpecificClass: string, isPrinting: boolean) {
    preElement.classList.add(`codeblock-customizer-pre`);
    preElement.classList.add(`codeblock-customizer-language-` + (parameters.language.length > 0 ? parameters.language.toLowerCase() : "nolang"));

    if (codeblockLanguageSpecificClass) {
      preElement.classList.add(codeblockLanguageSpecificClass);
    }

    if (isPrinting && this.plugin.settings.pluginSettings.printing.avoidPageBreaks) {
      if (preElement.parentElement) {
        preElement.parentElement.style.breakInside = 'avoid';
      }
    }

    const borderColor = getBorderColorByLanguage(parameters.language, getPropertyFromLanguageSpecificColors("codeblock.borderColor", this.plugin.settings));
    if (borderColor.length > 0) {
      preElement.classList.add(`hasLangBorderColor`);
    }

    if (parameters.output) {
      preElement.classList.add('is-output');
    }
  }// applyBaseStyling

  private cleanupPreviousElements(preElement: HTMLElement) {
    // remove old header and buttons to prevent duplication during re-render
    preElement.querySelector(".codeblock-customizer-header-container")?.remove();
    preElement.querySelector(".codeblock-customizer-header-container-specific")?.remove();
    preElement.querySelector(".codeblock-customizer-button-container")?.remove();
  }// cleanupPreviousElements

  private async applyInitialFoldState(preElement: HTMLElement, parameters: CBCParameters, charPos: number | undefined, codeblockLines: string[]) {
    const lineCount = Math.max(1, codeblockLines.length - 2);
    const keyToUse = charPos ?? this.codeBlockSectionInfo?.lineStart;
    const settings = this.plugin.settings.pluginSettings;
    let rememberedState: FoldingState | undefined;

    if (settings.codeblock.folding.rememberFoldState && keyToUse !== undefined) {
      const rememberedFolds = this.plugin.foldStoreReading.getAll(this.context.sourcePath);
      rememberedState = rememberedFolds ? rememberedFolds.get(keyToUse) : undefined;
    }

    let foldByDefault = false;
    let useSemiFold = false;
    const globalCommand = this.plugin.foldCommandTrigger;

    switch (globalCommand) {
      case FoldCommand.FoldAll:
        foldByDefault = true;
        useSemiFold = settings.semiFold.enableSemiFold;
        break;
      case FoldCommand.UnfoldAll:
        foldByDefault = false;
        break;
      case FoldCommand.Default:
      default:
        if (rememberedState !== undefined) {
          foldByDefault = rememberedState === FoldingState.FullyFolded || rememberedState === FoldingState.SemiFolded;
          useSemiFold = rememberedState === FoldingState.SemiFolded;
        } else {
          const specificHeader = isSpecificHeader(parameters, this.plugin.settings, false, lineCount, "reading");
          const foldState = determineDefaultFoldState(parameters, this.plugin.settings, lineCount, specificHeader, "reading");
          foldByDefault = foldState.foldByDefault;
          useSemiFold = foldState.useSemiFold;
        }
        break;
    }

    if (foldByDefault) {
      const visibleLinesCount = getVisibleLineCount(parameters, lineCount);
      const canSemiFold = visibleLinesCount >= settings.semiFold.visibleLines + fadeOutLineCount;
      const isSemiCollapsed = useSemiFold && canSemiFold;
      if (isSemiCollapsed) {
        preElement.classList.add('codeblock-customizer-codeblock-semi-collapsed');
      } else {
        preElement.classList.add('codeblock-customizer-codeblock-collapsed');
      }
      if (rememberedState === undefined && globalCommand === FoldCommand.Default) {
        preElement.classList.add('codeblock-customizer-codeblock-default-collapse');
      }

      const header = preElement.querySelector('.codeblock-customizer-header-container, .codeblock-customizer-header-container-specific');
      if (header) {
        header.classList.add(isSemiCollapsed ? 'semi-collapsed' : 'collapsed');
        if (!parameters.hasTitle) {
          const headerText = header.querySelector('.codeblock-customizer-header-text');
          if (headerText) {
            headerText.textContent = this.plugin.settings.pluginSettings.header.collapsedCodeText || DEFAULT_COLLAPSE_TEXT;
          }
        }
      }
    }
  }// applyInitialFoldState

  private HeaderWidget(preElement: HTMLElement, parameters: CBCParameters, settings: CodeblockCustomizerSettings, specificHeader: boolean, charPos?: number) {
    const codeblockLanguageSpecificClass = getLanguageSpecificColorClass(parameters.language, settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors);
    const container = createContainer(specificHeader, parameters.language, false, codeblockLanguageSpecificClass); // hasLangBorderColor must be always false in reading mode, because how the doc is generated
    const frag = document.createDocumentFragment();

    if (parameters.displayLanguage) {
      const Icon = getLanguageIcon(parameters.displayLanguage)
      if (Icon) {
        frag.appendChild(createCodeblockIcon(parameters.displayLanguage));
        container.classList.add('has-icon');
      }
      frag.appendChild(createCodeblockLang(parameters.displayLanguage));
    }
    const fileNameEl = createFileName(parameters.headerDisplayText, settings.pluginSettings.codeblock.enableLinks, this.context.sourcePath, this.plugin);
    frag.appendChild(fileNameEl);

    const collapseStyle = settings.pluginSettings.header.collapseIconStyle;
    const collapseEl = createCodeblockCollapse(parameters.fold, collapseStyle);
    if ((this.plugin.settings.pluginSettings.header.disableFoldUnlessSpecified && !this.plugin.settings.pluginSettings.codeblock.folding.inverseFold && !parameters.fold) ||
      (this.plugin.settings.pluginSettings.header.disableFoldUnlessSpecified && this.plugin.settings.pluginSettings.codeblock.folding.inverseFold && !parameters.unfold)) {
      container.classList.add(`noCollapseIcon`);
    } else {
      frag.appendChild(collapseEl);
    }

    container.appendChild(frag);

    const semiFold = settings.pluginSettings.semiFold.enableSemiFold;
    const visibleLines = settings.pluginSettings.semiFold.visibleLines;

    container.addEventListener("click", () => {
      if ((this.plugin.settings.pluginSettings.header.disableFoldUnlessSpecified && !this.plugin.settings.pluginSettings.codeblock.folding.inverseFold && !parameters.fold) ||
        (this.plugin.settings.pluginSettings.header.disableFoldUnlessSpecified && this.plugin.settings.pluginSettings.codeblock.folding.inverseFold && !parameters.unfold)) {
        return;
      }

      const codeElements = preElement.querySelector('code:not(.codeblock-customizer-hidden-code)');
      let lines: Element[] = [];
      if (codeElements) {
        const children = Array.from(codeElements.children);
        lines = children.filter(child => !child.classList.contains('codeblock-customizer-cmdoutput-line') && !child.classList.contains('hidden-line-hidden'));
      }
      const canSemiFold = lines.length >= visibleLines + fadeOutLineCount;
      const useSemiFold = semiFold && canSemiFold;

      const isCollapsed = preElement.classList.contains(`codeblock-customizer-codeblock-collapsed`);
      const isSemiCollapsed = preElement.classList.contains(`codeblock-customizer-codeblock-semi-collapsed`);

      let newState: FoldingState;
      if (isCollapsed || isSemiCollapsed) {
        toggleFold(preElement, collapseEl, isSemiCollapsed ? `codeblock-customizer-codeblock-semi-collapsed` : `codeblock-customizer-codeblock-collapsed`, collapseStyle);
        newState = FoldingState.Unfolded;
        container.classList.remove('collapsed', 'semi-collapsed');
        if (!parameters.hasTitle) {
          fileNameEl.textContent = '';
        }
      } else {
        toggleFold(preElement, collapseEl, useSemiFold ? `codeblock-customizer-codeblock-semi-collapsed` : `codeblock-customizer-codeblock-collapsed`, collapseStyle);
        newState = useSemiFold ? FoldingState.SemiFolded : FoldingState.FullyFolded;
        container.classList.add(useSemiFold ? 'semi-collapsed' : 'collapsed');
        if (!parameters.hasTitle) {
          fileNameEl.textContent = this.plugin.settings.pluginSettings.header.collapsedCodeText || DEFAULT_COLLAPSE_TEXT;
        }
        if (useSemiFold) {
          reassignFadeOutClasses(preElement, preElement.querySelector('code') as HTMLElement, settings.pluginSettings);
        }
      }

      if (this.codeBlockSectionInfo) {
        const foldSettings = this.plugin.settings.pluginSettings.codeblock.folding;
        const shouldRemember = foldSettings.scope === FoldingScope.All || (foldSettings.scope === FoldingScope.NoFoldSpecified && !parameters.fold && !parameters.unfold);
        if (shouldRemember) {
          const keyToUse = charPos ?? this.codeBlockSectionInfo.lineStart;
          this.plugin.setFoldState(this.context.sourcePath, keyToUse, newState, 'reading', parameters, lines.length);
        }
      }
    });

    return container
  }// HeaderWidget

  private async highlightLines(preCodeElm: HTMLElement, parameters: CBCParameters, rawCodeLines: string[], isIndentedBlock: boolean, isRerender = false, isPrinting = false, htmlSourceEl: HTMLElement) {
    if (!preCodeElm) {
      return;
    }

    const sourceEl = htmlSourceEl || preCodeElm;
    const isAlreadyProcessed = preCodeElm.innerHTML.includes('codeblock-customizer-line');
    const isRunLanguage = Array.from(htmlSourceEl.classList).some(cls => cls.startsWith('language-run-'));
    const isNotHighlighted = isRunLanguage && !htmlSourceEl.innerHTML.includes('<span') && this.plugin.settings.pluginSettings.plugins.executeCode.enabled;
    const rebuild = isRerender || isAlreadyProcessed || isNotHighlighted;
    const tempCodeElm = document.createElement('div');
    const settings = this.plugin.settings.pluginSettings;

    if (rebuild) {
      const customLangConfig = getLanguageConfig(parameters.language, this.plugin);
      const customFormat = customLangConfig?.format ?? undefined; // custom syntax highlight
      //let codeLinesToProcess = rawCodeLines.slice(1, -1);
      let codeLinesToProcess = isIndentedBlock ? rawCodeLines : rawCodeLines.slice(1, -1);

      codeLinesToProcess = normalizeIndentation(codeLinesToProcess);

      const codeContentToHighlight = codeLinesToProcess.join('\n');
      const prism = await loadPrism();
      const language = parameters.language;
      const langDefinition = prism.languages[customFormat ? customFormat : language];

      if (langDefinition) {
        tempCodeElm.innerHTML = await prism.highlight(codeContentToHighlight, langDefinition, language);
      } else {
        tempCodeElm.textContent = codeContentToHighlight;
      }
    } else {
      // initial render
      tempCodeElm.innerHTML = sourceEl.innerHTML;
    }

    preCodeElm.innerHTML = '';
    const { htmlLines, textLines } = extractLinesFromHTML(tempCodeElm);

    const codeblockLen = isIndentedBlock ? htmlLines.length - 1 : Math.max(1, rawCodeLines.length - 2);

    const { fragment, annotations } = await renderCodeBlockLines({
      htmlLines,
      textLines,
      lineCount: codeblockLen,
      parameters: parameters,
      plugin: this.plugin,
      settings,
      sourcePath: this.context.sourcePath,
      handleAnnotations: true,
      processPrompts: true,
      addIndentationGuides: true,
      parseLinks: settings.codeblock.enableLinks,
      isPrinting,
    });

    preCodeElm.appendChild(fragment);

    attachEventListeners(preCodeElm, this.plugin, this.context.sourcePath, annotations);
  }// highlightLines

  private async handlePDFExport() {
    if (this.containerEl.closest('.codeblock-customizer-pre-parent')) {
      return;
    }

    const allPreElements = this.allPreElements?.filter(pre => this.isValidPdfExportElement(pre)) ?? [];
    if (allPreElements.length === 0) {
      return;
    }

    const nativePreElements: HTMLElement[] = [];
    const embedContainers = new Map<HTMLElement, HTMLElement[]>();

    for (const pre of allPreElements) {
      if (pre.closest('.internal-embed[src]')) {
        const embedContainer = pre.closest('.internal-embed[src]') as HTMLElement;
        if (!embedContainers.has(embedContainer)) {
          embedContainers.set(embedContainer, []);
        }
        embedContainers.get(embedContainer)?.push(pre);
      } else {
        nativePreElements.push(pre);
      }
    }

    if (nativePreElements.length > 0) {
      await this.processNativePdfBlocks(nativePreElements);
    }

    for (const [container, preElements] of embedContainers.entries()) {
      await this.processEmbeddedPdfBlocks(container, preElements);
    }
  }// handlePDFExport

  private isValidPdfExportElement(pre: HTMLElement): boolean {
    const codeEl = pre.querySelector("code");
    if (!codeEl) {
      return false;
    }

    // admonitions must be excluded only when the admonition plugin is installed
    if (isPluginLoaded('obsidian-admonition', this.plugin)) {
      const isAdmonition = Array.from(codeEl.classList).some(cls => cls.startsWith('language-ad-'));
      // const isOutput = codeEl.classList.contains('language-output');
      if (isAdmonition) {
        return false;
      }
    }

    return true; // !isAdmonition// && !isOutput
  }// isValidPdfExportElement

  private async processNativePdfBlocks(nativePreElements: HTMLElement[]): Promise<void> {
    const { cache, fileContentLines } = await getFileCacheAndContentLines(this.plugin, this.context.sourcePath);
    if (!cache || !fileContentLines) {
      return;
    }

    const sections = cache.sections?.filter(s => ['code', 'list', 'callout', 'blockquote'].includes(s.type)) ?? [];
    const nativeCodeBlocks = this.extractCodeBlocksFromSections(sections, fileContentLines);

    await this.processBlocks(nativePreElements, nativeCodeBlocks, `native blocks in ${this.context.sourcePath}`);
  }// processNativePdfBlocks

  private async processEmbeddedPdfBlocks(container: HTMLElement, preElements: HTMLElement[]): Promise<void> {
    const src = container.getAttribute('src');
    if (!src) {
      return;
    }

    const { sourceFile } = this.parseEmbedSrc(src);
    const targetFile = this.plugin.app.metadataCache.getFirstLinkpathDest(sourceFile || '', this.context.sourcePath);
    if (!targetFile) {
      return;
    }

    const { cache, fileContentLines } = await getFileCacheAndContentLines(this.plugin, targetFile.path);
    if (!cache || !fileContentLines) {
      return;
    }

    const codeBlocksToFind = this.findCodeBlocksInEmbed(src, cache, fileContentLines);

    await this.processBlocks(preElements, codeBlocksToFind, `embedded content from ${src}`);
  }// processEmbeddedPdfBlocks

  private findCodeBlocksInEmbed(src: string, cache: CachedMetadata, content: string[]): CodeBlockData[] {
    const { header, id: blockId } = this.parseEmbedSrc(src);

    if (blockId) {
      // block embed
      const block = cache.blocks?.[blockId];
      if (block) {
        const blockLines = content.slice(block.position.start.line, block.position.end.line + 1);
        return extractCodeBlocksFromSection(blockLines);
      }
    } else if (header) {
      // header embed
      const headings = cache.headings ?? [];
      const targetHeading = headings.find(h => h.heading === header.replace(/#/g, ''));
      if (targetHeading) {
        const startLine = targetHeading.position.start.line;
        const nextHeading = headings.find(h => h.position.start.line > startLine && h.level <= targetHeading.level);
        const endLine = nextHeading ? nextHeading.position.start.line - 1 : content.length - 1;

        const sectionLines = content.slice(startLine, endLine + 1);
        const sections = cache.sections?.filter(s => s.position.start.line >= startLine && s.position.end.line <= endLine) ?? [];
        return this.extractCodeBlocksFromSections(sections, sectionLines);
      }
    } else {
      // full file embed
      const sections = cache.sections?.filter(s => ['code', 'list', 'callout', 'blockquote'].includes(s.type)) ?? [];
      return this.extractCodeBlocksFromSections(sections, content);
    }
    return [];
  }// findCodeBlocksInEmbed

  private async processBlocks(preElements: HTMLElement[], codeBlocks: CodeBlockData[], contextMessage: string): Promise<void> {
    if (preElements.length !== codeBlocks.length) {
      console.error(`[processBlocks] PDF Export Mismatch for ${contextMessage}!`, { parsedCount: codeBlocks.length, renderedCount: preElements.length });
      return;
    }

    const limit = Math.min(preElements.length, codeBlocks.length);
    for (let i = 0; i < limit; i++) {
      await this.processSingleCodeBlock(preElements[i], codeBlocks[i], { isPrinting: true });
    }
  }// processBlocks

  private isCodeBlockProcessor(language: string): boolean {
    // @ts-expect-error: undocumented Obsidian API
    const processors: Record<string, unknown> | undefined = MarkdownPreviewRenderer.codeBlockPostProcessors;
    if (!processors) {
      return false;
    }

    return language.toLowerCase() in processors;
  }// isCodeBlockProcessor

  private extractCodeBlocksFromSections(sections: SectionCache[], fileContent: string[]): CodeBlockData[] {
    const sectionsToParse: SectionCache[] = [];
    const coveredLines = new Set<number>();
    const allPotentialSections = [...sections].sort((a, b) => a.position.start.line - b.position.start.line);

    for (const section of allPotentialSections) {
      if (coveredLines.has(section.position.start.line)) {
        continue;
      }

      sectionsToParse.push(section);
      for (let i = section.position.start.line; i <= section.position.end.line; i++) {
        coveredLines.add(i);
      }
    }

    return sectionsToParse.flatMap(section => {
      const blockLines = fileContent.slice(section.position.start.line, section.position.end.line + 1);
      const firstLine = blockLines.find(l => l.trim() !== '')?.trim() || '';
      const language = firstLine.replace(/^(?:`|~){3,}/, '').trim().split(' ')[0] || '';
      const isAdmonitionContainer = section.type === 'code' && language.toLowerCase().startsWith('ad-');

      let extractedBlocks: CodeBlockData[];
      if (isAdmonitionContainer) {
        if (isPluginLoaded('obsidian-admonition', this.plugin)) {
          extractedBlocks = extractCodeBlocksFromAdmonition(blockLines);
        } else {
          extractedBlocks = extractCodeBlocksFromSection(blockLines);
        }
      } else {
        extractedBlocks = extractCodeBlocksFromSection(blockLines);
      }

      // filter out code blocks, which have registered code block processors ==> won't produce <pre> elements and this would lead to mismatch
      return extractedBlocks.filter(block => {
        const blockLang = block.firstLine.replace(/^(?:`|~){3,}/, '').trim().split(' ')[0] || '';
        if (blockLang && this.isCodeBlockProcessor(blockLang)) {
          //console.log(`[extractCodeBlocksFromSections] skipping code block with language "${blockLang}" (isCodeBlockProcessor)`);
          return false;
        }
        return true;
      });
    });
  }// extractCodeBlocksFromSections

  private parseEmbedSrc(src: string): { sourceFile: string | null; header: string | null; id: string | null } {
    let sourceFile: string | null = null;
    let header: string | null = null;
    let id: string | null = null;

    const caretIndex = src.indexOf('^');
    if (caretIndex !== -1) {
      id = src.substring(caretIndex + 1);
    }

    const hashIndex = src.indexOf('#');
    if (hashIndex !== -1) {
      header = src.substring(hashIndex + 1, caretIndex !== -1 ? caretIndex : undefined);
    }

    let pathPart = src;
    if (hashIndex !== -1) {
      pathPart = src.substring(0, hashIndex);
    } else if (caretIndex !== -1) {
      pathPart = src.substring(0, caretIndex);
    }

    if (pathPart.length > 0) {
      sourceFile = pathPart;
    }

    return { sourceFile, header, id };
  }//parseEmbedSrc

  private async getPreElements(element: HTMLElement) {
    const preElements: Array<HTMLElement> = Array.from(element.querySelectorAll("pre:not(.frontmatter)"));
    return preElements;
  }// getPreElements
}// CodeBlockRenderer
