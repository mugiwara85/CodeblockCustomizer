import { MarkdownView, MarkdownPostProcessorContext, sanitizeHTMLToDom, TFile, setIcon, MarkdownSectionInformation, MarkdownRenderChild } from "obsidian";

import { getHighlightedLines, getDisplayLanguageName, isExcluded, getLanguageIcon, createContainer, createCodeblockLang, createCodeblockIcon, createFileName, createCodeblockCollapse, getCurrentMode, getCodeBlockLanguage, extractParameter, extractFileTitle, isFoldDefined, getBorderColorByLanguage, removeCharFromStart, createUncollapseCodeButton } from "./Utils";
import CodeblockCustomizerPlugin from "./main";
import { CodeblockCustomizerSettings, ThemeSettings } from "./Settings";
import { fadeOutLineCount } from "./Const";

interface CodeBlockDetails {
  codeBlockLang: string;
  linesToHighlight: number[];
  fileName: string;
  Fold: boolean;
  lineNumberOffset: number;
  showNumbers: string;
  altHL: { name: string; lineNumber: number }[];
  isCodeBlockExcluded: boolean;
}

interface OpenTag {
  tag: string;
  class: string | null;
}

interface IndentationInfo {
  indentationLevels: number;
  insertCollapse: boolean;
}

export async function ReadingView(codeBlockElement: HTMLElement, context: MarkdownPostProcessorContext, plugin: CodeblockCustomizerPlugin) {
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

  await processCodeBlockFirstLines(preElements, codeBlockFirstLines, indentationLevels, plugin);
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

export async function calloutPostProcessor(codeBlockElement: HTMLElement, context: MarkdownPostProcessorContext, plugin: CodeblockCustomizerPlugin) {
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

    await processCodeBlockFirstLines(calloutPreElements, codeBlockFirstLines, null, plugin);
  }
}// calloutPostProcessor

async function processCodeBlockFirstLines(preElements: HTMLElement[], codeBlockFirstLines: string[], indentationLevels: IndentationInfo[] | null, plugin: CodeblockCustomizerPlugin ) {
  if (preElements.length !== codeBlockFirstLines.length)
  return;

  for (let [key, preElement] of preElements.entries()) {
    let codeBlockFirstLine = codeBlockFirstLines[key];
    let preCodeElm = preElement.querySelector('pre > code');

    if (!preCodeElm)
      return;

    if (Array.from(preCodeElm.classList).some(className => /^language-\S+/.test(className)))
      while(!preCodeElm.classList.contains("is-loaded"))
        await sleep(2);

    const codeblockDetails = getCodeBlockDetails(codeBlockFirstLine, plugin.settings);
    if (codeblockDetails.isCodeBlockExcluded)
      continue;

    await addClasses(preElement, codeblockDetails, plugin, preCodeElm as HTMLElement, indentationLevels);
  }
}// processCodeBlockFirstLines

async function addClasses(preElement: HTMLElement, codeblockDetails: CodeBlockDetails, plugin: CodeblockCustomizerPlugin, preCodeElm: HTMLElement, indentationLevels: IndentationInfo[] | null) {
  preElement.classList.add(`codeblock-customizer-pre`);

  if (codeblockDetails.codeBlockLang)
    preElement.classList.add(`codeblock-customizer-language-` + codeblockDetails.codeBlockLang.toLowerCase());

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

  const header = HeaderWidget(preElement as HTMLPreElement, fileName, specificHeader, getDisplayLanguageName(codeblockDetails.codeBlockLang), codeblockDetails.codeBlockLang, codeblockDetails.Fold, plugin.settings.SelectedTheme.settings.semiFold.enableSemiFold, plugin.settings.SelectedTheme.settings.semiFold.visibleLines );
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

  highlightLines(preCodeElm, codeblockDetails, plugin.settings.SelectedTheme.settings, indentationLevels);
}// addClasses

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

async function handlePDFExport(preElements: Array<HTMLElement>, context: MarkdownPostProcessorContext, plugin: CodeblockCustomizerPlugin, id: string | null) {
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
      await PDFExport(preElements, plugin, codeBlockFirstLines);
  } catch (error) {
    console.error(`Error exporting to PDF: ${error.message}`);
    return;
  }
  return;
}// handlePDFExport

