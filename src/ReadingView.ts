import { MarkdownView, MarkdownPostProcessorContext, setIcon, MarkdownSectionInformation, MarkdownRenderer, loadPrism, Notice } from "obsidian";

import { getLanguageIcon, createContainer, createCodeblockLang, createCodeblockIcon, createFileName, createCodeblockCollapse, getCurrentMode, getBorderColorByLanguage, removeCharFromStart, createUncollapseCodeButton, addTextToClipboard, getLanguageSpecificColorClass, findAllOccurrences, CBCParameters, getAllParameters, getPropertyFromLanguageSpecificColors, getLanguageConfig, getFileCacheAndContentLines, getDisplayLanguageName, getInlineCodeIcon } from "./Utils";
import { TooltipManager } from "./TooltipManager";
import { PromptManager } from "./PromptManager";
import CodeBlockCustomizerPlugin from "./main";
import { CodeblockCustomizerSettings, FoldingPersistence, FoldingScope, InlineCodeModifierKeys, ThemeSettings } from "./Settings";
import { ANNOTATION_PATTERN, fadeOutLineCount, INLINE_CODE_LANG_REGEX, rhombusSVG } from "./Const";
import { FoldCommand, FoldingState } from "./EditorExtensions";

import { visitParents } from "unist-util-visit-parents";
import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";
import detectIndent from 'detect-indent';

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

  const codeLines = Array.from(codeblockLines);
  if (codeLines.length >= 2) {
    codeLines.shift();
    codeLines.pop();
  }
  const indentationLevels = trackIndentation(codeLines);
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

  await processCodeBlockFirstLines(preElements, codeBlockFirstLines, indentationLevels, codeblockLines, context, plugin, codeBlockSectionInfo, validCharPos);
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
  const codeBlock = lines.join('\n');
  const indent = detectIndent(codeBlock).indent || '    '; // default to 4 spaces

  const result: IndentationInfo[] = [];
  for (let i = 0; i < lines.length; i++) {
    const currentLevel = getIndentLevel(lines[i], indent);
    const nextLevel = (i + 1 < lines.length) ? getIndentLevel(lines[i + 1], indent) : 0;

    result.push({
      indentationLevels: currentLevel,
      insertCollapse: nextLevel > currentLevel
    });
  }
  
  return result;
}// trackIndentation

function getIndentLevel(line: string, indent: string, tabSize = 4): number {
  let level = 0;
  while (line.startsWith(indent.repeat(level + 1))) {
    level++;
  }
  return level;
}// getIndentLevel

export async function calloutPostProcessor(codeBlockElement: HTMLElement, context: MarkdownPostProcessorContext, plugin: CodeBlockCustomizerPlugin) {
  const callouts: HTMLElement | null = codeBlockElement.querySelector('.callout');
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
    await processCodeBlockFirstLines(calloutPreElements, codeBlockFirstLines, null, [], context, plugin);
  }
}// calloutPostProcessor

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

