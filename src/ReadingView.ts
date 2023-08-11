import { MarkdownView, MarkdownPostProcessorContext, sanitizeHTMLToDom, TFile, setIcon, MarkdownSectionInformation } from "obsidian";

import { getHighlightedLines, getDisplayLanguageName, isExcluded, getLanguageIcon, createContainer, createCodeblockLang, createCodeblockIcon, createFileName, createCodeblockCollapse, getCurrentMode, getCodeBlockLanguage, extractParameter, extractFileTitle, isFolded, getBorderColorByLanguage, removeCharFromStart } from "./Utils";
import CodeblockCustomizerPlugin from "./main";
import { CodeblockCustomizerSettings } from "./Settings";

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

export async function ReadingView(codeBlockElement: HTMLElement, context: MarkdownPostProcessorContext, plugin: CodeblockCustomizerPlugin) {
  const codeElm: HTMLElement | null = codeBlockElement.querySelector('pre > code');

  if (!codeElm) 
    return;
  
  const preElements: Array<HTMLElement> = Array.from(codeBlockElement.querySelectorAll('pre:not(.frontmatter)'));
  if (!preElements)
    return;

  const codeBlockSectionInfo = context.getSectionInfo(codeElm);
  if (!codeBlockSectionInfo) {
    // PDF export and callout render in editing view!
    handlePDFExportAndCallouts(codeElm, preElements, context, plugin);
  }

  const sectionInfo: MarkdownSectionInformation | null = context.getSectionInfo(preElements[0]);
  if (!sectionInfo)
    return;

  const codeblockLines = Array.from({length: sectionInfo.lineEnd - sectionInfo.lineStart + 1}, (_,number) => number + sectionInfo.lineStart).map((lineNumber) => sectionInfo.text.split('\n')[lineNumber]);
  const codeblockFirstLines = getCodeBlocksFirstLines(codeblockLines);

  if (preElements.length !== codeblockFirstLines.length)
    return;

  for (const [key, preElement] of preElements.entries()) {
    const codeBlockFirstLine = codeblockFirstLines[key];
    const preCodeElm = preElement.querySelector('pre > code');

    if (!preCodeElm)
      return;

    if (Array.from(preCodeElm.classList).some(className => /^language-\S+/.test(className)))
      while(!preCodeElm.classList.contains("is-loaded"))
        await sleep(2);

    const codeblockDetails = getCodeBlockDetails(codeBlockFirstLine, plugin.settings);
    if (codeblockDetails.isCodeBlockExcluded)
      continue;

    await addClasses(preElement, codeblockDetails, plugin, preCodeElm as HTMLElement);
  }
}// ReadingView