function HeaderWidget(preElements: HTMLPreElement, textToDisplay: string, specificHeader: boolean, displayLanguageName: string, languageName: string, Collapse: boolean, semiFold: boolean, visibleLines: number) {
  const parent = preElements.parentNode;

  const container = createContainer(specificHeader, languageName, false); // hasLangBorderColor must be always false in reading mode, because how the doc is generated
  if (displayLanguageName){
    const Icon = getLanguageIcon(displayLanguageName)
    if (Icon) {
      container.appendChild(createCodeblockIcon(displayLanguageName));
    }
    container.appendChild(createCodeblockLang(languageName));
  }
  container.appendChild(createFileName(textToDisplay));
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
      const codeElements = preElements.getElementsByTagName("CODE");
      const lines = convertHTMLCollectionToArray(codeElements);
      if (lines.length >= visibleLines + fadeOutLineCount) {
        preElements.classList.add(`codeblock-customizer-codeblock-semi-collapsed`);
      } else 
        preElements.classList.add(`codeblock-customizer-codeblock-collapsed`);
    }
    else
      preElements.classList.add(`codeblock-customizer-codeblock-collapsed`);
    preElements.classList.add(`codeblock-customizer-codeblock-default-collapse`);
  }
  
  /*const mutationCallback = (mutationsList, observer) => {
    for (const mutation of mutationsList) {
      if (mutation.target.classList.contains('codeblock-customizer-header-collapse-command')) {
        console.log("Specific class was added to body.");
        // Do something when the specific class is added to the body
      } else {
        console.log("Specific class was removed from body.");
        // Do something when the specific class is removed from the body
      }
    }
  };

  // Create a MutationObserver instance
  const bodyObserver = new MutationObserver(mutationCallback);

  // Options for the MutationObserver
  const observerOptions = {
    attributes: true,
    attributeFilter: ['class'],
  };

  // Start observing the body element with the specified options
  bodyObserver.observe(document.body, observerOptions);*/

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

/*function addIndentLine(inputString: string): string {
  // Use a regular expression to find tabs or 4-space indentations at the beginning of the string
  const indentRegex = /^(?:\t+|( {4})*)/;

  // Find the matched indentation at the beginning of the string
  const match = inputString.match(indentRegex);
  const indent = match ? match[0] : '';

  // Determine the type of indentation (tab or spaces)
  const isTabIndentation = /\t/.test(indent);

  // Calculate the number of tabs or spaces in the matched indentation
  const numIndentCharacters = isTabIndentation ? (indent.match(/\t/g) || []).length : (indent.match(/ {4}/g) || []).length;

  // Generate the <span> elements with the corresponding indentation
  const spans = isTabIndentation
    ? Array(numIndentCharacters).fill('<span class="codeblock-customizer-indentation-guide">\t</span>').join('')
    : Array(numIndentCharacters).fill('<span class="codeblock-customizer-indentation-guide">    </span>').join('');

  // Add the generated <span> elements to the string
  const stringWithSpans = inputString.replace(indentRegex, spans);

  return stringWithSpans;
}// addIndentLine*/

function addIndentLine(inputString: string, insertCollapse: boolean = false): string {
  // Use a regular expression to find tabs or 4-space indentations at the beginning of the string
  const indentRegex = /^(?:\t+|( {4})*)/;

  // Find the matched indentation at the beginning of the string
  const match = inputString.match(indentRegex);
  const indent = match ? match[0] : '';

  // Determine the type of indentation (tab or spaces)
  const isTabIndentation = /\t/.test(indent);

  // Calculate the number of tabs or spaces in the matched indentation
  const numIndentCharacters = isTabIndentation ? (indent.match(/\t/g) || []).length : (indent.match(/ {4}/g) || []).length;

  const spans = isTabIndentation
    ? Array(numIndentCharacters).fill(`<span class="codeblock-customizer-indentation-guide">\t</span>`).join('')
    : Array(numIndentCharacters).fill(`<span class="codeblock-customizer-indentation-guide">    </span>`).join('');

    const lastIndentPosition = isTabIndentation ? numIndentCharacters : numIndentCharacters * 4;
    console.log(lastIndentPosition);
    let modifiedString: string = "";
    if (insertCollapse){
      modifiedString = inputString.slice(0, lastIndentPosition) + `<span class="codeblock-customizer-collapse-code"></span>` + inputString.slice(lastIndentPosition);
    }
  // Add the generated <span> elements to the string
  const stringWithSpans = inputString.replace(indentRegex, spans);

  return insertCollapse ? modifiedString.replace(indentRegex, spans) : stringWithSpans;
}// addIndentLine