async function processCodeBlockFirstLines(preElements: HTMLElement[], codeBlockFirstLines: string[], indentationLevels: IndentationInfo[] | null, codeblockLines: string[], context: MarkdownPostProcessorContext, plugin: CodeBlockCustomizerPlugin, sectionInfo?: MarkdownSectionInformation, charPos?: number) {
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

async function addClasses(preElement: HTMLElement, parameters: CBCParameters, codeblockLines: string[], plugin: CodeBlockCustomizerPlugin, preCodeElm: HTMLElement, indentationLevels: IndentationInfo[] | null, codeblockLanguageSpecificClass: string, sourcePath: string, sectionInfo?: MarkdownSectionInformation, charPos?: number, isParameterRerender = false) {
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
  
  frag.appendChild(header);
  frag.appendChild(buttons);
	
  preElement.insertBefore(frag, preElement.firstChild);

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

  await highlightLines(preCodeElm, codeblockLines, parameters, indentationLevels, sourcePath, plugin, isParameterRerender);
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

  if (!preElement)
    return;
  
  let codeText: string;

  if (plugin && codeblockLines && codeblockLines.length > 0) {
    const contentLines = codeblockLines.slice(1, -1);

    if (plugin.settings.SelectedTheme.settings.annotations.excludeAnnotationsFromCopy) {
      const ANNOTATION_MARKER = '[!';
      const processedLines = contentLines.map(line => {
        if (line.includes(ANNOTATION_MARKER)) {
          const commentRegex = /^(.*?)(\s*(?:\/\/|#|--|\/\*))/;
          const match = line.match(commentRegex);
          if (match && match[1] !== undefined) {
            return match[1].trimEnd();
          }
        }
        return line;
      });
      codeText = processedLines.join('\n');
    } else {
      codeText = contentLines.join('\n');
    }
  } else {
    const lines = preElement.querySelectorAll("code .codeblock-customizer-line-text:not(.codeblock-customizer-prompt-cmd-output)");
    const codeTextArray: string[] = [];
    lines.forEach(line => {
      codeTextArray.push(line.textContent || "");
    });
    codeText = codeTextArray.join('\n');
  }

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
  if (!cache || !fileContentLines)
    return;

  let codeBlockFirstLines: string[] = [];
  if (cache?.sections && !id) {
    codeBlockFirstLines = getCodeBlocksFirstLines(fileContentLines);
  } else if (cache?.blocks && id) { 
    codeBlockFirstLines = getCodeBlocksFirstLines(fileContentLines.slice(cache.blocks[id].position.start.line, cache.blocks[id].position.end.line));
  } else {
      console.error(`Metadata cache not found for file: ${context.sourcePath}`);
      return;
  }

  if (preElements.length !== codeBlockFirstLines.length)
    return;

  try {
    if (plugin.settings.SelectedTheme.settings.printing.enablePrintToPDFStyling)
      await PDFExport(preElements, plugin, codeBlockFirstLines, context.sourcePath, fileContentLines);
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
  let wrapperClass = 'codeblock-customizer-line-number';
  if (showNumbers === "specific")
    wrapperClass = `codeblock-customizer-line-number-specific`;
  else if (showNumbers === "hide")
    wrapperClass = `codeblock-customizer-line-number-hide`;
  
  const numberText = lineNumber === -1 ? '' : lineNumber.toString();
  const lineNumberElement = `<span class="codeblock-customizer-line-number-element">${numberText}</span>`;
    
  return `<div class="${wrapperClass}">${lineNumberElement}</div>`;
}// createLineNumberElement

function addIndentLine(inputString: string, insertCollapse = false): string {
  const indentRegex = /^(?:\t+|( {4})*)/;
  const match = inputString.match(indentRegex);
  const indent = match ? match[0] : '';
  const isTabIndentation = /\t/.test(indent);
  const numIndentCharacters = isTabIndentation ? (indent.match(/\t/g) || []).length : (indent.match(/ {4}/g) || []).length;
  const indentSpan = `<span class="codeblock-customizer-indentation-guide">${isTabIndentation ? "\t" : "    "}</span>`;
  
  const spans = Array(numIndentCharacters).fill(indentSpan).join('');
  
  let stringWithSpans = inputString.replace(indentRegex, spans);

  if (insertCollapse) {
    const lastIndentPosition = isTabIndentation ? numIndentCharacters : numIndentCharacters * 4;
    const iconSpan = `<span class="codeblock-customizer-collapse-icon"></span>`;
    const indicator = `<span class="codeblock-customizer-collapse-indicator">${iconSpan}</span>`;
    
    const temp = inputString;
    const stringBeforeIndent = temp.substring(0, temp.search(/\S|$/));
    const stringAfterIndent = temp.substring(stringBeforeIndent.length);
    
    const modifiedIndent = stringBeforeIndent.slice(0, lastIndentPosition) + indicator + stringBeforeIndent.slice(lastIndentPosition);
    const modifiedString = modifiedIndent + stringAfterIndent;

    stringWithSpans = modifiedString.replace(indentRegex, spans);
  }
  
  return stringWithSpans;
}// addIndentLine

function extractLinesFromHTML(preCodeElm: HTMLElement): { htmlLines: string[]; textLines: string[] } {
  let htmlContent = preCodeElm.innerHTML;

  const tree = fromHtml(preCodeElm.innerHTML.replace(/\n/g, "<br>"), { fragment: true });
  visitParents(tree, ["text", "element"], (node, parents) => {
    if (node.type === "element" && node.tagName === "br") {
      htmlContent = replaceNewlineWithBr(htmlContent, parents);
    }
  });
  const splitTree = fromHtml(htmlContent);
  htmlContent = toHtml(splitTree);

  let htmlLines = htmlContent.split("<br>");
  let textLines = preCodeElm.textContent?.split("\n") ?? [];

  if (htmlLines.length === 1) {
    if (htmlLines[0].trim() === "") {
      htmlLines = ["", ""];
      textLines = ["", ""];
    } else {
      htmlLines = [htmlLines[0], ""];
      textLines = [textLines[0], ""];
    }
  }

  preCodeElm.innerHTML = "";

  return { htmlLines, textLines };
}// extractLinesFromHTML

function replaceNewlineWithBr(htmlContent: string, parents: any[]): string {
  const brReplacement = parents.length >= 2 ? replaceWithNestedBr(parents) : "<br>";
  return htmlContent.replace(/\n/, brReplacement);
}// replaceNewlineWithBr

function replaceWithNestedBr(parents: any[]): string {
  const nestedBr = parents.slice(1).reduce((ret: string, el) => {
    const clonedElement = structuredClone(el);
    clonedElement.children = [];
    const tags = toHtml(clonedElement).split(/(?<=>)(?=<\/)/);
    return tags.splice(-1) + ret + tags.join("");
  }, "<br>");
  return nestedBr;
}// replaceWithNestedBr

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

async function highlightLines(preCodeElm: HTMLElement, rawCodeLines: string[], parameters: CBCParameters, indentationLevels: IndentationInfo[] | null, sourcePath: string, plugin: CodeBlockCustomizerPlugin, isRerender = false) {
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
  
  let newHtml = '';
  const annotationsToProcess: { selector: string, type: string, content: string }[] = [];
  
  const tempDiv = document.createElement('div');

  for (let index = 0; index < htmlLines.length; index++) {
    if (index === htmlLines.length - 1 && (!isRerender || htmlLines[index].trim() === '')) {
      continue;
    }

    const htmlLine = htmlLines[index];
    const textLine = textLines[index];
    const lineNumber = index + 1;
    const caseInsensitiveLineText = htmlLine.toLowerCase();

    const { lineContent, annotationData } = processAnnotations(htmlLine, settings);
    const { lineClasses, uncollapseButtonHTML, updatedFadeOutLineIndex } = getLineClass(lineNumber, caseInsensitiveLineText, parameters, settings, useSemiFold, fadeOutLineIndex);
    fadeOutLineIndex = updatedFadeOutLineIndex;
    const lineNumberHTML = createLineNumberElement(lineNumber + parameters.lineNumberOffset, parameters.showNumbers);
    
    let annotationIconHTML = '';
    if (annotationData) {
      const selector = `[data-line-number="${lineNumber}"] .codeblock-customizer-annotation-icon`;
      annotationsToProcess.push({ selector, type: annotationData.type, content: annotationData.content });
      annotationIconHTML = `<span class="codeblock-customizer-annotation-icon codeblock-customizer-annotation-icon-${annotationData.type}"></span>`;
    }

    let promptNodeHTML = '';
    let commandOutputHTML = '';
    const isPromptLine = prompt.promptLines.has(lineNumber + parameters.lineNumberOffset);
    if (isPromptLine) {
      const { node: promptNode, output } = prompt.renderLine(textLine);

      promptNodeHTML = promptNode.outerHTML;

      if (output.length > 0) {
        commandOutputHTML = output.map(out => 
          `<div class="${out.className} codeblock-customizer-line-text">${out.text}</div>`
        ).join('');
      }
    }

    const indentedLine = addIndentLine(lineContent, (indentationLevels && indentationLevels[lineNumber - 1]) ? indentationLevels[lineNumber - 1].insertCollapse : false);
    const parsedLine = settings.codeblock.enableLinks ? parseInput(indentedLine, sourcePath, plugin) : indentedLine;

    tempDiv.innerHTML = parsedLine;
    textHighlight(parameters, lineNumber, tempDiv);
    let highlightedTextHTML = tempDiv.innerHTML;

    if (highlightedTextHTML.trim() === '') {
      highlightedTextHTML = '&nbsp;';
    }

    const lineTextHTML = `<div class="codeblock-customizer-line-text">${highlightedTextHTML}</div>`;
    const indentLevel = indentationLevels && indentationLevels[lineNumber - 1] ? indentationLevels[lineNumber - 1].indentationLevels.toString() : "-1";
    const lineWrapperClasses = `${lineClasses} ${isPromptLine ? 'has-prompt' : ''}`.trim();

    newHtml += `<div class="${lineWrapperClasses}" data-line-number="${lineNumber}" indentLevel="${indentLevel}">`;
    newHtml += lineNumberHTML;
    if (annotationIconHTML) {
      newHtml += annotationIconHTML;
    }
    
    if (isPromptLine) {
      newHtml += promptNodeHTML;
    }
    newHtml += lineTextHTML;
    
    if (uncollapseButtonHTML) {
      newHtml += uncollapseButtonHTML;
    }
    
    if (commandOutputHTML) {
      newHtml += commandOutputHTML;
    }
    newHtml += `</div>`;
  }
  newCodeElm.innerHTML = newHtml;

  attachEventListeners(newCodeElm, plugin, sourcePath, annotationsToProcess);

  preCodeElm.replaceWith(newCodeElm);
}// highlightLines

function attachEventListeners(preCodeElm: HTMLElement, plugin: CodeBlockCustomizerPlugin, sourcePath: string, annotationsToProcess: { selector: string, type: string, content: string }[]) {
  // annotations
  annotationsToProcess.forEach(annotation => {
    const iconContainer = preCodeElm.querySelector(annotation.selector);
    if (iconContainer) {
      iconContainer.innerHTML = rhombusSVG;
      new TooltipManager(iconContainer as HTMLElement, annotation.content, annotation.type, plugin, sourcePath);
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

function processAnnotations(htmlLine: string, settings: ThemeSettings): { lineContent: string; annotationData: { type: string; content: string } | null } {
  let annotationData: { type: string; content: string } | null = null;
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

    if (explicitMatch && explicitMatch.groups) {
      type = explicitMatch.groups.type;
      content = explicitMatch.groups.content.trim();
    } else if (settings.annotations.convertAllComments) {
      type = 'note';
      content = cleanedText;
    }

    if (type && content && content.length > 0) {
      annotationData = { type, content };
      commentElement.remove();
    }
  }
  return { lineContent: tempDiv.innerHTML, annotationData };
}// processAnnotations

function getLineClass(lineNumber: number, caseInsensitiveLineText: string, parameters: CBCParameters, settings: ThemeSettings, useSemiFold: boolean, fadeOutLineIndex: number) { 
  let lineClasses = '';
  let uncollapseButtonHTML = '';
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
      const uncollapseCodeButton = createUncollapseCodeButton();
      uncollapseButtonHTML = uncollapseCodeButton.outerHTML;
    }
  }

  if (useSemiFold && lineNumber > settings.semiFold.visibleLines + fadeOutLineCount) {
    lineClasses += ` codeblock-customizer-fade-out-line-hide`;
  }

  return { lineClasses: lineClasses.trim(), uncollapseButtonHTML, updatedFadeOutLineIndex };
}// getLineClass

function findHighlightRanges(fullText: string, from: string, to: string): { start: number, end: number }[] {
  const ranges: { start: number, end: number }[] = [];
  const lowerCaseText = fullText.toLowerCase();
  const lowerCaseFrom = from ? from.toLowerCase() : null;
  const lowerCaseTo = to ? to.toLowerCase() : null;

  if (lowerCaseFrom && lowerCaseTo) { // from and to are specified
    let startIndex = 0;
    while ((startIndex = lowerCaseText.indexOf(lowerCaseFrom, startIndex)) !== -1) {
      const endIndex = lowerCaseText.indexOf(lowerCaseTo, startIndex + lowerCaseFrom.length);
      if (endIndex === -1) {
        break;
      }
      ranges.push({ start: startIndex, end: endIndex + lowerCaseTo.length });
      startIndex = endIndex + lowerCaseTo.length;
    }
  } else if (lowerCaseFrom) { // from is specified -> highlight to end
    let startIndex = 0;
    if ((startIndex = lowerCaseText.indexOf(lowerCaseFrom, startIndex)) !== -1) {
    ranges.push({ start: startIndex, end: fullText.length });
    }
  } else if (lowerCaseTo) { // to is specified -> highlight from start
    const endIndex = lowerCaseText.indexOf(lowerCaseTo);
    if (endIndex !== -1) {
      ranges.push({ start: 0, end: endIndex + lowerCaseTo.length });
    }
  } else { // neither is specified -> highlight entire line
    if (fullText.trim().length > 0) {
      //ranges.push({ start: 0, end: fullText.length });
      const trimmedEndIndex = fullText.trimEnd().length;
      ranges.push({ start: 0, end: trimmedEndIndex });
    }
  }
  
  return ranges;
}// findHighlightRanges

function highlightRangesInNode(node: Node, ranges: { start: number, end: number }[], className: string): void {
  const createSpan = (text: string): HTMLSpanElement => {
    const span = document.createElement('span');
    span.className = className;
    span.appendChild(document.createTextNode(text));
    return span;
  };

  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  let textOffset = 0;
  let rangeIndex = 0;

  for (const currentNode of textNodes) {
    if (rangeIndex >= ranges.length) 
      break;

    const parent = currentNode.parentNode;
    if (!parent) 
      continue;

    const nodeText = currentNode.textContent || '';
    const nodeLength = nodeText.length;
    let lastIndex = 0;
    const fragment = document.createDocumentFragment();

    while (rangeIndex < ranges.length) {
      const range = ranges[rangeIndex];
      const rangeStart = range.start;
      const rangeEnd = range.end;

      if (rangeEnd <= textOffset) {
        rangeIndex++;
        continue;
      }

      if (rangeStart >= textOffset + nodeLength) {
        break;
      }
      
      const localStart = Math.max(0, rangeStart - textOffset);
      const localEnd = Math.min(nodeLength, rangeEnd - textOffset);

      if (localStart > lastIndex) {
        fragment.appendChild(document.createTextNode(nodeText.substring(lastIndex, localStart)));
      }

      if (localEnd > localStart) {
        fragment.appendChild(createSpan(nodeText.substring(localStart, localEnd)));
      }
      
      lastIndex = localEnd;

      if (rangeEnd <= textOffset + nodeLength) {
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
}// highlightRangesInNode

function textHighlight(parameters: CBCParameters, lineNumber: number, lineTextEl: HTMLDivElement) {
  const wordHighlight = (words: string[], name = '') => {
    const caseInsensitiveWords = words.map(word => word.toLowerCase());
    for (const word of caseInsensitiveWords) {
      highlightWords(lineTextEl, word, name);
    }
  };

  const highlightBetween = (from: string, to: string, name = '') => {
    const walker = document.createTreeWalker(lineTextEl, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }
    const concatenatedText = textNodes.map(node => node.textContent).join('');
    if (!concatenatedText) 
      return;

    const ranges = findHighlightRanges(concatenatedText, from, to);
    if (ranges.length === 0) 
      return;

    const className = name ? `codeblock-customizer-highlighted-text-${name}` : 'codeblock-customizer-highlighted-text';
      
    highlightRangesInNode(lineTextEl, ranges, className);
  };

  // highlight text in every line if linetext contains the specified word hlt:test
  const words = parameters.defaultTextToHighlight.words;
  if (words.length > 0) {
    wordHighlight(words);
  }

  // highlight text in specific lines if linetext contains the specified word hlt:1|test,3-5|test
  const lineSpecificWords = parameters.defaultTextToHighlight.lineSpecificWords;
  const lineSpecificWord = lineSpecificWords.filter(item => item.lineNumber === lineNumber);
  if (lineSpecificWord.length > 0) {
    lineSpecificWord.forEach(rule => {
      wordHighlight(rule.words);
    });
  }

  // highlight text with specific text between markers hlt:start:end
  const textBetween = parameters.defaultTextToHighlight.textBetween;
  for (const { from, to } of textBetween) {
    highlightBetween(from, to);
  }

  // highlight text within specific lines with text between markers hl:5|start:end, hlt:5-7|start:end
  const lineSpecificTextBetween = parameters.defaultTextToHighlight.lineSpecificTextBetween;
  const specificTextBetween = lineSpecificTextBetween.filter(item => item.lineNumber === lineNumber);
  if (specificTextBetween.length > 0) {
    specificTextBetween.forEach(rule => {
      highlightBetween(rule.from, rule.to);
    });
  }

  // highlight all words in specified line hlt:1,3-5
  if (parameters.defaultTextToHighlight.allWordsInLine.includes(lineNumber)) {
    highlightBetween('', '');
  }

  // highlight text in every line if linetext contains the specified word impt:test
  const altWords = parameters.alternativeTextToHighlight.words;
  for (const entry of altWords) {
    const { colorName, words } = entry;
    if (words.length > 0) {
      wordHighlight(words, colorName);
    }
  }

  // highlight text in specific lines if linetext contains the specified word impt:1|test,3-5|test
  const altLineSpecificWords = parameters.alternativeTextToHighlight.lineSpecificWords;
  const altLineSpecificWord = altLineSpecificWords.filter(item => item.lineNumber === lineNumber);
  if (altLineSpecificWord.length > 0) {
    altLineSpecificWord.forEach(rule => {
      const { colorName, words } = rule;
      wordHighlight(words, colorName);
    });
  }

  // highlight text with specific text between markers impt:start:end
  const altTextBetween = parameters.alternativeTextToHighlight.textBetween;
  altTextBetween.forEach(({ from, to, colorName }) => {
    highlightBetween(from, to, colorName);
  });

  // highlight text within specific lines with text between markers impt:5|start:end, imp:5-7|start:end
  const altLineSpecificTextBetween = parameters.alternativeTextToHighlight.lineSpecificTextBetween;
  const altSpecificTextBetween = altLineSpecificTextBetween.filter(item => item.lineNumber === lineNumber);
  if (altSpecificTextBetween.length > 0) {
    altSpecificTextBetween.forEach(rule => {
      highlightBetween(rule.from, rule.to, rule.colorName);
    });
  }

  // highlight all words in specified line impt:1,3-5
  const altAllWordsInLine = parameters.alternativeTextToHighlight.allWordsInLine;
  const altAllWordsInLineMatch = altAllWordsInLine.find(item => item.allWordsInLine.includes(lineNumber));
  if (altAllWordsInLineMatch) {
    highlightBetween('','', altAllWordsInLineMatch.colorName);
  }
}// textHighlight

function highlightWords(node: Node, word: string, alternativeName?: string): void {
  if (!word) {
    return;
  }

  const lowerCaseWord = word.toLowerCase();
  const className = alternativeName 
    ? `codeblock-customizer-highlighted-text-${alternativeName}` 
    : `codeblock-customizer-highlighted-text`;

  const createSpan = (text: string): HTMLSpanElement => {
    const span = document.createElement('span');
    span.className = className;
    span.appendChild(document.createTextNode(text));
    return span;
  };

  const processTextNode = (textNode: Text): void => {
    const textContent = textNode.textContent || '';
    const occurrences = findAllOccurrences(textContent.toLowerCase(), lowerCaseWord);

    if (occurrences.length === 0) return;

    const parentNode = textNode.parentNode;
    if (!parentNode) return;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;

    occurrences.forEach(index => {
      const beforeText = textContent.substring(lastIndex, index);
      const matchText = textContent.substring(index, index + word.length);

      if (beforeText) {
        fragment.appendChild(document.createTextNode(beforeText));
      }
      fragment.appendChild(createSpan(matchText));
      lastIndex = index + word.length;
    });

    const remainingText = textContent.substring(lastIndex);
    if (remainingText) {
      fragment.appendChild(document.createTextNode(remainingText));
    }

    parentNode.replaceChild(fragment, textNode);
  };

  const walkTree = (node: Node): void => {
    const textNodes: Text[] = [];
    const collectTextNodes = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        textNodes.push(node as Text);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        Array.from(node.childNodes).forEach(collectTextNodes);
      }
    };

    collectTextNodes(node);
    textNodes.forEach(processTextNode);
  };

  walkTree(node);
}// highlightWords

function parseInput(input: string, sourcePath: string, plugin: CodeBlockCustomizerPlugin): string {
  if (input === "") {
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

async function PDFExport(codeBlockElement: HTMLElement[], plugin: CodeBlockCustomizerPlugin, codeBlockFirstLines: string[], sourcePath: string, codeblockLines: string[]) {
  for (const [key, codeblockPreElement] of Array.from(codeBlockElement).entries()) {
    const codeblockParameters = codeBlockFirstLines[key];
    const parameters = getAllParameters(codeblockParameters, plugin.settings);  
    
    const codeblockCodeElement: HTMLPreElement | null = codeblockPreElement.querySelector("pre > code");
    if (!codeblockCodeElement)
      return;

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
    await addClasses(codeblockPreElement, parameters, codeblockLines, plugin, codeblockCodeElement as HTMLElement, null, codeblockLanguageSpecificClass, sourcePath);
  }
}// PDFExport

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
