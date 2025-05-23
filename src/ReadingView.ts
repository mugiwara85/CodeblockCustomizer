import { MarkdownView, MarkdownPostProcessorContext, sanitizeHTMLToDom, setIcon, MarkdownSectionInformation, MarkdownRenderer, loadPrism, Notice } from "obsidian";

import { getLanguageIcon, createContainer, createCodeblockLang, createCodeblockIcon, createFileName, createCodeblockCollapse, getCurrentMode, getBorderColorByLanguage, removeCharFromStart, createUncollapseCodeButton, addTextToClipboard, getLanguageSpecificColorClass, findAllOccurrences, Parameters, getAllParameters, getPropertyFromLanguageSpecificColors, getLanguageConfig, getFileCacheAndContentLines, PromptEnvironment, getPWD, createPromptContext, PromptCache, renderPromptLine, computePromptLines } from "./Utils";
import CodeBlockCustomizerPlugin from "./main";
import { CodeblockCustomizerSettings, ThemeSettings } from "./Settings";
import { fadeOutLineCount } from "./Const";

import { visitParents } from "unist-util-visit-parents";
import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";

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
  }

  const sectionInfo: MarkdownSectionInformation | null = context.getSectionInfo(preElements[0]);
  if (!sectionInfo)
    return;

  const codeblockLines = Array.from({length: sectionInfo.lineEnd - sectionInfo.lineStart + 1}, (_,number) => number + sectionInfo.lineStart).map((lineNumber) => sectionInfo.text.split('\n')[lineNumber]);
  const codeLines = Array.from(codeblockLines);
  if (codeLines.length >= 2) {
    codeLines.shift();
    codeLines.pop();
  }
  const indentationLevels = trackIndentation(codeLines);
  const codeBlockFirstLines = getCodeBlocksFirstLines(codeblockLines);

  await processCodeBlockFirstLines(preElements, codeBlockFirstLines, indentationLevels, codeblockLines, context.sourcePath, plugin);
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
  const spaceIndentRegex = /^( {0,4}|\t)*/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = line.match(spaceIndentRegex);
    let currentIndentLevel = 0;

    if (match) {
      const indentation = match[0];
      currentIndentLevel = calculateIndentLevel(indentation);
    }

    const nextLine = lines[i + 1] ?? "";
    let nextIndentLevel = 0;

    if (nextLine) {
      const nextMatch = nextLine.match(spaceIndentRegex);

      if (nextMatch) {
        const nextIndentation = nextMatch[0];
        nextIndentLevel = calculateIndentLevel(nextIndentation);
      }
    }

    const info: IndentationInfo = {
      indentationLevels: currentIndentLevel,
      insertCollapse: nextIndentLevel > currentIndentLevel,
    };

    result.push(info);
  }

  return result;
}// trackIndentation

function calculateIndentLevel(indentation: string): number {
  let indentLevel = 0;
  let spaceCount = 0;

  for (const char of indentation) {
    if (char === '\t') {
      indentLevel += 1;
      spaceCount = 0;
    } else if (char === ' ') {
      spaceCount += 1;
      if (spaceCount === 4) {
        indentLevel += 1;
        spaceCount = 0;
      }
    }
  }

  // Handle remaining spaces less than 4
  if (spaceCount > 0) {
    indentLevel += 1;
  }

  return indentLevel;
}// calculateIndentLevel

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
    await processCodeBlockFirstLines(calloutPreElements, codeBlockFirstLines, null, [], context.sourcePath, plugin);
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

async function checkCustomSyntaxHighlight(parameters: Parameters, codeblockLines: string[], preCodeElm: HTMLElement, plugin: CodeBlockCustomizerPlugin ){
  const customLangConfig = getLanguageConfig(parameters.language, plugin);
  const customFormat = customLangConfig?.format ?? undefined;
  if (customFormat){
    const highlightedLines = await addCustomSyntaxHighlight(codeblockLines, customFormat);
    if (highlightedLines.length > 0){
      preCodeElm.innerHTML = highlightedLines;
    }
  }
}// checkCustomSyntaxHighlight

async function processCodeBlockFirstLines(preElements: HTMLElement[], codeBlockFirstLines: string[], indentationLevels: IndentationInfo[] | null, codeblockLines: string[], sourcepath: string, plugin: CodeBlockCustomizerPlugin ) {
  if (preElements.length !== codeBlockFirstLines.length)
    return;

  for (const [key, preElement] of preElements.entries()) {
    const codeBlockFirstLine = codeBlockFirstLines[key];
    const preCodeElm = preElement.querySelector('pre > code');

    if (!preCodeElm)
      return;

    if (preCodeElm.querySelector("code [class*='codeblock-customizer-line']"))
      continue;

    if (Array.from(preCodeElm.classList).some(className => /^language-\S+/.test(className)))
      while(!preCodeElm.classList.contains("is-loaded"))
        await sleep(2);

    const parameters = getAllParameters(codeBlockFirstLine, plugin.settings);
    if (parameters.exclude)
      continue;

    await checkCustomSyntaxHighlight(parameters, codeblockLines, preCodeElm as HTMLElement, plugin);

    const codeblockLanguageSpecificClass = getLanguageSpecificColorClass(parameters.language, plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors);
    await addClasses(preElement, parameters, plugin, preCodeElm as HTMLElement, indentationLevels, codeblockLanguageSpecificClass, sourcepath);
  }
}// processCodeBlockFirstLines

