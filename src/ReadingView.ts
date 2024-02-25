import { MarkdownView, MarkdownPostProcessorContext, sanitizeHTMLToDom, TFile, setIcon, MarkdownSectionInformation, MarkdownRenderer } from "obsidian";

import { getHighlightedLines, getDisplayLanguageName, isExcluded, getLanguageIcon, createContainer, createCodeblockLang, createCodeblockIcon, createFileName, createCodeblockCollapse, getCurrentMode, getCodeBlockLanguage, extractParameter, extractFileTitle, isFoldDefined, getBorderColorByLanguage, removeCharFromStart, createUncollapseCodeButton, addTextToClipboard, getLanguageSpecificColorClass, getValueNameByLineNumber, findAllOccurrences } from "./Utils";
import CodeBlockCustomizerPlugin from "./main";
import { CodeblockCustomizerSettings, ThemeSettings } from "./Settings";
import { fadeOutLineCount } from "./Const";

import { visitParents } from "unist-util-visit-parents";
import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";

interface CodeBlockDetails {
  codeBlockLang: string;
  linesToHighlight: number[];
  lineSpecificWords: Record<number, string>;
  words: string;
  fileName: string;
  Fold: boolean;
  lineNumberOffset: number;
  showNumbers: string;
  altHL: { name: string; lineNumber: number }[];
  altLineSpecificWords: { name: string; lineNumber: number }[];
  altWords: { name: string, words: string }[];
  isCodeBlockExcluded: boolean;
}

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

  const preElements: Array<HTMLElement> = Array.from(codeBlockElement.querySelectorAll('pre:not(.frontmatter)'));
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
  
  await processCodeBlockFirstLines(preElements, codeBlockFirstLines, indentationLevels, context.sourcePath, plugin);
}// ReadingView

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

  const markdownView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  const viewMode = markdownView?.getMode();

  if (viewMode === "source") {
    // @ts-ignore
    const calloutText = context?.containerEl?.cmView?.widget?.text?.split("\n") || null;
    let codeBlockFirstLines: string[] = [];
    codeBlockFirstLines = getCallouts(calloutText);

    await processCodeBlockFirstLines(calloutPreElements, codeBlockFirstLines, null, context.sourcePath, plugin);
  }
}// calloutPostProcessor

async function processCodeBlockFirstLines(preElements: HTMLElement[], codeBlockFirstLines: string[], indentationLevels: IndentationInfo[] | null, sourcepath: string, plugin: CodeBlockCustomizerPlugin ) {
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
        
    const codeblockDetails = getCodeBlockDetails(codeBlockFirstLine, plugin.settings);
    if (codeblockDetails.isCodeBlockExcluded)
      continue;

    const codeblockLanguageSpecificClass = getLanguageSpecificColorClass(codeblockDetails.codeBlockLang, plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors);
    await addClasses(preElement, codeblockDetails, plugin, preCodeElm as HTMLElement, indentationLevels, codeblockLanguageSpecificClass, sourcepath);
  }
}// processCodeBlockFirstLines

async function addClasses(preElement: HTMLElement, codeblockDetails: CodeBlockDetails, plugin: CodeBlockCustomizerPlugin, preCodeElm: HTMLElement, indentationLevels: IndentationInfo[] | null, codeblockLanguageSpecificClass: string, sourcePath: string) {
  preElement.classList.add(`codeblock-customizer-pre`);

  const copyButton = createCopyButton(codeblockDetails.codeBlockLang);
  copyButton.addEventListener("click", copyCode);
  preElement.appendChild(copyButton);

  if (codeblockDetails.codeBlockLang) {
    preElement.classList.add(`codeblock-customizer-language-` + codeblockDetails.codeBlockLang.toLowerCase());
    if (codeblockLanguageSpecificClass)
      preElement.classList.add(codeblockLanguageSpecificClass);
  }

  if (preElement.parentElement)
    preElement.parentElement.classList.add(`codeblock-customizer-pre-parent`);

  let specificHeader = true;
  let fileName = codeblockDetails.fileName;
  if (codeblockDetails.fileName === null || codeblockDetails.fileName === "") {
    if (codeblockDetails.Fold) {
      fileName = plugin.settings.SelectedTheme.settings.header.collapsedCodeText || "Collapsed Code";
    } else {
      if (plugin.settings.foldAllCommand)
        fileName = plugin.settings.SelectedTheme.settings.header.collapsedCodeText || "Collapsed Code";
      else
        fileName = '';
      specificHeader = false;
    }
  }

  const header = HeaderWidget(preElement as HTMLPreElement, fileName, specificHeader, getDisplayLanguageName(codeblockDetails.codeBlockLang), codeblockDetails.codeBlockLang, codeblockDetails.Fold, plugin.settings.SelectedTheme.settings.semiFold.enableSemiFold, plugin.settings.SelectedTheme.settings.semiFold.visibleLines, plugin.settings.SelectedTheme.settings.codeblock.enableLinks, plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors, sourcePath, plugin);
  preElement.insertBefore(header, preElement.childNodes[0]);
	
  const lines = Array.from(preCodeElm.innerHTML.split('\n')) || 0;
  if (codeblockDetails.Fold) {
    toggleFoldClasses(preElement as HTMLPreElement, lines.length - 1, codeblockDetails.Fold, plugin.settings.SelectedTheme.settings.semiFold.enableSemiFold, plugin.settings.SelectedTheme.settings.semiFold.visibleLines);
  }/* else {
    isFoldable(preElement as HTMLPreElement, lines.length - 1, plugin.settings.SelectedTheme.settings.semiFold.enableSemiFold, plugin.settings.SelectedTheme.settings.semiFold.visibleLines);
  }*/
	
  const borderColor = getBorderColorByLanguage(codeblockDetails.codeBlockLang, plugin.settings.SelectedTheme.colors[getCurrentMode()].codeblock.languageBorderColors);
  if (borderColor.length > 0)
    preElement.classList.add(`hasLangBorderColor`);

  highlightLines(preCodeElm, codeblockDetails, plugin.settings.SelectedTheme.settings, indentationLevels, sourcePath, plugin);
}// addClasses