export async function calloutPostProcessor(codeBlockElement: HTMLElement, context: MarkdownPostProcessorContext, plugin: CodeblockCustomizerPlugin) {

  const calloutPreElements: Array<HTMLElement> = Array.from(codeBlockElement.querySelectorAll('.callout-content pre'));
  if (!calloutPreElements)
    return;

  const calloutElements: HTMLElement | null = codeBlockElement.querySelector('.callout');
  //console.log(calloutElements);
  if (!calloutElements)
    return;
   /* const preElements: Array<HTMLElement> = Array.from(codeBlockElement.querySelectorAll('pre:not(.frontmatter)'));
    if (!preElements)
      return;*/

  const markdownView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  //const codeBlockSectionInfo = context.getSectionInfo(calloutElements);
  
  if (!markdownView) {
    //console.log(calloutPreElements);
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
    let temp: string[] = [];
    
    if (cache?.sections) {
      for (const element of cache.sections) {
        //console.log(element);
       
        if (element.type === 'callout') {
          //console.log(element);
          //if (codeBlockElement?.parentElement?.parentElement?.classList.contains("callout-content")) {
            //console.log(element);
            const lineStart = element.position.start.line;
            const lineEnd = element.position.end.line + 1;
            temp = getCodeBlocksFirstLines(fileContentLines.slice(lineStart, lineEnd));
            //console.log(temp);
            //console.log(lineStart + " - " + lineEnd);
            //console.log(codeBlockFirstLines);
            const codeblockDetails = getCodeBlockDetails(temp.toString(), plugin.settings);
            //console.log(codeblockDetails);
            //if (codeblockDetails.isCodeBlockExcluded)
              //return;
              calloutElements.setAttribute("args",temp.toString());
            codeBlockFirstLines = temp;
            //const args = calloutElements?.getAttribute("args") ||"";
            //console.log("args = "  +args);
          //if (calloutElements.hasAttribute("args") && !calloutElements.hasAttribute("processed")){
            //const args = calloutElements?.getAttribute("args") ||"";
            //console.log("args = "  +args);
            //const codeblockDetails = getCodeBlockDetails(args, plugin.settings);
            //await addClasses(calloutElements, codeblockDetails, plugin, calloutPreElements[0] as HTMLElement);
           // calloutElements?.setAttribute("processed", "yes");
          //}
          /*}
          else
            codeBlockFirstLines = getCodeBlocksFirstLines(fileContentLines);*/
        }
        //codeBlockFirstLines = getCodeBlocksFirstLines(fileContentLines.slice(lineStart, lineEnd));
      }
      
    }

    /*const sectionInfo: MarkdownSectionInformation | null = context.getSectionInfo(calloutElements);
    console.log(sectionInfo);
    if (!sectionInfo)
      return;
  
    const codeblockLines = Array.from({length: sectionInfo.lineEnd - sectionInfo.lineStart + 1}, (_,number) => number + sectionInfo.lineStart).map((lineNumber) => sectionInfo.text.split('\n')[lineNumber]);
    const codeblockFirstLines = getCodeBlocksFirstLines(codeblockLines);*/
  //console.log(calloutPreElements);
  console.log(codeBlockFirstLines);
    if (calloutPreElements.length !== codeBlockFirstLines.length)
      return;
  
    for (let [key, preElement] of calloutPreElements.entries()) {
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
  
      await addClasses(preElement, codeblockDetails, plugin, preCodeElm as HTMLElement);
    }
    /*if (cache?.sections) {
      for (const element of cache.sections) {
        console.log(element);
        if (element.type === 'callout') {
          //console.log(element);
          if (codeBlockElement?.parentElement?.parentElement?.classList.contains("callout-content")) {
            console.log(element);
            const lineStart = element.position.start.line;
            const lineEnd = element.position.end.line + 1;
            temp = getCodeBlocksFirstLines(fileContentLines.slice(lineStart, lineEnd));
            console.log(lineStart + " - " + lineEnd);
            //console.log(codeBlockFirstLines);
            const codeblockDetails = getCodeBlockDetails(temp.toString(), plugin.settings);
            console.log(codeblockDetails.codeBlockLang);
            //if (codeblockDetails.isCodeBlockExcluded)
              //return;
  
            codeBlockFirstLines = temp;
          }
          else
            codeBlockFirstLines = getCodeBlocksFirstLines(fileContentLines);
        }

      }
    } else {
      console.error(`Metadata cache not found for file: ${context.sourcePath}`);
      return;
    }*/

    /*if (calloutPreElements.length !== codeBlockFirstLines.length)
      return;*/

  /*try {
    if (plugin.settings.SelectedTheme.settings.printing.enablePrintToPDFStyling)
      await PDFExport(calloutPreElements, plugin, codeBlockFirstLines);
  } catch (error) {
    console.error(`Error exporting to PDF: ${error.message}`);
    return;
  }*/
  return;
  }
}// calloutPostProcessor

async function addClasses(preElement: HTMLElement, codeblockDetails: CodeBlockDetails, plugin: CodeblockCustomizerPlugin, preCodeElm: HTMLElement) {
  preElement.classList.add(`codeblock-customizer-pre`);

  if (codeblockDetails.codeBlockLang)
    preElement.classList.add(`codeblock-customizer-language-` + codeblockDetails.codeBlockLang.toLowerCase());

  if (preElement.parentElement)
    preElement.parentElement.classList.add(`codeblock-customizer-pre-parent`);

  let specificHeader = true;
  let fileName = codeblockDetails.fileName;
  if (codeblockDetails.fileName === null || codeblockDetails.fileName === "") {
    fileName = plugin.settings.SelectedTheme.settings.header.collapsedCodeText || "Collapsed Code";
    if (!codeblockDetails.Fold) {
      specificHeader = false;
    }
  }

  const header = HeaderWidget(preElement as HTMLPreElement, fileName, specificHeader, getDisplayLanguageName(codeblockDetails.codeBlockLang), codeblockDetails.codeBlockLang, codeblockDetails.Fold);
  preElement.insertBefore(header, preElement.childNodes[0]);
	
  if (codeblockDetails.Fold)
    preElement.classList.add("codeblock-customizer-collapsed");
	
  const borderColor = getBorderColorByLanguage(codeblockDetails.codeBlockLang, plugin.settings.SelectedTheme.colors[getCurrentMode()].codeblock.languageBorderColors);
  if (borderColor.length > 0)
    preElement.classList.add(`hasLangBorderColor`);

  highlightLines(preCodeElm, codeblockDetails);
}// addClasses