function highlightLines(preCodeElm: HTMLElement, codeblockDetails: CodeBlockDetails, settings: ThemeSettings, indentationLevels: IndentationInfo[] | null) {
  if (!preCodeElm)
    return;

  let codeblockLines = preCodeElm.innerHTML.split("\n");
  if (codeblockLines.length == 1)
    codeblockLines = ['',''];

  const codeblockLen = codeblockLines.length - 1;
  let useSemiFold = false;
  if (codeblockLen >= settings.semiFold.visibleLines + fadeOutLineCount) {
    useSemiFold = true;
  }

  let fadeOutLineIndex = 0;
  preCodeElm.innerHTML = "";
  const openTagsStack: OpenTag[] = [];
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
    }
    else if (altHLMatch.length > 0) {
      lineWrapper.classList.add(`codeblock-customizer-line-highlighted-${altHLMatch[0].name.replace(/\s+/g, '-').toLowerCase()}`);
    }

    if (useSemiFold && lineNumber > settings.semiFold.visibleLines && fadeOutLineIndex < fadeOutLineCount) {
      lineWrapper.classList.add(`codeblock-customizer-fade-out-line${fadeOutLineIndex}`);
      fadeOutLineIndex++;
      if (fadeOutLineIndex === fadeOutLineCount - 1){
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

    const indentedLine = addIndentLine(line, indentationLevels ? indentationLevels[lineNumber - 1].insertCollapse : false);

    // create line text element
    const lineTextEl = createLineTextElement(indentedLine);
    processHTMLtags(openTagsStack, lineTextEl, line);
    lineWrapper.appendChild(lineTextEl);
    lineWrapper.setAttribute("indentLevel", indentationLevels ? indentationLevels[lineNumber - 1].indentationLevels.toString() : "-1");
  });
}

function handleUncollapseClick(event: Event) {
  const button = event.target as HTMLElement;
  const codeElement = button.parentElement?.parentElement;
  const header = button.parentElement?.parentElement?.previousSibling as HTMLElement;
  const pre = button.parentElement?.parentElement?.previousSibling?.parentElement;

  if (!codeElement)
    return;
    
  removeFadeEffect(codeElement.children, false);

  if (header) {
    const collapseIcon = header.querySelector(".codeblock-customizer-header-collapse") as HTMLElement;
    if (collapseIcon && pre) {
      toggleFold(pre, collapseIcon, `codeblock-customizer-codeblock-semi-collapsed`, codeElement.children, false, null);
    }
  }
}// handleUncollapseClick

function toggleFold(pre: HTMLElement, collapseIcon: HTMLElement, toggleClass: string, codeElements: HTMLCollection | null = null, convert: boolean | null = null, visibleLines: number | null = null) {
  if (pre?.classList.contains(toggleClass)) {
    if (codeElements && (convert !== null))
      removeFadeEffect(codeElements, convert);
    setIcon(collapseIcon, "chevrons-up-down");
  } else {
    if (codeElements && visibleLines)
      addFadeEffect(codeElements, visibleLines);
    setIcon(collapseIcon, "chevrons-down-up");
  }
  pre?.classList.toggle(toggleClass);
}// toggleFold

