import { setIcon, MarkdownRenderer, Notice} from "obsidian";

import { createUncollapseCodeButton, addTextToClipboard, isPluginLoaded, RenderOptions, removeCharFromStart, normalizeIndentation, generateSnapshot, filterOccurrences } from "./Utils";
import { TooltipManager } from "./TooltipManager";
import { PromptManager } from "./PromptManager";
import CodeBlockCustomizerPlugin from "./main";
import { ANNOTATION_PATTERN, EXECUTE_CODE_SUPPORTED_LANGUAGES, fadeOutLineCount, rhombusSVG } from "./Const";
import { addAndObserveExecuteCodeButtons } from "./ExecuteCode";
import { PluginSettings } from "./Settings";
import { CBCParameters } from "./Parsing";

interface IndentationInfo {
  indentationLevels: number;
  insertCollapse: boolean;
}

export interface CodeBlockData {
  firstLine: string;
  contentLines: string[];
  startLine: number;
  endLine: number;
  isIndentedBlock?: boolean;
}

export interface ExtractionOptions {
  stripCalloutMarkers?: boolean;      // strip '>' characters (callouts)
  skipFirstLine?: boolean;            // skip the first line of input (admonitions)
  allowLongerClosingFence?: boolean;  // allow the closing fence to be longer than the opening one
  handleIndentedBlocks?: boolean;     // check for non-fenced indented code blocks
}

type AnnotationInfo = { 
  selector: string; 
  type: string; 
  content: string; 
  title?: string 
};

export function trackIndentation(lines: string[]): IndentationInfo[] {
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
  let observer: MutationObserver | null = null;

  const copyButton = createCopyButton(parameters.displayLanguage);
  copyButton.addEventListener("click", (event) => {
    const preEl = targetPreElement || (event.currentTarget as HTMLElement).parentNode?.parentNode as HTMLElement;
    if (preEl) {
      copyCode(preEl, event, plugin, codeblockLines);
    }
  });
  frag.appendChild(copyButton);

  const snapshotButton = createsnapshotButton(container, targetPreElement, parameters, plugin);
  frag.appendChild(snapshotButton);

  const wrapCodeButton = createWrapCodeButton();
  wrapCodeButton.addEventListener("click", (event) => {
    const preEl = targetPreElement || (event.currentTarget as HTMLElement).parentNode?.parentNode as HTMLElement;
    if (preEl) {
      wrapCode(preEl, event);
    }
  });
  frag.appendChild(wrapCodeButton);

  if (plugin.settings.pluginSettings.plugins.executeCode.enabled && isPluginLoaded('execute-code', plugin) && EXECUTE_CODE_SUPPORTED_LANGUAGES.includes(parameters.language.toLowerCase())) {
    observer = addAndObserveExecuteCodeButtons(frag, targetPreElement, parameters, plugin);
  }

  container.appendChild(frag);
  return { container, observer };
}// createButtons

