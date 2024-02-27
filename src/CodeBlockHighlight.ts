import { EditorView, ViewUpdate, ViewPlugin, Decoration, WidgetType, DecorationSet } from "@codemirror/view";
import { RangeSet, EditorState, Range, Line } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { SyntaxNodeRef } from "@lezer/common";

import { getHighlightedLines, isExcluded, getBorderColorByLanguage, getCurrentMode, getCodeBlockLanguage, extractParameter, isSourceMode, getDisplayLanguageName, addTextToClipboard, getIndentationLevel, getLanguageSpecificColorClass, createObjectCopy, getValueNameByLineNumber, findAllOccurrences } from "./Utils";
import { CodeblockCustomizerSettings } from "./Settings";
import { App, MarkdownRenderer, setIcon, editorInfoField } from "obsidian";
import { getCodeblockByHTMLTarget } from "./Header";
import CodeBlockCustomizerPlugin from "./main";

interface Codeblock {
  from: number;
  to: number;
}

export function codeblockHighlight(settings: CodeblockCustomizerSettings, plugin: CodeBlockCustomizerPlugin) {
  const viewPlugin = ViewPlugin.fromClass(
    class CodeblockHighlightPlugin {
      mutationObserver: MutationObserver;
      view: EditorView;
      decorations: DecorationSet;
      settings: CodeblockCustomizerSettings;
      prevAlternateColors: Record<string, string>;
      prevBorderColors: Record<string, string>;
      prevExcludeLangs: string;
      app: App;
      previousCursorPos: number;

      constructor(view: EditorView) {
        this.initialize(view, settings);
      }

      initialize(view: EditorView, settings: CodeblockCustomizerSettings) {
        this.mutationObserver = setupMutationObserver(view, this);
        this.view = view;
        this.decorations = this.buildDecorations(view);
        this.settings = settings;
        this.prevAlternateColors = {};
        this.prevBorderColors = {};
        this.prevExcludeLangs = "";
        this.app = plugin.app;
      }// initialize

      forceUpdate(editorView: EditorView) {
        this.view = editorView;
        this.decorations = this.buildDecorations(this.view);
        this.view.requestMeasure();
      }// forceUpdate

      shouldUpdate(update: ViewUpdate) {
        const currentCursorPos = update.view.state.selection.main.head;
        return (update.docChanged || update.viewportChanged || !areObjectsEqual(this.settings.SelectedTheme.colors[getCurrentMode()].codeblock.alternateHighlightColors, this.prevAlternateColors)
        || !areObjectsEqual(this.settings.SelectedTheme.colors[getCurrentMode()].codeblock.languageBorderColors, this.prevBorderColors) || this.settings.ExcludeLangs !== this.prevExcludeLangs || this.previousCursorPos !== currentCursorPos);
      }// shouldUpdate
      
      update(update: ViewUpdate) {
        if (this.shouldUpdate(update)) {
          this.prevAlternateColors = createObjectCopy(this.settings.SelectedTheme.colors[getCurrentMode()].codeblock.alternateHighlightColors || {});
          this.prevBorderColors = createObjectCopy(this.settings.SelectedTheme.colors[getCurrentMode()].codeblock.languageBorderColors || {});
          this.prevExcludeLangs = this.settings.ExcludeLangs;
          this.decorations = this.buildDecorations(update.view);
        }
      }// update

      destroy() {
        this.mutationObserver.disconnect();
      }// destroy

      filterVisibleCodeblocks(view: EditorView, codeblocks: Codeblock[]): Codeblock[] {
        return codeblocks.filter((codeblock) => {
          return view.visibleRanges.some((visibleRange) => {
            return (codeblock.from < visibleRange.to && codeblock.to > visibleRange.from);
          });
        });
      }// filterVisibleCodeblocks

      deduplicateCodeblocks(codeblocks: Codeblock[]): Codeblock[] {
        const deduplicatedCodeblocks = [];
        for (let i = 0; i < codeblocks.length; i++) {
          if (i === 0 || codeblocks[i].from !== codeblocks[i - 1].from) {
            deduplicatedCodeblocks.push(codeblocks[i]);
          }
        }
        return deduplicatedCodeblocks;
      }// deduplicateCodeblocks
  
      buildDecorations(view: EditorView): DecorationSet {
        let lineNumber = 0;
        let HL: number[] = [];
        let altHL: { name: string, lineNumber: number }[] = [];
        let lineSpecificWords: Record<number, string> = {};
        let altLineSpecificWords: { name: string; lineNumber: number; value?: string }[] = [];
        let words = "";
        let altWords: { name: string, words: string }[] = [];
        let showNumbers = "";
        let isSpecificNumber = false;
        const currentMode = getCurrentMode();
        let bExclude = false;
        let borderColor = "";
        let codeblockLanguageClass = "";
        let codeblockLanguageSpecificClass = "";
        const alternateColors = settings.SelectedTheme.colors[currentMode].codeblock.alternateHighlightColors || {};
        const languageBorderColors = settings.SelectedTheme.colors[currentMode].codeblock.languageBorderColors || {};
        const languageSpecificColors = settings.SelectedTheme.colors[currentMode].languageSpecificColors;
        const decorations: Array<Range<Decoration>> = [];
        const sourcePath = view.state.field(editorInfoField)?.file?.path ?? "";
        if (!view.visibleRanges || view.visibleRanges.length === 0 || (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(view.state))) {
          return RangeSet.empty;
        }

        // Find all code blocks in the document
        const codeblocks = findCodeblocks(view.state);
        // Find code blocks that intersect with the visible range
        const visibleCodeblocks = this.filterVisibleCodeblocks(view, codeblocks);
        // remove duplicates
        const deduplicatedCodeblocks = this.deduplicateCodeblocks(visibleCodeblocks);
        let codeblockId = 0;
        let indentLevel = 0;
        let indentChars = 0;
        for (const codeblock of deduplicatedCodeblocks) {
          syntaxTree(view.state).iterate({ from: codeblock.from, to: codeblock.to,
            enter(node) {
              const line = view.state.doc.lineAt(node.from);
              const originalLineText = view.state.sliceDoc(line.from, line.to).toString();
              const lineText = originalLineText.trim();
              let lang = null;
              const startLine = node.type.name.includes("HyperMD-codeblock-begin");
              if (startLine) {
                lang = getCodeBlockLanguage(lineText);
                const { level, characters, margin } = getIndentationLevel(originalLineText);
                indentLevel = level;
                indentChars = characters;
              }
              const endLine = node.type.name.includes("HyperMD-codeblock-end");

              if (lang) {
                bExclude = isExcluded(lineText, settings.ExcludeLangs);
                codeblockLanguageClass = "codeblock-customizer-language-" + lang.toLowerCase();
                codeblockLanguageSpecificClass = getLanguageSpecificColorClass(lang, languageSpecificColors);
                borderColor = getBorderColorByLanguage(lang, languageBorderColors);
              }
              if (bExclude) {
                if (endLine) {
                  bExclude = false;
                }
                return;
              }
              
              if (settings.SelectedTheme.settings.codeblock.enableLinks)
                checkForLinks(view, originalLineText, node, decorations, sourcePath, plugin);

              if (startLine) {
                const result = processLineText(lineText, codeblockId, alternateColors);
                lineNumber = result.lineNumber;
                isSpecificNumber = result.isSpecificNumber;
                codeblockId = result.codeblockId;
                showNumbers = result.showNumbers;
                HL = result.HL;
                altHL = result.altHL;
                lineSpecificWords = result.lineSpecificWords;
                altLineSpecificWords = result.altLineSpecificWords;
                words = result.words;
                altWords = result.altWords;
              }

              const caseInsensitiveLineText = (originalLineText ?? '').toLowerCase();

              let lineClass = `codeblock-customizer-line`;
              lineClass = highlightLinesOrWords(lineNumber, startLine, endLine, node, lineSpecificWords, words, HL, altHL, altLineSpecificWords, altWords, line, decorations, caseInsensitiveLineText, lineClass, settings)
              
              lineClass = lineClass + " " + codeblockLanguageClass + " " + codeblockLanguageSpecificClass;
              let spanClass = "";
              if (startLine) {
                spanClass = `codeblock-customizer-line-number-first`;
              }
              
              let width = -1;
              if (isSpecificNumber) 
                width = getMaxWidth(view, codeblockId);

              const style = (width > -1) ? "--gutter-width:" + width.toString() + "px" : "";
              if (borderColor.length > 0)
                lineClass = lineClass + " hasLangBorderColor";

              if (endLine) {
                spanClass = `codeblock-customizer-line-number-last`;
                codeblockLanguageClass = "";
                codeblockLanguageSpecificClass = "";
                borderColor = "";
              }

              if (node.type.name === "HyperMD-codeblock_HyperMD-codeblock-bg" || startLine || endLine) {
                decorations.push(Decoration.line({attributes: {class: lineClass, "codeblockId": codeblockId.toString(), "style": style}}).range(node.from));
                decorations.push(Decoration.widget({ widget: new LineNumberWidget((startLine || endLine) ? " " : lineNumber.toString(), showNumbers, isSpecificNumber, spanClass, codeblockId),}).range(node.from));
                if (startLine) {
                  decorations.push(Decoration.widget({ widget: new deleteCodeWidget(codeblockId)}).range(node.from)); 
                  decorations.push(Decoration.widget({ widget: new copyCodeWidget(lang, codeblockId)}).range(node.from));
                }
                //const unit = getIndentUnit(view.state);
                //console.log(unit);
                //console.log(this.app.vault.getConfig("useTab"));
                //console.log(this.app.vault.getConfig("tabSize"));
                 
                if (indentLevel > 0) {
                  //decorations.push(Decoration.mark({class: "codeblock-customizer-hidden-element"}).range(node.from, node.from + indentChars));
                  if (originalLineText.length > 0) {
                    decorations.push(Decoration.replace({}).range(node.from, node.from + indentChars)); 
                  }
                  decorations.push(Decoration.line({attributes: {"style": `--level:${indentLevel}`, class: `indented-line`}}).range(node.from));
                }
                lineNumber++;
              }
            },
          });
        }
        return RangeSet.of(decorations, true);
      }
    },// CodeblockHighlightPlugin
    {
      decorations: (value) => value.decorations,
    }
  );

  return viewPlugin;
}// codeblockHighlight

