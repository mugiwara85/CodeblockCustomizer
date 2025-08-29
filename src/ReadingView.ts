import { MarkdownView, MarkdownPostProcessorContext, setIcon, MarkdownSectionInformation, MarkdownRenderer, loadPrism, Notice } from "obsidian";

import { getLanguageIcon, createContainer, createCodeblockLang, createCodeblockIcon, createFileName, createCodeblockCollapse, getCurrentMode, getBorderColorByLanguage, removeCharFromStart, createUncollapseCodeButton, addTextToClipboard, getLanguageSpecificColorClass, CBCParameters, getAllParameters, getPropertyFromLanguageSpecificColors, getLanguageConfig, getFileCacheAndContentLines, getDisplayLanguageName, getInlineCodeIcon } from "./Utils";
import { TooltipManager } from "./TooltipManager";
import { PromptManager } from "./PromptManager";
import CodeBlockCustomizerPlugin from "./main";
import { CodeblockCustomizerSettings, FoldingPersistence, FoldingScope, InlineCodeModifierKeys, ThemeSettings } from "./Settings";
import { ANNOTATION_PATTERN, fadeOutLineCount, INLINE_CODE_LANG_REGEX, rhombusSVG } from "./Const";
import { FoldCommand, FoldingState } from "./EditorExtensions";

interface IndentationInfo {
  indentationLevels: number;
  insertCollapse: boolean;
}

export async function ReadingView(codeBlockElement: HTMLElement, context: MarkdownPostProcessorContext, plugin: CodeBlockCustomizerPlugin) {
  const codeElm: HTMLElement | null = codeBlockElement.querySelector('pre > code');
  if (!codeElm) 
    return;

  /*if (Array.from(codeElm.classList).some(className => /^language-\S+/.test(className)))
  while(!codeElm.classList.contains("is-loaded"))
    await sleep(2);*/

  const preElements: Array<HTMLElement> = await getPreElements(codeBlockElement);
  if (!preElements)
    return;

  const codeBlockSectionInfo = context.getSectionInfo(codeElm);
  if (!codeBlockSectionInfo) {
    // PDF export
    let id: string | null = null;
    if (codeBlockElement.parentElement?.classList.contains("internal-embed")) {
      const src = codeBlockElement.parentElement?.getAttribute("src");
      if (src) {
        const indexOfCaret = src.indexOf("^");
        if (indexOfCaret !== -1) {
          id = src.substring(indexOfCaret + 1);
        }
      }
    }
    handlePDFExport(preElements, context, plugin, id);
    return;
  }

  let fileContentLines: string[];
  const initialLines = codeBlockSectionInfo.text.split('\n');
  const allInitialLinesUndefined = initialLines.slice(codeBlockSectionInfo.lineStart, codeBlockSectionInfo.lineEnd + 1).every(line => line === undefined);

  if (initialLines.length <= 1 || allInitialLinesUndefined) {
    console.warn("Line data is insufficient or invalid. Falling back to getFileCacheAndContentLines.");
    const { cache, fileContentLines: fallbackLines } = await getFileCacheAndContentLines(plugin, context.sourcePath);
    
    if (!cache || !fallbackLines) {
      console.error(`Fallback failed: Could not get file cache or content for ${context.sourcePath}`);
      return;
    }
    fileContentLines = fallbackLines;
  } else {
    fileContentLines = initialLines;
  }

  const codeblockLines = fileContentLines.slice(codeBlockSectionInfo.lineStart, codeBlockSectionInfo.lineEnd + 1);
  const codeBlockFirstLines = getCodeBlocksFirstLines(codeblockLines);

  let charPos = 0;
  for (let i = 0; i < codeBlockSectionInfo.lineStart; i++) {
    if (typeof fileContentLines[i] !== 'string') {
      console.error(`Inconsistent data for file ${context.sourcePath}. Could not calculate character position.`);
      charPos = -1;
      break;
    }
    charPos += fileContentLines[i].length + 1; // +1 for the newline character
  }

  const validCharPos = charPos !== -1 ? charPos : undefined;

  await processCodeBlockFirstLines(preElements, codeBlockFirstLines, codeblockLines, context, plugin, codeBlockSectionInfo, validCharPos);
}// ReadingView

async function addCustomSyntaxHighlight(codeblockLines: string[], language: string) {
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

async function getPreElements(element: HTMLElement) {
  const preElements: Array<HTMLElement> = Array.from(element.querySelectorAll("pre:not(.frontmatter)"));
  return preElements;
}// getPreElements

function trackIndentation(lines: string[]): IndentationInfo[] {
  const result: IndentationInfo[] = [];
  for (let i = 0; i < lines.length; i++) {
    const currentLineIsBlank = lines[i].trim() === '';
    let currentLevel = getIndentLevel(lines[i]);
    
    let nextNonBlankLineLevel = -1; 
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== '') {
        nextNonBlankLineLevel = getIndentLevel(lines[j]);
        break; 
      }
    }
    
    if (currentLineIsBlank && nextNonBlankLineLevel > 0) {
      currentLevel = nextNonBlankLineLevel;
    }

    const nextLevel = (nextNonBlankLineLevel !== -1) ? nextNonBlankLineLevel : 0;

    result.push({
      indentationLevels: currentLevel,
      insertCollapse: !currentLineIsBlank && nextLevel > currentLevel
    });
  }
  return result;
}// trackIndentation

function getIndentLevel(line: string, tabSize = 4): number {
  const match = line.match(/^(\s*)/);
  if (!match) {
    return 0;
  }

  const whitespace = match[1];
  let totalWidth = 0;

  for (const char of whitespace) {
    if (char === '\t') {
      totalWidth += tabSize;
    } else {
      totalWidth += 1;
    }
  }
  
  return Math.floor(totalWidth / tabSize);
}// getIndentLevel

export async function calloutPostProcessor(codeBlockElement: HTMLElement, context: MarkdownPostProcessorContext, plugin: CodeBlockCustomizerPlugin) {
  // this only handles callouts in editing mode, because in reading mode callouts are styled by default
  const callouts: HTMLElement | null = codeBlockElement.querySelector('.callout:not(.admonition)');
  if (!callouts) 
    return;

  const calloutPreElements: Array<HTMLElement> = Array.from(callouts.querySelectorAll('pre:not(.frontmatter)'));
  if (!calloutPreElements)
    return;

  const markdownView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  const viewMode = markdownView?.getMode();

  if (viewMode === "source") {
    const foundCmView = await waitForCmView(context);
    if (!foundCmView)
      return;

    // @ts-ignore
    const calloutText = context?.containerEl?.cmView?.widget?.text?.split("\n") || null;
    let codeBlockFirstLines: string[] = [];
    codeBlockFirstLines = getCallouts(calloutText);
    await processCodeBlockFirstLines(calloutPreElements, codeBlockFirstLines, [], context, plugin);
  }
}// calloutPostProcessor

export async function admonitionPostProcessor(containerElement: HTMLElement, context: MarkdownPostProcessorContext, plugin: CodeBlockCustomizerPlugin) {
  const admonition = containerElement.closest('.admonition');
  if (!admonition || (admonition as HTMLElement).dataset.cbcAdmonitionProcessed) {
    return;
  }

  const { fileContentLines } = await getFileCacheAndContentLines(plugin, context.sourcePath);
  if (!fileContentLines) {
    return;
  }

  const availableBlocks = [...getCodeBlocksWithContent(fileContentLines)];
  const preElements = Array.from(admonition.querySelectorAll('pre:not(.frontmatter):not(.codeblock-customizer-pre)'));

  for (const preElement of preElements) {
    let domLanguage = '';
    const langClass = Array.from(preElement.classList).find(cls => cls.startsWith('language-'));
    if (langClass) {
      domLanguage = langClass.replace('language-', '');
    }

    const domText = (preElement as HTMLElement).textContent?.trim();
    if (!domText) {
      continue;
    }

    const matchIndex = availableBlocks.findIndex(block => {
      const sourceParams = getAllParameters(block.firstLine, plugin.settings);
      const sourceLanguage = sourceParams.language;
      const sourceText = block.content.slice(1, -1).join('\n').trim();
      return sourceText === domText && sourceLanguage === domLanguage;
    });
    
    if (matchIndex !== -1) {
      const matchingBlockData = availableBlocks[matchIndex];
      availableBlocks.splice(matchIndex, 1);
      const { firstLine, content, startLine } = matchingBlockData;

      if (getAllParameters(firstLine, plugin.settings).exclude) {
        continue;
      }

      await processCodeBlockFirstLines([preElement as HTMLElement], [firstLine], content, context, plugin, { lineStart: startLine, lineEnd: startLine + content.length - 1 } as MarkdownSectionInformation);
    }
  }

  (admonition as HTMLElement).dataset.cbcAdmonitionProcessed = 'true';
}// admonitionPostProcessor