function createsnapshotButton(container: HTMLDivElement, targetPreElement: HTMLElement | undefined, parameters: CBCParameters, plugin: CodeBlockCustomizerPlugin) {
  const snapshotButton = document.createElement("button");
  snapshotButton.classList.add("codeblock-customizer-snapshot-button");
  snapshotButton.setAttribute("aria-label", "Copy as image");
  setIcon(snapshotButton, "camera");

  snapshotButton.addEventListener("click", async (event) => {
    event.stopPropagation();

    const preEl = targetPreElement || (event.currentTarget as HTMLElement).closest('pre');
    if (!preEl || !preEl.parentElement) {
      new Notice("Error: Could not find code block container.");
      return;
    }
    
    const parentContainer = preEl.parentElement;

    //container.style.visibility = 'hidden';

    try {
      let elementToClone: HTMLElement;
      const isGrouped = preEl.classList.contains('displayedInGroup');

      if (isGrouped) {
        const wrapper = document.createElement('div');
        const groupName = preEl.getAttribute('groupname');
        if (groupName) {
          const headerEl = document.querySelector(`.codeblock-customizer-header-group-container[group="${groupName}"]`);
          if (headerEl) {
            wrapper.appendChild(headerEl.cloneNode(true));
          }
        }
        wrapper.appendChild(preEl.cloneNode(true));
        elementToClone = wrapper;
      } else {
        // normal code blocks
        elementToClone = preEl.cloneNode(true) as HTMLElement;
      }

      // remove hidden-code element (execute code)
      const hiddenCodeEl = elementToClone.querySelector('code.codeblock-customizer-hidden-code');
      if (hiddenCodeEl) {
        hiddenCodeEl.remove();
      }

      const snapshotOptions = {
        style: { padding: '0px', margin: '0' },
        filter: (node: HTMLElement) => 
          !node.classList?.contains('codeblock-customizer-button-container') && 
          !node.classList?.contains('codeblock-customizer-header-collapse'), 
      };

      await generateSnapshot(elementToClone, preEl, parentContainer, plugin.settings, parameters, snapshotOptions);
    } finally {
      //container.style.visibility = 'visible';
    }
  });

  return snapshotButton;
}// createsnapshotButton

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

  const sourceCodeElement = preElement.querySelector('code:not(.language-output):not(.codeblock-customizer-hidden-code)');
  if (!sourceCodeElement) {
    const codeText = preElement.textContent || '';
    addTextToClipboard(codeText);
    return;
  }

  const allLineElements = sourceCodeElement.querySelectorAll<HTMLElement>("div[data-line-number]");
  const settings = plugin.settings.pluginSettings;
  const includePrompts = settings.prompts.includePromptsInCopy;
  const excludeAnnotations = settings.annotations.excludeAnnotationsFromCopy;
  const codeTextArray: string[] = [];

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

  const processedLines = normalizeIndentation(codeTextArray);
  const codeText = processedLines.join('\n');
  addTextToClipboard(codeText);
}// copyCode