function highlightLinesOrWords(lineNumber: number, startLine: boolean, endLine: boolean, node: SyntaxNodeRef, lineSpecificWords: Record<number, string> = {}, words: string, HL: number[], altHL: { name: string, lineNumber: number }[], altLineSpecificWords: { name: string; lineNumber: number; value?: string }[], altWords: { name: string, words: string }[], line: Line, decorations: Array<Range<Decoration>>, caseInsensitiveLineText: string, lineClass: string, settings: CodeblockCustomizerSettings) {
  const addHighlightClass = (name = '') => {
    const className = `codeblock-customizer-line-highlighted${name ? `-${name.replace(/\s+/g, '-').toLowerCase()}` : ''}`;
    return className;
  };

  const highlightLine = (words: string, name = '') => {
    const caseInsensitiveWords = words.toLowerCase().split(',');
    for (const word of caseInsensitiveWords) {
      const retVal = setClass(line, decorations, caseInsensitiveLineText, word, settings, lineClass, name.replace(/\s+/g, '-').toLowerCase());
      lineClass = retVal !== '' ? retVal : lineClass;
    }
    return lineClass;
  };

  const isCodeblockBg = node.type.name === "HyperMD-codeblock_HyperMD-codeblock-bg";

  if (!startLine && !endLine) {
    // highlight line by line number hl:1,3-5
    if (HL.includes(lineNumber)) {
      lineClass = addHighlightClass();
    } 

    // highlight specific lines if they contain a word hl:1|test,3-5|test
    if (lineNumber in lineSpecificWords && isCodeblockBg) {
      lineClass = highlightLine(lineSpecificWords[lineNumber]);
    }

    // highlight every line which contains a specific word hl:test
    if (words.length > 0 && isCodeblockBg) {
      const substringsArray = words.split(',');
      substringsArray.forEach(substring => {
        lineClass = highlightLine(substring);
      });
    }

    // highlight line by line number imp:1,3-5
    const altHLMatch = altHL.find(hl => hl.lineNumber === lineNumber);
    if (altHLMatch) {
      lineClass = addHighlightClass(altHLMatch.name);
    }

    // highlight specific lines if they contain a word imp:1|test,3-5|test
    const altLineSpecificWord = altLineSpecificWords.find(item => item.lineNumber === lineNumber);
    if (altLineSpecificWord && isCodeblockBg) {
      const { extractedValues } = getValueNameByLineNumber(lineNumber, altLineSpecificWords);
      extractedValues.forEach(({ value, name }) => {
        lineClass = highlightLine(value ?? '', name);
      });
    }
  
    // highlight every line which contains a specific word imp:test
    if (!startLine && !endLine && isCodeblockBg) {
      for (const entry of altWords) {
        const { name, words } = entry;
        if (words.length > 0) {
          lineClass = highlightLine(words, name);
        }
      }
    }
  }

  return lineClass;
}// highlightLinesOrWords

