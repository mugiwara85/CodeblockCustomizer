import { MarkdownView, MarkdownPostProcessorContext, sanitizeHTMLToDom, TFile, setIcon, MarkdownSectionInformation, MarkdownRenderer, loadPrism } from "obsidian";

import { getLanguageIcon, createContainer, createCodeblockLang, createCodeblockIcon, createFileName, createCodeblockCollapse, getCurrentMode, getBorderColorByLanguage, removeCharFromStart, createUncollapseCodeButton, addTextToClipboard, getLanguageSpecificColorClass, getValueNameByLineNumber, findAllOccurrences, Parameters, getAllParameters, getPropertyFromLanguageSpecificColors, getLanguageConfig } from "./Utils";
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
  const spaceIndentRegex = /^( {4}|\t)*/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(spaceIndentRegex);
    let currentIndentLevel = 0;

    if (match) {
      const indentation = match[0];

      if (indentation.includes('\t')) {
        // Handle tabs by counting them as 4 spaces each
        const tabCount = indentation.split('\t').length - 1;
        currentIndentLevel = tabCount + 1;
      } else {
        // Count the number of spaces
        const spaceCount = indentation.length / 4;
        currentIndentLevel = spaceCount;
      }
    }

    const nextLine = lines[i + 1];
    let nextIndentLevel = 0;

    if (nextLine) {
      const nextMatch = nextLine.match(spaceIndentRegex);

      if (nextMatch) {
        const nextIndentation = nextMatch[0];

        if (nextIndentation.includes('\t')) {
          // Handle tabs by counting them as 4 spaces each
          const tabCount = nextIndentation.split('\t').length - 1;
          nextIndentLevel = tabCount + 1;
        } else {
          // Count the number of spaces
          const spaceCount = nextIndentation.length / 4;
          nextIndentLevel = spaceCount;
        }
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

export async function calloutPostProcessor(codeBlockElement: HTMLElement, context: MarkdownPostProcessorContext, plugin: CodeBlockCustomizerPlugin) {
  await sleep(50); // need to find a better way instead of this...

  /*if (Array.from(codeBlockElement.classList).some(className => /^language-\S+/.test(className)))
  while(!codeBlockElement.classList.contains("is-loaded"))
    await sleep(2);*/

  const callouts: HTMLElement | null = codeBlockElement.querySelector('.callout');
  if (!callouts) 
    return;

  const calloutPreElements: Array<HTMLElement> = Array.from(callouts.querySelectorAll('pre:not(.frontmatter)'));
  if (!calloutPreElements)
    return;

  /*const sectionInfo: MarkdownSectionInformation | null = context.getSectionInfo(calloutPreElements[0]);
  if (!sectionInfo)
    return;
  const codeblockLines = Array.from({length: sectionInfo.lineEnd - sectionInfo.lineStart + 1}, (_,number) => number + sectionInfo.lineStart).map((lineNumber) => sectionInfo.text.split('\n')[lineNumber]);*/

  const markdownView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  const viewMode = markdownView?.getMode();

  if (viewMode === "source") {
    // @ts-ignore
    const calloutText = context?.containerEl?.cmView?.widget?.text?.split("\n") || null;
    let codeBlockFirstLines: string[] = [];
    codeBlockFirstLines = getCallouts(calloutText);

    await processCodeBlockFirstLines(calloutPreElements, codeBlockFirstLines, null, [], context.sourcePath, plugin);
  }
}// calloutPostProcessor

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
  preElement.classList.add(`codeblock-customizer-pre`);

  const copyButton = createCopyButton(parameters.displayLanguage);
  copyButton.addEventListener("click", copyCode);
  preElement.appendChild(copyButton);

  preElement.classList.add(`codeblock-customizer-language-` + (parameters.language.length > 0 ? parameters.language.toLowerCase() : "nolang"));

  if (codeblockLanguageSpecificClass)
    preElement.classList.add(codeblockLanguageSpecificClass);

  if (preElement.parentElement)
    preElement.parentElement.classList.add(`codeblock-customizer-pre-parent`);

  const header = HeaderWidget(preElement as HTMLPreElement, parameters, plugin.settings, sourcePath, plugin);
  preElement.insertBefore(header, preElement.childNodes[0]);
	
  const lines = Array.from(preCodeElm.innerHTML.split('\n')) || 0;
  if (parameters.fold) {
    toggleFoldClasses(preElement as HTMLPreElement, lines.length - 1, parameters.fold, plugin.settings.SelectedTheme.settings.semiFold.enableSemiFold, plugin.settings.SelectedTheme.settings.semiFold.visibleLines);
  }/* else {
    isFoldable(preElement as HTMLPreElement, lines.length - 1, plugin.settings.SelectedTheme.settings.semiFold.enableSemiFold, plugin.settings.SelectedTheme.settings.semiFold.visibleLines);
  }*/
	
  const borderColor = getBorderColorByLanguage(parameters.language, getPropertyFromLanguageSpecificColors("codeblock.borderColor", plugin.settings));
  if (borderColor.length > 0)
    preElement.classList.add(`hasLangBorderColor`);

  highlightLines(preCodeElm, parameters, plugin.settings.SelectedTheme.settings, indentationLevels, sourcePath, plugin);
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

function copyCode(event: Event) {
  const button = event.currentTarget as HTMLElement;
  const preElement = button.parentNode;
  if (!preElement)
    return;

  const lines = preElement.querySelectorAll("code");
  const codeTextArray: string[] = [];

  lines.forEach((line, index) => {
    const codeElements = line.querySelectorAll('.codeblock-customizer-line-text');
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

async function handlePDFExport(preElements: Array<HTMLElement>, context: MarkdownPostProcessorContext, plugin: CodeBlockCustomizerPlugin, id: string | null) {
  const file = plugin.app.vault.getAbstractFileByPath(context.sourcePath);
  if (!file) {
    console.error(`File not found: ${context.sourcePath}`);
    return;
  }
  const cache = plugin.app.metadataCache.getCache(context.sourcePath);
  const fileContent = await plugin.app.vault.cachedRead(<TFile> file).catch((error) => {
    console.error(`Error reading file: ${error.message}`);
    return '';
  });

  const fileContentLines = fileContent.split(/\n/g);
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

  if (parameters.displayLanguage){
    const Icon = getLanguageIcon(parameters.displayLanguage)
    if (Icon) {
      container.appendChild(createCodeblockIcon(parameters.displayLanguage));
    }
    container.appendChild(createCodeblockLang(parameters.language));
  }
  container.appendChild(createFileName(parameters.headerDisplayText, settings.SelectedTheme.settings.codeblock.enableLinks, sourcePath, plugin));
  const collapseEl = createCodeblockCollapse(parameters.fold);
  container.appendChild(collapseEl);
  if (parent)
    parent.insertBefore(container, preElements);
  
  const semiFold = settings.SelectedTheme.settings.semiFold.enableSemiFold;
  const visibleLines = settings.SelectedTheme.settings.semiFold.visibleLines;
  // Add event listener to the widget element
  container.addEventListener("click", function() {
    //collapseEl.innerText = preElements.classList.contains(`codeblock-customizer-codeblock-collapsed`) ? "-" : "+";
    if (semiFold) {
      const codeElements = preElements.getElementsByTagName("CODE");
      const lines = convertHTMLCollectionToArray(codeElements);
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
  lineNumberElement.setText(lineNumber.toString());
  
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

function extractLinesFromHTML(preCodeElm: HTMLElement): Array<string> {
  const tree = fromHtml(preCodeElm.innerHTML.replace(/\n/g, "<br>"), { fragment: true });
  let htmlContent = preCodeElm.innerHTML;

  visitParents(tree, ["text", "element"], (node, parents) => {
    if (node.type === "element" && node.tagName === "br") {
      htmlContent = replaceNewlineWithBr(htmlContent, parents);
    }
  });

  const splitTree = fromHtml(htmlContent);
  htmlContent = toHtml(splitTree);

  let lines = htmlContent.split("<br>");
  if (lines.length === 1)
    lines = ["", ""];
  preCodeElm.innerHTML = "";

  return lines;
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

async function highlightLines(preCodeElm: HTMLElement, parameters: Parameters, settings: ThemeSettings, indentationLevels: IndentationInfo[] | null, sourcePath: string, plugin: CodeBlockCustomizerPlugin) {
  if (!preCodeElm)
    return;

  const codeblockLines = extractLinesFromHTML(preCodeElm);
  const codeblockLen = codeblockLines.length - 1;
  let useSemiFold = false;
  if (codeblockLen >= settings.semiFold.visibleLines + fadeOutLineCount) {
    useSemiFold = true;
  }

  let fadeOutLineIndex = 0;
  codeblockLines.forEach((line, index) => {
    if (index === codeblockLines.length - 1)
      return;

    const lineNumber = index + 1;
    const isHighlighted = parameters.linesToHighlight.lines.includes(lineNumber + parameters.lineNumberOffset);
    const altHLMatch = parameters.alternativeLinesToHighlight.lines.filter((hl) => hl.lineNumber === lineNumber + parameters.lineNumberOffset);

    // create line element
    const lineWrapper = createDiv();

    if (isHighlighted) {
      lineWrapper.classList.add(`codeblock-customizer-line-highlighted`);
    } else if (altHLMatch.length > 0) {
      lineWrapper.classList.add(`codeblock-customizer-line-highlighted-${altHLMatch[0].name.replace(/\s+/g, '-').toLowerCase()}`);
    } else {
      lineWrapper.classList.add(`codeblock-customizer-line`);
    }

    if (useSemiFold && lineNumber > settings.semiFold.visibleLines && fadeOutLineIndex < fadeOutLineCount) {
      lineWrapper.classList.add(`codeblock-customizer-fade-out-line${fadeOutLineIndex}`);
      fadeOutLineIndex++;
      if (fadeOutLineIndex === fadeOutLineCount - 1) {
        const uncollapseCodeButton = createUncollapseCodeButton();
        uncollapseCodeButton.addEventListener("click", handleUncollapseClick);
        lineWrapper.appendChild(uncollapseCodeButton);
      }
    }

    if (useSemiFold && lineNumber > settings.semiFold.visibleLines + fadeOutLineCount) {
      lineWrapper.classList.add(`codeblock-customizer-fade-out-line-hide`);
    }

    preCodeElm.appendChild(lineWrapper);

    // create line number element
    const lineNumberEl = createLineNumberElement(lineNumber + parameters.lineNumberOffset, parameters.showNumbers);
    lineWrapper.appendChild(lineNumberEl);
    
    const indentedLine = addIndentLine(line, (indentationLevels && indentationLevels[lineNumber - 1]) ? indentationLevels[lineNumber - 1].insertCollapse : false);
    // create line text element
    const lineTextEl = createLineTextElement(settings.codeblock.enableLinks ? parseInput(indentedLine, sourcePath, plugin) : indentedLine);

    textHighlight(parameters, lineNumber, lineTextEl, lineWrapper);

    if (indentationLevels && indentationLevels[lineNumber - 1]) {
      const collapseIcon = lineTextEl.querySelector(".codeblock-customizer-collapse-icon");
      if (collapseIcon) {
        setIcon(collapseIcon as HTMLElement, "chevron-down");
        collapseIcon.addEventListener("click", handleClick);
      }
    }
    lineWrapper.appendChild(lineTextEl);
    lineWrapper.setAttribute("indentLevel", (indentationLevels && indentationLevels[lineNumber - 1]) ? indentationLevels[lineNumber - 1].indentationLevels.toString() : "-1");
  });
}// highlightLines

function textHighlight(parameters: Parameters, lineNumber: number, lineTextEl: HTMLDivElement, lineWrapper: HTMLDivElement) {
  const addHighlightClass = (name = '') => {
    const className = `codeblock-customizer-highlighted-text-line${name ? `-${name.replace(/\s+/g, '-').toLowerCase()}` : ''}`;
    lineWrapper.classList.add(className);
  };

  const highlightLine = (words: string, name = '') => {
    const caseInsensitiveWords = words.toLowerCase().split(',');
    for (const word of caseInsensitiveWords) {
      highlightWords(lineTextEl, word, name);
      if (lineTextEl.textContent?.toLowerCase().includes(word)) {
        addHighlightClass(name);
      }
    }
  };

  const highlightBetween = (from: string, to: string, name = '') => {
    const caseInsensitiveFrom = from.toLowerCase();
    const caseInsensitiveTo = to.toLowerCase();
    let startFound = false;
    let accumulatedText = '';
    let nodesToHighlight: Node[] = [];
    let startNode: Node | null = null;
    let endNode: Node | null = null;
    let startOffset = 0;
    let endOffset = 0;

    const traverseAndHighlight = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const textContent = node.textContent?.toLowerCase() || '';
        if (!startFound) {
          const startIndex = textContent.indexOf(caseInsensitiveFrom);
          if (startIndex !== -1) {
            startFound = true;
            startNode = node;
            startOffset = startIndex;
            accumulatedText = textContent.substring(startIndex);
            nodesToHighlight.push(node);
          }
        } else {
          accumulatedText += textContent;
          nodesToHighlight.push(node);
        }

        if (startFound) {
          const endIndex = accumulatedText.indexOf(caseInsensitiveTo, accumulatedText.indexOf(caseInsensitiveFrom) + caseInsensitiveFrom.length);
          if (endIndex !== -1) {
            endNode = node;
            endOffset = endIndex - (accumulatedText.length - textContent.length) + caseInsensitiveTo.length;
            if (startNode && endNode) {
              highlightNodesRange(nodesToHighlight, startNode, startOffset, endNode, endOffset, name);
              addHighlightClass(name);
            }
            startFound = false;
            accumulatedText = '';
            nodesToHighlight = [];
          }
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        node.childNodes.forEach(traverseAndHighlight);
      }
    };

    traverseAndHighlight(lineTextEl);
  };

  const highlightNodesRange = (nodes: Node[], startNode: Node, startOffset: number, endNode: Node, endOffset: number, name: string) => {
    for (const currentNode of nodes) {
      if (currentNode.nodeType === Node.TEXT_NODE) {
        const span = createSpan();
        span.className = name ? `codeblock-customizer-highlighted-text-${name}` : 'codeblock-customizer-highlighted-text';
        
        let textToHighlight = '';
        if (currentNode === startNode && currentNode === endNode) {
          textToHighlight = currentNode.textContent?.substring(startOffset, endOffset) || '';
        } else if (currentNode === startNode) {
          textToHighlight = currentNode.textContent?.substring(startOffset) || '';
        } else if (currentNode === endNode) {
          textToHighlight = currentNode.textContent?.substring(0, endOffset) || '';
        } else {
          textToHighlight = currentNode.textContent || '';
        }

        span.appendChild(document.createTextNode(textToHighlight));

        const beforeText = document.createTextNode(currentNode.textContent?.substring(0, startOffset) || '');
        const afterText = currentNode === endNode ? document.createTextNode(currentNode.textContent?.substring(endOffset) || '') : document.createTextNode('');

        const parentNode = currentNode.parentNode;
        if (parentNode) {
          parentNode.replaceChild(afterText, currentNode);
          parentNode.insertBefore(span, afterText);
          parentNode.insertBefore(beforeText, span);
        }

        startOffset = 0; // Reset startOffset after the first node
      }
    }
  };

  // highlight specific lines if they contain a word hl:1|test,3-5|test
  if (parameters.linesToHighlight.lineSpecificWords.hasOwnProperty(lineNumber)) {
    highlightLine(parameters.linesToHighlight.lineSpecificWords[lineNumber] ?? '');
  }

  // highlight every line which contains a specific word hl:test
  if (parameters.linesToHighlight.words.length > 0) {
    highlightLine(parameters.linesToHighlight.words);
  }

  // highlight lines with specific text between markers hl:start:end
  const textBetween = parameters.linesToHighlight.textBetween;
  for (const [start, end] of Object.entries(textBetween)) {
    highlightBetween(start, end);
  }

  // highlight specific lines with text between markers hl:5|start:end, hl:5-7|start:end
  const lineSpecificTextBetween = parameters.linesToHighlight.lineSpecificTextBetween;
  if (lineNumber in lineSpecificTextBetween) {
    for (const [start, end] of Object.entries(lineSpecificTextBetween[lineNumber])) {
      highlightBetween(start, end);
    }
  }

  // highlight specific lines if they contain a word imp:1|test,3-5|test
  if (parameters.alternativeLinesToHighlight.lineSpecificWords.some(item => item.lineNumber === lineNumber)) {
    const { extractedValues } = getValueNameByLineNumber(lineNumber, parameters.alternativeLinesToHighlight.lineSpecificWords);
    extractedValues.forEach(({ value, name }) => {
      highlightLine(value ?? '', name);
    });
  }

  // highlight every line which contains a specific word imp:test
  parameters.alternativeLinesToHighlight.words.forEach(({ name, words }) => {
    if (words.length > 0) {
      highlightLine(words, name);
    }
  });

  // highlight lines with specific text between markers imp:start:end
  const altTextBetween = parameters.alternativeLinesToHighlight.textBetween;
  altTextBetween.forEach(({ from, to, name }) => {
    highlightBetween(from, to, name);
  });

  // highlight specific lines with text between markers imp:5|start:end, imp:5-7|start:end
  const altLineSpecificTextBetween = parameters.alternativeLinesToHighlight.lineSpecificTextBetween;
  altLineSpecificTextBetween.forEach(({ lineNumber: altLineNumber, from, to, name }) => {
    if (lineNumber === altLineNumber) {
      highlightBetween(from, to, name);
    }
  });
}// textHighlight

function highlightWords(node: Node, word: string, alternativeName?: string) {
  if (node.nodeType === Node.TEXT_NODE) {
    const textContent = node.textContent || '';
    const occurrences = findAllOccurrences(textContent.toLowerCase(), word.toLowerCase());

    let offset = 0;
    occurrences.forEach(index => {
      const originalIndex = index + offset;
      const beforeTextContent = textContent.substring(0, originalIndex);
      const afterTextContent = textContent.substring(originalIndex + word.length);

      const span = createSpan();
      span.className = alternativeName ? `codeblock-customizer-highlighted-text-${alternativeName}` : `codeblock-customizer-highlighted-text`;
      span.appendChild(document.createTextNode(word));

      const beforeText = document.createTextNode(beforeTextContent);
      const afterText = document.createTextNode(afterTextContent);

      const parentNode = node.parentNode;
      if (parentNode) {
        parentNode.replaceChild(afterText, node);
        parentNode.insertBefore(span, afterText);
        parentNode.insertBefore(beforeText, span);
      }

      // After replacement, reprocess the modified content
      highlightWords(afterText, word, alternativeName);

      offset += (word.length - 1); // Adjust offset to account for replacement
    });
  } else if (node.nodeType === Node.ELEMENT_NODE) {
      const childNodes = Array.from(node.childNodes);
      for (let i = 0; i < childNodes.length; i++) {
        const childNode = childNodes[i];
        highlightWords(childNode, word, alternativeName);
      }
  }
}// highlightWords

function parseInput(input: string, sourcePath: string, plugin: CodeBlockCustomizerPlugin): string {
  if (input === "") return input;

  const parser = new DOMParser();
  const doc = parser.parseFromString(input, 'text/html');
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

  return new XMLSerializer().serializeToString(doc);
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
  const header = button.parentElement?.parentElement?.previousSibling as HTMLElement;
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

export function convertHTMLCollectionToArray(elements: HTMLCollection) {
  const result: Element[] = [];
  for (let i = 0; i < elements.length;i++ ){
    result.push(...Array.from(elements[i].children));
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

export function foldAllReadingView(fold: boolean, settings: CodeblockCustomizerSettings) {
  const preParents = document.querySelectorAll('.codeblock-customizer-pre-parent');
  preParents.forEach((preParent) => {
    const preElement = preParent.querySelector('.codeblock-customizer-pre');
    
    let lines: Element[] = [];
    if (preElement){
      const codeElements = preElement?.getElementsByTagName("CODE");
      lines = convertHTMLCollectionToArray(codeElements);
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
  const codeBlocks: string[] = [];
  let inCodeBlock = false;
  let openingBackticks = 0;

  for (let i = 0; i < array.length; i++) {
    let line = array[i].trim();
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
