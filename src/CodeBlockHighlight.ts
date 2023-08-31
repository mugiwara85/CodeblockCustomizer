import { EditorView, ViewUpdate, ViewPlugin, Decoration, WidgetType, DecorationSet } from "@codemirror/view";
import { RangeSet, EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { SyntaxNodeRef } from "@lezer/common";

import { getHighlightedLines, isExcluded, getBorderColorByLanguage, getCurrentMode, getCodeBlockLanguage, extractParameter, isSourceMode } from "./Utils";
import { CodeblockCustomizerSettings } from "./Settings";
import { setIcon } from "obsidian";
import { getCodeblockByHTMLTarget } from "./Header";

interface Codeblock {
  from: number;
  to: number;
}

export function codeblockHighlight(settings: CodeblockCustomizerSettings) {
  const viewPlugin = ViewPlugin.fromClass(
    class CodeblockHighlightPlugin {
      mutationObserver: MutationObserver;
      view: EditorView;
      decorations: DecorationSet;
      settings: CodeblockCustomizerSettings;
      prevAlternateColors: Record<string, string>;
      prevBorderColors: Record<string, string>;
      prevExcludeLangs: string;

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
      }// initialize

      forceUpdate(editorView: EditorView) {
        this.view = editorView;
        this.decorations = this.buildDecorations(this.view);
        this.view.requestMeasure();
      }// forceUpdate

      shouldUpdate(update: ViewUpdate) {
        return (update.docChanged || update.viewportChanged || !areObjectsEqual(this.settings.SelectedTheme.colors[getCurrentMode()].codeblock.alternateHighlightColors, this.prevAlternateColors)
        || !areObjectsEqual(this.settings.SelectedTheme.colors[getCurrentMode()].codeblock.languageBorderColors, this.prevBorderColors) || this.settings.ExcludeLangs !== this.prevExcludeLangs);
      }// shouldUpdate
      
      update(update: ViewUpdate) {
        if (this.shouldUpdate(update)) {
          for (const [name, color] of Object.entries(this.settings.SelectedTheme.colors[getCurrentMode()].codeblock.alternateHighlightColors)) {
            this.prevAlternateColors[name] = color;
          }
          for (const [name, color] of Object.entries(this.settings.SelectedTheme.colors[getCurrentMode()].codeblock.languageBorderColors)) {
            this.prevBorderColors[name] = color;
          }
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
        let showNumbers = "";
        let isSpecificNumber = false;
        const currentMode = getCurrentMode();
        let bExclude = false;
        let borderColor = "";
        let codeblockLanguageClass = "";
        const alternateColors = settings.SelectedTheme.colors[currentMode].codeblock.alternateHighlightColors || {};
        const languageBorderColors = settings.SelectedTheme.colors[currentMode].codeblock.languageBorderColors || {};
        const decorations: Array<Range<Decoration>> = [];

        if (!view.visibleRanges || view.visibleRanges.length === 0 || isSourceMode(view.state)) {
          return RangeSet.empty;
        }

        // Find all code blocks in the document
        const codeblocks = findCodeblocks(view.state);
        // Find code blocks that intersect with the visible range
        const visibleCodeblocks = this.filterVisibleCodeblocks(view, codeblocks);
        // remove duplicates
        const deduplicatedCodeblocks = this.deduplicateCodeblocks(visibleCodeblocks);
        let codeblockId = 0;
        for (const codeblock of deduplicatedCodeblocks) {
          syntaxTree(view.state).iterate({ from: codeblock.from, to: codeblock.to,
            enter(node) {
              const line = view.state.doc.lineAt(node.from);
              const lineText = view.state.sliceDoc(line.from, line.to).toString().trim();
              //const lang = getCodeBlockLanguage(lineText);
              let lang = null;
              const startLine = node.type.name.includes("HyperMD-codeblock-begin");
              if (startLine)
                lang = getCodeBlockLanguage(lineText);
              const endLine = node.type.name.includes("HyperMD-codeblock-end");

              if (lang) {
                //console.log(lineText);
                bExclude = isExcluded(lineText, settings.ExcludeLangs);
                codeblockLanguageClass = "codeblock-customizer-language-" + lang.toLowerCase();
                borderColor = getBorderColorByLanguage(lang, languageBorderColors);
              }
              if (bExclude) {
                if (endLine) {
                  bExclude = false;
                }
                return;
              }

              if (startLine) {
                const result = processLineText(lineText, codeblockId, alternateColors);
                lineNumber = result.lineNumber;
                isSpecificNumber = result.isSpecificNumber;
                codeblockId = result.codeblockId;
                showNumbers = result.showNumbers;
                HL = result.HL;
                altHL = result.altHL;
              }

              let lineClass = `codeblock-customizer-line`;
              if (HL.includes(lineNumber) && !startLine && !endLine) {
                lineClass = `codeblock-customizer-line-highlighted`;
              } else {
                const altHLMatch = altHL.filter((hl) => hl.lineNumber === lineNumber);
                if ((altHLMatch.length > 0) && !startLine && !endLine) {
                  lineClass = `codeblock-customizer-line-highlighted-${altHLMatch[0].name.replace(/\s+/g, '-').toLowerCase()}`;
                }
              }
              lineClass = lineClass + " " + codeblockLanguageClass;
              let spanClass = "";
              if (startLine){
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
                borderColor = "";
              }

              if (node.type.name === "HyperMD-codeblock_HyperMD-codeblock-bg" || startLine || endLine) {
                decorations.push(Decoration.line({attributes: {class: lineClass, "codeblockId": codeblockId.toString(), "style": style}}).range(node.from));
                decorations.push(Decoration.widget({ widget: new LineNumberWidget((startLine || endLine) ? " " : lineNumber.toString(), showNumbers, isSpecificNumber, spanClass, codeblockId),}).range(node.from));
                if (startLine)
                  decorations.push(Decoration.widget({ widget: new deleteCodeWidget(codeblockId)}).range(node.from));
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

function processLineText(lineText: string, codeblockId: number, alternateColors: Record<string, string>) {
  let lineNumber = 0;
  let isSpecificNumber = false;
  let showNumbers = "";
  let HL: number[] = [];
  let altHL: { name: string, lineNumber: number }[] = [];

  if (lineText) {
    lineNumber = 0;
    isSpecificNumber = false;
    codeblockId++;
    const specificLN = extractParameter(lineText, "ln:") || "";
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

    const params = extractParameter(lineText, "HL:");
    HL = getHighlightedLines(params);
    
    for (const [name, hexValue] of Object.entries(alternateColors)) {
      const altParams = extractParameter(lineText, `${name}:`);
      altHL = altHL.concat(getHighlightedLines(altParams).map((lineNumber) => ({ name, lineNumber })));
    }
  }

  return { lineNumber, isSpecificNumber, codeblockId, showNumbers, HL, altHL };
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