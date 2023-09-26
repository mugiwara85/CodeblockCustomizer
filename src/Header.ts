import { StateField, StateEffect, RangeSetBuilder, EditorState, Transaction, Extension, Range, RangeSet, Text, Line } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, DecorationSet } from "@codemirror/view";

import { getDisplayLanguageName, getLanguageIcon, isExcluded, createContainer, createCodeblockLang, createCodeblockIcon, createFileName, createCodeblockCollapse, isFoldDefined, getCodeBlockLanguage, extractFileTitle, getBorderColorByLanguage, getCurrentMode, createUncollapseCodeButton, isSourceMode, getIndentationLevel } from "./Utils";
import { CodeblockCustomizerSettings } from "./Settings";
import { setIcon } from "obsidian";
import { fadeOutLineCount } from "./Const";

type Ranges = {
  replaceStart: Line;
  replaceEnd: Line;
  fadeOutStart: Line;
  fadeOutEnd: Line;
};

interface RangeWithDecoration {
  from: number;
  to: number;
  decoration: Decoration;
}

function processCodeBlocks(doc: Text, settings: CodeblockCustomizerSettings, callback: (start: Line, end: Line, lineText: string, fold: boolean) => void) {
  let CollapseStart: Line | null = null;
  let CollapseEnd: Line | null = null;
  let blockFound = false;
  let bExclude = false;
  let isDefaultFold = false;
  let inCodeBlock = false;
  let openingBackticks = 0;
  
  for (let i = 1; i <= doc.lines; i++) {
    const lineText = doc.line(i).text.toString().trim();
    const line = doc.line(i);
    bExclude = isExcluded(lineText, settings.ExcludeLangs);
    const backtickMatch = lineText.match(/^`+(?!.*`)/);
    if (backtickMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        openingBackticks = backtickMatch[0].length;
        if (bExclude)
          continue;
        if (CollapseStart === null) {
          isDefaultFold = isFoldDefined(lineText);
          CollapseStart = line;
        }
      } else {
        if (backtickMatch[0].length === openingBackticks) {
          inCodeBlock = false;
          openingBackticks = 0; // Reset the opening backticks count
          blockFound = true;
          CollapseEnd = line;
        } else {
          // Nested code block with different number of backticks
        }
      }
    } else if (inCodeBlock) {
      // Lines inside the code block
    } else {
      // Lines outside the code block
    }

    if (blockFound) {
      if (CollapseStart != null && CollapseEnd != null) {
        callback(CollapseStart, CollapseEnd, lineText, isDefaultFold);
        CollapseStart = null;
        CollapseEnd = null;
        isDefaultFold = false;
      }
      blockFound = false;
    }
  }
}// processCodeBlocks

export function defaultFold(state: EditorState, settings: CodeblockCustomizerSettings) {
  const builder = new RangeSetBuilder<Decoration>();
  processCodeBlocks(state.doc, settings, (start, end, lineText, fold) => {
    if (fold) {
      if (settings.SelectedTheme.settings.semiFold.enableSemiFold) {
        const lineCount = state.doc.lineAt(end.to).number - state.doc.lineAt(start.from).number + 1;
        if (lineCount > settings.SelectedTheme.settings.semiFold.visibleLines + fadeOutLineCount) {
          const ranges = getRanges(state, start.from, end.to, settings.SelectedTheme.settings.semiFold.visibleLines);
          const decorations = addFadeOutEffect(null, state, ranges, settings.SelectedTheme.settings.semiFold.visibleLines, null);
          for (const { from, to, decoration } of decorations || []) {
            builder.add(from, to, decoration);
          }
        } else {
          const decoration = Decoration.replace({ effect: Collapse.of(Decoration.replace({block: true}).range(start.from, end.to)), block: true, side: -1 });
          builder.add(start.from, end.to, decoration);
        }
      } else {
        const decoration = Decoration.replace({ effect: Collapse.of(Decoration.replace({block: true}).range(start.from, end.to)), block: true, side: -1 });
        builder.add(start.from, end.to, decoration);
      }
    }
  });

  return builder.finish();
}// defaultFold