function getCodeBlocksWithContent(lines: string[]): { startLine: number, firstLine: string, content: string[] }[] {
  const results = [];
  const stack: {
    type: 'admonition' | 'codeblock';
    fenceChar: '`' | '~';
    fenceCount: number;
    startLine: number;
    firstLine: string;
  }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith(">")) {
      continue;
    }

    const fenceMatch = trimmedLine.match(/^(?:`|~){3,}/);
    if (!fenceMatch) {
      continue;
    }

    const fence = fenceMatch[0];
    const char = fence[0] as '`' | '~';
    const count = fence.length;
    const lineContentAfterFence = trimmedLine.substring(count).trim();
    const currentContext = stack.length > 0 ? stack[stack.length - 1] : null;

    if (currentContext && char === currentContext.fenceChar && count === currentContext.fenceCount) {
      const closedBlock = stack.pop();
      if (closedBlock && closedBlock.type === 'codeblock') {
        const blockContent = lines.slice(closedBlock.startLine, i + 1);
        results.push({
          startLine: closedBlock.startLine,
          firstLine: closedBlock.firstLine,
          content: blockContent,
        });
      }
    } else {
      if (lineContentAfterFence.startsWith('ad-')) {
        stack.push({ type: 'admonition', fenceChar: char, fenceCount: count, startLine: i, firstLine: line });
      } else if (currentContext && currentContext.type === 'admonition') {
        stack.push({ type: 'codeblock', fenceChar: char, fenceCount: count, startLine: i, firstLine: line });
      }
    }
  }

  return results;
}// getCodeBlocksWithContent

async function waitForCmView(context: MarkdownPostProcessorContext, maxRetries = 25, delay = 2): Promise<boolean> {
  // @ts-ignore
  if (context?.containerEl?.cmView)
    return true;

  let retries = 0;
  // @ts-ignore
  while (!context?.containerEl?.cmView) {
    if (retries >= maxRetries) {
      return false;
    }
    retries++;
    await sleep(delay);
  }
  return true;
}// waitForCmView

async function checkCustomSyntaxHighlight(parameters: CBCParameters, codeblockLines: string[], preCodeElm: HTMLElement, plugin: CodeBlockCustomizerPlugin ){
  const customLangConfig = getLanguageConfig(parameters.language, plugin);
  const customFormat = customLangConfig?.format ?? undefined;
  if (customFormat){
    const highlightedLines = await addCustomSyntaxHighlight(codeblockLines, customFormat);
    if (highlightedLines.length > 0){
      preCodeElm.innerHTML = highlightedLines;
    }
  }
}// checkCustomSyntaxHighlight

async function processCodeBlockFirstLines(preElements: HTMLElement[], codeBlockFirstLines: string[], codeblockLines: string[], context: MarkdownPostProcessorContext, plugin: CodeBlockCustomizerPlugin, sectionInfo?: MarkdownSectionInformation, charPos?: number) {
  if (preElements.length !== codeBlockFirstLines.length)
    return;

  for (const [key, preElement] of preElements.entries()) {
    const isRerenderQueued = sectionInfo && plugin.rerenderQueue.has(sectionInfo.lineStart);

    if (preElement.classList.contains('codeblock-customizer-pre') && !isRerenderQueued) {
      continue;
    }

    let codeBlockFirstLine = codeBlockFirstLines[key];
    const preCodeElm = preElement.querySelector('code');
    if (!preCodeElm) {
      continue;
    }

    if (Array.from(preCodeElm.classList).some(className => /^language-\S+/.test(className)))
      while(!preCodeElm.classList.contains("is-loaded"))
        await sleep(2);

    let indentationLevels: IndentationInfo[] | null = null;
    if (preCodeElm.textContent) {
      const codeLines = preCodeElm.textContent.split('\n');
      if (codeLines.length > 0 && codeLines[codeLines.length - 1] === '') {
        codeLines.pop();
      }
      indentationLevels = trackIndentation(codeLines);
    }

    const lineStart = sectionInfo?.lineStart;
    let isParameterRerender = false;

    if (lineStart !== undefined) {
      const override = plugin.rerenderQueue.get(lineStart);
      if (override) {
        isParameterRerender = true;
        codeBlockFirstLine = override.content;
        const newCount = override.count - 1;

        if (newCount > 0) {
          plugin.rerenderQueue.set(lineStart, { content: override.content, count: newCount });
        } else {
          plugin.rerenderQueue.delete(lineStart);
        }
      }
    }

    const parameters = getAllParameters(codeBlockFirstLine, plugin.settings);
    if (parameters.exclude)
      continue;

    if (parameters.group && parameters.group.length > 0) {
      preElement.setAttribute('groupname', parameters.group);
      preElement.setAttribute('sourcepath', context.sourcePath);
      const paramsJsonString = JSON.stringify(parameters);
      preElement.dataset.parameters = paramsJsonString;
      preElement.classList.add('codeblock-customizer-grouped');
      if (charPos !== undefined && charPos !== -1) {
        preElement.dataset.charPos = String(charPos);
      }
    }

    await checkCustomSyntaxHighlight(parameters, codeblockLines, preCodeElm, plugin);

    const codeblockLanguageSpecificClass = getLanguageSpecificColorClass(parameters.language, plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors);
    await addClasses(preElement, parameters, codeblockLines, plugin, preCodeElm, indentationLevels, codeblockLanguageSpecificClass, context.sourcePath, sectionInfo, charPos, isParameterRerender);
  }
}// processCodeBlockFirstLines

async function addClasses(preElement: HTMLElement, parameters: CBCParameters, codeblockLines: string[], plugin: CodeBlockCustomizerPlugin, preCodeElm: HTMLElement, indentationLevels: IndentationInfo[] | null, codeblockLanguageSpecificClass: string, sourcePath: string, sectionInfo?: MarkdownSectionInformation, charPos?: number, isParameterRerender = false, isPrinting = false) {
  const frag = document.createDocumentFragment();
  
  preElement.classList.add(`codeblock-customizer-pre`);  
  preElement.classList.add(`codeblock-customizer-language-` + (parameters.language.length > 0 ? parameters.language.toLowerCase() : "nolang"));

  if (codeblockLanguageSpecificClass) {
    preElement.classList.add(codeblockLanguageSpecificClass);
  }

  if (preElement.parentElement) {
    preElement.parentElement.classList.add(`codeblock-customizer-pre-parent`);
  }

  // remove old header and buttons to prevent duplication during re-render
  preElement.querySelector(".codeblock-customizer-header-container")?.remove();
  preElement.querySelector(".codeblock-customizer-header-container-specific")?.remove();
  preElement.querySelector(".codeblock-customizer-button-container")?.remove();

  const header = HeaderWidget(preElement as HTMLPreElement, parameters, plugin.settings, sourcePath, plugin, sectionInfo, charPos);
  const buttons = createButtons(parameters, codeblockLines, plugin);
  
  if (parameters.specificHeader || !isPrinting) {
    frag.appendChild(header);
  }
  frag.appendChild(buttons);
	
  preElement.insertBefore(frag, preElement.firstChild);

  if (isPrinting && plugin.settings.SelectedTheme.settings.printing.avoidPageBreaks) {
    if (preElement.parentElement) {
      preElement.parentElement.style.breakInside = 'avoid';
    }
  }

  const lines = Array.from(preCodeElm.innerHTML.split('\n')) || 0;
  const lineCount = lines.length > 0 ? lines.length - 1 : 0;
  const keyToUse = charPos ?? sectionInfo?.lineStart;
  const settings = plugin.settings.SelectedTheme.settings;
  let rememberedState: FoldingState | undefined;
  
  if (settings.codeblock.folding.rememberFoldState && keyToUse !== undefined) {
    if (settings.codeblock.folding.persistence === FoldingPersistence.Permanent) {
      const rememberedFolds = plugin.loadPermanentReadingViewFolds(sourcePath);
      rememberedState = rememberedFolds.get(keyToUse);
    } else { 
      // session
      const rememberedFolds = plugin.activeReadingViewFolds.get(sourcePath);
      rememberedState = rememberedFolds ? rememberedFolds.get(keyToUse) : undefined;
    }
  }

  let shouldFold = false;
  let useSemiFold = false;
  const globalCommand = plugin.foldCommandTrigger;

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
        shouldFold = parameters.fold || (inverseFold && !parameters.unfold);
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
	
  const borderColor = getBorderColorByLanguage(parameters.language, getPropertyFromLanguageSpecificColors("codeblock.borderColor", plugin.settings));
  if (borderColor.length > 0)
    preElement.classList.add(`hasLangBorderColor`);

  await highlightLines(preCodeElm, codeblockLines, parameters, indentationLevels, sourcePath, plugin, isParameterRerender, isPrinting);
}// addClasses