function setClass(line: Line, decorations: Array<Range<Decoration>>, caseInsensitiveLineText: string, word: string, settings: CodeblockCustomizerSettings, lineClass: string, customClass = '') {
  const occurrences = findAllOccurrences(caseInsensitiveLineText, word);

  if (settings.SelectedTheme.settings.codeblock.textHighlight) {
    occurrences.forEach((index, occurrenceIndex) => {
      const classToUse = customClass ? `codeblock-customizer-highlighted-text-${customClass}` : 'codeblock-customizer-highlighted-text';
      decorations.push(Decoration.mark({ class: classToUse }).range(line.from + index, line.from + index + word.length));
    });
    lineClass = ``;
  } else if (occurrences.length > 0) {
    lineClass = customClass ? `codeblock-customizer-line-highlighted-${customClass}` : 'codeblock-customizer-line-highlighted';
  }

  return lineClass;
}// setClass

function checkForLinks(view: EditorView, originalLineText: string, node: SyntaxNodeRef, decorations: Array<Range<Decoration>>, sourcePath: string, plugin: CodeBlockCustomizerPlugin) {
  const cursorPos = view.state.selection.main.head;
  //const regex = /(?:\[\[([^[\]]*)\]\]|\[([^\]]+)\]\(([^)]+)\))(?!\r?\n)/g;
  //const regex = /(?:\[\[([^[\]]*)\]\]|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s]+))/g;
  const regex = /(?:\[\[([^[\]]+?)(?:\|([^\]]+?))?]]|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s]+))/g;
  
  //----------------------------------------------
  // only for comments
  let comment = '';
  if (node.type.name.includes("HyperMD-codeblock-begin") || node.type.name.includes("comment_hmd-codeblock")) {
    comment = view.state.sliceDoc(node.from, node.to);
  }  
  const matches = [...comment.matchAll(regex)];
  //----------------------------------------------
  //const matches = [...originalLineText.matchAll(regex)]; // not only for comments

  for (const match of matches) {
    //if (node.type.name === "HyperMD-codeblock_HyperMD-codeblock-bg" || node.type.name.includes("HyperMD-codeblock-begin")) { // not only for comments
      const fullMatch = match[0];
      const startPosition = match.index !== undefined ? match.index : -1;
      const isCursorInside = (cursorPos >= node.from + startPosition && cursorPos <= node.from + startPosition + fullMatch.length);

      if (match[1] !== undefined && match[1] !== '') { // Double square bracket link: [[link]] or [[Link|DisplayText]]
        handleWikiLink(isCursorInside, node, startPosition, fullMatch, decorations, sourcePath, plugin);
      } else if (match[3] !== undefined && match[3] !== '') { // Square bracket followed by parentheses link: [DisplayText](Link)
        handleMarkdownLink(isCursorInside, node, startPosition, fullMatch, decorations, sourcePath, plugin);
      } else if (match[5] !== undefined && match[5] !== '') { // HTTP or HTTPS URL
        handleHTTPLink(isCursorInside, node, startPosition, fullMatch, decorations, sourcePath, plugin);
      }
    //}
  }
}// checkForLinks