export function foldAll(view: EditorView, settings: CodeblockCustomizerSettings, fold: boolean, defaultState: boolean) {
  processCodeBlocks(view.state.doc, settings, (start, end, lineText, isDefaultFold) => {
    if (fold) {
      if (settings.SelectedTheme.settings.semiFold.enableSemiFold) {
        const lineCount = end.number - start.number + 1;
        if (lineCount > settings.SelectedTheme.settings.semiFold.visibleLines + fadeOutLineCount) {
          const ranges = getRanges(view.state, start.from, end.to, settings.SelectedTheme.settings.semiFold.visibleLines);
          const Pos = view.domAtPos(start.from);
          let headerElement = null;
          if (Pos) {
            headerElement = (Pos.node as HTMLElement).previousElementSibling;
          }

          addFadeOutEffect(headerElement as HTMLElement, view.state, ranges, settings.SelectedTheme.settings.semiFold.visibleLines, view);
        } else {
          view.dispatch({ effects: Collapse.of(Decoration.replace({block: true}).range(start.from, end.to)) });
          view.requestMeasure();
        }
      } else {
        view.dispatch({ effects: Collapse.of(Decoration.replace({block: true}).range(start.from, end.to)) });
        view.requestMeasure();
      }
    }
    else {
      if (!isDefaultFold || !defaultState) {
        if (settings.SelectedTheme.settings.semiFold.enableSemiFold)
          clearFadeEffect(view, start.from, end.to);

        // @ts-ignore
        view.dispatch({ effects: UnCollapse.of((from: number, to: number) => to <= start.from || from >= end.to) });
        view.requestMeasure();
      }
    }
  });
}// foldAll

let settings: CodeblockCustomizerSettings;
export const codeblockHeader = StateField.define<DecorationSet>({
  create(state): DecorationSet {
    document.body.classList.remove('codeblock-customizer-header-collapse-command');
    // @ts-ignore
    codeblockHeader.settings.foldAllCommand = false;
    return Decoration.none;    
  },
  update(oldState: DecorationSet, transaction: Transaction): DecorationSet {
    // @ts-ignore
    if (!codeblockHeader.settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(transaction.state))
      return Decoration.none;

    const builder = new RangeSetBuilder<Decoration>();
    let WidgetStart = null;
    let Fold = false;
    let fileName = null;
    let specificHeader = true;
    let numBackticks = 0;
    let inCodeBlock = false;
    let bExclude = false;
    
    for (let i = 1; i < transaction.state.doc.lines; i++) {
      const originalLineText = transaction.state.doc.line(i).text.toString();
      const lineText = originalLineText.trim();
      const line = transaction.state.doc.line(i);
      const lang = getCodeBlockLanguage(lineText);
      bExclude = isExcluded(lineText, this.settings.ExcludeLangs);
      specificHeader = true;

      const backtickMatch = lineText.match(/^`+(?!.*`)/);
      if (backtickMatch) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          numBackticks = backtickMatch[0].length;
          WidgetStart = line;
          fileName = extractFileTitle(lineText);
          Fold = isFoldDefined(lineText);
          const { level, characters, margin } = getIndentationLevel(originalLineText);
          if (!bExclude) {
            if (fileName === null || fileName === "") {
              if (Fold) {
                fileName = this.settings.SelectedTheme.settings.header.collapsedCodeText || 'Collapsed Code';
              } else {
                if (this.settings.foldAllCommand)
                  fileName = this.settings.SelectedTheme.settings.header.collapsedCodeText || 'Collapsed Code';
                else
                  fileName = '';
                specificHeader = false;
              }
            }
            const hasLangBorderColor = getBorderColorByLanguage(lang || "", this.settings.SelectedTheme.colors[getCurrentMode()].codeblock.languageBorderColors).length > 0 ? true : false;
            // @ts-ignore
            builder.add(WidgetStart.from, WidgetStart.from, createDecorationWidget(fileName, getDisplayLanguageName(lang), lang, specificHeader, Fold, hasLangBorderColor, codeblockHeader.settings, margin));
            //EditorView.requestMeasure;
          }
        } else {
          if (backtickMatch[0].length === numBackticks) {
            inCodeBlock = false;
            numBackticks = 0;
            WidgetStart = null;
            Fold = false;
            fileName = null;
          } else {
            // Nested code block with different number of backticks
          }
        }
      } else if (inCodeBlock) {
        // Lines inside the code block
      } else {
        // Lines outside the code block
      }
    }
  
    return builder.finish();
  },
  provide(field: StateField<DecorationSet>): Extension {
    return EditorView.decorations.from(field);
  },
});// codeblockHeader