function createCopyButton(displayLanguage: string) {
  const container = document.createElement("button");
  container.classList.add(`codeblock-customizer-copy-code-button`);
  container.setAttribute("aria-label", "Copy code");

  if (displayLanguage) {
    if (displayLanguage)
      container.setText(displayLanguage);
    else
      setIcon(container, "copy");
  } else
    setIcon(container, "copy");

  return container;
}// createCopyButton

export function createButtons(parameters: CBCParameters, codeblockLines: string[] | undefined, plugin: CodeBlockCustomizerPlugin, targetPreElement?: HTMLElement){
  const container = createDiv({cls: `codeblock-customizer-button-container`});
  const frag = document.createDocumentFragment();

  const copyButton = createCopyButton(parameters.displayLanguage);
    copyButton.addEventListener("click", (event) => {
    const preEl = targetPreElement || (event.currentTarget as HTMLElement).parentNode?.parentNode as HTMLElement;
    if (preEl) {
      copyCode(preEl, event, plugin, codeblockLines);
    }
  });
  frag.appendChild(copyButton);

  const wrapCodeButton = createWrapCodeButton();
    wrapCodeButton.addEventListener("click", (event) => {
    const preEl = targetPreElement || (event.currentTarget as HTMLElement).parentNode?.parentNode as HTMLElement;
    if (preEl) {
      wrapCode(preEl, event);
    }
  });
  frag.appendChild(wrapCodeButton);

  container.appendChild(frag);
  return container;
}// createButtons

function createWrapCodeButton() {
  const container = document.createElement("button");
  container.classList.add(`codeblock-customizer-wrap-code`);
  container.setAttribute("aria-label", "Wrap/Unwrap code");
  setIcon(container, "wrap-text");

  return container;
}// createWrapCodeButton

function copyCode(preElement: HTMLElement, event: Event, plugin: CodeBlockCustomizerPlugin, codeblockLines?: string[]) {
  event.stopPropagation();

  if (!preElement){
    return;
  }

  const settings = plugin.settings.SelectedTheme.settings;
  const includePrompts = settings.prompts.includePromptsInCopy;
  const excludeAnnotations = settings.annotations.excludeAnnotationsFromCopy;
  
  const codeTextArray: string[] = [];
  const allLineElements = preElement.querySelectorAll<HTMLElement>("div[data-line-number]");

  allLineElements.forEach(lineEl => {
    const commandLineParts: string[] = [];

    if (includePrompts) {
      const promptEl = lineEl.querySelector<HTMLElement>('[class*="codeblock-customizer-prompt-"]');
      if (promptEl) {
        commandLineParts.push(promptEl.textContent ?? "");
      }
    }

    const commandTextEl = lineEl.querySelector<HTMLElement>('.codeblock-customizer-line-text:not(.codeblock-customizer-prompt-cmd-output)');
    if (commandTextEl) {
      commandLineParts.push(commandTextEl.textContent ?? "");
    }
    
    let commandLine = commandLineParts.join("");

    if (!excludeAnnotations) {
      const annotationEl = lineEl.querySelector<HTMLElement>('.codeblock-customizer-annotation-source-comment');
      const annotationText = annotationEl?.dataset.cbcComment;
      if (annotationText) {
        commandLine += ` ${annotationText}`;
      }
    }

    codeTextArray.push(commandLine);

    if (includePrompts) {
      const outputElements = lineEl.querySelectorAll<HTMLElement>('.codeblock-customizer-prompt-cmd-output');
      outputElements.forEach(outputEl => {
        codeTextArray.push(outputEl.textContent ?? "");
      });
    }
  });

  const getLeadingWhitespace = (s: string) => s.match(/^\s*/)?.[0] || '';
  const nonEmtpyLines = codeTextArray.filter(line => line.trim() !== '');
  
  if (nonEmtpyLines.length > 0) {
    const minIndentLength = Math.min( ...nonEmtpyLines.map(line => getLeadingWhitespace(line).length));

    if (minIndentLength > 0) {
      const processedLines = codeTextArray.map(line => line.substring(minIndentLength));
      const codeText = processedLines.join('\n');
      addTextToClipboard(codeText);
      return;
    }
  }

  const codeText = codeTextArray.join('\n');

  addTextToClipboard(codeText);
}// copyCode

function wrapCode(preElement: HTMLElement, event: Event) {
  event.stopPropagation();

  if (!preElement)
    return;

  const codeElement = preElement.querySelector('code');
  if (!codeElement)
    return;

  let wrapState = '';
  const currentWhiteSpace = window.getComputedStyle(codeElement).whiteSpace;
  if (currentWhiteSpace === 'pre') {
    wrapState = 'pre-wrap';
    new Notice("Code wrapped");
  } else {
    wrapState = 'pre';
    new Notice("Code unwrapped");
  }

  codeElement.style.setProperty("white-space", wrapState, "important");

}// wrapCode