function handleWikiLink(isCursorInside: boolean, node: SyntaxNodeRef, startPosition: number, fullMatch: string, decorations: Array<Range<Decoration>>, sourcePath: string, plugin: CodeBlockCustomizerPlugin) {
  const linkClass = "cm-formatting-link";
  const startClass = `${linkClass} cm-formatting-link-start`;
  const endClass = `${linkClass} cm-formatting-link-end`;
  const startPosSquareBrackets = fullMatch.indexOf("[[");
  const endPosSquareBrackets = fullMatch.lastIndexOf("]]");
  if (!isCursorInside) {
    decorations.push(Decoration.replace({ widget: new createLink(fullMatch, sourcePath, plugin) }).range(node.from + startPosition, node.from + startPosition + fullMatch.length));
  } else {
    decorations.push(Decoration.mark({class: startClass}).range(node.from + startPosition + startPosSquareBrackets, node.from + startPosition + startPosSquareBrackets + 2));
    decorations.push(Decoration.mark({class: endClass}).range(node.from + startPosition + endPosSquareBrackets, node.from + startPosition + endPosSquareBrackets+2));
    if (fullMatch.length > 0)
      decorations.push(Decoration.mark({class:"cm-hmd-internal-link"}).range(node.from + startPosition + startPosSquareBrackets + 2, node.from + startPosition + fullMatch.length - 2));
  }
}// handleWikiLink

