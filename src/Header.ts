import { StateField, StateEffect, RangeSetBuilder, EditorState, Transaction, Extension, Range, Text } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, DecorationSet } from "@codemirror/view";

import { getDisplayLanguageName, getLanguageIcon, isExcluded, createContainer, createCodeblockLang, createCodeblockIcon, createFileName, createCodeblockCollapse, isFolded, getCodeBlockLanguage, extractFileTitle, getBorderColorByLanguage, getCurrentMode } from "./Utils";
import { CodeblockCustomizerSettings } from "./Settings";
import { setIcon } from "obsidian";

function processCodeBlocks(doc: Text, settings: CodeblockCustomizerSettings, callback: (start: number, end: number, lineText: string, fold: boolean) => void) {
  let CollapseStart: number | null = null;
  let CollapseEnd: number | null = null;
  let blockFound = false;
  let bExclude = false;
  let isDefaultFold = false;

  for (let i = 1; i < doc.lines; i++) {
    const lineText = doc.line(i).text.toString().trim();
    const line = doc.line(i);
    bExclude = isExcluded(lineText, settings.ExcludeLangs);
    if (lineText.startsWith('```') && lineText.indexOf('```', 3) === -1) {
      if (bExclude)
        continue;
      if (CollapseStart === null) {
        isDefaultFold = isFolded(lineText);
        CollapseStart = line.from;
      } else {
        blockFound = true;
        CollapseEnd = line.to;
      }
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
      const decoration = Decoration.replace({ effect: Collapse.of(Decoration.replace({block: true}).range(start, end)), block: true, side: -1 });
      builder.add(start, end, decoration);
    }
  });

  return builder.finish();
}// defaultFold

export function foldAll(view: EditorView, settings: CodeblockCustomizerSettings, fold: boolean, defaultState: boolean) {
  processCodeBlocks(view.state.doc, settings, (start, end, lineText, isDefaultFold) => {
    if (fold) {
      view.dispatch({ effects: Collapse.of(Decoration.replace({block: true}).range(start, end)) });
    }
    else {
      if (!isDefaultFold || !defaultState){
        // @ts-ignore
        view.dispatch({ effects: UnCollapse.of((from: number, to: number) => to <= start || from >= end) });
      }
    }
  });
}// foldAll


let settings: CodeblockCustomizerSettings;
export const codeblockHeader = StateField.define<DecorationSet>({
  create(state): DecorationSet {
    document.body.classList.remove('codeblock-customizer-header-collapse-command');
    return Decoration.none;    
  },
  update(oldState: DecorationSet, transaction: Transaction): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    let WidgetStart = null;
    let Fold = false;
    let fileName = null;
    let bExclude = false;
    let specificHeader = true;     
    for (let i = 1; i < transaction.state.doc.lines; i++) {
      const lineText = transaction.state.doc.line(i).text.toString().trim();
      const line = transaction.state.doc.line(i);
      const lang = getCodeBlockLanguage(lineText);      
      bExclude = isExcluded(lineText, this.settings.ExcludeLangs);
      specificHeader = true;
      if (lineText.startsWith('```') && lineText.indexOf('```', 3) === -1) {
        if (WidgetStart === null) {
          WidgetStart = line;
          fileName = extractFileTitle(lineText);
          Fold = isFolded(lineText);
          if (!bExclude) {
            if (fileName === null || fileName === "") {
              fileName = this.settings.SelectedTheme.settings.header.collapsedCodeText || 'Collapsed Code';
              if (!Fold) {
                specificHeader = false;
              }
            }
            const hasLangBorderColor = getBorderColorByLanguage(lang || "", this.settings.SelectedTheme.colors[getCurrentMode()].codeblock.languageBorderColors).length > 0 ? true : false;
            builder.add(WidgetStart.from, WidgetStart.from, createDecorationWidget(fileName, getDisplayLanguageName(lang), lang, specificHeader, Fold, hasLangBorderColor));
            //EditorView.requestMeasure;
          }
        } else {
          WidgetStart = null;
          Fold = false;
          fileName = null;
        }
      }
    }
  
    return builder.finish();
  },
  provide(field: StateField<DecorationSet>): Extension {
    return EditorView.decorations.from(field);
  },
});// codeblockHeader

function createDecorationWidget(textToDisplay: string, displayLanguageName: string, languageName: string | null, specificHeader: boolean, defaultFold: boolean, hasLangBorderColor: boolean) {
  return Decoration.widget({ widget: new TextAboveCodeblockWidget(textToDisplay, displayLanguageName, languageName, specificHeader, defaultFold, hasLangBorderColor), block: true });
}// createDecorationWidget

const Collapse = StateEffect.define<Range<Decoration>>();
const UnCollapse = StateEffect.define<{ filter: number; filterFrom: number; filterTo: number }>();

let pluginSettings: CodeblockCustomizerSettings;
// @ts-ignore
export const collapseField = StateField.define({  
  create(state) {
    return defaultFold(state, collapseField.pluginSettings);
    //return Decoration.none;
  },
  update(value, tr) {
    value = value.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(Collapse))
        value = value.update({add: [effect.value], sort: true});
      else if (effect.is(UnCollapse)) {
        // @ts-ignore
        value = value.update({filter: effect.value});
      }
    }
    return value;
  },
  provide: f => EditorView.decorations.from(f)
})