async function handlePDFExportAndCallouts(codeElm: HTMLElement, preElements: Array<HTMLElement>, context: MarkdownPostProcessorContext, plugin: CodeblockCustomizerPlugin) {
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

  if (cache?.sections) {
    codeBlockFirstLines = getCodeBlocksFirstLines(fileContentLines);
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
}// handlePDFExportAndCallouts

function HeaderWidget(preElements: HTMLPreElement, textToDisplay: string, specificHeader: boolean, displayLanguageName: string, languageName: string, Collapse: boolean) {
  const parent = preElements.parentNode;

  const container = createContainer(specificHeader, languageName, false); // hasLangBorderColor must be always false in reading modebecause how the doc is generated
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
    if (preElements.classList.contains(`codeblock-customizer-codeblock-collapsed`))
      setIcon(collapseEl, "chevrons-up-down");
    else
      setIcon(collapseEl, "chevrons-down-up");
    // Toggle the "collapsed" class on the codeblock element
    preElements.classList.toggle(`codeblock-customizer-codeblock-collapsed`);
  });
  
  if (Collapse) {
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
  lineNumberWrapper.setText(lineNumber.toString());
  
  return lineNumberWrapper;
}// createLineNumberElement

function createLineTextElement(line: string) {
  const lineText = line !== "" ? line : "<br>";
  const sanitizedText = sanitizeHTMLToDom(lineText);
  const lineContentWrapper = createDiv({cls: `codeblock-customizer-line-text`, text: sanitizedText});  
  
  return lineContentWrapper;
}// createLineTextElement

function highlightLines(preCodeElm: HTMLElement, codeblockDetails: CodeBlockDetails) {
  if (!preCodeElm)
    return;

  let codeblockLines = preCodeElm.innerHTML.split("\n");
  if (codeblockLines.length == 1)
    codeblockLines = ['',''];

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
    preCodeElm.appendChild(lineWrapper);

    // create line number element
    const lineNumberEl = createLineNumberElement(lineNumber + offset, codeblockDetails.showNumbers);
    lineWrapper.appendChild(lineNumberEl);

    // create line text element
    const lineTextEl = createLineTextElement(line);
    processHTMLtags(openTagsStack, lineTextEl, line);
    lineWrapper.appendChild(lineTextEl);
	});
}// highlightLines

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

    await addClasses(codeblockPreElement, codeblockDetails, plugin, codeblockCodeElement as HTMLElement);
  }
}// PDFExport

function getCodeBlockDetails(codeBlockFirstLine: string, pluginSettings: CodeblockCustomizerSettings): CodeBlockDetails  {
  const codeBlockLang = getCodeBlockLanguage(codeBlockFirstLine) || "";
  const highlightedLinesParams = extractParameter(codeBlockFirstLine, "hl:");
  const linesToHighlight = getHighlightedLines(highlightedLinesParams);
  const fileName = (extractFileTitle(codeBlockFirstLine) || "").toString().trim();
  const Fold = isFolded(codeBlockFirstLine);
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

export function foldAllReadingView(fold: boolean) {
  const preParents = document.querySelectorAll('.codeblock-customizer-pre-parent');
  preParents.forEach((preParent) => {
    const preElement = preParent.querySelector('.codeblock-customizer-pre');
    if (fold)
      preElement?.classList.add('codeblock-customizer-codeblock-collapsed');
    else
      preElement?.classList.remove('codeblock-customizer-codeblock-collapsed');
  });
}//foldAllreadingView

function getCodeBlocksFirstLines(array: string[]): string[] {
  const codeBlocks: string[] = [];
  let currentBlock: string[] = [];

  for (let i = 0; i < array.length; i++) {
    let line = array[i].trim();
    line = removeCharFromStart(line.trim(), ">");

    if (line.startsWith("```")) {
      if (currentBlock.length > 0) {
          const firstLineOfBlock = currentBlock[0];
          codeBlocks.push(firstLineOfBlock);
          currentBlock = [];
      } else {
        currentBlock.push(line);
      }
    } else if (currentBlock.length > 0) {
      currentBlock.push(line);
    }
  }

  // Handle the case when the last block is requested
  if (codeBlocks.length > 0) {
    //const firstLineOfBlock = currentBlock[0];
    return codeBlocks;
  }

  return [];
}// getCodeBlocksFirstLine