function handleMarkdownLink(isCursorInside: boolean, node: SyntaxNodeRef, startPosition: number, fullMatch: string, decorations: Array<Range<Decoration>>, sourcePath: string, plugin: CodeBlockCustomizerPlugin) {
  const linkClass = "cm-formatting-link";
  const startPosSquareBrackets = fullMatch.indexOf("[");
  const endPosSquareBrackets = fullMatch.lastIndexOf("]");
  const startPosParentheses = fullMatch.indexOf("(");
  const endPosParentheses = fullMatch.lastIndexOf(")");

  if (!isCursorInside) {
    decorations.push(Decoration.replace({ widget: new createLink(fullMatch, sourcePath, plugin) }).range(node.from + startPosition, node.from + startPosition + fullMatch.length));
  } else {
    decorations.push(Decoration.mark({class: `cm-formatting ${linkClass} cm-link`}).range(node.from + startPosition + startPosSquareBrackets, node.from + startPosition + startPosSquareBrackets + 1));
    decorations.push(Decoration.mark({class: `cm-link`}).range(node.from + startPosition + startPosSquareBrackets + 1, node.from + startPosition + endPosSquareBrackets));
    decorations.push(Decoration.mark({class: `cm-formatting ${linkClass} cm-link`}).range(node.from + startPosition + endPosSquareBrackets, node.from + startPosition + endPosSquareBrackets + 1));

    decorations.push(Decoration.mark({class: `cm-formatting ${linkClass}-string cm-string cm-url`}).range(node.from + startPosition + startPosParentheses, node.from + startPosition + startPosParentheses + 1));
    decorations.push(Decoration.mark({class: `cm-string cm-url`}).range(node.from + startPosition + startPosParentheses, node.from + startPosition + endPosParentheses));
    decorations.push(Decoration.mark({class: `cm-formatting ${linkClass}-string cm-string cm-url`}).range(node.from + startPosition + endPosParentheses, node.from + startPosition + endPosParentheses + 1));
  }
}// handleMarkdownLink