function wrapCode(preElement: HTMLElement, event: Event) {
  event.stopPropagation();

  if (!preElement)
    return;

  const codeElement = preElement.querySelector('code:not(.codeblock-customizer-hidden-code)') as HTMLElement;
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

export function extractLinesFromHTML(container: HTMLElement): { htmlLines: string[]; textLines: string[] } {
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

  const finalHtmlLines = lines;
  const finalTextLines = container.textContent?.split('\n') ?? [];

  /*if (finalHtmlLines.length === 1 && container.textContent?.trim() === '') {
    finalHtmlLines = ['', ''];
    finalTextLines = ['', ''];
  }*//* else if (finalHtmlLines.length === 1) {
    finalHtmlLines.push('');
    finalTextLines.push('');
  }*/

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
  if (altwords.length > 0 && altwords.some(altword => altword.words.some(word => caseInsensitiveLineText.includes(word.toLowerCase())))) {
    altwords.forEach(altword => {
      if (altword.words.some(word => caseInsensitiveLineText.includes(word.toLowerCase()))) {
        isAlternativeHighlightedByWord = true;
        isAlternativeHighlightedByWordColor = altword.colorName;
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
  type HighlightedWord = {
    text: string;
    occurrences: number[];
  };

  const rulesToApply: { from?: string; to?: string; words?: HighlightedWord[]; all?: boolean; occurrences?: number[]; className: string }[] = [];

  const addRule = (details: { from?: string; to?: string; words?: HighlightedWord[]; all?: boolean; occurrences?: number[] }, colorName = '') => {
    rulesToApply.push({ ...details, className: colorName ? `codeblock-customizer-highlighted-text-${colorName}` : 'codeblock-customizer-highlighted-text' });
  };
  
  if (parameters.defaultTextToHighlight.words.length > 0) addRule({ words: parameters.defaultTextToHighlight.words });
  parameters.defaultTextToHighlight.lineSpecificWords.forEach(r => { if (r.lineNumber === lineNumber) addRule({ words: r.words }); });
  parameters.defaultTextToHighlight.textBetween.forEach(r => addRule({ from: r.from, to: r.to, occurrences: r.occurrences }));
  parameters.defaultTextToHighlight.lineSpecificTextBetween.forEach(r => { if (r.lineNumber === lineNumber) addRule({ from: r.from, to: r.to, occurrences: r.occurrences }); });
  if (parameters.defaultTextToHighlight.allWordsInLine.includes(lineNumber)) addRule({ all: true });

  parameters.alternativeTextToHighlight.words.forEach(r => addRule({ words: r.words }, r.colorName));
  parameters.alternativeTextToHighlight.lineSpecificWords.forEach(r => { if (r.lineNumber === lineNumber) addRule({ words: r.words }, r.colorName); });
  parameters.alternativeTextToHighlight.textBetween.forEach(r => addRule({ from: r.from, to: r.to, occurrences: r.occurrences }, r.colorName));
  parameters.alternativeTextToHighlight.lineSpecificTextBetween.forEach(r => { if (r.lineNumber === lineNumber) addRule({ from: r.from, to: r.to, occurrences: r.occurrences }, r.colorName); });
  parameters.alternativeTextToHighlight.allWordsInLine.forEach(r => { if (r.allWordsInLine.includes(lineNumber)) addRule({ all: true }, r.colorName); });
  
  if (rulesToApply.length === 0) {
    return lineHtml;
  }

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = lineHtml;
  const lineTextContent = tempDiv.textContent || '';
  const escapeRegex = (str: string) => str.replace(/[-/\\^$*+?.()|[\]{}%]/g, '\\$&');

  type HighlightPoint = {
    index: number;
    type: 'start' | 'end';
    className: string;
    // lower priority means it's an "outer" span
    priority: number; // (end - start)
  };
  
  const allPoints: HighlightPoint[] = [];

  for (const rule of rulesToApply) {
    let ranges: { from: number, to: number }[] = [];
    
    if (rule.words) {
      for (const word of rule.words) {
        if (!word || !word.text) continue;
        const regex = new RegExp(escapeRegex(word.text), 'gi');
        const allMatches: { from: number, to: number }[] = [];
        let match;
        while ((match = regex.exec(lineTextContent)) !== null) {
          allMatches.push({ from: match.index, to: match.index + match[0].length });
        }
        ranges.push(...filterOccurrences(allMatches, word.occurrences));
      }
    } else { // from:to and all
      ranges = findHighlightRanges(lineTextContent, rule.from ?? '', rule.to ?? '', rule.occurrences ?? []);
    }

    for (const range of ranges) {
      if (range.from === range.to) {
        continue;
      }

      allPoints.push({index: range.from, type: 'start', className: rule.className, priority: range.to - range.from});
      allPoints.push({index: range.to, type: 'end', className: rule.className, priority: range.to - range.from});
    }
  }

  if (allPoints.length === 0) {
    return lineHtml;
  }

  allPoints.sort((a, b) => {
    if (a.index !== b.index) {
      return a.index - b.index;
    }
    if (a.type !== b.type) {
      return a.type === 'end' ? -1 : 1;
    }
    if (a.type === 'start') {
      return b.priority - a.priority;
    }
    return a.priority - b.priority;
  });
 
  const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, null);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  let textOffset = 0;
  let pointIndex = 0;
  const activeSpans: { className: string; span: HTMLElement }[] = [];

  for (const currentNode of textNodes) {
    const parent = currentNode.parentNode;
    if (!parent) continue;

    const nodeText = currentNode.textContent || '';
    const nodeLength = nodeText.length;
    let lastSliceIndex = 0;
    const fragment = document.createDocumentFragment();
    let currentWrapper: Node = fragment;

    for (const active of activeSpans) {
      const newSpan = document.createElement('span');
      newSpan.className = active.className;
      currentWrapper.appendChild(newSpan);
      currentWrapper = newSpan;
      active.span = newSpan;
    }

    while (pointIndex < allPoints.length && allPoints[pointIndex].index < textOffset + nodeLength) {
      const point = allPoints[pointIndex];
      const localIndex = point.index - textOffset;

      if (localIndex > lastSliceIndex) {
        currentWrapper.appendChild(document.createTextNode(nodeText.substring(lastSliceIndex, localIndex)));
        lastSliceIndex = localIndex;
      }

      if (point.type === 'start') {
        const newSpan = document.createElement('span');
        newSpan.className = point.className;
        currentWrapper.appendChild(newSpan);
        currentWrapper = newSpan;
        activeSpans.push({ className: point.className, span: newSpan });
      } else {
        const matchingSpanIndex = activeSpans.findLastIndex(s => s.className === point.className);
        if (matchingSpanIndex > -1) {
          while (activeSpans.length - 1 > matchingSpanIndex) {
            const lastActive = activeSpans.pop();
            if (lastActive && lastActive.span.parentNode) {
              currentWrapper = lastActive.span.parentNode;
            }
          }
          const closingSpan = activeSpans.pop();
          if (closingSpan && closingSpan.span.parentNode) {
            currentWrapper = closingSpan.span.parentNode;
          }
        }
      }
      pointIndex++;
    }

    if (lastSliceIndex < nodeLength) {
      currentWrapper.appendChild(document.createTextNode(nodeText.substring(lastSliceIndex)));
    }
    
    parent.replaceChild(fragment, currentNode);
    textOffset += nodeLength;
  }

  return tempDiv.innerHTML;
}// getHighlightedLineHtml

export async function renderCodeBlockLines(options: RenderOptions): Promise<{ fragment: DocumentFragment; annotations: AnnotationInfo[] }> {
  const {
    htmlLines,
    textLines,
    lineCount,
    //parameters,
    plugin,
    settings,
    sourcePath,
    target = 'input',
    handleAnnotations = false,
    processPrompts = false,
    addIndentationGuides = false,
    parseLinks = false,
    isPrinting = false,
  } = options;

  let parameters = options.parameters;
  if (target === 'codeOutput') {
    parameters = {
      ...parameters,
      defaultLinesToHighlight: parameters.outputLinesToHighlight,
      defaultTextToHighlight: parameters.outputTextToHighlight,
      alternativeLinesToHighlight: {
        ...parameters.alternativeLinesToHighlight,
        lines: parameters.alternativeLinesToHighlight.outputLines,
        words: parameters.alternativeLinesToHighlight.outputWords,
        lineSpecificWords: parameters.alternativeLinesToHighlight.outputLineSpecificWords,
      },
      alternativeTextToHighlight: {
        ...parameters.alternativeTextToHighlight,
        allWordsInLine: parameters.alternativeTextToHighlight.outputAllWordsInLine,
        words: parameters.alternativeTextToHighlight.outputWords,
        lineSpecificWords: parameters.alternativeTextToHighlight.outputLineSpecificWords,
        textBetween: parameters.alternativeTextToHighlight.outputTextBetween,
        lineSpecificTextBetween: parameters.alternativeTextToHighlight.outputLineSpecificTextBetween,
      }
    };
  }

  const frag = document.createDocumentFragment();
  //const lineCount = textLines.length;
  const prompt = processPrompts ? new PromptManager(parameters, lineCount, plugin.settings) : null;
  const indentationLevels = addIndentationGuides ? trackIndentation(textLines) : null;
  const annotationsToProcess: AnnotationInfo[] = [];

  const useSemiFold = lineCount >= settings.semiFold.visibleLines + fadeOutLineCount;
  let fadeOutLineIndex = 0;

  for (let index = 0; index < lineCount; index++) {
    const htmlLine = htmlLines[index] ?? '';
    const textLine = textLines[index] ?? '';
    const lineNumber = index + 1;
    const caseInsensitiveLineText = textLine.toLowerCase();

    let processedLine = htmlLine;
    let annotationData = null;

    if (handleAnnotations) {
      const result = processAnnotations(htmlLine, isPrinting, plugin);
      processedLine = result.lineContent;
      annotationData = result.annotationData;
    }
    
    const { lineClasses, uncollapseButton, updatedFadeOutLineIndex } = getLineClass(lineNumber, caseInsensitiveLineText, parameters, settings, useSemiFold, fadeOutLineIndex);
    fadeOutLineIndex = updatedFadeOutLineIndex;
    const lineWrapper = createDiv();

    for (const lineClass of lineClasses.split(' ')){
      if (lineClass) {
        lineWrapper.classList.add(lineClass);
      }
    }

    //if (showLineNumbers) {
    const lineNumberEl = createLineNumberElement(lineNumber + parameters.lineNumberOffset, parameters.showNumbers);
    lineWrapper.appendChild(lineNumberEl);
    //}

    if (annotationData) {
      const annotationIcon = createSpan({cls: `codeblock-customizer-annotation-icon`});
      const selector = `[data-line-number="${lineNumber}"] .codeblock-customizer-annotation-icon`;
      annotationsToProcess.push({ selector, type: annotationData.type, content: annotationData.content, title: annotationData.title });
      annotationIcon.classList.add(`codeblock-customizer-annotation-icon-${annotationData.type}`);
      lineWrapper.appendChild(annotationIcon);
    }
    
    let promptOutput: { className: string, text: string }[] = [];
    const isPromptLine = processPrompts && prompt && (parameters.parsePromptId || prompt.promptLines.has(lineNumber + parameters.lineNumberOffset));
    if (isPromptLine) {
      const promptResult = prompt.renderLine(textLine, lineNumber + parameters.lineNumberOffset);

      if (parameters.parsePromptId) {
        // parsed prompt
        if (promptResult.matchedLength > 0) {
          lineWrapper.classList.add(`has-prompt`);
          if (promptResult.lineClassName) 
            lineWrapper.classList.add(promptResult.lineClassName);
          if (promptResult.isRoot) 
            lineWrapper.classList.add(`is-root`);
          
          processedLine = applyPromptStylesToString(processedLine, promptResult.styledParts);
        }
      } else {
        // normal prompts
        const promptPart = promptResult.styledParts[0];
        promptOutput = promptResult.output; 
        if (promptPart?.node) {
          lineWrapper.classList.add(`has-prompt`);
          if (promptResult.isRoot) {
            lineWrapper.classList.add(`is-root`);
          }
          lineWrapper.appendChild(promptPart.node);
        }
      }
    }

    if (addIndentationGuides && indentationLevels) {
      const indentInfo = indentationLevels[index] ?? { indentationLevels: 0, insertCollapse: false };
      processedLine = addIndentLine(processedLine, indentInfo.insertCollapse, indentInfo.indentationLevels);
    }

    if (parseLinks) {
      processedLine = parseInput(processedLine, sourcePath, plugin);
    }

    const lineTextEl = createDiv({ cls: `codeblock-customizer-line-text` });
    const finalLineHtml = getHighlightedLineHtml(processedLine, parameters, lineNumber);
    lineTextEl.innerHTML = finalLineHtml.trim() === '' ? '<br>' : finalLineHtml;
    lineWrapper.appendChild(lineTextEl);
    
    if (promptOutput.length > 0) {
      promptOutput.forEach(out => {
        const outputEl = createDiv({ cls: `${out.className} codeblock-customizer-line-text`, text: out.text, });
        lineWrapper.appendChild(outputEl);
      });
    }

    if (addIndentationGuides) {
      const indentLevel = indentationLevels && indentationLevels[lineNumber - 1] ? indentationLevels[lineNumber - 1].indentationLevels.toString() : "-1";
      lineWrapper.setAttribute('indentLevel', indentLevel);
    }

    lineWrapper.setAttribute('data-line-number', lineNumber.toString());
    
    if (uncollapseButton) {
      lineWrapper.appendChild(uncollapseButton);
    }
        
    frag.appendChild(lineWrapper);
  }

  return { fragment: frag, annotations: annotationsToProcess };
}// renderCodeBlockLines

function applyPromptStylesToString(htmlLine: string, styledParts: { from: number; to: number; className: string }[]): string {
  if (styledParts.length === 0) {
    return htmlLine;
  }

  const starts = new Map<number, string[]>();
  const ends = new Map<number, number>();
  for (const part of styledParts) {
    let startSpans = starts.get(part.from);
    if (!startSpans) {
      startSpans = [];
      starts.set(part.from, startSpans);
    }
    startSpans.push(`<span class="${part.className}">`);
    ends.set(part.to, (ends.get(part.to) || 0) + 1);
  }

  let result = '';
  let textIndex = 0;
  let inTag = false;
  const entityRegex = /&[#a-zA-Z0-9]+;/g;

  for (let i = 0; i < htmlLine.length; ) {
    if (!inTag) {
      const endCount = ends.get(textIndex);
      if (endCount) {
        result += '</span>'.repeat(endCount);
      }
      const startSpans = starts.get(textIndex);
      if (startSpans) {
        result += startSpans.join('');
      }
    }

    const char = htmlLine[i];

    if (char === '<') {
      inTag = true;
      result += char;
      i++;
      continue;
    } else if (char === '>') {
      inTag = false;
      result += char;
      i++;
      continue;
    }

    if (!inTag && char === '&') {
      entityRegex.lastIndex = i;
      const match = entityRegex.exec(htmlLine);
      if (match && match.index === i) {
        const entity = match[0];
        result += entity;
        i += entity.length;
        textIndex++;
        continue;
      }
    }

    result += char;
    i++;
    if (!inTag) {
      textIndex++;
    }
  }

  const endCount = ends.get(textIndex);
  if (endCount) {
    result += '</span>'.repeat(endCount);
  }

  return result;
}// applyPromptStylesToString

export function attachEventListeners(preCodeElm: HTMLElement, plugin: CodeBlockCustomizerPlugin, sourcePath: string, annotationsToProcess: { selector: string, type: string, content: string, title?: string }[]) {
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
    } else if (plugin.settings.pluginSettings.annotations.convertAllComments) {
      type = 'note';
      content = cleanedText;
    }

    if (type && content && content.length > 0) {
      annotationData = { type, content, title };
      commentElement.classList.add('codeblock-customizer-annotation-source-comment');

      if (commentElement.textContent) {
        commentElement.setAttribute('data-cbc-comment', commentElement.textContent);
      }
      const printAsComments = plugin.settings.pluginSettings.printing.printAnnotationsAsComments;
      if (!isPrinting || !printAsComments) {
        commentElement.textContent = '';
      }
    }
  }
  return { lineContent: tempDiv.innerHTML, annotationData };
}// processAnnotations
  
function getLineClass(lineNumber: number, caseInsensitiveLineText: string, parameters: CBCParameters, settings: PluginSettings, useSemiFold: boolean, fadeOutLineIndex: number) { 
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

function findHighlightRanges(fullText: string, from: string, to: string, occurrences: number[] = []): { from: number, to: number }[] {
  const ranges: { from: number, to: number }[] = [];
  const escapeRegex = (str: string) => str.replace(/[-/\\^$*+?.()|[\]{}%]/g, '\\$&');

  if (!from && !to) { // neither is specified -> highlight entire line
    const trimmedText = fullText.trim();
    if (trimmedText.length > 0) {
      const start = fullText.indexOf(trimmedText);
      const end = start + trimmedText.length;
      ranges.push({ from: start, to: end });
    }
    return filterOccurrences(ranges, occurrences);
  }
  
  const fromPattern = from ? escapeRegex(from) : '^';
  const toPattern = to ? escapeRegex(to) : '$';
  
  if (from && to) { // from and to are specified
    const fromRegex = new RegExp(fromPattern, 'gi');
    const toRegex = new RegExp(toPattern, 'gi');
    
    const fromIndices: number[] = [];
    const toMatches: { index: number, length: number }[] = [];
    let match;
    while ((match = fromRegex.exec(fullText)) !== null) {
      if (match.index === fromRegex.lastIndex) fromRegex.lastIndex++;
      fromIndices.push(match.index);
    }

    while ((match = toRegex.exec(fullText)) !== null) {
      if (match.index === toRegex.lastIndex) toRegex.lastIndex++;
      toMatches.push({ index: match.index, length: match[0].length });
    }

    for (const fromIndex of fromIndices) {
      const nextToMatch = toMatches.find(toMatch => toMatch.index > fromIndex);
      
      if (nextToMatch) {
        const range = { from: fromIndex, to: nextToMatch.index + nextToMatch.length };
        ranges.push(range);
      }
    }
  } else if (from) { // from is specified -> highlight to end
    if (occurrences.length > 0) {
      const fromOnlyRegex = new RegExp(fromPattern, 'gi');
      let match;
      while ((match = fromOnlyRegex.exec(fullText)) !== null) {
        if (match.index === fromOnlyRegex.lastIndex) fromOnlyRegex.lastIndex++;
        ranges.push({ from: match.index, to: fullText.length });
      }
    } else {
      const regex = new RegExp(fromPattern + '([\\s\\S]*?)$', 'gi');
      let match;
      if ((match = regex.exec(fullText)) !== null) {
        ranges.push({ from: match.index, to: match.index + match[0].length });
      }
    }
  } else { // to is specified -> highlight from start
    if (occurrences.length > 0) {
      const toOnlyRegex = new RegExp(toPattern, 'gi');
      let match;
      while ((match = toOnlyRegex.exec(fullText)) !== null) {
        if (match.index === toOnlyRegex.lastIndex) toOnlyRegex.lastIndex++;
        ranges.push({ from: 0, to: match.index + match[0].length });
      }
    } else {
      const regex = new RegExp('^([\\s\\S]*?)' + toPattern, 'gi');
      let match;
      if ((match = regex.exec(fullText)) !== null) {
        ranges.push({ from: match.index, to: match.index + match[0].length });
      }
    }
  }
  
  return filterOccurrences(ranges, occurrences);
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
      const codeElement = parentElement.querySelector('code:not(.codeblock-customizer-hidden-code)');
      if (codeElement) {
        return codeElement as HTMLElement;
      }
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
  if (!codeElement) {
    return;
  }

  const pre = button.closest('pre.codeblock-customizer-pre');
  if (!pre) {
    return;
  }

  let header: HTMLElement| null = null;
  if (pre.classList.contains("displayedInGroup")) {
    // grouped code blocks
    const group = pre.getAttribute("groupname");
    header = document.querySelector(`.markdown-rendered .codeblock-customizer-pre-parent .codeblock-customizer-header-group-container[group="${group}"]`) as HTMLElement;
  } else {
    // ungrouped code blocks
    header = pre.querySelector('.codeblock-customizer-header-container, .codeblock-customizer-header-container-specific');
  }

  if (header) {
    const collapseIcon = header.querySelector(".codeblock-customizer-header-collapse") as HTMLElement;
    if (collapseIcon) {
      collapseIcon.click();
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

function extractCodeBlocks(lines: string[], options: ExtractionOptions = {}): CodeBlockData[] {
  if (!lines || !Array.isArray(lines)) {
    return [];
  }

  if (options.handleIndentedBlocks) {
    const firstNonEmptyLine = lines.find(line => line.trim() !== '');
    if (firstNonEmptyLine) {
      const isIndentedLine = firstNonEmptyLine.startsWith('    ') || firstNonEmptyLine.startsWith('\t');
      const isFenceLine = firstNonEmptyLine.trim().startsWith('```') || firstNonEmptyLine.trim().startsWith('~~~');
      if (isIndentedLine && !isFenceLine) {
        return [{
          firstLine: '```',
          contentLines: lines,
          startLine: 0,
          endLine: lines.length - 1,
          isIndentedBlock: true
        }];
      }
    }
  }

  const results: CodeBlockData[] = [];
  let inCodeBlock = false;
  let openingFenceCount = 0;
  let openingFenceChar: '`' | '~' | null = null;
  let startLine = -1;
  let firstLine = '';

  const startingIndex = options.skipFirstLine ? 1 : 0;

  for (let i = startingIndex; i < lines.length; i++) {
    const lineContent = lines[i] ?? "";
    let trimmedLine = lineContent.trim();
    
    if (options.stripCalloutMarkers) {
      trimmedLine = removeCharFromStart(trimmedLine, ">");
    }

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
        firstLine = trimmedLine;
      } else if (char === openingFenceChar && (options.allowLongerClosingFence ? count >= openingFenceCount : count === openingFenceCount)) {
        const endLine = i;
        let contentLines = lines.slice(startLine, endLine + 1);
        
        if (options.stripCalloutMarkers) {
          contentLines = contentLines.map(line => line.replace(/^(\s*>\s*)+/, ''));
        }

        results.push({ firstLine: firstLine, contentLines: contentLines, startLine: startLine, endLine: endLine });

        inCodeBlock = false;
        openingFenceChar = null;
        openingFenceCount = 0;
        startLine = -1;
        firstLine = '';
      }
    }
  }

  // Handle an unclosed code block at the end of the file
  if (inCodeBlock && !options.skipFirstLine) {
    const endLine = lines.length - 1;
    let contentLines = lines.slice(startLine, endLine + 1);
    
    if (options.stripCalloutMarkers) {
      contentLines = contentLines.map(line => line.replace(/^(\s*>\s*)+/, ''));
    }
    results.push({ firstLine: firstLine, contentLines: contentLines, startLine: startLine, endLine: endLine });
  }

  return results;
}// extractCodeBlocks

export function extractCodeBlocksFromCallout(lines: string[]): CodeBlockData[] {
  return extractCodeBlocks(lines, { stripCalloutMarkers: true });
}// extractCodeBlocksFromCallout

export function extractCodeBlocksFromAdmonition(lines: string[]): CodeBlockData[] {
  return extractCodeBlocks(lines, { skipFirstLine: true, allowLongerClosingFence: true });
}// extractCodeBlocksFromAdmonition

export function extractCodeBlocksFromSection(lines: string[]): CodeBlockData[] {
  return extractCodeBlocks(lines, { stripCalloutMarkers: true, handleIndentedBlocks: true });
}// extractCodeBlocksFromSection