export function convertHTMLCollectionToArray(elements: HTMLCollection) {
  let result: Element[] = [];
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

function processHTMLtags(openTagsStack: OpenTag[], lineTextEl: HTMLDivElement, line: string) {
  // Apply class of open HTML tag to subsequent lines until closing tag is found
  if (openTagsStack.length > 0) {
    const lastOpenTagClass = openTagsStack[openTagsStack.length - 1].class;
    const tokens = lastOpenTagClass?.split(" ");

    if (tokens) {
      for (let k = 0; k < tokens.length; k++) {
        lineTextEl.classList.add(tokens[k]);
      }
    }
  }

  // Check if the line contains HTML tags
  if (line.includes("<") && line.includes(">")) {
    const openingTags = line.match(/<[^/].*?>/g); // Find all opening HTML tags
    const closingTags = line.match(/<\/.*?>/g); // Find all closing HTML tags

    if (openingTags && closingTags) {
      // Process each opening tag
      for (const openingTag of openingTags) {
        const tagClass = getClassFromHTMLTag(openingTag);

        // Push the opening tag and its class to the stack
        openTagsStack.push({ tag: openingTag, class: tagClass });
      }

      // Process each closing tag
      for (const closingTag of closingTags) {
        // Pop the last opening tag from the stack
        const lastOpenTag = openTagsStack.pop();

        // Check if the closing tag corresponds to the last opening tag
        if (lastOpenTag && isClosingTagMatching(closingTag, lastOpenTag.tag)) {
          // If matched, continue to the next line
          continue;
        } else {
          // If not matched, push the last opening tag back to the stack
          if (lastOpenTag) {
            openTagsStack.push(lastOpenTag);
          }
          break; // Exit the loop since we found the unmatched closing tag
        }
      }
    } else if (openingTags) {
      // If there are only opening tags and no closing tags in the line
      for (const openingTag of openingTags) {
        const tagClass = getClassFromHTMLTag(openingTag);
        openTagsStack.push({ tag: openingTag, class: tagClass });
      }
    } else if (closingTags) {
      // If there are only closing tags and no opening tags in the line
      for (const closingTag of closingTags) {
        const lastOpenTag = openTagsStack.pop();
        if (!lastOpenTag || !isClosingTagMatching(closingTag, lastOpenTag.tag)) {
          if (lastOpenTag) {
            openTagsStack.push(lastOpenTag);
          }
          break;
        }
      }
    }
  }
}// processHTMLtags

// Helper function to extract the class from an HTML tag
function getClassFromHTMLTag(tag: string) {
  const match = tag.match(/class=["']([^"']+)["']/);
  return match ? match[1] : null;
}// getClassFromHTMLTag

// Helper function to check if a closing tag matches an opening tag
function isClosingTagMatching(closingTag: string, openingTag: string) {
  const closingTagName = closingTag.match(/<\/(\w+)/)?.[1];
  const openingTagName = openingTag.match(/<(\w+)/)?.[1];
  return closingTagName === openingTagName;
}// isClosingTagMatching

async function PDFExport(codeBlockElement: HTMLElement[], plugin: CodeblockCustomizerPlugin, codeBlockFirstLines: string[]) {
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

    await addClasses(codeblockPreElement, codeblockDetails, plugin, codeblockCodeElement as HTMLElement, null);
  }
}// PDFExport

function getCodeBlockDetails(codeBlockFirstLine: string, pluginSettings: CodeblockCustomizerSettings): CodeBlockDetails  {
  const codeBlockLang = getCodeBlockLanguage(codeBlockFirstLine) || "";
  const highlightedLinesParams = extractParameter(codeBlockFirstLine, "hl:");
  const linesToHighlight = getHighlightedLines(highlightedLinesParams);
  const fileName = (extractFileTitle(codeBlockFirstLine) || "").toString().trim();
  const Fold = isFoldDefined(codeBlockFirstLine);
  let lineNumberOffset = -1;
  let showNumbers = "";

  const specificLN = (extractParameter(codeBlockFirstLine, "ln:") || "") as string;
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
  
  const alternateColors = pluginSettings.SelectedTheme.colors[getCurrentMode()].codeblock.alternateHighlightColors || {};
  let altHL: { name: string, lineNumber: number }[] = [];
  for (const [name, hexValue] of Object.entries(alternateColors)) {
    const altParams = extractParameter(codeBlockFirstLine, `${name}:`);
    altHL = altHL.concat(getHighlightedLines(altParams).map((lineNumber) => ({ name, lineNumber })));
  }
  
  let isCodeBlockExcluded = false;
  isCodeBlockExcluded = isExcluded(codeBlockFirstLine, pluginSettings.ExcludeLangs);

  return {
    codeBlockLang,
    linesToHighlight,
    fileName,
    Fold,
    lineNumberOffset,
    showNumbers,
    altHL,
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
    let line = array[i].trim();
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