function handleHTTPLink(isCursorInside: boolean, node: SyntaxNodeRef, startPosition: number, fullMatch: string, decorations: Array<Range<Decoration>>, sourcePath: string, plugin: CodeBlockCustomizerPlugin) {
  if (isCursorInside) {
    decorations.push(Decoration.replace({ widget: new createLink(fullMatch, sourcePath, plugin) }).range(node.from + startPosition, node.from + startPosition + fullMatch.length));
  } else {
    decorations.push(Decoration.mark({class: `cm-url`}).range(node.from + startPosition, node.from + startPosition + fullMatch.length));
  }
}// handleHTTPLink

class createLink extends WidgetType {

  constructor(private link: string, private sourcePath: string, private plugin: CodeBlockCustomizerPlugin) {
    super();
  }

  eq(other: createLink) {
    return this.link === other.link && this.sourcePath === other.sourcePath && this.plugin === other.plugin;
  }
  
  toDOM(view: EditorView): HTMLElement {
    const span = createSpan({cls: "codeblock-customizer-link"});
    MarkdownRenderer.render(this.plugin.app, this.link, span, this.sourcePath, this.plugin);
    return span;
  }
}// createLink

function processLineText(lineText: string, codeblockId: number, alternateColors: Record<string, string>) {
  let lineNumber = 0;
  let isSpecificNumber = false;
  let showNumbers = "";
  let HL: number[] = [];
  let altHL: { name: string, lineNumber: number }[] = [];
  let lineSpecificWords: Record<number, string> = {};
  let altLineSpecificWords: { name: string; lineNumber: number }[] = [];
  let words = "";
  const altWords: { name: string, words: string }[] = [];

  if (lineText) {
    lineNumber = 0;
    isSpecificNumber = false;
    codeblockId++;
    const specificLN = extractParameter(lineText, "ln") || "";
    if (specificLN.toLowerCase() === "true") {
      showNumbers = "specific";
    } else if (specificLN.toLowerCase() === "false") {
      showNumbers = "hide";
    } else {
      const lineNumberOffset = parseInt(specificLN);
      if (!isNaN(lineNumberOffset) && lineNumberOffset >= 0) {
        lineNumber += lineNumberOffset - 1;
        showNumbers = "specific";
        isSpecificNumber = true;
      }
      else {
        showNumbers = "";
      }
    }

    const params = extractParameter(lineText, "HL");
    const linesToHighlight = getHighlightedLines(params);
    HL = linesToHighlight.lines;
    lineSpecificWords = linesToHighlight.lineSpecificWords;
    words = linesToHighlight.words;

    for (const [name, hexValue] of Object.entries(alternateColors)) {
      const altParams = extractParameter(lineText, `${name}`);
      const altlinesToHighlight = getHighlightedLines(altParams);
      altHL = altHL.concat(altlinesToHighlight.lines.map((lineNumber) => ({ name, lineNumber })));
      altLineSpecificWords = altLineSpecificWords.concat(
        //altHL,
        Object.entries(altlinesToHighlight.lineSpecificWords).map(([lineNumber, value]: [string, string]) => ({ name, lineNumber: parseInt(lineNumber), value }))
      );
      altWords.push({ name, words: altlinesToHighlight.words });
    }
  }

  return { lineNumber, isSpecificNumber, codeblockId, showNumbers, HL, lineSpecificWords, words, altHL, altLineSpecificWords, altWords };
}// processLineText