function createDecorationWidget(textToDisplay: string, displayLanguageName: string, languageName: string | null, specificHeader: boolean, defaultFold: boolean, hasLangBorderColor: boolean, settings: CodeblockCustomizerSettings, marginLeft: number) {
  return Decoration.widget({ widget: new TextAboveCodeblockWidget(textToDisplay, displayLanguageName, languageName, specificHeader, defaultFold, hasLangBorderColor, settings, marginLeft), block: true });
}// createDecorationWidget

const Collapse = StateEffect.define<Range<Decoration>>();
const UnCollapse = StateEffect.define<{ filter: number; filterFrom: number; filterTo: number }>();
const semiCollapse = StateEffect.define<Range<Decoration>>();
const semiUnCollapse = StateEffect.define<{ filter: number; filterFrom: number; filterTo: number }>();
const semiFade = StateEffect.define<Range<Decoration>>();
const semiUnFade = StateEffect.define<{ filter: number; filterFrom: number; filterTo: number }>();

let pluginSettings: CodeblockCustomizerSettings;
export const collapseField = StateField.define<RangeSet<Decoration>>({  
  create(state): RangeSet<Decoration> {
    // @ts-ignore
    if (!collapseField.pluginSettings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(state))
      return Decoration.none;
    // @ts-ignore
    return defaultFold(state, collapseField.pluginSettings);
    //return Decoration.none;
  },
  update(value, tr) {
    // @ts-ignore
    if (!collapseField.pluginSettings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(tr.state))
      return Decoration.none;

    value = value.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(Collapse) || effect.is(semiCollapse) || effect.is(semiFade))
        value = value.update({add: [effect.value], sort: true});
      else if (effect.is(UnCollapse) || effect.is(semiUnCollapse) || effect.is(semiUnFade)) {
        // @ts-ignore
        value = value.update({filter: effect.value});
      }
    }
    return value;
  },
  provide: f => EditorView.decorations.from(f)
})// collapseField

class TextAboveCodeblockWidget extends WidgetType {
  text: string;
  observer: MutationObserver;
  view: EditorView;
  defaultFold: boolean;
  displayLanguageName: string;
  specificHeader: boolean;
  languageName: string;
  hasLangBorderColor: boolean;
  settings: CodeblockCustomizerSettings;
  enableLinks: boolean;
  marginLeft: number;

  constructor(text: string, displayLanguageName: string, languageName: string | null, specificHeader: boolean, defaultFold: boolean, hasLangBorderColor: boolean, settings: CodeblockCustomizerSettings, marginLeft: number) {
    super();
    this.text = text;    
    this.displayLanguageName = displayLanguageName;
    this.specificHeader = specificHeader;
    this.languageName = languageName || "";
    this.defaultFold = defaultFold;
    this.hasLangBorderColor = hasLangBorderColor;
    this.settings = settings;
    this.enableLinks = settings.SelectedTheme.settings.codeblock.enableLinks;
    this.marginLeft = marginLeft;
    this.observer = new MutationObserver(this.handleMutation);    
  }
  
  handleMutation = (mutations: MutationRecord[]) => {
    mutations.forEach(mutation => {
      if ((mutation.target as HTMLElement).hasAttribute("data-clicked")){
        handleClick(this.view, mutation.target as HTMLElement, this.settings);        
        //this.view.update([]);
        //this.view.state.update();
        //EditorView.requestMeasure;
      }
    });
    //this.view.update([]);
    //this.view.state.update();
    //this.view.requestMeasure();
  }