function createCopyButton(codeblockLanguage: string) {
  const container = document.createElement("button");
  container.classList.add(`codeblock-customizer-copy-code-button`);
  container.setAttribute("aria-label", "Copy code");

  if (codeblockLanguage) {
    const displayLangText = getDisplayLanguageName(codeblockLanguage);
    if (displayLangText)
    container.setText(displayLangText);
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

function isFoldable(preElement: HTMLPreElement, linesLen: number, enableSemiFold: boolean, visibleLines: number) {
  if (enableSemiFold) {
    if (linesLen >= visibleLines + fadeOutLineCount) {
      preElement?.classList.add('codeblock-customizer-codeblock-semi-collapseable');
    } else
      preElement?.classList.add('codeblock-customizer-codeblock-collapseable');
  }
  else
    preElement?.classList.add('codeblock-customizer-codeblock-collapseable');
}// isFoldable

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

function HeaderWidget(preElements: HTMLPreElement, textToDisplay: string, specificHeader: boolean, displayLanguageName: string, languageName: string, Collapse: boolean, semiFold: boolean, visibleLines: number, enableLinks: boolean, languageSpecificColors: Record<string, Record<string, string>>, sourcePath: string, plugin: CodeBlockCustomizerPlugin) {
  const parent = preElements.parentNode;
  const codeblockLanguageSpecificClass = getLanguageSpecificColorClass(languageName, languageSpecificColors);
  const container = createContainer(specificHeader, languageName, false, codeblockLanguageSpecificClass); // hasLangBorderColor must be always false in reading mode, because how the doc is generated

  if (displayLanguageName){
    const Icon = getLanguageIcon(displayLanguageName)
    if (Icon) {
      container.appendChild(createCodeblockIcon(displayLanguageName));
    }
    container.appendChild(createCodeblockLang(languageName));
  }
  container.appendChild(createFileName(textToDisplay, enableLinks, sourcePath, plugin));
  const collapseEl = createCodeblockCollapse(Collapse);
  container.appendChild(collapseEl);
  if (parent)
    parent.insertBefore(container, preElements);
  
  // Add event listener to the widget element
  container.addEventListener("click", function() {
    //collapseEl.innerText = preElements.classList.contains(`codeblock-customizer-codeblock-collapsed`) ? "-" : "+";
    if (semiFold) {
      const codeElements = preElements.getElementsByTagName("CODE");
      const lines = convertHTMLCollectionToArray(codeElements);
      if (lines.length >= visibleLines + fadeOutLineCount) {
        toggleFold(preElements, collapseEl, `codeblock-customizer-codeblock-semi-collapsed`, codeElements, true, visibleLines);
      } else
        toggleFold(preElements, collapseEl, `codeblock-customizer-codeblock-collapsed`);
    } else {
      toggleFold(preElements, collapseEl, `codeblock-customizer-codeblock-collapsed`);
    }
  });
  
  if (Collapse) {
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
  const lineNumberWrapper = document.createElement("div");
  if (showNumbers === "specific")
    lineNumberWrapper.classList.add(`codeblock-customizer-line-number-specific`);
  else if (showNumbers === "hide")
    lineNumberWrapper.classList.add(`codeblock-customizer-line-number-hide`);
  else 
    lineNumberWrapper.classList.add(`codeblock-customizer-line-number`);

  const lineNumberElement = document.createElement("span");
  lineNumberElement.classList.add(`codeblock-customizer-line-number-element`);
  lineNumberElement.setText(lineNumber.toString());
  
  lineNumberWrapper.appendChild(lineNumberElement);
  //lineNumberWrapper.setText(lineNumber.toString());

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

async function highlightLines(preCodeElm: HTMLElement, codeblockDetails: CodeBlockDetails, settings: ThemeSettings, indentationLevels: IndentationInfo[] | null, sourcePath: string, plugin: CodeBlockCustomizerPlugin) {
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
    let offset = 0;
    if ((typeof codeblockDetails.lineNumberOffset === 'number') && (!isNaN(codeblockDetails.lineNumberOffset) && codeblockDetails.lineNumberOffset >= 0)) {
      offset = codeblockDetails.lineNumberOffset - 1;
    }
    const isHighlighted = codeblockDetails.linesToHighlight.includes(lineNumber + offset);
    const altHLMatch = codeblockDetails.altHL.filter((hl) => hl.lineNumber === lineNumber + offset);

    // create line element
    const lineWrapper = document.createElement("div");

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
    const lineNumberEl = createLineNumberElement(lineNumber + offset, codeblockDetails.showNumbers);
    lineWrapper.appendChild(lineNumberEl);
    
    const indentedLine = addIndentLine(line, (indentationLevels && indentationLevels[lineNumber - 1]) ? indentationLevels[lineNumber - 1].insertCollapse : false);
    // create line text element
    const lineTextEl = createLineTextElement(settings.codeblock.enableLinks ? parseInput(indentedLine, sourcePath, plugin) : indentedLine);
  
    textHighlight(codeblockDetails, lineNumber, lineTextEl, lineWrapper);

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

function textHighlight(codeblockDetails: CodeBlockDetails, lineNumber: number, lineTextEl: HTMLDivElement, lineWrapper: HTMLDivElement) {
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

  // highlight specific lines if they contain a word hl:1|test,3-5|test
  if (codeblockDetails.lineSpecificWords.hasOwnProperty(lineNumber)) {
    highlightLine(codeblockDetails.lineSpecificWords[lineNumber] ?? '');
  }

  // highlight every line which contains a specific word hl:test
  if (codeblockDetails.words.length > 0) {
    highlightLine(codeblockDetails.words);
  }

  // highlight specific lines if they contain a word imp:1|test,3-5|test
  if (codeblockDetails.altLineSpecificWords.some(item => item.lineNumber === lineNumber)) {
    const { extractedValues } = getValueNameByLineNumber(lineNumber, codeblockDetails.altLineSpecificWords);
    extractedValues.forEach(({ value, name }) => {
      highlightLine(value ?? '', name);
    });
  }

  // highlight every line which contains a specific word imp:test
  codeblockDetails.altWords.forEach(({ name, words }) => {
    if (words.length > 0) {
      highlightLine(words, name);
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

      const span = document.createElement('span');
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

function removeClassesWithWildcard(element: HTMLElement, classesToRemove: string[]): void {
  const classes = element.classList;
  
  // Remove classes without wildcards
  classesToRemove.forEach(className => {
    if (!className.includes('*')) {
      element.classList.remove(className);
    }
  });

  for (let i = 0; i < classes.length; i++) {
    const className = classes[i];
    classesToRemove.forEach(classToRemove => {
      if (classToRemove.includes('*')) {
        const regexWildcard = classToRemove.replace(/\*/g, '.*');
        const regex = new RegExp(regexWildcard);
        if (regex.test(className)) {
          element.classList.remove(className);
        }
      }
    });
  }
}// removeClassesWithWildcard

function parseInput(input: string, sourcePath: string, plugin: CodeBlockCustomizerPlugin): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(input, 'text/html');
  const elementsWithClass = Array.from(doc.getElementsByClassName('comment'));
  const regex = /(?:\[\[([^[\]]+?)(?:\|([^\]]+?))?]]|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s]+))/g;

  elementsWithClass.forEach((element: Element) => {
    const fragment = document.createDocumentFragment();
    const textContent = element.textContent || '';
    let lastIndex = 0;
    const matches = [...textContent.matchAll(regex)];
    
    for (const match of matches) {
      const textBeforeMatch = textContent.substring(lastIndex, match.index);
      fragment.appendChild(document.createTextNode(textBeforeMatch));
      
      const span = createSpan({cls: "codeblock-customizer-link"});
      MarkdownRenderer.render(plugin.app, match[0], span, sourcePath, plugin);
      fragment.appendChild(span);
      
      lastIndex = match.index !== undefined ? match.index + match[0].length : lastIndex;
    }

    const textAfterLastMatch = textContent.substring(lastIndex);
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
      toggleFold(pre, collapseIcon, `codeblock-customizer-codeblock-semi-collapsed`, codeElement.children, false, null);
    }
  }
}// handleUncollapseClick

function toggleFold(pre: HTMLElement, collapseIcon: HTMLElement, toggleClass: string, codeElements: HTMLCollection | null = null, convert: boolean | null = null, visibleLines: number | null = null) {
  if (pre?.classList.contains(toggleClass)) {
    //if (codeElements && (convert !== null))
      //removeFadeEffect(codeElements, convert);
    setIcon(collapseIcon, "chevrons-up-down");
  } else {
    //if (codeElements && visibleLines)
      //addFadeEffect(codeElements, visibleLines);
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

function removeFadeEffect(lines: HTMLCollection, convert: boolean) {
  let result: Element[] = [];

  if (convert) {
    result = convertHTMLCollectionToArray(lines);
  } else {
    result = Array.from(lines);
  }

  for (let i = 0; i < result.length; i++) {
    const line = result[i];
    if (line.classList.contains("codeblock-customizer-fade-out-line0"))
      line.classList.remove("codeblock-customizer-fade-out-line0");
    if (line.classList.contains("codeblock-customizer-fade-out-line1"))
      line.classList.remove("codeblock-customizer-fade-out-line1");
    if (line.classList.contains("codeblock-customizer-fade-out-line2"))
      line.classList.remove("codeblock-customizer-fade-out-line2");
    if (line.classList.contains("codeblock-customizer-fade-out-line3"))
      line.classList.remove("codeblock-customizer-fade-out-line3");
    if (line.classList.contains("codeblock-customizer-fade-out-line-hide"))
      line.classList.remove("codeblock-customizer-fade-out-line-hide");
  }
}// removeFadeEffect

function addFadeEffect(lines: HTMLCollection, visibleLines: number) {
  const codeElements = Array.from(lines).filter(element => element.tagName === "CODE");

  for (let i = 0; i < codeElements.length; i++) {
    const codeElement = codeElements[i];
    const codeblockLen = codeElement.children.length;

    let useSemiFold = false;
    if (codeblockLen >= visibleLines + fadeOutLineCount) {
      useSemiFold = true;
    }
    if (!useSemiFold)
      continue;
    
    let fadeOutLineIndex = 0
    for (let j = 0; j < codeblockLen; j++) {
      const line = codeElement.children[j];
      if (useSemiFold && j >= visibleLines && fadeOutLineIndex < fadeOutLineCount) {
        line.classList.add(`codeblock-customizer-fade-out-line${fadeOutLineIndex}`);
        fadeOutLineIndex++;
        if (fadeOutLineIndex === fadeOutLineCount - 1){
          const uncollapseCodeButton = createUncollapseCodeButton();
          uncollapseCodeButton.addEventListener("click", handleUncollapseClick);
        }
      }
      if (useSemiFold && j >= visibleLines + fadeOutLineCount) {
        line.classList.add(`codeblock-customizer-fade-out-line-hide`);
      }
    }
  }
}// addFadeEffect

async function PDFExport(codeBlockElement: HTMLElement[], plugin: CodeBlockCustomizerPlugin, codeBlockFirstLines: string[], sourcePath: string) {
  for (const [key, codeblockPreElement] of Array.from(codeBlockElement).entries()) {
    const codeblockParameters = codeBlockFirstLines[key];
    const codeblockDetails = getCodeBlockDetails(codeblockParameters, plugin.settings);  
    
    const codeblockCodeElement: HTMLPreElement | null = codeblockPreElement.querySelector("pre > code");
    if (!codeblockCodeElement)
      return;

    if (Array.from(codeblockCodeElement.classList).some(className => /^language-\S+/.test(className)))
      while(!codeblockCodeElement.classList.contains("is-loaded"))
        await sleep(2);

    if (codeblockCodeElement.querySelector("code [class*='codeblock-customizer-line']"))
      continue;

    if (codeblockDetails.isCodeBlockExcluded)
      continue;

    const codeblockLanguageSpecificClass = getLanguageSpecificColorClass(codeblockDetails.codeBlockLang, plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors);
    await addClasses(codeblockPreElement, codeblockDetails, plugin, codeblockCodeElement as HTMLElement, null, codeblockLanguageSpecificClass, sourcePath);
  }
}// PDFExport

function getCodeBlockDetails(codeBlockFirstLine: string, pluginSettings: CodeblockCustomizerSettings): CodeBlockDetails  {
  const codeBlockLang = getCodeBlockLanguage(codeBlockFirstLine) || "";
  const highlightedLinesParams = extractParameter(codeBlockFirstLine, "hl");
  //const linesToHighlight = getHighlightedLines(highlightedLinesParams).lines;
  const highlightLines = getHighlightedLines(highlightedLinesParams);
  const linesToHighlight = highlightLines.lines;
  const lineSpecificWords = highlightLines.lineSpecificWords;
  const words = highlightLines.words;
  const fileName = (extractFileTitle(codeBlockFirstLine) || "").toString().trim();
  const Fold = isFoldDefined(codeBlockFirstLine);
  let lineNumberOffset = -1;
  let showNumbers = "";

  const specificLN = (extractParameter(codeBlockFirstLine, "ln") || "") as string;
  if (specificLN.toLowerCase() === "true") {
    showNumbers = "specific";
  } else if (specificLN.toLowerCase() === "false") {
    showNumbers = "hide";
  } else {
    const offset = parseInt(specificLN);
    if (!isNaN(offset) && offset >= 0) {
      lineNumberOffset = offset;
      showNumbers = "specific";
    }
    else {
      showNumbers = "";
    }
  }

  let altLineSpecificWords: { name: string; lineNumber: number }[] = [];
  const altWords: { name: string, words: string }[] = [];

  const alternateColors = pluginSettings.SelectedTheme.colors[getCurrentMode()].codeblock.alternateHighlightColors || {};
  let altHL: { name: string, lineNumber: number }[] = [];
  for (const [name, hexValue] of Object.entries(alternateColors)) {
    const altParams = extractParameter(codeBlockFirstLine, `${name}`);
    const altlinesToHighlight = getHighlightedLines(altParams);
    altHL = altHL.concat(altlinesToHighlight.lines.map((lineNumber) => ({ name, lineNumber })));
    altLineSpecificWords = altLineSpecificWords.concat(
      //altHL,
      Object.entries(altlinesToHighlight.lineSpecificWords).map(([lineNumber, value]: [string, string]) => ({ name, lineNumber: parseInt(lineNumber), value }))
    );
    altWords.push({ name, words: altlinesToHighlight.words });
  }
  
  let isCodeBlockExcluded = false;
  isCodeBlockExcluded = isExcluded(codeBlockFirstLine, pluginSettings.ExcludeLangs);

  return {
    codeBlockLang,
    linesToHighlight,
    lineSpecificWords,
    words,
    fileName,
    Fold,
    lineNumberOffset,
    showNumbers,
    altHL,
    altLineSpecificWords, 
    altWords,
    isCodeBlockExcluded,
  };
}// getCodeBlockDetails

export function foldAllReadingView(fold: boolean, settings: CodeblockCustomizerSettings) {
  const preParents = document.querySelectorAll('.codeblock-customizer-pre-parent');
  preParents.forEach((preParent) => {
    const preElement = preParent.querySelector('.codeblock-customizer-pre');
    const headerTextElement = preElement?.querySelector('.codeblock-customizer-header-container .codeblock-customizer-header-text');
    
    let lines: Element[] = [];
    if (preElement){
      const codeElements = preElement?.getElementsByTagName("CODE");
      lines = convertHTMLCollectionToArray(codeElements);
    }

    toggleFoldClasses(preElement as HTMLPreElement, lines.length, fold, settings.SelectedTheme.settings.semiFold.enableSemiFold, settings.SelectedTheme.settings.semiFold.visibleLines, settings.SelectedTheme.settings.header.collapsedCodeText || 'Collapsed Code', headerTextElement as HTMLElement);
  });
}//foldAllreadingView

export function toggleFoldClasses(preElement: HTMLPreElement, linesLength: number, fold: boolean, enableSemiFold: boolean, visibleLines: number, collapsedCodeText: string | null = null, headerTextElement: HTMLElement | null = null) {
  if (fold) {
    if (enableSemiFold) {
      if (linesLength >= visibleLines + fadeOutLineCount) {
        preElement?.classList.add('codeblock-customizer-codeblock-semi-collapsed');
      } else
        preElement?.classList.add('codeblock-customizer-codeblock-collapsed');
    }
    else
      preElement?.classList.add('codeblock-customizer-codeblock-collapsed');
    if (collapsedCodeText)
      headerTextElement?.setText(collapsedCodeText);
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
    return arrowBlocksResult
  else
    return [];
}// getCallouts