function getMaxWidth (view: EditorView, codeblockId: number) {
  let maxWidth = 0;
  const codeBlockElements = view.contentDOM.querySelectorAll(`[codeblockid="${codeblockId}"]`);
  const specificNumberElements = Array.from(codeBlockElements).map(lineElement => lineElement.querySelector(".codeblock-customizer-line-number-specific") as HTMLElement);
  const nonEmptySpecificNumberElements = specificNumberElements.filter(element => element?.textContent?.trim() !== "");
  const widths = nonEmptySpecificNumberElements.map(element => element?.offsetWidth || 0);
  maxWidth = Math.max(...widths);
  
  return maxWidth;
}// getMaxWidth

class LineNumberWidget extends WidgetType {
  private width: number;

  constructor(private lineNumber: string, private showNumbers: string, private isSpecificNumber: boolean, private spanClass: string, private codeblockId: number) {
    super();
    this.width = 0;
  }

  eq(other: LineNumberWidget) {
    return this.lineNumber === other.lineNumber && this.showNumbers === other.showNumbers && 
           this.isSpecificNumber === other.isSpecificNumber && this.spanClass === other.spanClass && 
           this.width === other.width && this.codeblockId === other.codeblockId;
  }

  private updateWidth(view: EditorView) {
    if (this.isSpecificNumber) {
      const maxWidth = getMaxWidth(view, this.codeblockId);
      
      if (maxWidth > 0)
        this.width = maxWidth;

      const firstLineSpan = view.contentDOM.querySelector(`[codeblockid="${this.codeblockId}"] .codeblock-customizer-line-number-first.codeblock-customizer-line-number-specific`);
      firstLineSpan?.setAttribute("style", "--gutter-width: " + this.width.toString() + "px");
      const lastLineSpan = view.contentDOM.querySelector(`[codeblockid="${this.codeblockId}"] .codeblock-customizer-line-number-last.codeblock-customizer-line-number-specific`);
      lastLineSpan?.setAttribute("style", "--gutter-width: " + this.width.toString() + "px");

      /*const elements = document.querySelectorAll(`[codeblockid="${this.codeblockId}"] .codeblock-customizer-line-number-specific-number`);

      if (elements.length > 0) {
        elements.forEach(element => {
          element.setAttribute("style", "--gutter-width: " + maxWidth.toString() + "px");
        });
      }*/
    }
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("span");    
    if (this.spanClass !== "")
        container.classList.add(this.spanClass);

    if (this.showNumbers === "specific") {
      container.classList.add("codeblock-customizer-line-number-specific");
      if (this.isSpecificNumber) 
        container.classList.add("codeblock-customizer-line-number-specific-number");
    } else if (this.showNumbers === "hide") {
      container.classList.add("codeblock-customizer-line-number-hide");
    } else {
      container.classList.add("codeblock-customizer-line-number");
    }

    //container.innerText = `${this.lineNumber}`;
    const lineNumber = document.createElement("span");
    lineNumber.classList.add("codeblock-customizer-line-number-element");
    lineNumber.innerText = `${this.lineNumber}`;
    container.appendChild(lineNumber);

    requestAnimationFrame(() => {
      this.updateWidth(view);
    });

    return container;
  }
  
  updateDOM(dom: HTMLElement, view: EditorView) {
    view.requestMeasure();
    return false;
  }
  
}// LineNumberWidget

class deleteCodeWidget extends WidgetType {
  constructor(private codeblockId: number) {
    super();
  }