async function addClasses(preElement: HTMLElement, parameters: Parameters, plugin: CodeBlockCustomizerPlugin, preCodeElm: HTMLElement, indentationLevels: IndentationInfo[] | null, codeblockLanguageSpecificClass: string, sourcePath: string) {
  const frag = document.createDocumentFragment();
  
  preElement.classList.add(`codeblock-customizer-pre`);  
  preElement.classList.add(`codeblock-customizer-language-` + (parameters.language.length > 0 ? parameters.language.toLowerCase() : "nolang"));

  if (codeblockLanguageSpecificClass)
    preElement.classList.add(codeblockLanguageSpecificClass);

  if (preElement.parentElement)
    preElement.parentElement.classList.add(`codeblock-customizer-pre-parent`);

  const buttons = createButtons(parameters);
  frag.appendChild(buttons);

  const header = HeaderWidget(preElement as HTMLPreElement, parameters, plugin.settings, sourcePath, plugin);
  frag.insertBefore(header, frag.firstChild);
	
  preElement.insertBefore(frag, preElement.firstChild);

  const lines = Array.from(preCodeElm.innerHTML.split('\n')) || 0;
  if (parameters.fold) {
    toggleFoldClasses(preElement as HTMLPreElement, lines.length - 1, parameters.fold, plugin.settings.SelectedTheme.settings.semiFold.enableSemiFold, plugin.settings.SelectedTheme.settings.semiFold.visibleLines);
  }/* else {
    isFoldable(preElement as HTMLPreElement, lines.length - 1, plugin.settings.SelectedTheme.settings.semiFold.enableSemiFold, plugin.settings.SelectedTheme.settings.semiFold.visibleLines);
  }*/
	
  const borderColor = getBorderColorByLanguage(parameters.language, getPropertyFromLanguageSpecificColors("codeblock.borderColor", plugin.settings));
  if (borderColor.length > 0)
    preElement.classList.add(`hasLangBorderColor`);

  await highlightLines(preCodeElm, parameters, plugin.settings.SelectedTheme.settings, indentationLevels, sourcePath, plugin);
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

function createButtons(parameters: Parameters){
  const container = createDiv({cls: `codeblock-customizer-button-container`});
  const frag = document.createDocumentFragment();

  const copyButton = createCopyButton(parameters.displayLanguage);
  copyButton.addEventListener("click", copyCode);
  frag.appendChild(copyButton);

  const wrapCodeButton = createWrapCodeButton();
  wrapCodeButton.addEventListener("click", wrapCode);
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

function copyCode(event: Event) {
  const button = event.currentTarget as HTMLElement;
  const preElement = button.parentNode?.parentNode;
  if (!preElement)
    return;

  const lines = preElement.querySelectorAll("code");
  const codeTextArray: string[] = [];

  lines.forEach((line, index) => {
    //const codeElements = line.querySelectorAll('.codeblock-customizer-line-text');
    const codeElements = line.querySelectorAll('.codeblock-customizer-line-text:not(.codeblock-customizer-prompt-cmd-output)');
    codeElements.forEach((codeElement, codeIndex) => {
      const textContent = codeElement.textContent || "";
      codeTextArray.push(textContent);
      if (codeIndex !== codeElements.length - 1)
        codeTextArray.push('\n');
    });
  });

  const concatenatedCodeText = codeTextArray.join('');
  addTextToClipboard(concatenatedCodeText);
}// copyCode

function wrapCode(event: Event) {
  const button = event.currentTarget as HTMLElement;
  const preElement = button.parentNode?.parentNode;
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
      await PDFExport(preElements, plugin, codeBlockFirstLines, context.sourcePath);
  } catch (error) {
    console.error(`Error exporting to PDF: ${error.message}`);
    return;
  }
  return;
}// handlePDFExport

function HeaderWidget(preElements: HTMLPreElement, parameters: Parameters, settings: CodeblockCustomizerSettings, sourcePath: string, plugin: CodeBlockCustomizerPlugin) {
  const parent = preElements.parentNode;
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
  if ((plugin.settings.SelectedTheme.settings.header.disableFoldUnlessSpecified && !plugin.settings.SelectedTheme.settings.codeblock.inverseFold && !parameters.fold) ||
      (plugin.settings.SelectedTheme.settings.header.disableFoldUnlessSpecified && plugin.settings.SelectedTheme.settings.codeblock.inverseFold && !parameters.unfold)) {
    container.classList.add(`noCollapseIcon`);
  } else {
    frag.appendChild(collapseEl);
  }
  
  container.appendChild(frag);

  if (parent)
    parent.insertBefore(container, preElements);
  
  const semiFold = settings.SelectedTheme.settings.semiFold.enableSemiFold;
  const visibleLines = settings.SelectedTheme.settings.semiFold.visibleLines;

  // Add event listener to the widget element
  container.addEventListener("click", function() {
    //collapseEl.innerText = preElements.classList.contains(`codeblock-customizer-codeblock-collapsed`) ? "-" : "+";
    if ((plugin.settings.SelectedTheme.settings.header.disableFoldUnlessSpecified && !plugin.settings.SelectedTheme.settings.codeblock.inverseFold && !parameters.fold) ||
        (plugin.settings.SelectedTheme.settings.header.disableFoldUnlessSpecified && plugin.settings.SelectedTheme.settings.codeblock.inverseFold && !parameters.unfold)) {
      return;
    }
    if (semiFold) {
      const codeElements = preElements.getElementsByTagName("CODE");
      const lines = convertHTMLCollectionToArray(codeElements, true);
      if (lines.length >= visibleLines + fadeOutLineCount) {
        toggleFold(preElements, collapseEl, `codeblock-customizer-codeblock-semi-collapsed`);
      } else
        toggleFold(preElements, collapseEl, `codeblock-customizer-codeblock-collapsed`);
    } else {
      toggleFold(preElements, collapseEl, `codeblock-customizer-codeblock-collapsed`);
    }
  });
  
  if (parameters.fold) {
    if (semiFold) {
      const preCodeElm = preElements.querySelector("pre > code");
      let codeblockLineCount = 0;
      if (preCodeElm) {
        let codeblockLines = preCodeElm.innerHTML.split("\n");
        if (codeblockLines.length == 1)
          codeblockLines = ['',''];
        codeblockLineCount = codeblockLines.length - 1;
      }
      if (codeblockLineCount >= visibleLines + fadeOutLineCount) {
        preElements.classList.add(`codeblock-customizer-codeblock-semi-collapsed`);
      } else 
        preElements.classList.add(`codeblock-customizer-codeblock-collapsed`);
    }
    else
      preElements.classList.add(`codeblock-customizer-codeblock-collapsed`);
    preElements.classList.add(`codeblock-customizer-codeblock-default-collapse`);
  }

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

function createLineTextElement(line: string) {
  const lineText = line !== "" ? line : "<br>";
  const sanitizedText = sanitizeHTMLToDom(lineText);
  const lineContentWrapper = createDiv({cls: `codeblock-customizer-line-text`, text: sanitizedText});
  
  return lineContentWrapper;
}// createLineTextElement

function addIndentLine(inputString: string, insertCollapse = false): string {
  const indentRegex = /^(?:\t+|( {4})*)/;
  const match = inputString.match(indentRegex);
  const indent = match ? match[0] : '';
  const isTabIndentation = /\t/.test(indent);
  const numIndentCharacters = isTabIndentation ? (indent.match(/\t/g) || []).length : (indent.match(/ {4}/g) || []).length;
  const indentSpan = createSpan({cls: "codeblock-customizer-indentation-guide", text: isTabIndentation ? "\t" : "    "});
  
  const spans = Array(numIndentCharacters).fill(indentSpan.outerHTML).join('');
  const lastIndentPosition = isTabIndentation ? numIndentCharacters : numIndentCharacters * 4;
  const indicator = createSpan({cls: "codeblock-customizer-collapse-indicator"});
  const iconSpan = createSpan({cls: "codeblock-customizer-collapse-icon"});
  indicator.appendChild(iconSpan);

  let modifiedString = "";
  if (insertCollapse) {
    modifiedString = inputString.slice(0, lastIndentPosition) + indicator.outerHTML + inputString.slice(lastIndentPosition);
  }
  
  const stringWithSpans = inputString.replace(indentRegex, spans);

  return insertCollapse ? modifiedString.replace(indentRegex, spans) : stringWithSpans;
}// addIndentLine

function extractLinesFromHTML(preCodeElm: HTMLElement): { htmlLines: string[]; textLines: string[] } {
  const tree = fromHtml(preCodeElm.innerHTML.replace(/\n/g, "<br>"), { fragment: true });
  let htmlContent = preCodeElm.innerHTML;

  visitParents(tree, ["text", "element"], (node, parents) => {
    if (node.type === "element" && node.tagName === "br") {
      htmlContent = replaceNewlineWithBr(htmlContent, parents);
    }
  });

  const splitTree = fromHtml(htmlContent);
  htmlContent = toHtml(splitTree);

  let htmlLines = htmlContent.split("<br>");
  if (htmlLines.length === 1)
    htmlLines = ["", ""];

  let textLines = preCodeElm.textContent?.split("\n") ?? [];
  if (textLines.length === 1 && htmlLines.length === 2 && htmlLines[0] === "" && htmlLines[1] === "") {
    textLines = ["", ""];
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

function isLineHighlighted(lineNumber: number, caseInsensitiveLineText: string, parameters: Parameters) {
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
    result.color = altHLMatch[0].colorName; // Assuming `colorName` is a property in the `lines` object
  } else if (isAlternativeHighlightedByWord) {
    result.isHighlighted = true;
    result.color = isAlternativeHighlightedByWordColor;
  } else if (isAlternativeHighlightedByLineSpecificWord) {
    result.isHighlighted = true;
    result.color = isAlternativeHighlightedByLineSpecificWordColor;
  }

  return result;
}// isLineHighlighted

async function highlightLines(preCodeElm: HTMLElement, parameters: Parameters, settings: ThemeSettings, indentationLevels: IndentationInfo[] | null, sourcePath: string, plugin: CodeBlockCustomizerPlugin) {
  if (!preCodeElm) 
    return;
  
  const { htmlLines, textLines } = extractLinesFromHTML(preCodeElm);
  const codeblockLen = htmlLines.length - 1;
  const useSemiFold = codeblockLen >= settings.semiFold.visibleLines + fadeOutLineCount;

  let fadeOutLineIndex = 0;

  const totalLines = htmlLines.length - 1;
  const promptLines = computePromptLines(parameters, totalLines);

  const { context, initialEnv } = createPromptContext(parameters, plugin.settings);
  let promptEnv = { ...initialEnv };
  let cache: PromptCache = { key: "", node: null };
  
  const frag = document.createDocumentFragment();
  
  htmlLines.forEach((htmlLine, index) => {
    if (index === htmlLines.length - 1)
      return;

    const lineNumber = index + 1;
    const caseInsensitiveLineText = htmlLine.toLowerCase();
    const hideCommandOutput = useSemiFold && lineNumber > settings.semiFold.visibleLines;

    const { lineWrapper, updatedFadeOutLineIndex } = getLineClass(lineNumber, caseInsensitiveLineText, parameters, settings, useSemiFold, fadeOutLineIndex);
    fadeOutLineIndex = updatedFadeOutLineIndex;

    const lineNumberEl = createLineNumberElement(lineNumber + parameters.lineNumberOffset, parameters.showNumbers);
    lineWrapper.appendChild(lineNumberEl);
    const textLine = textLines[index];
    const isPromptLine = promptLines.has(lineNumber + parameters.lineNumberOffset);
    if (isPromptLine) {
      lineWrapper.classList.add("has-prompt");
      const snapshot = { ...promptEnv };
      const { /*promptData,*/ newEnv, newCache, node } = renderPromptLine(textLine, snapshot, cache, context);
      //const promptNode = addClassesToPrompt(promptData, context.isCustom ? context.promptDef.name : context.promptType, context.promptDef, plugin.settings, snapshot.user === "root");
      //lineWrapper.appendChild(promptNode);
      lineWrapper.appendChild(node);

      promptEnv = newEnv;
      cache = newCache;
    }
      
    const indentedLine = addIndentLine(htmlLine, (indentationLevels && indentationLevels[lineNumber - 1]) ? indentationLevels[lineNumber - 1].insertCollapse : false);
    const lineTextEl = createLineTextElement(settings.codeblock.enableLinks ? parseInput(indentedLine, sourcePath, plugin) : indentedLine);
    textHighlight(parameters, lineNumber, lineTextEl);

    if (indentationLevels && indentationLevels[lineNumber - 1]) {
      const collapseIcon = lineTextEl.querySelector(".codeblock-customizer-collapse-icon");
      if (collapseIcon) {
        setIcon(collapseIcon as HTMLElement, "chevron-down");
        collapseIcon.addEventListener("click", handleClick);
      }
    }

    lineWrapper.appendChild(lineTextEl);
    lineWrapper.setAttribute("indentLevel", indentationLevels && indentationLevels[lineNumber - 1] ? indentationLevels[lineNumber - 1].indentationLevels.toString() : "-1");
    frag.appendChild(lineWrapper);

    if (isPromptLine) {
      const outputLines = addCommandOutput(textLine, parameters, promptEnv, hideCommandOutput, lineNumber);
      for (const outputLine of outputLines) {
        frag.appendChild(outputLine);
      }
    }
  });
  preCodeElm.appendChild(frag);
}// highlightLines

function addCommandOutput(lineText: string, parameters: Parameters, env: PromptEnvironment, hideCommandOutput: boolean, lineNumber: number) {
  const outputElements: HTMLElement[] = [];
  // pwd command
  if (/^\s*pwd\s*$/.test(lineText)) {
    outputElements.push(appendCommandOutputLine(getPWD(env), 'codeblock-customizer-prompt-cmd-output codeblock-customizer-workingdir', parameters, hideCommandOutput, lineText.toLowerCase(), lineNumber));
  }
  
  // whoami command
  if (/^\s*whoami\s*$/.test(lineText)) 
    outputElements.push(appendCommandOutputLine(env.user, 'codeblock-customizer-prompt-cmd-output codeblock-customizer-whoami', parameters, hideCommandOutput, lineText.toLowerCase(), lineNumber));

  return outputElements;
}// addCommandOutput

function appendCommandOutputLine(text: string, cls: string, parameters: Parameters, hideCommandOutput: boolean, caseInsensitiveLineText: string, lineNumber: number) {
  const classes = ['has-prompt', 'codeblock-customizer-line', 'codeblock-customizer-cmdoutput-line'];
  
  if (hideCommandOutput) {
    classes.push('codeblock-customizer-fade-out-line-hide');
  }

  const outputLine = createDiv({ cls: classes.join(' ') });
  const outputText = createDiv({ cls: `${cls} codeblock-customizer-line-text`, text });
  const result = isLineHighlighted(lineNumber, caseInsensitiveLineText, parameters);
  if (result.isHighlighted) {
    if (result.color) {
      outputLine.classList.add(`codeblock-customizer-line-highlighted-${result.color.replace(/\s+/g, '-').toLowerCase()}`);
    } else {
      outputLine.classList.add(`codeblock-customizer-line-highlighted`);
    }
  }

  const emptyLineNumber = createLineNumberElement(-1, parameters.showNumbers);
  outputLine.appendChild(emptyLineNumber);
  outputLine.appendChild(outputText);

  return outputLine;
}// appendCommandOutputLine

function getLineClass(lineNumber: number, caseInsensitiveLineText: string, parameters: Parameters, settings: ThemeSettings, useSemiFold: boolean, fadeOutLineIndex: number) { 
  const lineWrapper = createDiv();
  let updatedFadeOutLineIndex = fadeOutLineIndex;

  const result = isLineHighlighted(lineNumber, caseInsensitiveLineText, parameters);
  if (result.isHighlighted) {
    if (result.color) {
      lineWrapper.classList.add(`codeblock-customizer-line-highlighted-${result.color.replace(/\s+/g, '-').toLowerCase()}`);
    } else {
      lineWrapper.classList.add(`codeblock-customizer-line-highlighted`);
    }
  } else {
    lineWrapper.classList.add(`codeblock-customizer-line`);
  }

  if (useSemiFold && lineNumber > settings.semiFold.visibleLines && fadeOutLineIndex < fadeOutLineCount) {
    lineWrapper.classList.add(`codeblock-customizer-fade-out-line${fadeOutLineIndex}`);
    updatedFadeOutLineIndex++;
    if (fadeOutLineIndex === fadeOutLineCount - 1) {
      const uncollapseCodeButton = createUncollapseCodeButton();
      uncollapseCodeButton.addEventListener("click", handleUncollapseClick);
      lineWrapper.appendChild(uncollapseCodeButton);
    }
  }

  if (useSemiFold && lineNumber > settings.semiFold.visibleLines + fadeOutLineCount) {
    lineWrapper.classList.add(`codeblock-customizer-fade-out-line-hide`);
  }

  return { lineWrapper, updatedFadeOutLineIndex };
}// getLineClass

interface RangeToHighlight {
  nodesToHighlight: Node[];
  startNode: Node;
  startOffset: number;
  endNode: Node;
  endOffset: number;
}

function textHighlight(parameters: Parameters, lineNumber: number, lineTextEl: HTMLDivElement) {
  const caseInsensitiveLineText = (lineTextEl.textContent ?? '').toLowerCase();

  const wordHighlight = (words: string[], name = '') => {
    const caseInsensitiveWords = words.map(word => word.toLowerCase());
    for (const word of caseInsensitiveWords) {
      highlightWords(lineTextEl, word, name);
    }
  };

  const highlightBetween = (from: string, to: string, name = '') => {
    const caseInsensitiveFrom = from.toLowerCase();
    const caseInsensitiveTo = to.toLowerCase();
  
    const walkAndHighlight = (node: Node, searchTextFrom: string | null, searchTextTo: string | null) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
      let firstNonWhitespaceNode: Node | null = null;
      let firstNonWhitespaceOffset = 0;
      let lastNode: Node | null = null;
      let lastNodeOffset = 0;
      const nodesToHighlight: Node[] = [];
      let searchTextToFound = false;
    
      while (walker.nextNode()) {
        const currentNode = walker.currentNode;
        const textContent = currentNode.textContent?.toLowerCase() || '';
    
        if (!firstNonWhitespaceNode && textContent.trim().length > 0) {
          if (searchTextFrom) {
            if (textContent.includes(searchTextFrom)) {
              firstNonWhitespaceNode = currentNode;
              firstNonWhitespaceOffset = textContent.indexOf(searchTextFrom);
            }
          } else {
            firstNonWhitespaceNode = currentNode;
            firstNonWhitespaceOffset = textContent.search(/\S/);
          }
        }
    
        if (firstNonWhitespaceNode) {
          nodesToHighlight.push(currentNode);
          if (searchTextTo && textContent.includes(searchTextTo)) {
            const tempOffset = textContent.indexOf(searchTextTo) + searchTextTo.length;
            if (tempOffset > firstNonWhitespaceOffset) {
              lastNode = currentNode;
              lastNodeOffset = tempOffset;
              searchTextToFound = true;
              break;
            } else {
              let position = tempOffset;
              while ((position = textContent.indexOf(searchTextTo, position + 1)) !== -1) {
                if (position > firstNonWhitespaceOffset) {
                  lastNode = currentNode;
                  lastNodeOffset = position + searchTextTo.length;
                  searchTextToFound = true;
                  break;
                }
              }
              if (searchTextToFound) 
                break;
            }
          }
        }
      }
    
      if (nodesToHighlight.length > 0 && firstNonWhitespaceNode && (searchTextFrom || searchTextToFound || (!searchTextFrom && !searchTextTo))) {
        const startNode = firstNonWhitespaceNode;
        const endNode = lastNode || nodesToHighlight[nodesToHighlight.length - 1];
        const startOffset = firstNonWhitespaceOffset;
        const endOffset = lastNodeOffset || endNode.textContent?.length || 0;
    
        const rangeToHighlight: RangeToHighlight = {
          nodesToHighlight,
          startNode,
          startOffset,
          endNode,
          endOffset,
        };
    
        highlightNodesRange(rangeToHighlight, name);
      }
    };

    const highlightEntireText = (node: Node) => {
      walkAndHighlight(node, null, null);
    };

    const highlightFromStart = (node: Node, searchTextFrom: string) => {
      walkAndHighlight(node, searchTextFrom, null);
    };

    const highlightUntilEnd = (node: Node, searchTextTo: string) => {
      walkAndHighlight(node, null, searchTextTo);
    };

    /*const highlightFromTo = (node: Node, searchTextFrom: string, searchTextTo: string) => {
      walkAndHighlight(node, searchTextFrom, searchTextTo);
    };*/
  
    if (!caseInsensitiveFrom && !caseInsensitiveTo) {
      highlightEntireText(lineTextEl);
    } else if (caseInsensitiveFrom && !caseInsensitiveTo) {
      highlightFromStart(lineTextEl, caseInsensitiveFrom.toLowerCase());
    } else if (!caseInsensitiveFrom && caseInsensitiveTo) {
      highlightUntilEnd(lineTextEl, caseInsensitiveTo.toLowerCase());
    } else if (caseInsensitiveFrom && caseInsensitiveTo) {
      //highlightFromTo(lineTextEl, caseInsensitiveFrom.toLowerCase(), caseInsensitiveTo.toLowerCase());
      highlightFromTo(lineTextEl, from, to, name);
    }
  };
  
  const highlightNodesRange = (range: RangeToHighlight, name: string) => {
    const { nodesToHighlight, startNode, startOffset, endNode, endOffset } = range;
    let currentStartOffset = startOffset; // Change this line
  
    for (const currentNode of nodesToHighlight) {
      if (currentNode.nodeType === Node.TEXT_NODE) {
        const span = createSpan();
        span.className = name ? `codeblock-customizer-highlighted-text-${name}` : 'codeblock-customizer-highlighted-text';
        
        let textToHighlight = '';
        if (currentNode === startNode && currentNode === endNode) {
          textToHighlight = currentNode.textContent?.substring(currentStartOffset, endOffset) || '';
        } else if (currentNode === startNode) {
          textToHighlight = currentNode.textContent?.substring(currentStartOffset) || '';
        } else if (currentNode === endNode) {
          textToHighlight = currentNode.textContent?.substring(0, endOffset) || '';
        } else {
          textToHighlight = currentNode.textContent || '';
        }
  
        span.appendChild(document.createTextNode(textToHighlight));
  
        const beforeText = document.createTextNode(currentNode.textContent?.substring(0, currentStartOffset) || '');
        const afterText = currentNode === endNode ? document.createTextNode(currentNode.textContent?.substring(endOffset) || '') : document.createTextNode('');
  
        const parentNode = currentNode.parentNode;
        if (parentNode) {
          parentNode.replaceChild(afterText, currentNode);
          parentNode.insertBefore(span, afterText);
          parentNode.insertBefore(beforeText, span);
        }
  
        currentStartOffset = 0; // Reset startOffset after the first node
      }
    }
  };

  // highlight text in every line if linetext contains the specified word hlt:test
  const words = parameters.defaultTextToHighlight.words;
  if (words.length > 0) {
    wordHighlight(words);
  }

  // highlight text in specific lines if linetext contains the specified word hlt:1|test,3-5|test
  const lineSpecificWords = parameters.defaultTextToHighlight.lineSpecificWords;
  const lineSpecificWord = lineSpecificWords.find(item => item.lineNumber === lineNumber);
  if (lineSpecificWord) {
    wordHighlight(lineSpecificWord.words);
  }

  // highlight text with specific text between markers hlt:start:end
  const textBetween = parameters.defaultTextToHighlight.textBetween;
  for (const { from, to } of textBetween) {
    if (caseInsensitiveLineText.includes(from.toLowerCase()) && caseInsensitiveLineText.includes(to.toLowerCase())) {
      highlightBetween(from, to);
    }
  }

  // highlight text within specific lines with text between markers hl:5|start:end, hlt:5-7|start:end
  const lineSpecificTextBetween = parameters.defaultTextToHighlight.lineSpecificTextBetween;
  const specificTextBetween = lineSpecificTextBetween.find(item => item.lineNumber === lineNumber);
  if (specificTextBetween) {
    if (caseInsensitiveLineText.includes(specificTextBetween.from.toLowerCase()) && caseInsensitiveLineText.includes(specificTextBetween.to.toLowerCase())) {
      highlightBetween(specificTextBetween.from, specificTextBetween.to);
    }
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
  const altLineSpecificWord = altLineSpecificWords.find(item => item.lineNumber === lineNumber);
  if (altLineSpecificWord) {
    const { colorName, words } = altLineSpecificWord;
    wordHighlight(words, colorName);
  }

  // highlight text with specific text between markers impt:start:end
  const altTextBetween = parameters.alternativeTextToHighlight.textBetween;
  altTextBetween.forEach(({ from, to, colorName }) => {
    highlightBetween(from, to, colorName);
  });

  // highlight text within specific lines with text between markers impt:5|start:end, imp:5-7|start:end
  const altLineSpecificTextBetween = parameters.alternativeTextToHighlight.lineSpecificTextBetween;
  const altSpecificTextBetween = altLineSpecificTextBetween.find(item => item.lineNumber === lineNumber);
  if (altSpecificTextBetween) {
    altLineSpecificTextBetween.forEach(({ lineNumber: altLineNumber, from, to, colorName }) => {
      if (lineNumber === altLineNumber) {
        highlightBetween(from, to, colorName);
      }
    });
  }

  // highlight all words in specified line impt:1,3-5
  const altAllWordsInLine = parameters.alternativeTextToHighlight.allWordsInLine;
  const altAllWordsInLineMatch = altAllWordsInLine.find(item => item.allWordsInLine.includes(lineNumber));
  if (altAllWordsInLineMatch) {
    highlightBetween('','', altAllWordsInLineMatch.colorName);
  }
}// textHighlight

function highlightFromTo(node: Node, from: string, to: string, alternativeName?: string): void {
  const className = alternativeName 
    ? `codeblock-customizer-highlighted-text-${alternativeName}` 
    : `codeblock-customizer-highlighted-text`;

  const createSpan = (text: string): HTMLSpanElement => {
    const span = document.createElement('span');
    span.className = className;
    span.appendChild(document.createTextNode(text));
    return span;
  };

  const collectTextNodes = (node: Node, textNodes: Text[]): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      textNodes.push(node as Text);
    } else {
      node.childNodes.forEach(child => collectTextNodes(child, textNodes));
    }
  };

  const highlightRanges = (textNodes: Text[], ranges: { start: number, end: number }[]): void => {
    let currentIndex = 0;
    let currentRangeIndex = 0;
    let currentRange = ranges[currentRangeIndex];

    textNodes.forEach(textNode => {
      if (!currentRange) return;
      const textContent = textNode.textContent || '';
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;

      while (currentRange && lastIndex < textContent.length) {
        const rangeStart = currentRange.start - currentIndex;
        const rangeEnd = currentRange.end - currentIndex;

        if (rangeStart >= 0 && rangeStart < textContent.length) {
          // Text before the range
          if (rangeStart > lastIndex) {
            fragment.appendChild(document.createTextNode(textContent.substring(lastIndex, rangeStart)));
          }

          // Text within the range
          if (rangeEnd <= textContent.length) {
            fragment.appendChild(createSpan(textContent.substring(rangeStart, rangeEnd)));
            lastIndex = rangeEnd;
            currentRangeIndex++;
            currentRange = ranges[currentRangeIndex];
          } else {
            fragment.appendChild(createSpan(textContent.substring(rangeStart)));
            lastIndex = textContent.length;
            currentRange.start += textContent.length - rangeStart;
          }
        } else {
          break;
        }
      }

      // Append remaining text
      if (lastIndex < textContent.length) {
        fragment.appendChild(document.createTextNode(textContent.substring(lastIndex)));
      }

      const parentNode = textNode.parentNode;
      if (parentNode) {
        parentNode.replaceChild(fragment, textNode);
      }

      currentIndex += textContent.length;
    });
  };

  const findRanges = (text: string, from: string, to: string): { start: number, end: number }[] => {
    const ranges = [];
    let startIndex = text.toLowerCase().indexOf(from.toLowerCase());

    while (startIndex !== -1) {
      const endIndex = text.toLowerCase().indexOf(to.toLowerCase(), startIndex + from.length);
      if (endIndex === -1) break;

      ranges.push({ start: startIndex, end: endIndex + to.length });
      startIndex = text.toLowerCase().indexOf(from.toLowerCase(), endIndex + to.length);
    }

    return ranges;
  };

  const textNodes: Text[] = [];
  collectTextNodes(node, textNodes);

  const concatenatedText = textNodes.map(node => node.textContent).join('');
  const ranges = findRanges(concatenatedText, from, to);

  highlightRanges(textNodes, ranges);
}// highlightFromTo

function highlightWords(node: Node, word: string, alternativeName?: string): void {
  if (!word) return;

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
  if (input === "") 
    return input;

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
  const header = button.parentElement?.parentElement?.previousSibling?.previousSibling as HTMLElement;
  const pre = button.parentElement?.parentElement?.previousSibling?.parentElement;
    
  if (!codeElement)
    return;
    
  //removeFadeEffect(codeElement.children, false);

  if (header) {
    const collapseIcon = header.querySelector(".codeblock-customizer-header-collapse") as HTMLElement;
    if (collapseIcon && pre) {
      toggleFold(pre, collapseIcon, `codeblock-customizer-codeblock-semi-collapsed`);
    }
  }
}// handleUncollapseClick

function toggleFold(pre: HTMLElement, collapseIcon: HTMLElement, toggleClass: string) {
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

async function PDFExport(codeBlockElement: HTMLElement[], plugin: CodeBlockCustomizerPlugin, codeBlockFirstLines: string[], sourcePath: string) {
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
    await addClasses(codeblockPreElement, parameters, plugin, codeblockCodeElement as HTMLElement, null, codeblockLanguageSpecificClass, sourcePath);
  }
}// PDFExport

// does not support if folding is disabled
export function foldAllReadingView(fold: boolean, settings: CodeblockCustomizerSettings) {
  const preParents = document.querySelectorAll('.codeblock-customizer-pre-parent');
  preParents.forEach((preParent) => {
    const preElement = preParent.querySelector('.codeblock-customizer-pre');
    
    let lines: Element[] = [];
    if (preElement){
      const codeElements = preElement?.getElementsByTagName("CODE");
      lines = convertHTMLCollectionToArray(codeElements, true);
    }

    toggleFoldClasses(preElement as HTMLPreElement, lines.length, fold, settings.SelectedTheme.settings.semiFold.enableSemiFold, settings.SelectedTheme.settings.semiFold.visibleLines);
  });
}//foldAllreadingView

export function toggleFoldClasses(preElement: HTMLPreElement, linesLength: number, fold: boolean, enableSemiFold: boolean, visibleLines: number) {
  if (fold) {
    if (enableSemiFold) {
      if (linesLength >= visibleLines + fadeOutLineCount) {
        preElement?.classList.add('codeblock-customizer-codeblock-semi-collapsed');
      } else
        preElement?.classList.add('codeblock-customizer-codeblock-collapsed');
    }
    else
      preElement?.classList.add('codeblock-customizer-codeblock-collapsed');
  }
  else {
    if (enableSemiFold) {
      if (linesLength >= visibleLines + fadeOutLineCount) {
        preElement?.classList.remove('codeblock-customizer-codeblock-semi-collapsed');
      } else
        preElement?.classList.remove('codeblock-customizer-codeblock-collapsed');
    } else
      preElement?.classList.remove('codeblock-customizer-codeblock-collapsed');
  }
}// toggleFoldClasses

function getCodeBlocksFirstLines(array: string[]): string[] {
  if (!array || !Array.isArray(array)) 
    return [];

  const codeBlocks: string[] = [];
  let inCodeBlock = false;
  let openingBackticks = 0;

  for (let i = 0; i < array.length; i++) {
    let line = array[i] ?? "";
    line = removeCharFromStart(line.trim(), ">");

    const backtickMatch = line.match(/^`+(?!.*`)/);
    if (backtickMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        openingBackticks = backtickMatch[0].length;
        codeBlocks.push(line);
      } else { 
        if (backtickMatch[0].length === openingBackticks) {
          inCodeBlock = false;
          openingBackticks = 0;
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