  eq(other: TextAboveCodeblockWidget) {
    return other.text === this.text && 
    other.displayLanguageName === this.displayLanguageName && 
    other.languageName === this.languageName && 
    other.specificHeader === this.specificHeader && 
    other.defaultFold === this.defaultFold && 
    other.hasLangBorderColor === this.hasLangBorderColor &&
    other.enableLinks === this.enableLinks &&
    other.marginLeft === this.marginLeft;
  }

  mousedownEventHandler = (event: MouseEvent) => {
    const container = event.currentTarget as HTMLElement;
    container.setAttribute("data-clicked", "true");
  };

  toDOM(view: EditorView): HTMLElement {
    this.view = view;
    const container = createContainer(this.specificHeader, this.languageName, this.hasLangBorderColor);
    if (this.displayLanguageName){
      const Icon = getLanguageIcon(this.displayLanguageName)
      if (Icon) {
        container.appendChild(createCodeblockIcon(this.displayLanguageName));
      }
      container.appendChild(createCodeblockLang(this.languageName));
    }

    container.appendChild(createFileName(this.text, this.enableLinks));
    const collapse = createCodeblockCollapse(this.defaultFold);
    container.appendChild(collapse);
    if (this.marginLeft > 0) {
      container.setAttribute("style", `margin-left:${this.marginLeft}px !important`);
    }
    
    container.addEventListener("mousedown", this.mousedownEventHandler);
    this.observer.observe(container, { attributes: true });   
    
    //EditorView.requestMeasure;

    return container;
  }
  
  updateDOM(dom: HTMLElement, view: EditorView) {
    view.requestMeasure();
    return false;
  }

  destroy(dom: HTMLElement) {
    dom.removeAttribute("data-clicked");
    dom.removeEventListener("mousedown", this.mousedownEventHandler);
    this.observer.disconnect();
  }
  
}// TextAboveCodeblockWidget

export function getCodeblockByHTMLTarget(view: EditorView, target: HTMLElement | null, includeBackTicks: boolean) {
  //view.state.update();
  //view.update([]);
  //view.requestMeasure({});  
  if (!target)
    return { CollapseStart : null, CollapseEnd : null };

  const Pos = view.posAtDOM(target);
  let CollapseStart: number | null = null;
  let CollapseEnd: number | null = null;
  // NOTE: Can't use for loop over view.visibleRanges, because that way the closing backticks wouldn't be found and collapse would not be possible
  let blockFound = false;
  let inCodeBlock = false;
  let openingBackticks = 0;
  for (let i = 1; i <= view.state.doc.lines; i++) {
    const lineText = view.state.doc.line(i).text.toString().trim();
    const line = view.state.doc.line(i);

    const backtickMatch = lineText.match(/^`+(?!.*`)/);
    if (backtickMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        openingBackticks = backtickMatch[0].length;
        if (Pos === line.from) {
          if (includeBackTicks)
            CollapseStart = line.from;
          else
            CollapseStart = line.from + line.length;
        }
      } else {
        if (backtickMatch[0].length === openingBackticks) {
          inCodeBlock = false;
          openingBackticks = 0;
          blockFound = true;
          if (includeBackTicks)
            CollapseEnd = line.to;
          else 
            CollapseEnd = line.from - 1;
        } else {
          // Nested code block with different number of backticks
        }
      }
    } else if (inCodeBlock) {
      // Lines inside the code block
    } else {
      // Lines outside the code block
    }

    if (blockFound) {
      if (CollapseStart != null && CollapseEnd != null ){
          return { CollapseStart, CollapseEnd };
      }
      blockFound = false;
    }
  }

  return { CollapseStart, CollapseEnd };
}// getCodeblockByHTMLTarget

