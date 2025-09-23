import { MarkdownRenderChild, MarkdownPostProcessorContext, MarkdownSectionInformation, loadPrism, CachedMetadata, SectionCache } from "obsidian";

import { getLanguageIcon, createContainer, createCodeblockLang, createCodeblockIcon, createFileName, createCodeblockCollapse, getCurrentMode, getBorderColorByLanguage, getLanguageSpecificColorClass, CBCParameters, getAllParameters, getPropertyFromLanguageSpecificColors, getLanguageConfig, getFileCacheAndContentLines, isPluginLoaded, normalizeIndentation } from "./Utils";
import CodeBlockCustomizerPlugin from "./main";
import { CodeblockCustomizerSettings, FoldingPersistence, FoldingScope } from "./Settings";
import { fadeOutLineCount } from "./Const";
import { FoldCommand, FoldingState } from "./EditorExtensions";
import { createButtons, toggleFold, extractLinesFromHTML, attachEventListeners, renderCodeBlockLines, CodeBlockData, extractCodeBlocksFromSection, extractCodeBlocksFromAdmonition } from "./ReadingViewUtils";

enum DataSource {
  Dataset = 'dataset',
  API = 'api',
  Fallback = 'fallback',
}

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
      if (this.containerEl.parentElement)
        this.plugin.executeCodeObservers.delete(this.containerEl.parentElement);
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
    const leftoverOutputs = codeBlockElement.querySelectorAll('code.language-output, .clear-button');
    leftoverOutputs.forEach(el => el.remove());

    if (!codeBlockElement.querySelector("pre > code")) {
      return;
    }

    const { codeBlockSectionInfo, source } = await this.getSectionInfo(codeBlockElement);
    const isPrinting = !!codeBlockElement.closest('.print');
    
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
    
    if (this.plugin.settings.SelectedTheme.settings.plugins.executeCode.enabled && isPluginLoaded("execute-code", this.plugin)) {
      const fallbackInfo = await this.waitForExecuteCodeToFinish(codeBlockElement);
      if (fallbackInfo) {
        return { codeBlockSectionInfo: fallbackInfo, source: DataSource.Fallback };
      }
    }
    
    return { codeBlockSectionInfo: null, source: null };
  }// getSectionInfo

  private async waitForExecuteCodeToFinish(codeBlockElement: HTMLElement, maxRetries = 25, delay = 2): Promise<MarkdownSectionInformation | null> {
    if (!codeBlockElement || !this.context) {
      return null;
    }
    
    for (let i = 0; i < maxRetries; i++) {
      const codeEl = codeBlockElement.querySelector('pre > code');
      if (codeEl) {
        const sectionInfo = this.context.getSectionInfo(codeEl as HTMLElement);
        if (sectionInfo) {
          return sectionInfo;
        }
      }
      
      await sleep(delay);
    }
    
    return null;
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
    if (firstLine && firstLine.trim().match(/^(?:`{3,}|~{3,})\s*ad-\w+/)) {
      // this is an admonition. admonitionPostProcessor handles it through renderExternal
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

  private async processSingleCodeBlock(preElement: HTMLElement, blockData: CodeBlockData, options: { charPos?: number; isParameterRerender?: boolean; isPrinting: boolean; }) {
    const { firstLine: codeBlockFirstLine, contentLines, isIndentedBlock } = blockData;
    const { charPos, isParameterRerender = false, isPrinting } = options;

    const preCodeElm = preElement.querySelector('code');
    if (!preCodeElm) {
      return;
    }

    if (Array.from(preCodeElm.classList).some(className => /^language-\S+/.test(className))) {
      while (!preCodeElm.classList.contains("is-loaded")) {
        await sleep(2);
      }
    }

    let firstLine = codeBlockFirstLine;
    let isRerender = isParameterRerender;
    const lineStart = this.codeBlockSectionInfo?.lineStart;

    if (!isPrinting && lineStart !== undefined) {
      const result = this.handleRerenderOverride(lineStart, codeBlockFirstLine, isParameterRerender);
      firstLine = result.firstLine;
      isRerender = result.isRerender;
    }

    if (isPrinting && preCodeElm.querySelector("code [class*='codeblock-customizer-line']")) { // just for print or both?
      return;
    }

    const parameters = getAllParameters(firstLine, this.plugin.settings, true);
    if (parameters.exclude) {
      return;
    }

    if (isPrinting && this.plugin.settings.SelectedTheme.settings.printing.uncollapseDuringPrint) {
      parameters.fold = false;
    }

    if (!isPrinting && parameters.group && parameters.group.length > 0) {
      this.setGroupedCodeBlockAttributes(preElement, parameters, charPos);
    }

    await this.checkCustomSyntaxHighlight(contentLines, parameters, preCodeElm);

    const codeblockLanguageSpecificClass = getLanguageSpecificColorClass(parameters.language, this.plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors);
    await this.addClasses(preElement, parameters, contentLines, preCodeElm, codeblockLanguageSpecificClass, charPos, isIndentedBlock || false, isRerender, isPrinting);
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

  private async checkCustomSyntaxHighlight(codeblockLines: string[], parameters: CBCParameters, preCodeElm: HTMLElement) {
    const customLangConfig = getLanguageConfig(parameters.language, this.plugin);
    const customFormat = customLangConfig?.format ?? undefined;
    if (customFormat) {
      const highlightedLines = await this.addCustomSyntaxHighlight(codeblockLines, customFormat);
      if (highlightedLines.length > 0) {
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
  
  private async addClasses(preElement: HTMLElement, parameters: CBCParameters, codeblockLines: string[], preCodeElm: HTMLElement, codeblockLanguageSpecificClass: string, charPos?: number, isIndentedBlock = false, isParameterRerender = false, isPrinting = false) {
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
  
    const header = this.HeaderWidget(preElement, parameters, this.plugin.settings, charPos);
    const {container: buttons, observer} = createButtons(parameters, codeblockLines, this.plugin, preElement);
    this.observer = observer;

    if (parameters.specificHeader || !isPrinting) {
      frag.appendChild(header);
    }
    frag.appendChild(buttons);
      
    preElement.insertBefore(frag, preElement.firstChild);
      
    await this.applyInitialFoldState(preElement, parameters, charPos, codeblockLines);    
    await this.highlightLines(preCodeElm, parameters, codeblockLines, isIndentedBlock || false, isParameterRerender, isPrinting);
  }// addClasses

  private applyBaseStyling(preElement: HTMLElement, parameters: CBCParameters, codeblockLanguageSpecificClass: string, isPrinting: boolean) {
    preElement.classList.add(`codeblock-customizer-pre`);  
    preElement.classList.add(`codeblock-customizer-language-` + (parameters.language.length > 0 ? parameters.language.toLowerCase() : "nolang"));
  
    if (codeblockLanguageSpecificClass) {
      preElement.classList.add(codeblockLanguageSpecificClass);
    }

    if (isPrinting && this.plugin.settings.SelectedTheme.settings.printing.avoidPageBreaks) {
      if (preElement.parentElement) {
        preElement.parentElement.style.breakInside = 'avoid';
      }
    }

    const borderColor = getBorderColorByLanguage(parameters.language, getPropertyFromLanguageSpecificColors("codeblock.borderColor", this.plugin.settings));
    if (borderColor.length > 0) {
      preElement.classList.add(`hasLangBorderColor`);
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
    const settings = this.plugin.settings.SelectedTheme.settings;
    let rememberedState: FoldingState | undefined;
    
    if (settings.codeblock.folding.rememberFoldState && keyToUse !== undefined) {
      if (settings.codeblock.folding.persistence === FoldingPersistence.Permanent) {
        const rememberedFolds = this.plugin.loadPermanentReadingViewFolds(this.context.sourcePath);
        rememberedState = rememberedFolds.get(keyToUse);
      } else { 
        // session
        const rememberedFolds = this.plugin.activeReadingViewFolds.get(this.context.sourcePath);
        rememberedState = rememberedFolds ? rememberedFolds.get(keyToUse) : undefined;
      }
    }

    let shouldFold = false;
    let useSemiFold = false;
    const globalCommand = this.plugin.foldCommandTrigger;
  
    switch (globalCommand) {
      case FoldCommand.FoldAll:
        shouldFold = true;
        useSemiFold = settings.semiFold.enableSemiFold;
        break;
      case FoldCommand.UnfoldAll:
        shouldFold = false;
        break;
      case FoldCommand.Default:
      default:
        if (rememberedState !== undefined) {
          shouldFold = rememberedState === FoldingState.FullyFolded || rememberedState === FoldingState.SemiFolded;
          useSemiFold = rememberedState === FoldingState.SemiFolded;
        } else {
          const inverseFold = settings.codeblock.folding.inverseFold;
          const autoFold = parameters.specificHeader && settings.semiFold.enableSemiFold && settings.semiFold.autoFoldLongCodeblocks && lineCount >= settings.semiFold.longCodeBlockLines;
          shouldFold = parameters.fold || (inverseFold && !parameters.unfold) || autoFold;
          useSemiFold = settings.semiFold.enableSemiFold;
        }
        break;
    }
    
    if (shouldFold) {
      const canSemiFold = lineCount >= settings.semiFold.visibleLines + fadeOutLineCount;
      if (useSemiFold && canSemiFold) {
        preElement.classList.add('codeblock-customizer-codeblock-semi-collapsed');
      } else {
        preElement.classList.add('codeblock-customizer-codeblock-collapsed');
      }
      if (rememberedState === undefined && globalCommand === FoldCommand.Default) { 
        preElement.classList.add('codeblock-customizer-codeblock-default-collapse');
      }
    }
  }// applyInitialFoldState

  private HeaderWidget(preElement: HTMLElement, parameters: CBCParameters, settings: CodeblockCustomizerSettings, charPos?: number) {
    const codeblockLanguageSpecificClass = getLanguageSpecificColorClass(parameters.language, settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors);
    const container = createContainer(parameters.specificHeader, parameters.language, false, codeblockLanguageSpecificClass); // hasLangBorderColor must be always false in reading mode, because how the doc is generated
    const frag = document.createDocumentFragment();

    if (parameters.displayLanguage) {
      const Icon = getLanguageIcon(parameters.displayLanguage)
      if (Icon) {
        frag.appendChild(createCodeblockIcon(parameters.displayLanguage));
      }
      frag.appendChild(createCodeblockLang(parameters.language));
    }
    frag.appendChild(createFileName(parameters.headerDisplayText, settings.SelectedTheme.settings.codeblock.enableLinks, this.context.sourcePath, this.plugin));

    const collapseEl = createCodeblockCollapse(parameters.fold);
    if ((this.plugin.settings.SelectedTheme.settings.header.disableFoldUnlessSpecified && !this.plugin.settings.SelectedTheme.settings.codeblock.folding.inverseFold && !parameters.fold) ||
        (this.plugin.settings.SelectedTheme.settings.header.disableFoldUnlessSpecified && this.plugin.settings.SelectedTheme.settings.codeblock.folding.inverseFold && !parameters.unfold)) {
      container.classList.add(`noCollapseIcon`);
    } else {
      frag.appendChild(collapseEl);
    }

    container.appendChild(frag);

    const semiFold = settings.SelectedTheme.settings.semiFold.enableSemiFold;
    const visibleLines = settings.SelectedTheme.settings.semiFold.visibleLines;

    container.addEventListener("click", () => {
      if ((this.plugin.settings.SelectedTheme.settings.header.disableFoldUnlessSpecified && !this.plugin.settings.SelectedTheme.settings.codeblock.folding.inverseFold && !parameters.fold) ||
        (this.plugin.settings.SelectedTheme.settings.header.disableFoldUnlessSpecified && this.plugin.settings.SelectedTheme.settings.codeblock.folding.inverseFold && !parameters.unfold)) {
        return;
      }

      const codeElements = preElement.getElementsByTagName("CODE");
      const lines = this.convertHTMLCollectionToArray(codeElements, true);
      const canSemiFold = lines.length >= visibleLines + fadeOutLineCount;
      const useSemiFold = semiFold && canSemiFold;

      const isCollapsed = preElement.classList.contains(`codeblock-customizer-codeblock-collapsed`);
      const isSemiCollapsed = preElement.classList.contains(`codeblock-customizer-codeblock-semi-collapsed`);

      let newState: FoldingState;
      if (isCollapsed || isSemiCollapsed) {
        toggleFold(preElement, collapseEl, isSemiCollapsed ? `codeblock-customizer-codeblock-semi-collapsed` : `codeblock-customizer-codeblock-collapsed`);
        newState = FoldingState.Unfolded;
      } else {
        toggleFold(preElement, collapseEl, useSemiFold ? `codeblock-customizer-codeblock-semi-collapsed` : `codeblock-customizer-codeblock-collapsed`);
        newState = useSemiFold ? FoldingState.SemiFolded : FoldingState.FullyFolded;
      }

      if (this.codeBlockSectionInfo) {
        const foldSettings = this.plugin.settings.SelectedTheme.settings.codeblock.folding;
        const shouldRemember = foldSettings.scope === FoldingScope.All || (foldSettings.scope === FoldingScope.NoFoldSpecified && !parameters.fold && !parameters.unfold);
        if (shouldRemember) {
          const keyToUse = charPos ?? this.codeBlockSectionInfo.lineStart;
          this.plugin.setFoldState(this.context.sourcePath, keyToUse, newState, 'reading', parameters, lines.length);
        }
      }
    });

    return container
  }// HeaderWidget

  private async highlightLines(preCodeElm: HTMLElement, parameters: CBCParameters, rawCodeLines: string[], isIndentedBlock: boolean, isRerender = false, isPrinting = false) {
    if (!preCodeElm) {
      return;
    }

    const isAlreadyProcessed = preCodeElm.innerHTML.includes('codeblock-customizer-line');
    const rebuild = isRerender || isAlreadyProcessed;
    const tempCodeElm = document.createElement('div');
    const settings = this.plugin.settings.SelectedTheme.settings;

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
      tempCodeElm.innerHTML = preCodeElm.innerHTML;
    }

    preCodeElm.innerHTML = '';
    const { htmlLines, textLines } = extractLinesFromHTML(tempCodeElm);
    
    const codeblockLen = isIndentedBlock ? htmlLines.length - 1: Math.max(1, rawCodeLines.length - 2); 
    
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

    const allPreElements = this.allPreElements?.filter(this.isValidPdfExportElement) ?? [];
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
    
    // admonitions and execute-code outputs must be excluded
    const isAdmonition = Array.from(codeEl.classList).some(cls => cls.startsWith('language-ad-'));
    const isOutput = codeEl.classList.contains('language-output');
    
    return !isAdmonition && !isOutput;
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
      console.error(`[processBlocks] PDF Export Mismatch for ${contextMessage}!`, {parsedCount: codeBlocks.length, renderedCount: preElements.length });
      return;
    }
    
    const limit = Math.min(preElements.length, codeBlocks.length);
    for (let i = 0; i < limit; i++) {
      await this.processSingleCodeBlock(preElements[i], codeBlocks[i], { isPrinting: true });
    }
  }// processBlocks

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

      if (isAdmonitionContainer) {
        return extractCodeBlocksFromAdmonition(blockLines);
      }

      return extractCodeBlocksFromSection(blockLines);
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

  private convertHTMLCollectionToArray(elements: HTMLCollection, excludeCmdOutput = false) {
    const result: Element[] = [];
    for (let i = 0; i < elements.length; i++) {
      const children = Array.from(elements[i].children);
      if (excludeCmdOutput) {
        result.push(...children.filter(child => !child.classList.contains('codeblock-customizer-cmdoutput-line')));
      } else {
        result.push(...children);
      }
    }
    return result;
  }// convertHTMLCollectionToArray
}// CodeBlockRenderer