  eq(other: deleteCodeWidget) {
    return this.codeblockId === other.codeblockId;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("span");
    container.classList.add("codeblock-customizer-delete-code");
    container.setAttribute("aria-label", "Delete code block content");
    setIcon(container, "trash-2");
    
    container.addEventListener("mousedown", event => {
      const targetElement: HTMLElement | null = view.contentDOM.querySelector(`[codeblockid="${this.codeblockId}"]`);
      const { CollapseStart, CollapseEnd  } = getCodeblockByHTMLTarget(view, targetElement, false);

      if (CollapseStart !== null && CollapseEnd !== null) {
        const tr = view.state.update({ changes: { from: CollapseStart, to: CollapseEnd, insert: "" } });
        view.dispatch(tr);

        const firstLine = view.contentDOM.querySelector(`.codeblock-customizer-line-first`);
        const lastLine = view.contentDOM.querySelector(`.codeblock-customizer-line-last`);
                
        if (firstLine)
          firstLine.removeAttribute("style");

        if (lastLine)
          lastLine.removeAttribute("style");
      }
    });
    return container;
  }
}// deleteCodeWidget

class copyCodeWidget extends WidgetType {
  constructor(private codeblockLanguage: string | null, private codeblockId: number) {
    super();
  }

  eq(other: copyCodeWidget) {
    return this.codeblockId === other.codeblockId && this.codeblockLanguage === other.codeblockLanguage;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("span");
    container.classList.add("codeblock-customizer-copy-code");
    container.setAttribute("aria-label", "Copy code");
    if (this.codeblockLanguage) {
      const displayLangText = getDisplayLanguageName(this.codeblockLanguage);
      if (displayLangText)
        container.setText(displayLangText);
      else
        setIcon(container, "copy");
    } else
      setIcon(container, "copy");
    
    container.addEventListener("mousedown", async (event) => {
      const target: HTMLElement | null = view.contentDOM.querySelector(`[codeblockid="${this.codeblockId}"]`);
      const { CollapseStart, CollapseEnd } = getCodeblockByHTMLTarget(view, target, false);

      if (CollapseStart && CollapseEnd) {
        const lines = view.state.sliceDoc(CollapseStart, CollapseEnd).toString();
        addTextToClipboard(removeFirstLine(lines));
      }
    });

    return container;
  }
}// copyCodeWidget

function removeFirstLine(inputString: string): string {
  const lines = inputString.split('\n');
  
  if (lines.length > 1) {
    const modifiedLines = lines.slice(1);
    const resultString = modifiedLines.join('\n');
    
    return resultString;
  } else {
    // If there's only one line or the input is empty, return an empty string
    return '';
  }
}// removeFirstLine

function findCodeblocks(state: EditorState): SyntaxNodeRef[] {
  const tree = syntaxTree(state);
  const codeblocks: SyntaxNodeRef[] = [];

  tree.iterate({
    enter: (node) => {
      if (
        node.type.name.includes("HyperMD-codeblock-begin") ||
        node.type.name === "HyperMD-codeblock_HyperMD-codeblock-bg" ||
        node.type.name.includes("HyperMD-codeblock-end")
      ) {
        codeblocks.push(node);
      }
    },
  });

  return codeblocks;
}// findCodeblocks

function setupMutationObserver(editorView: EditorView, pluginInstance: any) {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.type === "attributes" &&
        mutation.attributeName === "class" &&
        ((mutation.target as HTMLElement).classList.contains("HyperMD-codeblock-begin") ||
          (mutation.target as HTMLElement).classList.contains("HyperMD-codeblock_HyperMD-codeblock-bg") ||
          (mutation.target as HTMLElement).classList.contains("HyperMD-codeblock-end"))
      ) {
        pluginInstance.forceUpdate(editorView);
      }
    }
  });

  observer.observe(editorView.dom, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ['class'], // Only observe changes to the 'class' attribute
  });

  return observer;
} // setupMutationObserver

function areObjectsEqual(obj1: Record<string, string>, obj2: Record<string, string>): boolean {
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (const key of keys1) {
    if (obj1[key] !== obj2[key]) {
      return false;
    }
  }

  return true;
}// areObjectsEqual