export function handleClick(view: EditorView, target: HTMLElement, settings: CodeblockCustomizerSettings) {
  const { CollapseStart, CollapseEnd } = getCodeblockByHTMLTarget(view, target, true);
  
  if (CollapseStart === null || CollapseEnd === null)
    return;

  if (settings.SelectedTheme.settings.semiFold.enableSemiFold) {
    const lineCount = view.state.doc.lineAt(CollapseEnd).number - view.state.doc.lineAt(CollapseStart).number + 1;
    if (lineCount > settings.SelectedTheme.settings.semiFold.visibleLines + fadeOutLineCount) {
      const ranges = getRanges(view.state, CollapseStart, CollapseEnd, settings.SelectedTheme.settings.semiFold.visibleLines);
      const isFolded = isHeaderFolded(target, view, settings.SelectedTheme.settings.semiFold.visibleLines);
      if (isFolded) {
        removeFadeOutEffect(target, view, ranges, CollapseStart, CollapseEnd);
      } else {
        addFadeOutEffect(target, view.state, ranges, settings.SelectedTheme.settings.semiFold.visibleLines, view);
      }
    } else {
      toggleCollapseCodeBlock(target, view, CollapseStart, CollapseEnd);
    }
  } else {
    toggleCollapseCodeBlock(target, view, CollapseStart, CollapseEnd);
  }
    
}// handleClick

function getRanges(state: EditorState, CollapseStart: number, CollapseEnd: number, visibleLines: number) {
  const replaceStart = state.doc.line(state.doc.lineAt(CollapseStart).number + visibleLines + fadeOutLineCount);
  const replaceEnd = state.doc.line(state.doc.lineAt(CollapseEnd).number);

  const fadeOutStart = state.doc.line(state.doc.lineAt(CollapseStart).number + visibleLines);
  const fadeOutEnd = state.doc.line(state.doc.lineAt(fadeOutStart.from).number + fadeOutLineCount - 1);
    
  return { replaceStart, replaceEnd, fadeOutStart, fadeOutEnd, };
}// getRanges

function isHeaderFolded(element: HTMLElement, view: EditorView, visibleLines = -1) {
  const Pos = view.posAtDOM(element);
  let domPos = Pos;

  if (visibleLines !== -1) {
    const lineNumber = view.state.doc.lineAt(Pos).number;
    const targetLine = lineNumber + visibleLines + fadeOutLineCount;
    if ( view.state.doc.lines >= targetLine)
      domPos = view.state.doc.line(targetLine).from;
  }

  return hasHeaderEffect(view, domPos, domPos);
}// isHeaderFolded

function toggleCollapseCodeBlock(target: HTMLElement, view: EditorView, CollapseStart: number, CollapseEnd: number) {
  //clearFadeEffect(view, collapseField, CollapseStart, CollapseEnd);
  const collapseIcon = target.querySelector('.codeblock-customizer-header-collapse');
  const isFolded = isHeaderFolded(target, view);
  if (isFolded) {
    // @ts-ignore
    view.dispatch({ effects: UnCollapse.of((from, to) => to <= CollapseStart || from >= CollapseEnd) });
    if (collapseIcon)
      setIcon(collapseIcon as HTMLElement, "chevrons-up-down");
  }
  else {
    view.dispatch({ effects: Collapse.of(Decoration.replace({block: true}).range(CollapseStart, CollapseEnd)) });
    if (collapseIcon)
      setIcon(collapseIcon as HTMLElement, "chevrons-down-up");
  }
  view.requestMeasure();
}// collapseCodeBlock

function clearFadeEffect(view: EditorView, CollapseStart: number, CollapseEnd: number) {
	const hasFadeEffect = hasHeaderEffect(view, CollapseStart, CollapseEnd);
  if (hasFadeEffect) {
    // @ts-ignore
    view.dispatch({ effects: semiUnFade.of((from, to) => to <= CollapseStart || from >= CollapseEnd )});
    view.requestMeasure();
  }
}// clearFadeEffect

function hasHeaderEffect(view: EditorView, startPos: number, endPos: number ) {
  const effect = view.state.field(collapseField, false);
  let hasEffect = false;
  effect?.between(startPos, endPos, () => {hasEffect = true});

  return hasEffect;
}// hasHeaderEffect

class uncollapseCodeWidget extends WidgetType {
  view: EditorView;

  constructor(private visibleLines: number) {
    super();
  }

  eq(other: uncollapseCodeWidget) {
    return this.visibleLines === other.visibleLines;
  }