async function handlePDFExport(preElements: Array<HTMLElement>, context: MarkdownPostProcessorContext, plugin: CodeBlockCustomizerPlugin, id: string | null) {
  const { cache, fileContentLines } = await getFileCacheAndContentLines(plugin, context.sourcePath);
  if (!cache || !fileContentLines) {
    return;
  }

  const allBlocks = extractCodeBlockData(fileContentLines);

  const filteredPreElements = preElements.filter(pre => {
    const codeElement = pre.querySelector("code");
    if (!codeElement) {
      return true;
    }
    const isAdmonitionContainer = Array.from(codeElement.classList).some(cls => cls.startsWith('language-ad-'));
    return !isAdmonitionContainer;
  });

  const codeBlocksToProcess = allBlocks.filter(block => {
    const language = block.firstLine.replace(/^(?:`|~){3,}/, '').trim().split(' ')[0];
    return !language.startsWith('ad-');
  });
  
  if (filteredPreElements.length !== codeBlocksToProcess.length) {
    return;
  }

  try {
    if (plugin.settings.SelectedTheme.settings.printing.enablePrintToPDFStyling) {
      for (let i = 0; i < codeBlocksToProcess.length; i++) {
        const blockData = codeBlocksToProcess[i];
        const preElement = filteredPreElements[i];
        
        await addPrintStyling([preElement], plugin, [blockData.firstLine], context.sourcePath, blockData.contentLines);
      }
    }
  } catch (error) {
    console.error(`Error exporting to PDF: ${error.message}`);
    return;
  }
  return;
}// handlePDFExport

function HeaderWidget(preElements: HTMLPreElement, parameters: CBCParameters, settings: CodeblockCustomizerSettings, sourcePath: string, plugin: CodeBlockCustomizerPlugin, sectionInfo?: MarkdownSectionInformation, charPos?: number) {
  const codeblockLanguageSpecificClass = getLanguageSpecificColorClass(parameters.language, settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors);
  const container = createContainer(parameters.specificHeader, parameters.language, false, codeblockLanguageSpecificClass); // hasLangBorderColor must be always false in reading mode, because how the doc is generated
  const frag = document.createDocumentFragment();

  if (parameters.displayLanguage){
    const Icon = getLanguageIcon(parameters.displayLanguage)
    if (Icon) {
      frag.appendChild(createCodeblockIcon(parameters.displayLanguage));
    }
    frag.appendChild(createCodeblockLang(parameters.language));
  }
  frag.appendChild(createFileName(parameters.headerDisplayText, settings.SelectedTheme.settings.codeblock.enableLinks, sourcePath, plugin));

  const collapseEl = createCodeblockCollapse(parameters.fold);
  if ((plugin.settings.SelectedTheme.settings.header.disableFoldUnlessSpecified && !plugin.settings.SelectedTheme.settings.codeblock.folding.inverseFold && !parameters.fold) ||
      (plugin.settings.SelectedTheme.settings.header.disableFoldUnlessSpecified && plugin.settings.SelectedTheme.settings.codeblock.folding.inverseFold && !parameters.unfold)) {
    container.classList.add(`noCollapseIcon`);
  } else {
    frag.appendChild(collapseEl);
  }
  
  container.appendChild(frag);
  
  const semiFold = settings.SelectedTheme.settings.semiFold.enableSemiFold;
  const visibleLines = settings.SelectedTheme.settings.semiFold.visibleLines;

  container.addEventListener("click", function() {
    //collapseEl.innerText = preElements.classList.contains(`codeblock-customizer-codeblock-collapsed`) ? "-" : "+";
    if ((plugin.settings.SelectedTheme.settings.header.disableFoldUnlessSpecified && !plugin.settings.SelectedTheme.settings.codeblock.folding.inverseFold && !parameters.fold) ||
        (plugin.settings.SelectedTheme.settings.header.disableFoldUnlessSpecified && plugin.settings.SelectedTheme.settings.codeblock.folding.inverseFold && !parameters.unfold)) {
      return;
    }

    const codeElements = preElements.getElementsByTagName("CODE");
    const lines = convertHTMLCollectionToArray(codeElements, true);
    const canSemiFold = lines.length >= visibleLines + fadeOutLineCount;
    const useSemiFold = semiFold && canSemiFold;

    const isCollapsed = preElements.classList.contains(`codeblock-customizer-codeblock-collapsed`);
    const isSemiCollapsed = preElements.classList.contains(`codeblock-customizer-codeblock-semi-collapsed`);

    let newState: FoldingState;
    if (isCollapsed || isSemiCollapsed) {
      toggleFold(preElements, collapseEl, isSemiCollapsed ? `codeblock-customizer-codeblock-semi-collapsed` : `codeblock-customizer-codeblock-collapsed`);
      newState = FoldingState.Unfolded;
    } else {
      toggleFold(preElements, collapseEl, useSemiFold ? `codeblock-customizer-codeblock-semi-collapsed` : `codeblock-customizer-codeblock-collapsed`);
      newState = useSemiFold ? FoldingState.SemiFolded : FoldingState.FullyFolded;
    }

    if (sectionInfo) {
      const foldSettings = plugin.settings.SelectedTheme.settings.codeblock.folding;
      const shouldRemember = foldSettings.scope === FoldingScope.All || (foldSettings.scope === FoldingScope.NoFoldSpecified && !parameters.fold && !parameters.unfold);
      if (shouldRemember) {
        const keyToUse = charPos ?? sectionInfo.lineStart;
        plugin.setFoldState(sourcePath, keyToUse, newState, 'reading', parameters, lines.length);
      }
    }
  });

  return container
}// HeaderWidget

function createLineNumberElement(lineNumber: number, showNumbers: string) {
  const lineNumberWrapper = createDiv();
  if (showNumbers === "specific")
    lineNumberWrapper.classList.add(`codeblock-customizer-line-number-specific`);
  else if (showNumbers === "hide")
    lineNumberWrapper.classList.add(`codeblock-customizer-line-number-hide`);
  else 
    lineNumberWrapper.classList.add(`codeblock-customizer-line-number`);
  
  const lineNumberElement = createSpan({cls : `codeblock-customizer-line-number-element`});
  lineNumberElement.setText(lineNumber === -1 ? '' : lineNumber.toString());
    
  lineNumberWrapper.appendChild(lineNumberElement);

  return lineNumberWrapper;
}// createLineNumberElement

function addIndentLine(inputString: string, insertCollapse = false, logicalIndentLevel = 0): string {
  const indentRegex = /^((?:<span[^>]*>)*)(?:\t+|( {4})*)/; 
  const match = inputString.match(indentRegex);
  
  if (!match) {
    return inputString;
  }
  
  const leadingTags = match[1] || '';
  const indent = match[0].replace(leadingTags, '');
  const isTabIndentation = /\t/.test(indent);
  let numIndentCharacters = isTabIndentation ? (indent.match(/\t/g) || []).length : (indent.match(/ {4}/g) || []).length;
  
  if (numIndentCharacters === 0 && logicalIndentLevel > 0) {
    numIndentCharacters = logicalIndentLevel;
  }

  const indentSpan = `<span class="codeblock-customizer-indentation-guide">${isTabIndentation ? "\t" : "    "}</span>`;
  const spansArray = Array(numIndentCharacters).fill(indentSpan);

  if (insertCollapse) {
    const iconSpan = `<span class="codeblock-customizer-collapse-icon"></span>`;
    const indicator = `<span class="codeblock-customizer-collapse-indicator">${iconSpan}</span>`;

    if (spansArray.length > 0) {
      const lastIndex = spansArray.length - 1;
      spansArray[lastIndex] = spansArray[lastIndex] + indicator;
    } else {
      spansArray.push(indicator);
    }
  }

  const finalSpans = spansArray.join('');
  const finalReplacement = leadingTags + finalSpans;
  
  return inputString.replace(indentRegex, finalReplacement);
}// addIndentLine

function extractLinesFromHTML(container: HTMLElement): { htmlLines: string[]; textLines: string[] } {
  const lines: string[] = [''];
  const openTags: HTMLElement[] = [];

  const escapeHtml = (text: string): string => {
    const p = document.createElement('p');
    p.appendChild(document.createTextNode(text));
    return p.innerHTML;
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName.toLowerCase() === 'br') {
      for (let j = openTags.length - 1; j >= 0; j--) {
        lines[lines.length - 1] += `</${openTags[j].tagName.toLowerCase()}>`;
      }
      
      lines.push('');

      for (let j = 0; j < openTags.length; j++) {
        const attrs = Array.from(openTags[j].attributes).map(attr => `${attr.name}="${attr.value}"`).join(' ');
        lines[lines.length - 1] += `<${openTags[j].tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>`;
      }
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const parts = (node.textContent ?? '').split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) {
          lines[lines.length - 1] += escapeHtml(parts[i]);
        }
        if (i < parts.length - 1) {
          for (let j = openTags.length - 1; j >= 0; j--) {
            lines[lines.length - 1] += `</${openTags[j].tagName.toLowerCase()}>`;
          }
          lines.push('');
          for (let j = 0; j < openTags.length; j++) {
            const attrs = Array.from(openTags[j].attributes).map(attr => `${attr.name}="${attr.value}"`).join(' ');
            lines[lines.length - 1] += `<${openTags[j].tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>`;
          }
        }
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const attrs = Array.from(el.attributes).map(attr => `${attr.name}="${attr.value}"`).join(' ');
      const openingTag = `<${el.tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>`;
      
      lines[lines.length - 1] += openingTag;
      openTags.push(el);
      el.childNodes.forEach(walk);
      openTags.pop();
      lines[lines.length - 1] += `</${el.tagName.toLowerCase()}>`;
    }
  };

  container.childNodes.forEach(walk);

  let finalHtmlLines = lines;
  let finalTextLines = container.textContent?.split('\n') ?? [];

  if (finalHtmlLines.length === 1 && container.textContent?.trim() === '') {
    finalHtmlLines = ['', ''];
    finalTextLines = ['', ''];
  } else if (finalHtmlLines.length === 1) {
    finalHtmlLines.push('');
    finalTextLines.push('');
  }

  container.innerHTML = "";

  return { htmlLines: finalHtmlLines, textLines: finalTextLines };
}// extractLinesFromHTML

function isLineHighlighted(lineNumber: number, caseInsensitiveLineText: string, parameters: CBCParameters) {
  const result = {
    isHighlighted: false,
    color: ''
  };

  // Highlight by line number hl:1,3-5
  const isHighlightedByLineNumber = parameters.defaultLinesToHighlight.lineNumbers.includes(lineNumber + parameters.lineNumberOffset);
  
  // Highlight every line which contains a specific word hl:test
  let isHighlightedByWord = false;
  const words = parameters.defaultLinesToHighlight.words;
  if (words.length > 0 && words.some(word => caseInsensitiveLineText.includes(word))) {
    isHighlightedByWord = true;
  }

  // Highlight specific lines if they contain the specified word hl:1|test,3-5|test
  let isHighlightedByLineSpecificWord = false;
  const lineSpecificWords = parameters.defaultLinesToHighlight.lineSpecificWords;
  if (lineSpecificWords.length > 0) {
    lineSpecificWords.forEach(lsWord => {
      if (lsWord.lineNumber === lineNumber && lsWord.words.some(word => caseInsensitiveLineText.includes(word))) {
        isHighlightedByLineSpecificWord = true;
      }
    });
  }

  // Highlight line by line number imp:1,3-5
  const altHLMatch = parameters.alternativeLinesToHighlight.lines.filter((hl) => hl.lineNumbers.includes(lineNumber + parameters.lineNumberOffset));

  // Highlight every line which contains a specific word imp:test
  let isAlternativeHighlightedByWord = false;
  let isAlternativeHighlightedByWordColor = '';
  const altwords = parameters.alternativeLinesToHighlight.words;
  if (altwords.length > 0 && altwords.some(altwordObj => altwordObj.words.some(word => caseInsensitiveLineText.includes(word.toLowerCase())))) {
    altwords.forEach(altwordObj => {
      if (altwordObj.words.some(word => caseInsensitiveLineText.includes(word.toLowerCase()))) {
        isAlternativeHighlightedByWord = true;
        isAlternativeHighlightedByWordColor = altwordObj.colorName;
      }
    });
  }

  // Highlight specific lines if they contain the specified word imp:1|test,3-5|test
  let isAlternativeHighlightedByLineSpecificWord = false;
  let isAlternativeHighlightedByLineSpecificWordColor = '';
  const altLineSpecificWords = parameters.alternativeLinesToHighlight.lineSpecificWords;
  if (altLineSpecificWords.length > 0) {
    altLineSpecificWords.forEach(lsWord => {
      if (lsWord.lineNumber === lineNumber && lsWord.words.some(word => caseInsensitiveLineText.includes(word))) {
        isAlternativeHighlightedByLineSpecificWord = true;
        isAlternativeHighlightedByLineSpecificWordColor = lsWord.colorName;
      }
    });
  }

  // Determine final highlight status and color
  if (isHighlightedByLineNumber || isHighlightedByWord || isHighlightedByLineSpecificWord) {
    result.isHighlighted = true;
  } else if (altHLMatch.length > 0) {
    result.isHighlighted = true;
    result.color = altHLMatch[0].colorName;
  } else if (isAlternativeHighlightedByWord) {
    result.isHighlighted = true;
    result.color = isAlternativeHighlightedByWordColor;
  } else if (isAlternativeHighlightedByLineSpecificWord) {
    result.isHighlighted = true;
    result.color = isAlternativeHighlightedByLineSpecificWordColor;
  }

  return result;
}// isLineHighlighted

function getHighlightedLineHtml(lineHtml: string, parameters: CBCParameters, lineNumber: number): string {
  const applyHighlightsToString = (html: string, rules: { from?: string; to?: string; words?: string[]; all?: boolean; className: string }[]): string => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    const highlightRangesInNode = (node: Node, ranges: { start: number, end: number }[], className: string): void => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
      const textNodes: Text[] = [];
      while (walker.nextNode()) {
        let parent = walker.currentNode.parentElement;
        let alreadyStyled = false;
        while (parent && parent !== node) {
          if (parent.classList.contains(className)) {
            alreadyStyled = true;
            break;
          }
          parent = parent.parentElement;
        }
        if (!alreadyStyled) {
          textNodes.push(walker.currentNode as Text);
        }
      }

      let textOffset = 0;
      let rangeIndex = 0;

      for (const currentNode of textNodes) {
        if (rangeIndex >= ranges.length) break;

        const parent = currentNode.parentNode;
        if (!parent) 
          continue;

        const nodeText = currentNode.textContent || '';
        const nodeLength = nodeText.length;
        let lastIndex = 0;
        const fragment = document.createDocumentFragment();

        while (rangeIndex < ranges.length) {
          const range = ranges[rangeIndex];
          if (range.end <= textOffset) {
            rangeIndex++;
            continue;
          }
          if (range.start >= textOffset + nodeLength) {
            break;
          }
          
          const localStart = Math.max(0, range.start - textOffset);
          const localEnd = Math.min(nodeLength, range.end - textOffset);

          if (localStart > lastIndex) {
            fragment.appendChild(document.createTextNode(nodeText.substring(lastIndex, localStart)));
          }
          if (localEnd > localStart) {
            const span = document.createElement('span');
            span.className = className;
            span.appendChild(document.createTextNode(nodeText.substring(localStart, localEnd)));
            fragment.appendChild(span);
          }
          
          lastIndex = localEnd;

          if (range.end <= textOffset + nodeLength) {
            rangeIndex++;
          } else {
            break;
          }
        }

        if (lastIndex < nodeLength) {
          fragment.appendChild(document.createTextNode(nodeText.substring(lastIndex)));
        }
        if (fragment.childNodes.length > 0) {
          parent.replaceChild(fragment, currentNode);
        }
        textOffset += nodeLength;
      }
    };

    for (const rule of rules) {
      let ranges: { start: number, end: number }[] = [];
      const currentText = tempDiv.textContent || '';

      if (rule.words) {
        const escapeRegex = (str: string) => str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        for (const word of rule.words) {
          if (!word) 
            continue;

          const regex = new RegExp(escapeRegex(word), 'gi');
          let match;
          while ((match = regex.exec(currentText)) !== null) {
            ranges.push({ start: match.index, end: match.index + match[0].length });
          }
        }
      } else { // from:to and all
        ranges = findHighlightRanges(currentText, rule.from ?? '', rule.to ?? '');
      }

      if (ranges.length > 0) {
        highlightRangesInNode(tempDiv, ranges, rule.className);
      }
    }

    return tempDiv.innerHTML;
  };

  const rulesToApply: { from?: string; to?: string; words?: string[]; all?: boolean; className: string }[] = [];

  const addRule = (details: { from?: string; to?: string; words?: string[]; all?: boolean }, colorName = '') => {
    rulesToApply.push({ ...details, className: colorName ? `codeblock-customizer-highlighted-text-${colorName}` : 'codeblock-customizer-highlighted-text' });
  };
  
  if (parameters.defaultTextToHighlight.words.length > 0) addRule({ words: parameters.defaultTextToHighlight.words });
  parameters.defaultTextToHighlight.lineSpecificWords.forEach(r => { if (r.lineNumber === lineNumber) addRule({ words: r.words }); });
  parameters.defaultTextToHighlight.textBetween.forEach(r => addRule({ from: r.from, to: r.to }));
  parameters.defaultTextToHighlight.lineSpecificTextBetween.forEach(r => { if (r.lineNumber === lineNumber) addRule({ from: r.from, to: r.to }); });
  if (parameters.defaultTextToHighlight.allWordsInLine.includes(lineNumber)) addRule({ all: true });

  parameters.alternativeTextToHighlight.words.forEach(r => addRule({ words: r.words }, r.colorName));
  parameters.alternativeTextToHighlight.lineSpecificWords.forEach(r => { if (r.lineNumber === lineNumber) addRule({ words: r.words }, r.colorName); });
  parameters.alternativeTextToHighlight.textBetween.forEach(r => addRule({ from: r.from, to: r.to }, r.colorName));
  parameters.alternativeTextToHighlight.lineSpecificTextBetween.forEach(r => { if (r.lineNumber === lineNumber) addRule({ from: r.from, to: r.to }, r.colorName); });
  parameters.alternativeTextToHighlight.allWordsInLine.forEach(r => { if (r.allWordsInLine.includes(lineNumber)) addRule({ all: true }, r.colorName); });
  
  if (rulesToApply.length === 0) 
    return lineHtml;

  return applyHighlightsToString(lineHtml, rulesToApply);
}// getHighlightedLineHtml

async function highlightLines(preCodeElm: HTMLElement, rawCodeLines: string[], parameters: CBCParameters, indentationLevels: IndentationInfo[] | null, sourcePath: string, plugin: CodeBlockCustomizerPlugin, isRerender = false, isPrinting = false) {
  if (!preCodeElm) {
    return;
  }

  const isAlreadyProcessed = preCodeElm.querySelector('.codeblock-customizer-line') !== null;
  const rebuild = isRerender || isAlreadyProcessed;
  const newCodeElm = preCodeElm.cloneNode(false) as HTMLElement;
  const tempCodeElm = document.createElement('div');
  const settings = plugin.settings.SelectedTheme.settings;

  if (rebuild) {
    const customLangConfig = getLanguageConfig(parameters.language, plugin);
    const customFormat = customLangConfig?.format ?? undefined; // custom syntax highlight
    const codeContentToHighlight = rawCodeLines.slice(1, -1).join('\n');
  
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

  const { htmlLines, textLines } = extractLinesFromHTML(tempCodeElm);

  const codeblockLen = htmlLines.length - 1;
  const useSemiFold = codeblockLen >= settings.semiFold.visibleLines + fadeOutLineCount;

  let fadeOutLineIndex = 0;
  const totalLines = isRerender ? htmlLines.length : htmlLines.length - 1;
  const prompt = new PromptManager(parameters, totalLines, plugin.settings);
  const annotationsToProcess: { selector: string, type: string, content: string; title?: string }[] = [];

  const frag = document.createDocumentFragment();

  for (let index = 0; index < totalLines; index++) {
    const htmlLine = htmlLines[index];
    const textLine = textLines[index];
    const lineNumber = index + 1;
    const caseInsensitiveLineText = htmlLine.toLowerCase();

    const { lineContent, annotationData } = processAnnotations(htmlLine, isPrinting, plugin);
    const { lineClasses, uncollapseButton, updatedFadeOutLineIndex } = getLineClass(lineNumber, caseInsensitiveLineText, parameters, settings, useSemiFold, fadeOutLineIndex);
    fadeOutLineIndex = updatedFadeOutLineIndex;
    const lineWrapper = createDiv();

    for (const lineClass of lineClasses.split(' ')){
      if (lineClass) {
        lineWrapper.classList.add(lineClass);
      }
    }

    const lineNumberEl = createLineNumberElement(lineNumber + parameters.lineNumberOffset, parameters.showNumbers);
    lineWrapper.appendChild(lineNumberEl);

    const annotationIcon = createSpan({cls: `codeblock-customizer-annotation-icon`});
    if (annotationData) {
      const selector = `[data-line-number="${lineNumber}"] .codeblock-customizer-annotation-icon`;
      annotationsToProcess.push({ selector, type: annotationData.type, content: annotationData.content, title: annotationData.title });
      annotationIcon.classList.add(`codeblock-customizer-annotation-icon-${annotationData.type}`);
      lineWrapper.appendChild(annotationIcon);
    }

    let promptOutput: { className: string, text: string }[] = [];
    const isPromptLine = prompt.promptLines.has(lineNumber + parameters.lineNumberOffset);
    if (isPromptLine) {
      const { node: promptNode, output } = prompt.renderLine(textLine);

      promptOutput = output; 
      lineWrapper.classList.add(`has-prompt`);
      lineWrapper.appendChild(promptNode);
    }

    const indentInfo = (indentationLevels && indentationLevels[lineNumber - 1]) ? indentationLevels[lineNumber - 1] : { indentationLevels: 0, insertCollapse: false };
    const indentedLine = addIndentLine(lineContent, indentInfo.insertCollapse, indentInfo.indentationLevels);
    const parsedLine = settings.codeblock.enableLinks ? parseInput(indentedLine, sourcePath, plugin) : indentedLine;
    const lineTextEl = createDiv({cls: `codeblock-customizer-line-text`});
    const finalLineHtml = getHighlightedLineHtml(parsedLine, parameters, lineNumber);

    lineTextEl.innerHTML = finalLineHtml.trim() === '' ? '&nbsp;' : finalLineHtml;
    lineWrapper.appendChild(lineTextEl);

    if (promptOutput.length > 0) {
      promptOutput.forEach(out => {
        const outputEl = createDiv({ cls: `${out.className} codeblock-customizer-line-text`, text: out.text, });
        lineWrapper.appendChild(outputEl);
      });
    }

    const indentLevel = indentationLevels && indentationLevels[lineNumber - 1] ? indentationLevels[lineNumber - 1].indentationLevels.toString() : "-1";

    lineWrapper.setAttribute('data-line-number', lineNumber.toString());
    lineWrapper.setAttribute('indentLevel', indentLevel);
    
    if (uncollapseButton) {
      lineWrapper.appendChild(uncollapseButton);
    }
        
    frag.appendChild(lineWrapper);
  }

  newCodeElm.appendChild(frag);

  attachEventListeners(newCodeElm, plugin, sourcePath, annotationsToProcess);

  preCodeElm.replaceWith(newCodeElm);
}// highlightLines

function attachEventListeners(preCodeElm: HTMLElement, plugin: CodeBlockCustomizerPlugin, sourcePath: string, annotationsToProcess: { selector: string, type: string, content: string, title?: string }[]) {
  // annotations
  annotationsToProcess.forEach(annotation => {
    const iconContainer = preCodeElm.querySelector(annotation.selector);
    if (iconContainer) {
      iconContainer.innerHTML = rhombusSVG;
      new TooltipManager(iconContainer as HTMLElement, annotation.content, annotation.type, plugin, sourcePath, annotation.title);
    }
  });

  // indentation collapse icons
  const collapseIcons = preCodeElm.querySelectorAll(".codeblock-customizer-collapse-icon");
  collapseIcons.forEach(icon => {
    setIcon(icon as HTMLElement, "chevron-down");
    icon.addEventListener("click", handleClick);
  });
  
  // uncollapse button for semi-folded code blocks
  const uncollapseButton = preCodeElm.querySelector(".codeblock-customizer-uncollapse-code");
  if (uncollapseButton) {
    uncollapseButton.addEventListener("click", handleUncollapseClick);
  }
}// attachEventListeners

function processAnnotations(htmlLine: string, isPrinting: boolean, plugin: CodeBlockCustomizerPlugin): { lineContent: string; annotationData: { type: string; content: string; title?: string } | null } {
  let annotationData: { type: string; content: string; title?: string } | null = null;
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlLine;

  const commentElement = tempDiv.querySelector<HTMLElement>('span.token.comment');

  if (commentElement && commentElement.textContent) {
    const rawCommentText = commentElement.textContent;
    let cleanedText = rawCommentText.replace(/^\s*\/\*!?/, '').replace(/\*\/$/, '').trim();
    cleanedText = cleanedText.replace(/^\s*(?:\/\/|#|--)\s*/, '').trim();

    const explicitMatch = cleanedText.match(ANNOTATION_PATTERN);

    let type: string | undefined;
    let content: string | undefined;
    let title: string | undefined;

    if (explicitMatch && explicitMatch.groups) {
      type = explicitMatch.groups.type;
      content = explicitMatch.groups.content.trim();
      title = explicitMatch.groups.title?.trim();
    } else if (plugin.settings.SelectedTheme.settings.annotations.convertAllComments) {
      type = 'note';
      content = cleanedText;
    }

    if (type && content && content.length > 0) {
      annotationData = { type, content, title };
      commentElement.classList.add('codeblock-customizer-annotation-source-comment');

      if (commentElement.textContent) {
        commentElement.setAttribute('data-cbc-comment', commentElement.textContent);
      }
      const printAsComments = plugin.settings.SelectedTheme.settings.printing.printAnnotationsAsComments;
      if (!isPrinting || !printAsComments) {
        commentElement.textContent = '';
      }
    }
  }
  return { lineContent: tempDiv.innerHTML, annotationData };
}// processAnnotations

function getLineClass(lineNumber: number, caseInsensitiveLineText: string, parameters: CBCParameters, settings: ThemeSettings, useSemiFold: boolean, fadeOutLineIndex: number) { 
  let lineClasses = '';
  let uncollapseButton: HTMLElement | null = null;
  let updatedFadeOutLineIndex = fadeOutLineIndex;

  const result = isLineHighlighted(lineNumber, caseInsensitiveLineText, parameters);
  if (result.isHighlighted) {
    if (result.color) {
      lineClasses = `codeblock-customizer-line-highlighted-${result.color.replace(/\s+/g, '-').toLowerCase()}`;
    } else {
      lineClasses = `codeblock-customizer-line-highlighted`;
    }
  } else {
    lineClasses = `codeblock-customizer-line`;
  }

  if (useSemiFold && lineNumber > settings.semiFold.visibleLines && fadeOutLineIndex < fadeOutLineCount) {
    lineClasses += ` codeblock-customizer-fade-out-line${fadeOutLineIndex}`;
    updatedFadeOutLineIndex++;
    if (fadeOutLineIndex === fadeOutLineCount - 1) {
      uncollapseButton = createUncollapseCodeButton();
    }
  }

  if (useSemiFold && lineNumber > settings.semiFold.visibleLines + fadeOutLineCount) {
    lineClasses += ` codeblock-customizer-fade-out-line-hide`;
  }

  return { lineClasses: lineClasses.trim(), uncollapseButton, updatedFadeOutLineIndex };
}// getLineClass

function findHighlightRanges(fullText: string, from: string, to: string): { start: number, end: number }[] {
  const ranges: { start: number, end: number }[] = [];
  
  const escapeRegex = (str: string) => str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

  if (!from && !to) { // neither is specified -> highlight entire line
    const trimmedText = fullText.trim();
    if (trimmedText.length > 0) {
      const start = fullText.indexOf(trimmedText);
      const end = start + trimmedText.length;
      ranges.push({ start, end });
    }
    return ranges;
  }
  
  const fromPattern = from ? escapeRegex(from) : '^';
  const toPattern = to ? escapeRegex(to) : '$';
  
  if (from && to) { // from and to are specified
    const regex = new RegExp(fromPattern + '([\\s\\S]*?)' + toPattern, 'gi');
    let match;
    while ((match = regex.exec(fullText)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  } else if (from) { // from is specified -> highlight to end
    const regex = new RegExp(fromPattern + '([\\s\\S]*?)$', 'gi');
    let match;
    if ((match = regex.exec(fullText)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  } else if (to) { // to is specified -> highlight from start
    const regex = new RegExp('^([\\s\\S]*?)' + toPattern, 'gi');
    let match;
    if ((match = regex.exec(fullText)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  
  return ranges;
}// findHighlightRanges

function parseInput(input: string, sourcePath: string, plugin: CodeBlockCustomizerPlugin): string {
  if (input === "") {
    return input;
  }

  if (!input.includes('[[') && !input.includes('](') && !input.includes('http')) {
    return input;
  }

  // #98
  const placeholder = '\u200B'; // Zero-width space
  const inputWithPlaceholders = input.replace(/(^\s{1,3})/gm, (match) => placeholder.repeat(match.length));

  const parser = new DOMParser();
  const doc = parser.parseFromString(inputWithPlaceholders, 'text/html');
  const elementsWithClass = Array.from(doc.getElementsByClassName('comment'));
  const regex = /(?:\[\[([^[\]]+?)(?:\|([^\]]+?))?]]|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s]+))/g;

  elementsWithClass.forEach((element: Element) => {
    const textContent = element.textContent || '';
    let lastIndex = 0;
    let match;

    const fragment = document.createDocumentFragment();

    while ((match = regex.exec(textContent)) !== null) {
      const textBeforeMatch = textContent.slice(lastIndex, match.index);
      fragment.appendChild(document.createTextNode(textBeforeMatch));

      const span = createSpan({cls: "codeblock-customizer-link"});
      MarkdownRenderer.render(plugin.app, match[0], span, sourcePath, plugin);
      fragment.appendChild(span);

      lastIndex = match.index + match[0].length;
    }

    const textAfterLastMatch = textContent.slice(lastIndex);
    fragment.appendChild(document.createTextNode(textAfterLastMatch));

    element.textContent = '';
    element.appendChild(fragment);
  });

  const output = new XMLSerializer().serializeToString(doc);
  return output.replace(new RegExp(placeholder, 'g'), ' ');
}// parseInput

function handleClick(event: Event) {
  const collapseIcon = event.currentTarget as HTMLElement;
  if (!collapseIcon)
    return;
  
  const codeElement = getCodeElementFromCollapseIcon(collapseIcon);
  if (!codeElement)
    return;

  const collapseIconParent = getParentWithClassStartingWith(collapseIcon, "codeblock-customizer-line");
  if (!collapseIconParent)
    return;
  collapseIconParent.classList.toggle("codeblock-customizer-lines-below-collapsed");

  const clickedIndentLevel = parseInt(collapseIconParent.getAttribute('indentlevel') || "");
  const codeLines = Array.from(codeElement.querySelectorAll('[class^="codeblock-customizer-line"]'));

  let lessEqualIndent = false;
  let startPosReached = false;
  let startPosLineId = -1;
  const lines: { element: HTMLElement; lineCount: number }[] = [];
  let lineCount = 0;
  for (const line of codeLines) {
    if (line.getAttribute('indentlevel') === null)
      continue;

    if (collapseIconParent === line) {
      startPosReached = true;
      startPosLineId = lineCount;
    }

    const lineIndentLevel = parseInt(line.getAttribute('indentlevel') || "");
    if (lineIndentLevel > clickedIndentLevel && startPosReached) {
      lines.push({ element: line as HTMLElement, lineCount });
      lessEqualIndent = true;
    } else if (lessEqualIndent && lineIndentLevel <= clickedIndentLevel) {
      break;
    }
    lineCount++;
  }

  if (collapseIconParent.classList.contains("codeblock-customizer-lines-below-collapsed")) {
    setIcon(collapseIcon, "chevron-right");
    for (const line of lines) {
      const lineTextEl = collapseIconParent.querySelector('.codeblock-customizer-line-text');
      if (lineTextEl) {
        const foldPlaceholder = createSpan({text: "…", cls: 'codeblock-customizer-foldPlaceholder'});
        const existingFoldPlaceholder = lineTextEl.querySelector('.codeblock-customizer-foldPlaceholder');
        if (!existingFoldPlaceholder) {
          lineTextEl.appendChild(foldPlaceholder);
        }
      }
      line.element.classList.add('codeblock-customizer-line-hidden');
      if (line.element.getAttribute('collapsedBy') === null)
        line.element.setAttribute('collapsedBy', startPosLineId.toString());
    }
  } else {
    setIcon(collapseIcon, "chevron-down");
    for (const line of lines) {
      if (parseInt(line.element.getAttribute("collapsedBy") || "") === startPosLineId) {
        line.element.classList.remove('codeblock-customizer-line-hidden');
        line.element.removeAttribute('collapsedBy');
        const lineTextEl = collapseIconParent.querySelector('.codeblock-customizer-line-text');
        if (lineTextEl) {
          const existingFoldPlaceholder = lineTextEl.querySelector('.codeblock-customizer-foldPlaceholder');
          if (existingFoldPlaceholder) {
            existingFoldPlaceholder.remove();
          }
        }
      }
    }
  }
}// handleClick

function getCodeElementFromCollapseIcon(collapseIcon: HTMLElement): HTMLElement | null {
  let parentElement = collapseIcon.parentElement;
  while (parentElement) {
    if (parentElement.classList.contains('codeblock-customizer-pre')) {
      const codeElements = parentElement.querySelector('code');
      if (codeElements)
        return codeElements;
    }
    parentElement = parentElement.parentElement;
  }
  return null;
}// getCodeElementFromCollapseIcon

function getParentWithClassStartingWith(element: HTMLElement, classNamePrefix: string) {
  let parent = element.parentElement;
  while (parent) {
    const classList = parent.classList;
    if (classList && Array.from(classList).some((className) => className.startsWith(classNamePrefix))) {
      const indentLevel = parent.getAttribute('indentlevel');
      if (indentLevel !== null) {
        return parent;
      }
    }
    parent = parent.parentElement;
  }
  return null;
}// getParentWithClassStartingWith

function handleUncollapseClick(event: Event) {
  const button = event.target as HTMLElement;

  const codeElement = button.parentElement?.parentElement;
  if (!codeElement)
    return;

  const pre = codeElement?.parentElement;
  if (!pre)
    return;

  let header: HTMLElement;
  if (pre.classList.contains("displayedInGroup")) {
    // grouped code blocks
    const group = pre.getAttribute("groupname");
    header = document.querySelector(`.markdown-rendered .codeblock-customizer-pre-parent .codeblock-customizer-header-group-container[group="${group}"]`) as HTMLElement;
  } else {
    // ungrouped code blocks
    header = button.parentElement?.parentElement?.previousSibling?.previousSibling as HTMLElement;
  }

  if (header) {
    const collapseIcon = header.querySelector(".codeblock-customizer-header-collapse") as HTMLElement;
    if (collapseIcon && pre) {
      toggleFold(pre, collapseIcon, `codeblock-customizer-codeblock-semi-collapsed`);
    }
  }
}// handleUncollapseClick

export function toggleFold(pre: HTMLElement, collapseIcon: HTMLElement, toggleClass: string) {
  if (pre?.classList.contains(toggleClass)) {
    setIcon(collapseIcon, "chevrons-up-down");
  } else {
    setIcon(collapseIcon, "chevrons-down-up");
  }
  pre?.classList.toggle(toggleClass);
}// toggleFold

export function convertHTMLCollectionToArray(elements: HTMLCollection, excludeCmdOutput = false) {
  const result: Element[] = [];
  for (let i = 0; i < elements.length; i++ ){
    const children = Array.from(elements[i].children);
    if (excludeCmdOutput) {
      result.push(...children.filter(child => !child.classList.contains('codeblock-customizer-cmdoutput-line')));
    } else {
      result.push(...children);
    }
  }
  return result;
}// convertHTMLCollectionToArray

async function addPrintStyling(codeBlockElement: HTMLElement[], plugin: CodeBlockCustomizerPlugin, codeBlockFirstLines: string[], sourcePath: string, codeblockLines: string[]) {
  for (const [key, codeblockPreElement] of Array.from(codeBlockElement).entries()) {
    const codeblockParameters = codeBlockFirstLines[key];
    const parameters = getAllParameters(codeblockParameters, plugin.settings);  
    
    const codeblockCodeElement: HTMLPreElement | null = codeblockPreElement.querySelector("pre > code");
    if (!codeblockCodeElement)
      continue;

    if (Array.from(codeblockCodeElement.classList).some(className => /^language-\S+/.test(className)))
      while(!codeblockCodeElement.classList.contains("is-loaded"))
        await sleep(2);

    if (codeblockCodeElement.querySelector("code [class*='codeblock-customizer-line']"))
      continue;

    if (parameters.exclude)
      continue;

    if (plugin.settings.SelectedTheme.settings.printing.uncollapseDuringPrint)
      parameters.fold = false;

    const codeblockLanguageSpecificClass = getLanguageSpecificColorClass(parameters.language, plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors);
    await addClasses(codeblockPreElement, parameters, codeblockLines, plugin, codeblockCodeElement as HTMLElement, null, codeblockLanguageSpecificClass, sourcePath, undefined, undefined, false, true);
  }
}// addPrintStyling

interface CodeBlockData {
  firstLine: string;
  contentLines: string[];
  startLine: number;
  endLine: number;
}

function extractCodeBlockData(lines: string[]): CodeBlockData[] {
  if (!lines || !Array.isArray(lines)) {
    return [];
  }

  const results: CodeBlockData[] = [];
  let inCodeBlock = false;
  let openingFenceCount = 0;
  let openingFenceChar: '`' | '~' | null = null;
  let startLine = -1;
  let firstLine = '';

  for (let i = 0; i < lines.length; i++) {
    const lineContent = lines[i] ?? "";
    const trimmedLine = removeCharFromStart(lineContent.trim(), ">");

    const fenceMatch = trimmedLine.match(/^(?:`|~){3,}/);

    if (fenceMatch) {
      const fence = fenceMatch[0];
      const char = fence[0] as '`' | '~';
      const count = fence.length;

      if (!inCodeBlock) {
        inCodeBlock = true;
        openingFenceChar = char;
        openingFenceCount = count;
        startLine = i;
        firstLine = lineContent;
      } else if (char === openingFenceChar && count === openingFenceCount) {
        const endLine = i;
        const contentLines = lines.slice(startLine, endLine + 1);
        
        results.push({ firstLine: firstLine, contentLines: contentLines, startLine: startLine, endLine: endLine, });

        inCodeBlock = false;
        openingFenceChar = null;
        openingFenceCount = 0;
        startLine = -1;
        firstLine = '';
      }
    }
  }

  // Handle an unclosed code block at the end of the file
  if (inCodeBlock) {
    const endLine = lines.length - 1;
    const contentLines = lines.slice(startLine, endLine + 1);
    results.push({ firstLine: firstLine, contentLines: contentLines, startLine: startLine, endLine: endLine, });
  }

  return results;
}// extractCodeBlockData

// Note: This should be replaced later with extractCodeBlockData
function getCodeBlocksFirstLines(array: string[]): string[] {
  if (!array || !Array.isArray(array)) 
    return [];

  const codeBlocks: string[] = [];
  let inCodeBlock = false;
  let openingFenceCount = 0;
  let openingFenceChar: '`' | '~' | null = null;

  for (let i = 0; i < array.length; i++) {
    let line = array[i] ?? "";
    line = removeCharFromStart(line.trim(), ">");

    const fenceMatch = line.match(/^(?:`|~){3,}/);
    if (fenceMatch) {
      const fence = fenceMatch[0];
      const char = fence[0] as '`' | '~';
      const count = fence.length;

      if (!inCodeBlock) {
        inCodeBlock = true;
        openingFenceChar = char;
        openingFenceCount = count;
        codeBlocks.push(line);
      } else { 
        if (char === openingFenceChar && count === openingFenceCount) {
          inCodeBlock = false;
          openingFenceCount = 0;
          openingFenceChar = null;
        }
      }
    }
  }

  // Handle the case when the last block is requested
  if (codeBlocks.length > 0) {
    //const firstLineOfBlock = currentBlock[0];
    return codeBlocks;
  }

  return [];
}// getCodeBlocksFirstLine

function getCallouts(array: string[]): string[] {
  if (!array)
    return [];

  const arrowBlocks: string[] = [];
  
  for (let i = 0; i < array.length; i++) {
    const line = array[i].trim();
    if (line.startsWith(">")) {
      arrowBlocks.push(line);
    }
  }

  const arrowBlocksResult: string[] = getCodeBlocksFirstLines(arrowBlocks);

  if (arrowBlocksResult.length > 0)
    return arrowBlocksResult;
  else
    return [];
}// getCallouts

export async function inlineCodeProcessor(element: HTMLElement, context: MarkdownPostProcessorContext, plugin: CodeBlockCustomizerPlugin) {
  const allInlineCodeElements = element.querySelectorAll("code:not(pre > code)");
  if (allInlineCodeElements.length === 0) {
    return;
  }

  // add class for styling
  allInlineCodeElements.forEach(codeEl => {
    codeEl.classList.add('codeblock-customizer-inline-code');
  });

  const firstInlineCodeElm: HTMLElement | null = element.querySelector('code:not(pre > code)');
  const isPdfExport = firstInlineCodeElm ? !context.getSectionInfo(firstInlineCodeElm) : true

  if (isPdfExport && !plugin.settings.SelectedTheme.settings.printing.enablePrintToPDFStyling) {
    // remove class during printing, so it does not gets styled
    allInlineCodeElements.forEach(codeEl => {
      codeEl.classList.remove('codeblock-customizer-inline-code');
    });
    return;
  }

  const prism = await loadPrism();

  allInlineCodeElements.forEach(codeEl => {
    if ((codeEl as HTMLElement).dataset.cbcProcessed) {
      return;
    }
    const text = codeEl.textContent ?? "";
    const match = text.match(INLINE_CODE_LANG_REGEX);

    if (plugin.settings.SelectedTheme.settings.inlineCode.enableSyntaxHighlight && match) {
      processSingleInlineCodeElement(codeEl, prism, plugin);
    } else {
      if (plugin.settings.SelectedTheme.settings.inlineCode.enableCopyOnClick) {
        (codeEl as HTMLElement).addEventListener('click', createInlineCodeClickHandler(plugin, () => codeEl.textContent ?? ""));
        (codeEl as HTMLElement).dataset.cbcProcessed = 'true';
      }
    }
  });
}// inlineCodeProcessor

function processSingleInlineCodeElement(codeEl: Element, prism: any, plugin: CodeBlockCustomizerPlugin) {
  const text = codeEl.textContent?.trim();
  if (!text) {
    return;
  }

  const match = text.match(INLINE_CODE_LANG_REGEX);

  if (match && match[1] && match[2]) {
    // {lang} was specified
    const language = match[1].toLowerCase();
    const code = match[2];

    const displayLanguage = getDisplayLanguageName(language);
    const newCodeEl = createCode({ cls: "codeblock-customizer-inline-code" });

    if (plugin.settings.SelectedTheme.settings.inlineCode.enableCopyOnClick) {
      newCodeEl.addEventListener('click', createInlineCodeClickHandler(plugin, () => code), true);
    }

    const iconSpan = createInlineCodeIcon(displayLanguage);
    if (iconSpan) {
      newCodeEl.appendChild(iconSpan);
    }

    const codeContentSpan = createCodeContentSpan(code, language, prism);
    newCodeEl.appendChild(codeContentSpan);

    (newCodeEl as HTMLElement).dataset.cbcProcessed = 'true';

    codeEl.replaceWith(newCodeEl);
  }
}// processSingleInlineCodeElement

function createInlineCodeClickHandler(plugin: CodeBlockCustomizerPlugin, getTextToCopy: () => string): (event: MouseEvent) => void {
  return (event: MouseEvent) => {
    const requiredKey = plugin.settings.SelectedTheme.settings.inlineCode.copyModifierKey;
    if ((requiredKey === InlineCodeModifierKeys.CTRL && !event.ctrlKey) || (requiredKey === InlineCodeModifierKeys.ALT && !event.altKey))
      return;

    event.preventDefault();
    event.stopImmediatePropagation();
    
    addTextToClipboard(getTextToCopy());
  };
}// createInlineCodeClickHandler

function createInlineCodeIcon(displayLanguage: string): HTMLSpanElement | null {
  const Icon = getLanguageIcon(displayLanguage);
  if (Icon) {
    return getInlineCodeIcon(displayLanguage);
  }
  return null;
}// createInlineCodeIcon

function createCodeContentSpan(code: string, language: string, prism: any): HTMLSpanElement {
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

function createCode(options?: { cls?: string, text?: string }): HTMLElement {
  const code = document.createElement('code');
  if (options?.cls) {
    code.classList.add(...options.cls.split(' '));
  }
  if (options?.text) {
    code.textContent = options.text;
  }
  return code;
}// createCode