class TextAboveCodeblockWidget extends WidgetType {
  text: string;
  observer: MutationObserver;
  view: EditorView;
  defaultFold: boolean;
  displayLanguageName: string;
  specificHeader: boolean;
  languageName: string;
  hasLangBorderColor: boolean;

  constructor(text: string, displayLanguageName: string, languageName: string | null, specificHeader: boolean, defaultFold: boolean, hasLangBorderColor: boolean) {
    super();
    this.text = text;    
    this.displayLanguageName = displayLanguageName;
    this.specificHeader = specificHeader;
    this.languageName = languageName || "";
    this.defaultFold = defaultFold;
    this.hasLangBorderColor = hasLangBorderColor;
    this.observer = new MutationObserver(this.handleMutation);    
  }
  
  handleMutation = (mutations: MutationRecord[]) => {
    mutations.forEach(mutation => {
      if ((mutation.target as HTMLElement).hasAttribute("data-clicked")){
        handleClick(this.view, mutation.target as HTMLElement);        
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
    return other.text === this.text && other.displayLanguageName === this.displayLanguageName && other.languageName === this.languageName && other.specificHeader === this.specificHeader && other.defaultFold === this.defaultFold && this.hasLangBorderColor === other.hasLangBorderColor;
  }

  mousedownEventHandler = (event: MouseEvent) => {
    const container = event.currentTarget as HTMLElement;
    container.setAttribute("data-clicked", "true");
    const Pos = this.view.posAtDOM(container);
    const effect = this.view.state.field(collapseField, false);
    let isFolded = false;
    // @ts-ignore
    effect.between(Pos, Pos, () => {
      isFolded = true;
    });
    
    const collapse = container.querySelector('.codeblock-customizer-header-collapse');
    if (collapse) {
      if (isFolded)
        setIcon(collapse as HTMLElement, "chevrons-up-down");
      else
        setIcon(collapse as HTMLElement, "chevrons-down-up");
    }
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

    container.appendChild(createFileName(this.text));
    const collapse = createCodeblockCollapse(this.defaultFold);
    container.appendChild(collapse);

    container.addEventListener("mousedown", this.mousedownEventHandler);
    this.observer.observe(container, { attributes: true });   
    
    //EditorView.requestMeasure;

    return container;
  }
      
  destroy(dom: HTMLElement) {
    dom.removeAttribute("data-clicked");
    dom.removeEventListener("mousedown", this.mousedownEventHandler);
    this.observer.disconnect();
  }

  ignoreEvent() { return false; }
  
}// TextAboveCodeblockWidget

export function getCodeblockByHTMLTarget(view: EditorView, target: HTMLElement | null, includeBackTicks: boolean) {
  //view.state.update();
  //view.update([]);
  //view.requestMeasure({});  
  if (!target)
    return { CollapseStart : null, CollapseEnd : null, isFolded: false };

  const Pos = view.posAtDOM(target);

  const effect = view.state.field(collapseField, false);
  let isFolded = false;
  // @ts-ignore
  effect.between(Pos, Pos, () => {isFolded = true});

  let CollapseStart: number | null = null;
  let CollapseEnd: number | null = null;
  let WidgetStart: number | null = null;
  // NOTE: Can't use for loop over view.visibleRanges, because that way the closing backticks wouldn't be found and collapse would not be possible
  let blockFound = false;
  for (let i = 1; i < view.state.doc.lines; i++) {
    const lineText = view.state.doc.line(i).text.toString().trim();
    const line = view.state.doc.line(i);
    if (lineText.startsWith('```') && lineText.indexOf('```', 3) === -1) {
      if (WidgetStart === null) {
        WidgetStart = line.from;
        if (Pos === line.from){
          if (includeBackTicks)
            CollapseStart = line.from;
          else
            CollapseStart = line.from + line.length;
        }
      } else {
        blockFound = true;
        if (includeBackTicks)
          CollapseEnd = line.to;
        else 
          CollapseEnd = line.from - 1;
      }
    }

    if (blockFound) {
      if (CollapseStart != null && CollapseEnd != null ){
          return { CollapseStart, CollapseEnd, isFolded };
      }
      WidgetStart = null;
      blockFound = false;
    }
  }

  return { CollapseStart, CollapseEnd, isFolded };
}// getCodeblockByHTMLTarget

export function handleClick(view: EditorView, target: HTMLElement) {
  const { CollapseStart, CollapseEnd, isFolded } = getCodeblockByHTMLTarget(view, target, true);
  if (isFolded) {
      if (CollapseStart && CollapseEnd) {
        // @ts-ignore
        view.dispatch({ effects: UnCollapse.of((from, to) => to <= CollapseStart || from >= CollapseEnd) });
      }
  }
  else {
    if (CollapseStart && CollapseEnd)
      view.dispatch({ effects: Collapse.of(Decoration.replace({block: true}).range(CollapseStart, CollapseEnd)) });
  }
}// handleClick