  mousedownEventHandler = (event: MouseEvent) => {
    event.preventDefault();
    const buttonElement = (event.currentTarget as HTMLElement)?.parentElement;
    const codeblockId = buttonElement?.getAttribute("codeblockid") || null;
    if (!codeblockId)
      return;

    const targetElement: HTMLElement | null = this.view.contentDOM.querySelector(`[codeblockid="${codeblockId}"]`);
    const { CollapseStart, CollapseEnd  } = getCodeblockByHTMLTarget(this.view, targetElement, true);
    if (CollapseStart !== null && CollapseEnd !== null) {
      const ranges = getRanges(this.view.state, CollapseStart, CollapseEnd, this.visibleLines);
      const headerElement = targetElement?.previousElementSibling || null;
      removeFadeOutEffect(headerElement as HTMLElement, this.view, ranges, CollapseStart, CollapseEnd);
      this.view.requestMeasure();
    }
  };

  toDOM(view: EditorView): HTMLElement {
    this.view = view;
    const container = createUncollapseCodeButton();
    
    container.addEventListener("mousedown", this.mousedownEventHandler);

    return container;
  }

  destroy(dom: HTMLElement) {
    dom.removeEventListener("mousedown", this.mousedownEventHandler);
  }
}// uncollapseCodeWidget

function removeFadeOutEffect(headerElement: HTMLElement, view: EditorView, ranges: Ranges, CollapseStart: number, CollapseEnd: number) {
  // @ts-ignore
  view.dispatch({ effects: semiUnCollapse.of((from, to) => to <= ranges.replaceStart.from || from >= ranges.replaceEnd.to )});
  // @ts-ignore
  view.dispatch({ effects: semiUnFade.of((from, to) => to <= ranges.fadeOutStart.from - 1 || from >= ranges.replaceEnd.to )}); // BUG ???
  //view.dispatch({ effects: semiUnFade.of((from, to) => to <= CollapseStart.from - 1 || from >= CollapseEnd.to )});
  view.requestMeasure();
  const collapseIcon = headerElement.querySelector('.codeblock-customizer-header-collapse');
  if (collapseIcon)
    setIcon(collapseIcon as HTMLElement, "chevrons-up-down");
}// removeFadeOutEffect

function addFadeOutEffect(element: HTMLElement | null, state: EditorState, ranges: Ranges, visibleLines: number, view: EditorView | null = null): void | RangeWithDecoration[] {
  const decorations: RangeWithDecoration[] = [];
  const fadeOutLines: Line[] = [];
  for (let i = 0; i < fadeOutLineCount; i++) {
    fadeOutLines.push(state.doc.line(state.doc.lineAt(ranges.fadeOutStart.from).number + i));
  }
  
  fadeOutLines.forEach((line, i) => {
    const fadeOutDecoration = Decoration.line({ attributes: { class: `codeblock-customizer-fade-out-line${i}` } });
    if (view === null) {
      decorations.push({ from: line.from, to: line.from, decoration: fadeOutDecoration });
    } else {
      view?.dispatch({ effects: semiFade.of(fadeOutDecoration.range(line.from, line.from)) });
      view?.requestMeasure();
    }

    if (i === fadeOutLineCount - 1) {
      const uncollapseWidget = Decoration.widget({ widget: new uncollapseCodeWidget(visibleLines) });
      if (view === null) {
        decorations.push({ from: line.from, to: line.from, decoration: uncollapseWidget });
      } else {
        view?.dispatch({ effects: semiFade.of(uncollapseWidget.range(line.from, line.from)) });
        view?.requestMeasure();
      }
    }
  });

  const collapseIcon = element?.querySelector('.codeblock-customizer-header-collapse');
  if (collapseIcon)
    setIcon(collapseIcon as HTMLElement, "chevrons-down-up");

  const collapseDecoration = Decoration.replace({ block: true });
  if (view === null) {    
    decorations.push({ from: ranges.replaceStart.from, to: ranges.replaceEnd.to, decoration: collapseDecoration });
    return decorations;
  } else {
    view?.dispatch({ effects: semiCollapse.of(collapseDecoration.range(ranges.replaceStart.from, ranges.replaceEnd.to)) });
    view?.requestMeasure();
  }
}// addFadeOutEffect