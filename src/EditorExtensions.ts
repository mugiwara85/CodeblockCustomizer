import { StateField, StateEffect, RangeSetBuilder, EditorState, Transaction, Extension, Range, RangeSet, Line, Text, EditorSelection } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { bracketMatching, syntaxTree } from "@codemirror/language";
import { SyntaxNodeRef } from "@lezer/common";
import { highlightSelectionMatches } from "@codemirror/search";

import { getLanguageIcon, createContainer, createCodeblockLang, createCodeblockIcon, createFileName, createCodeblockCollapse, getBorderColorByLanguage, getCurrentMode, isSourceMode, getLanguageSpecificColorClass, createObjectCopy, getAllParameters, Parameters, findAllOccurrences, createUncollapseCodeButton, getBacktickCount, isExcluded, isFoldDefined, isUnFoldDefined, addTextToClipboard, removeFirstLine, getPropertyFromLanguageSpecificColors, getDefaultParameters, addClassesToPrompt, PromptEnvironment, PromptDefinition, getPWD, createPromptContext, PromptCache, renderPromptLine, computePromptLines } from "./Utils";
import { CodeblockCustomizerSettings } from "./Settings";
import { MarkdownRenderer, editorEditorField, editorInfoField, setIcon } from "obsidian";
import { DEFAULT_TEXT_SEPARATOR, fadeOutLineCount } from "./Const";
import CodeBlockCustomizerPlugin from "./main";

let settingsUpdated = false;
export function updateValue(newValue: boolean) {
  settingsUpdated = newValue;
}

export interface ReplaceFadeOutRanges {
  replaceStart: Line;
  replaceEnd: Line;
  fadeOutStart: Line;
  fadeOutEnd: Line;
  firstLine: Line;
}

interface RangeWithDecoration {
  from: number;
  to: number;
  decoration: Decoration;
}

export interface CodeBlockPositions {
  codeBlockStartPos: number;
  codeBlockEndPos: number;
  parameters: Parameters;
}

interface ButtonConfig {
  class: string;
  displayText: string;
  action: (view: EditorView) => void;
  icon: string;
  text?: string;
  enabled: boolean;
}

export function extensions(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings) {
  /* StateFields */
  
  const header = StateField.define<DecorationSet>({
    create(state: EditorState): DecorationSet {
      document.body.classList.remove('codeblock-customizer-header-collapse-command');
      settings.foldAllCommand = false;
      return Decoration.none;
    },
    update(value: DecorationSet, transaction: Transaction): DecorationSet {
      return insertHeader(transaction.state);
    },
    provide(field: StateField<DecorationSet>): Extension {
      return EditorView.decorations.from(field);
    }
  });// header

  const codeBlockPositions = StateField.define<CodeBlockPositions[]>({
    create(state: EditorState): CodeBlockPositions[] {
      return findCodeBlockPositions(state); //return [];
    },
    update(value: CodeBlockPositions[], transaction: Transaction): CodeBlockPositions[] {
      //return findCodeBlockPositions(transaction.state);
      const { state, startState } = transaction;

      if (settingsUpdated) {
        return findCodeBlockPositions(state);
      }

      if (!transaction.docChanged && (!startState.selection.eq(state.selection) || syntaxTree(startState) !== syntaxTree(state))) {
        // selection change(click) or scroll
        return findCodeBlockPositions(state);
      } else if (transaction.docChanged) {
        // document change
        const changed = transaction.changes;
      
        // remove blocks that intersect the change
        const filtered = value.filter(pos =>
          !changed.touchesRange(pos.codeBlockStartPos, pos.codeBlockEndPos)
        );
      
        // determine where to re-scan from
        let from = 0;
        changed.iterChangedRanges((fromA, toA, fromB, toB) => {
          const precedingBlock = filtered.slice().reverse().find(
            block => block.codeBlockStartPos <= fromB
          );
          from = precedingBlock ? precedingBlock.codeBlockStartPos : 0;
        });
        
        // re-scan
        const updatedBlocks = findCodeBlockPositions(state, from, state.doc.length);

        // remove any overlapping blocks from the filtered set
        const preserved = filtered.filter(block =>
          block.codeBlockStartPos < from
        );
      
        return preserved.concat(updatedBlocks);
      } else {
        // no scroll/click change and no document change
        return value;
      }
    }
  });// codeBlockPositions

  const Collapse = StateEffect.define<Range<Decoration>>();
  const UnCollapse = StateEffect.define<{ filter: (from: number, to: number) => boolean; filterFrom: number; filterTo: number }>();
  const semiCollapse = StateEffect.define<Range<Decoration>>();
  const semiUnCollapse = StateEffect.define<{ filter: (from: number, to: number) => boolean; filterFrom: number; filterTo: number }>();
  const semiFade = StateEffect.define<Range<Decoration>>();
  const semiUnFade = StateEffect.define<{ filter: (from: number, to: number) => boolean; filterFrom: number; filterTo: number }>();

  const collapseField = StateField.define<RangeSet<Decoration>>({  
    create(state): RangeSet<Decoration> {
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(state))
        return Decoration.none;

      return defaultFold(state);
    },
    update(value, tr) {
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(tr.state))
        return Decoration.none;

      value = value.map(tr.changes);
      for (const effect of tr.effects) {
        if (effect.is(Collapse) || effect.is(semiCollapse) || effect.is(semiFade))
          value = value.update({add: [effect.value], sort: true});
        else if (effect.is(UnCollapse) || effect.is(semiUnCollapse) || effect.is(semiUnFade)) {
          const { filterFrom, filterTo } = effect.value;
          value = value.update({ filter: (from, to) => to <= filterFrom || from >= filterTo, filterFrom: filterFrom, filterTo: filterTo });
        }
      }
      return value;
    },
    provide: f => EditorView.decorations.from(f)
  })// collapseField

  /* Extensions */

  const customBracketMatching = bracketMatching({
    renderMatch: (match, state) => {
      const decorations: Range<Decoration>[] = [];
      
      if (!match.matched) {
        if (settings.SelectedTheme.settings.codeblock.highlightNonMatchingBrackets) {
          decorations.push(Decoration.mark({ class: "codeblock-customizer-bracket-highlight-nomatch" }).range(match.start.from, match.start.to));
          if (match.end) {
            decorations.push(Decoration.mark({ class: "codeblock-customizer-bracket-highlight-nomatch" }).range(match.end.from, match.end.to));
          }
        }
        return decorations;
      }
      
      if (match.end) {
        decorations.push(Decoration.mark({ class: "codeblock-customizer-bracket-highlight-match" }).range(match.start.from, match.start.to));
        decorations.push(Decoration.mark({ class: "codeblock-customizer-bracket-highlight-match" }).range(match.end.from, match.end.to));
      }

      return decorations;
    }
  });// customBracketMatching

  const matchHighlightOptions = { maxMatches: 750, wholeWords: false };
  const selectionMatching = highlightSelectionMatches(matchHighlightOptions);

  /* ViewPlugins */

  const viewPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    //settings: CodeblockCustomizerSettings;
  
    constructor(view: EditorView) {
      //this.settings = settings;
      this.decorations = this.buildDecorations(view);
    }
  
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.startState.field(codeBlockPositions) !== update.state.field(codeBlockPositions) || settingsUpdated) {
        this.decorations = this.buildDecorations(update.view);
      }
    }
  
    buildDecorations(view: EditorView): DecorationSet {
      updateValue(false);
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(view.state))
        return Decoration.none;

      const sourcePath = view.state.field(editorInfoField)?.file?.path ?? "";
      const defaultCharWidth = view.state.field(editorEditorField).defaultCharacterWidth;
      const positions = view.state.field(codeBlockPositions, false) ?? [];
      const visibleRanges = view.visibleRanges;
      const decorations: Array<Range<Decoration>> = [];
      const visibleBlocks = positions.filter(pos => {
        return visibleRanges.some(({ from, to }) => !(pos.codeBlockEndPos < from || pos.codeBlockStartPos > to));
      });

      for (const { codeBlockStartPos, codeBlockEndPos, parameters } of visibleBlocks) {
        const firstCodeBlockLine = view.state.doc.lineAt(codeBlockStartPos).number;
        const lastCodeBlockLine = view.state.doc.lineAt(codeBlockEndPos).number;
  
        if (parameters.exclude)
          continue;
    
        if (settings.SelectedTheme.settings.codeblock.enableLinks)
          checkForLinks(view.state, codeBlockStartPos, codeBlockEndPos, decorations, sourcePath);
    
        let lineNumber = 0;
        const lineCount = (lastCodeBlockLine - firstCodeBlockLine - 1) + parameters.lineNumberOffset;
        const gutterWidth = lineCount.toString().length * defaultCharWidth + 12; // padding-left + padding-right
        const gutterStyle = parameters.isSpecificNumber ? lineCount.toString().length > 2 ? `--gutter-width:${gutterWidth}px` : `` : ``; // number must be at least 3 digits, otherwise the padding is too little and causes a shift to left in text
        
        const rawLineCount = lastCodeBlockLine - firstCodeBlockLine - 1;
        const promptLines = computePromptLines(parameters, rawLineCount);
        const { context, initialEnv } = createPromptContext(parameters, settings);
        let promptEnv = { ...initialEnv };
        let cache: PromptCache = { key: "", node: null };

        for (let line = firstCodeBlockLine; line <= lastCodeBlockLine; line++) {
          const startLine = line === firstCodeBlockLine;
          const endLine = line === lastCodeBlockLine;
          const currentLine = view.state.doc.line(line);
          const lineStartPos = currentLine.from;

          // lines
          const lineClass = getLineClass(parameters, lineNumber, startLine, endLine, currentLine, decorations);
          decorations.push(Decoration.line({attributes: {class: lineClass, style: gutterStyle}}).range(lineStartPos));
          
          /*if ((!pos.defaultFolded) && (pos.parameters.fold || (settings.SelectedTheme.settings.codeblock.inverseFold && !pos.parameters.unfold)))
            defaultFold(state, decorations);*/
  
          let spanClass = "";
          if (startLine) {
            spanClass = `codeblock-customizer-line-number-first`;
            
            // first-line buttons
            const buttonConfigs = createButtonConfigs(codeBlockStartPos, codeBlockEndPos, view.state, parameters);
            decorations.push(Decoration.widget({ widget: new buttonWidget(buttonConfigs, { codeBlockStartPos, codeBlockEndPos, parameters } ), side: -1}).range(lineStartPos));
          }
    
          if (endLine) {
            spanClass = `codeblock-customizer-line-number-last`;
          }
          
          // line number
          if (settings.SelectedTheme.settings.codeblock.enableLineNumbers || parameters.isSpecificNumber || parameters.showNumbers === "specific"){
            decorations.push(Decoration.widget({ widget: new LineNumberWidget((startLine || endLine) ? " " : (lineNumber + parameters.lineNumberOffset).toString(), parameters, spanClass),}).range(lineStartPos));
          }

          // prompt
          const isPromptLine = promptLines.has(lineNumber + parameters.lineNumberOffset) && !startLine && !endLine;
          if (isPromptLine) {
            const snapshot = { ...promptEnv };
            const lineText = currentLine.text;
            addCommandOutput(lineText, decorations, currentLine, promptEnv, context.promptDef);
            const { promptData, newEnv, newCache/*, node*/ } = renderPromptLine(lineText, snapshot, cache, context);
            decorations.push(Decoration.widget({widget: new PromptWidget({promptData, promptType: context.promptType, promptDef: context.promptDef, promptEnv: snapshot, settings: context.settings,}),}).range(lineStartPos));
            //decorations.push(Decoration.widget({widget: new NodeWidget(node)}).range(lineStartPos));
            promptEnv = newEnv;
            cache = newCache;
          }

          // indentation
          if (parameters.indentLevel > 0) {
            if (currentLine.text.length > parameters.indentCharacter) {
              decorations.push(Decoration.replace({}).range(lineStartPos, lineStartPos + parameters.indentCharacter)); 
            }
            decorations.push(Decoration.line({attributes: {"style": `--level:${parameters.indentLevel}`, class: `indented-line`}}).range(lineStartPos));
          }
          lineNumber++;
        }
      }
      return RangeSet.of(decorations, true);
    }
  }, {
    decorations: v => v.decorations
  });// viewPlugin

  /* Widgets */

  class TextAboveCodeblockWidget extends WidgetType {
    enableLinks: boolean;
    languageSpecificColors: Record<string, string>;
    parameters: Parameters;
    pos: CodeBlockPositions
    buttonConfigs: Array<ButtonConfig>;
    sourcePath: string;
    disableFoldUnlessSpecified: boolean;
    plugin: CodeBlockCustomizerPlugin;
  
    constructor(parameters: Parameters, pos: CodeBlockPositions, buttonConfigs: Array<ButtonConfig>, sourcePath: string, plugin: CodeBlockCustomizerPlugin) {
      super();
      this.parameters = parameters;
      this.pos = pos;
      this.buttonConfigs = buttonConfigs;
      this.enableLinks = plugin.settings.SelectedTheme.settings.codeblock.enableLinks;
      this.languageSpecificColors = createObjectCopy(plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors[this.parameters.language.length > 0 ? this.parameters.language : "nolang"] || {});
      this.sourcePath = sourcePath;
      this.disableFoldUnlessSpecified = plugin.settings.SelectedTheme.settings.header.disableFoldUnlessSpecified;
      this.plugin = plugin;
    }
  
    eq(other: TextAboveCodeblockWidget) {
      return other.parameters.headerDisplayText === this.parameters.headerDisplayText && other.parameters.language === this.parameters.language && 
      other.parameters.specificHeader === this.parameters.specificHeader && other.parameters.fold === this.parameters.fold && 
      other.parameters.hasLangBorderColor === this.parameters.hasLangBorderColor && other.enableLinks === this.enableLinks && //other.marginLeft === this.marginLeft &&
      other.parameters.indentLevel === this.parameters.indentLevel && other.pos.codeBlockStartPos === this.pos.codeBlockStartPos && other.pos.codeBlockEndPos === this.pos.codeBlockEndPos && other.sourcePath === this.sourcePath &&
      other.plugin === this.plugin && areObjectsEqual(other.languageSpecificColors, this.languageSpecificColors) && compareButtonConfigs(this.buttonConfigs, other.buttonConfigs) &&
      other.disableFoldUnlessSpecified === this.disableFoldUnlessSpecified;
    }
  
    toDOM(view: EditorView): HTMLElement {
      const codeblockLanguageSpecificClass = getLanguageSpecificColorClass(this.parameters.language, null, this.languageSpecificColors);
      const container = createContainer(this.parameters.specificHeader, this.parameters.language, this.parameters.hasLangBorderColor, codeblockLanguageSpecificClass);
      if (this.parameters.displayLanguage){
        const Icon = getLanguageIcon(this.parameters.displayLanguage)
        if (Icon) {
          container.appendChild(createCodeblockIcon(this.parameters.displayLanguage));
        }
        container.appendChild(createCodeblockLang(this.parameters.language));
      }
  
      container.appendChild(createFileName(this.parameters.headerDisplayText, this.enableLinks, this.sourcePath, this.plugin));
      
      // header buttons
      const buttonContainer = createButtonContainer(this.buttonConfigs, view, `codeblock-customizer-header-button-container`)
      container.appendChild(buttonContainer);
      
      if ((this.disableFoldUnlessSpecified && !this.plugin.settings.SelectedTheme.settings.codeblock.inverseFold && !this.parameters.fold) ||
          (this.disableFoldUnlessSpecified && this.plugin.settings.SelectedTheme.settings.codeblock.inverseFold && !this.parameters.unfold)) {
        container.classList.add(`noCollapseIcon`);
      } else {
        const collapse = createCodeblockCollapse(this.parameters.fold);
        container.appendChild(collapse);
      }
  
      if (this.parameters.indentLevel > 0) {
        container.setAttribute("style", `--level:${this.parameters.indentLevel}; `);
        container.classList.add(`indented-line`);
      }

      container.onclick = (event) => {
        if ((this.disableFoldUnlessSpecified && !this.plugin.settings.SelectedTheme.settings.codeblock.inverseFold && !this.parameters.fold) ||
            (this.disableFoldUnlessSpecified && this.plugin.settings.SelectedTheme.settings.codeblock.inverseFold && !this.parameters.unfold)) {
          return;
        }
        handleClick(view, container, this.pos);
      };
      //EditorView.requestMeasure;
  
      return container;
    }
  
    updateDOM(dom: HTMLElement, view: EditorView) {
      view.requestMeasure();
      return false;
    }  
  }// TextAboveCodeblockWidget

  class uncollapseCodeWidget extends WidgetType {
    visibleLines: number;

    constructor(visibleLines: number) {
      super();
      this.visibleLines = visibleLines;
    }
    
    eq(other: uncollapseCodeWidget) {
      return this.visibleLines === other.visibleLines;
    }
  
    toDOM(view: EditorView): HTMLElement {
      const container = createUncollapseCodeButton();
      
      container.onclick = (event: MouseEvent) => {
        event.preventDefault();

        const buttonElement = (event.currentTarget as HTMLElement)?.parentElement;
        const { codeBlockStartPos, codeBlockEndPos } = getCodeblockByHTMLTarget(view, buttonElement as HTMLElement);
        if (!codeBlockStartPos || !codeBlockEndPos)
          return;

        const ranges = getRanges(view.state, codeBlockStartPos.from, codeBlockEndPos.to, this.visibleLines);
        const firstCodeBlockLine = view.state.doc.lineAt(codeBlockStartPos.from);
        const firstLineElement = view.domAtPos(firstCodeBlockLine.from);

        const headerElement = (firstLineElement.node as HTMLElement).previousElementSibling
        if (headerElement) {
          removeFadeOutEffect(headerElement as HTMLElement, view, ranges);
          view.requestMeasure();
        }
      }
  
      return container;
    }
  }// uncollapseCodeWidget

  class LineNumberWidget extends WidgetType {
    lineNumber: string;
    parameters: Parameters
    spanClass: string;
  
    constructor(lineNumber: string, parameters: Parameters, spanClass: string) {
      super();
      this.lineNumber = lineNumber;
      this.parameters = parameters;
      this.spanClass = spanClass;
    }
  
    eq(other: LineNumberWidget) {
      return this.lineNumber === other.lineNumber && this.parameters.showNumbers === other.parameters.showNumbers && 
             this.parameters.isSpecificNumber === other.parameters.isSpecificNumber && this.spanClass === other.spanClass;
    }
  
    toDOM(view: EditorView): HTMLElement {
      const container = createSpan();    
      if (this.spanClass !== "")
        container.classList.add(this.spanClass);
    
      if (this.parameters.showNumbers === "specific") {
        container.classList.add("codeblock-customizer-line-number-specific");
        if (this.parameters.isSpecificNumber) 
          container.classList.add("codeblock-customizer-line-number-specific-number");
      } else if (this.parameters.showNumbers === "hide") {
        container.classList.add("codeblock-customizer-line-number-hide");
      } else {
        container.classList.add("codeblock-customizer-line-number");
      }
    
      const lineNumber = createSpan({ cls: `codeblock-customizer-line-number-element`, text: `${this.lineNumber}`});
      container.appendChild(lineNumber);
  
      return container;
    }
      
    updateDOM(dom: HTMLElement, view: EditorView) {
      view.requestMeasure();
      return false;
    }
  
  }// LineNumberWidget
  
  class buttonWidget extends WidgetType {
    buttonsConfig: Array<ButtonConfig>;
    pos: CodeBlockPositions

    constructor(buttonsConfig: Array<ButtonConfig>, pos: CodeBlockPositions) {
      super();
      this.buttonsConfig = buttonsConfig;
      this.pos = pos;
    }
  
    eq(other: buttonWidget): boolean {
      return compareButtonConfigs(this.buttonsConfig, other.buttonsConfig) && other.pos.codeBlockStartPos === this.pos.codeBlockStartPos && other.pos.codeBlockEndPos === this.pos.codeBlockEndPos;
    }
    
    toDOM(view: EditorView): HTMLElement {
      return createButtonContainer(this.buttonsConfig, view);
    }

  }// buttonWidget

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

 interface PromptWidgetOptions {
  promptData: string | { text: string; class?: string }[];
  promptType: string;
  promptDef: PromptDefinition;
  promptEnv: PromptEnvironment;
  settings: CodeblockCustomizerSettings;
}

class PromptWidget extends WidgetType {
  constructor(private opts: PromptWidgetOptions) {
    super();
  }

  eq(other: PromptWidget): boolean {
    return (
      this.opts.promptType === other.opts.promptType &&
      JSON.stringify(this.opts.promptData) === JSON.stringify(other.opts.promptData) &&
      this.opts.promptEnv.user === other.opts.promptEnv.user &&
      this.opts.promptEnv.host === other.opts.promptEnv.host &&
      this.opts.promptEnv.dir === other.opts.promptEnv.dir
    );
  }

  toDOM(): HTMLElement {
    const isRoot = this.opts.promptEnv.user === "root";
    return addClassesToPrompt(this.opts.promptData, this.opts.promptType, this.opts.promptDef, this.opts.settings, isRoot);
  }
}// PromptWidget
  
/*class NodeWidget extends WidgetType {
  constructor(private node: HTMLElement) { super(); }
  eq(other: NodeWidget): boolean {
    // only reuse if it’s literally the same node instance
    return other.node === this.node;
  }
  toDOM(): HTMLElement {
    return this.node;
  }
}*/

  class LineWidget extends WidgetType {
    output: string;
    className: string;
  
    constructor(output: string, className: string) {
      super();
      this.output = output;
      this.className = className;
    }
  
    eq(other: LineWidget): boolean {
      return this.output === other.output && this.className === other.className;
    }
  
    toDOM(view: EditorView): HTMLElement {
      const span = createSpan({ cls: `${this.className}`, text: `\n${this.output}` });
      return span
    }
  }// LineWidget

  /* functions */

  function findCodeBlockPositions(state: EditorState, from = 0, to: number = state.doc.length): CodeBlockPositions[] {
    const positions: CodeBlockPositions[] = [];
    let codeBlockStartPos = -1;
    let codeBlockEndPos = -1;
    let parameters: Parameters = getDefaultParameters();

    syntaxTree(state).iterate({ from, to, 
      enter: (node) => {
        if (node.type.name.includes("HyperMD-codeblock-begin")) {
          const startLine = state.doc.lineAt(node.from);
          codeBlockStartPos = node.from;
          parameters = getAllParameters(startLine.text, settings);
        }
        if (node.type.name.includes("HyperMD-codeblock-end")) {
          codeBlockEndPos = node.to;
        }
        if (codeBlockStartPos !== -1 && codeBlockEndPos !== -1) {
          positions.push({ codeBlockStartPos, codeBlockEndPos, parameters });
          codeBlockStartPos = -1;
          codeBlockEndPos = -1;
        }
      }
    });
  
    if (codeBlockStartPos !== -1 && codeBlockEndPos === -1) {
      const end = findCodeBlockEnd(codeBlockStartPos, state, parameters.backtickCount);
      if (end)
        positions.push({ codeBlockStartPos, codeBlockEndPos: end, parameters });
    }
  
    return positions;
  }// findCodeBlockPositions

  function findCodeBlockEnd(collapseStart: number, state: EditorState, backtickCount: number) {
    const start = state.doc.lineAt(collapseStart).number;
    let end: Line | null = null;
    for (let i = start + 1; i <= state.doc.lines; i++) {
      const line = state.doc.line(i);
      const match = line.text.match(/^`+/);
      const count = match ? match[0].length : 0;
      if (count === backtickCount) {
      //if (line.text.trim().startsWith('```')) {
        end = line;
        break;
      }
    }
  
    return end?.to;
  }// findCodeBlockEnd
  
  function insertHeader(state: EditorState): DecorationSet {
    if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(state))
      return Decoration.none;

    const sourcePath = state.field(editorInfoField)?.file?.path ?? "";
    const positions = state.field(codeBlockPositions, false) ?? [];
    const decorations: Array<Range<Decoration>> = [];

    /*console.log(state.field(editorEditorField));
    console.log(state.field(editorInfoField));
    console.log(state.field(editorLivePreviewField));*/
    //const visibleRanges = EditorView.visibleRanges(state);

    //console.log(state.field(editorEditorField).viewport);
    //console.log(state.field(editorEditorField).visibleRanges);
    //console.log(state.field(editorEditorField).viewportLineBlocks);

    /*const viewport = state.field(editorEditorField).viewport;
    const filteredPositions = positions.filter(position => {
      return (position.codeBlockStartPos >= viewport.from && position.codeBlockStartPos <= viewport.to) ||
             (position.codeBlockEndPos >= viewport.from && position.codeBlockEndPos <= viewport.to);
    });*/

    for (const pos of positions) {
      const { codeBlockStartPos, codeBlockEndPos, parameters } = pos;

      if (parameters.exclude)
        continue;

      // header
      //if (settings.SelectedTheme.settings.header.alwaysDisplayCodeblockIcon || settings.SelectedTheme.settings.header.alwaysDisplayCodeblockLang || pos.parameters.fold || pos.parameters.headerDisplayText)
      const buttonConfigs = createButtonConfigs(codeBlockStartPos, codeBlockEndPos, state, parameters);
      decorations.push(Decoration.widget({ widget: new TextAboveCodeblockWidget(parameters, pos, buttonConfigs, sourcePath, plugin), block: true }).range(codeBlockStartPos));

    }
    return RangeSet.of(decorations, true);
  }// insertHeader

  function addCommandOutput(lineText: string, decorations: Array<Range<Decoration>>, currentLine: Line, env: PromptEnvironment, promptDef: PromptDefinition | undefined) {
    // pwd command
    if (/^\s*pwd\s*$/.test(lineText)){
      /*const shouldSimplify = shouldSimplifyHomePath(promptDef);
      const pwdOutput = shouldSimplify ? simplifyHomePath(env.dir, env.homeDir) : (env.dir === "~" ? env.homeDir : env.dir);*/
      decorations.push(Decoration.widget({ widget: new LineWidget(getPWD(env), `codeblock-customizer-prompt-cmd-output codeblock-customizer-workingdir`), side: 1 }).range(currentLine.to));
    }
    
    // whoami command
    if (/^\s*whoami\s*$/.test(lineText))
      decorations.push(Decoration.widget({ widget: new LineWidget(env.user, `codeblock-customizer-prompt-cmd-output codeblock-customizer-whoami`), side: 1 }).range(currentLine.to));
  }// addCommandOutput
  
  function createButtonConfigs(codeBlockStartPos: number, codeBlockEndPos: number, state: EditorState, parameters: Parameters){
    const cursorPos = state.selection.main.head;
    const isCursorInCodeBlock = cursorPos >= codeBlockStartPos && cursorPos <= codeBlockEndPos;
    
    let showButton = false;
    if ((!settings.SelectedTheme.settings.codeblock.buttons.alwaysShowButtons) && !isCursorInCodeBlock)
      showButton = true;
    else if (settings.SelectedTheme.settings.codeblock.buttons.alwaysShowButtons)
      showButton = true;

    return [
      {
        class: `codeblock-customizer-copy-code`,
        displayText: "Copy code",
        action: (view: EditorView) => {
          const collapseStart = codeBlockStartPos + parameters.backtickCount;
          const collapseEnd = codeBlockEndPos - parameters.backtickCount;
          const lines = view.state.sliceDoc(collapseStart, collapseEnd).toString();
          addTextToClipboard(removeFirstLine(lines));
        },
        icon: "copy",
        text: parameters.displayLanguage,
        enabled: showButton
      },
      {
        class: `codeblock-customizer-select-code`,
        displayText: "Select code",
        action: (view: EditorView) => {
          const collapseStart = codeBlockStartPos;
          const collapseEnd = codeBlockEndPos;
          const transaction = view.state.update({ selection: EditorSelection.range(collapseStart, collapseEnd) });
          view.dispatch(transaction);
        },
        icon: "text",
        enabled: settings.SelectedTheme.settings.codeblock.buttons.enableSelectCodeButton && showButton
      },
      {
        class: `codeblock-customizer-delete-code`,
        displayText: "Delete code block content",
        action: (view: EditorView) => {
          const collapseStart = codeBlockStartPos + state.doc.lineAt(codeBlockStartPos).length;
          const collapseEnd = codeBlockEndPos - parameters.backtickCount - 1;
          const transaction = view.state.update({ changes: { from: collapseStart, to: collapseEnd, insert: "" } });
          view.dispatch(transaction);
        },
        icon: "trash-2",
        enabled: settings.SelectedTheme.settings.codeblock.buttons.enableDeleteCodeButton && showButton
      }
    ];
  }// createButtonConfig

  function compareButtonConfigs(configs1: Array<ButtonConfig>, configs2: Array<ButtonConfig>): boolean {
    if (configs1.length !== configs2.length) 
      return false;

    return configs1.every((config, i) => {
      const otherConfig = configs2[i];
      return (
        config.class === otherConfig.class &&
        config.displayText === otherConfig.displayText &&
        config.icon === otherConfig.icon &&
        config.text === otherConfig.text &&
        config.enabled === otherConfig.enabled
      );
    });
  }// compareButtonConfigs

  function createButtonContainer(buttonsConfig: Array<ButtonConfig>, view: EditorView, buttonContainerClass?: string) {
    const container = createDiv({cls: buttonContainerClass || `codeblock-customizer-button-container`});

    buttonsConfig.forEach(config => {
      if (!config.enabled)
        return;

      const button = createSpan({ cls: config.class });
      button.setAttribute("aria-label", config.displayText);
      button.onclick = () => config.action(view);

      if (config.text) {
        button.textContent = config.text;
      } else {
        setIcon(button, config.icon);
      }

      container.appendChild(button);
    });

    if (buttonContainerClass) {
      container.onclick = (event) => {
        event.stopPropagation();  // prevent clicks from propagating to the header
      };
    }

    return container;
  }// createButtonContainer

  function getLineClass(parameters: Parameters, lineNumber: number, startLine: boolean, endLine: boolean, line: Line, decorations: Array<Range<Decoration>>) {
    let codeblockLanguageClass = "";
    let codeblockLanguageSpecificClass = "";
    let borderColor = "";
    const languageSpecificColors = settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors;
    const languageBorderColors = getPropertyFromLanguageSpecificColors("codeblock.borderColor", settings);
    const language = parameters.language.length > 0 ? parameters.language : "nolang";

    codeblockLanguageClass = "codeblock-customizer-language-" + language.toLowerCase();
    codeblockLanguageSpecificClass = getLanguageSpecificColorClass(language, languageSpecificColors);
    borderColor = getBorderColorByLanguage(parameters.language, languageBorderColors); // handles nolang
  
    let lineClass = `codeblock-customizer-line`;
    lineClass = highlightLinesOrWords(lineNumber + parameters.lineNumberOffset, startLine, endLine, parameters, line, decorations, lineClass);
    lineClass = lineClass + " " + codeblockLanguageClass + " " + codeblockLanguageSpecificClass;

    if (borderColor.length > 0)
      lineClass = lineClass + " hasLangBorderColor";
  
    return lineClass;
  }// getLineClass

  function checkForLinks(state: EditorState, collapseFrom: number, collapseTo: number, decorations: Array<Range<Decoration>>, sourcePath: string) {
    const cursorPos = state.selection.main.head;
    //const regex = /(?:\[\[([^[\]]*)\]\]|\[([^\]]+)\]\(([^)]+)\))(?!\r?\n)/g;
    //const regex = /(?:\[\[([^[\]]*)\]\]|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s]+))/g;
    const regex = /(?:\[\[([^[\]]+?)(?:\|([^\]]+?))?]]|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s]+))/g;
    
    syntaxTree(state).iterate({ from: collapseFrom, to: collapseTo,
      enter(node) {
        //----------------------------------------------
        // only for comments
        /*let comment = '';
        if (node.type.name.includes("HyperMD-codeblock-begin") || node.type.name.includes("comment_hmd-codeblock")) {
          comment = state.sliceDoc(node.from, node.to);
        }*/
        if (!node.type.name.includes("HyperMD-codeblock-begin") && !node.type.name.includes("comment_hmd-codeblock")) 
          return;
        
        const comment = state.sliceDoc(node.from, node.to);
        const matches = [...comment.matchAll(regex)];
        //----------------------------------------------
        //const matches = [...originalLineText.matchAll(regex)]; // not only for comments
        for (const match of matches) {
          const fullMatch = match[0];
          const startPosition = match.index !== undefined ? match.index : -1;
          if (startPosition === -1) 
            continue;

          const isCursorInside = (cursorPos >= node.from + startPosition && cursorPos <= node.from + startPosition + fullMatch.length);
    
          if (match[1] !== undefined && match[1] !== '') { // Double square bracket link: [[link]] or [[Link|DisplayText]]
            handleWikiLink(isCursorInside, node, startPosition, fullMatch, decorations, sourcePath);
          } else if (match[3] !== undefined && match[3] !== '') { // Square bracket followed by parentheses link: [DisplayText](Link)
            handleMarkdownLink(isCursorInside, node, startPosition, fullMatch, decorations, sourcePath);
          } else if (match[5] !== undefined && match[5] !== '') { // HTTP or HTTPS URL
            handleHTTPLink(isCursorInside, node, startPosition, fullMatch, decorations, sourcePath);
          }
        }
      }
    });
  }// checkForLinks

  function highlightLinesOrWords(lineNumber: number, startLine: boolean, endLine: boolean, parameters: Parameters, line: Line, decorations: Array<Range<Decoration>>, lineClass: string) {
    const caseInsensitiveLineText = (line.text ?? '').toLowerCase();
    const textSeparator = parameters.textSeparator || settings.SelectedTheme.settings.textHighlight.textSeparator || DEFAULT_TEXT_SEPARATOR;

    const addHighlightClass = (name = '') => {
      const className = `codeblock-customizer-line-highlighted${name ? `-${name.replace(/\s+/g, '-').toLowerCase()}` : ''}`;
      return className;
    };
  
    const highlighText = (words: string[], name = '') => {
      const caseInsensitiveWords = words.map(word => word.toLowerCase());
      for (const word of caseInsensitiveWords) {
        setClass(line, decorations, caseInsensitiveLineText, word, textSeparator, name.replace(/\s+/g, '-').toLowerCase());
      }
    };
  
    if (startLine || endLine) 
      return lineClass;
  
    // highlight line by line number hl:1,3-5
    if (parameters.defaultLinesToHighlight.lineNumbers.includes(lineNumber)) {
      lineClass = addHighlightClass();
    }
  
    // highlight every line which contains a specific word hl:test
    let words = parameters.defaultLinesToHighlight.words;
    if (words.length > 0 && words.some(word => caseInsensitiveLineText.includes(word))) {
      lineClass = addHighlightClass();
    }

    // highlight specific lines if they contain the specified word hl:1|test,3-5|test
    let lineSpecificWords = parameters.defaultLinesToHighlight.lineSpecificWords;
    if (lineSpecificWords.length > 0) {
      lineSpecificWords.forEach(lsWord => {
        if (lsWord.lineNumber === lineNumber && lsWord.words.some(word => caseInsensitiveLineText.includes(word))) {
          lineClass = addHighlightClass();
        }
      });
    }

    // highlight text in every line if linetext contains the specified word hlt:test
    words = parameters.defaultTextToHighlight.words;
    if (words.length > 0) {
      highlighText(words);
    }

    // highlight text in specific lines if linetext contains the specified word hlt:1|test,3-5|test
    lineSpecificWords = parameters.defaultTextToHighlight.lineSpecificWords;
    const lineSpecificWord = lineSpecificWords.find(item => item.lineNumber === lineNumber);
    if (lineSpecificWord) {
      highlighText(lineSpecificWord.words);
    }
    
    // highlight text with specific text between markers hlt:start:end
    const textBetween = parameters.defaultTextToHighlight.textBetween;
    for (const { from, to } of textBetween) {
      if (caseInsensitiveLineText.includes(from.toLowerCase()) && caseInsensitiveLineText.includes(to.toLowerCase())) {
        const highlightText = `${from}${textSeparator}${to}`;
        highlighText([highlightText]);
      }
    }
  
    // highlight text within specific lines with text between markers hl:5|start:end, hlt:5-7|start:end
    const lineSpecificTextBetween = parameters.defaultTextToHighlight.lineSpecificTextBetween;
    const specificTextBetween = lineSpecificTextBetween.find(item => item.lineNumber === lineNumber);
    if (specificTextBetween) {
      if (caseInsensitiveLineText.includes(specificTextBetween.from.toLowerCase()) && caseInsensitiveLineText.includes(specificTextBetween.to.toLowerCase())) {
        const highlightText = `${specificTextBetween.from}${textSeparator}${specificTextBetween.to}`;
        highlighText([highlightText]);
      }
    }
  
    // highlight all words in specified line hlt:1,3-5
    if (parameters.defaultTextToHighlight.allWordsInLine.includes(lineNumber)) {
      setClass(line, decorations, caseInsensitiveLineText, '', textSeparator, '');
    }
  
    // highlight line by line number imp:1,3-5
    const alternativeLinesToHighlight = parameters.alternativeLinesToHighlight.lines;
    const altHLMatch = alternativeLinesToHighlight.find(hl => hl.lineNumbers.includes(lineNumber));
    if (altHLMatch) {
      lineClass = addHighlightClass(altHLMatch.colorName);
    }

    // highlight every line which contains a specific word imp:test
    const altwords = parameters.alternativeLinesToHighlight.words;
    if (altwords.length > 0 && altwords.some(altwordObj => altwordObj.words.some(word => caseInsensitiveLineText.includes(word.toLowerCase())))) {
      altwords.forEach(altwordObj => {
        if (altwordObj.words.some(word => caseInsensitiveLineText.includes(word.toLowerCase()))) {
          lineClass = addHighlightClass(altwordObj.colorName);
        }
      });
    }

    // highlight specific lines if they contain the specified word imp:1|test,3-5|test
    let altLineSpecificWords = parameters.alternativeLinesToHighlight.lineSpecificWords;
    if (altLineSpecificWords.length > 0) {
      altLineSpecificWords.forEach(lsWord => {
        if (lsWord.lineNumber === lineNumber && lsWord.words.some(word => caseInsensitiveLineText.includes(word))) {
          lineClass = addHighlightClass(lsWord.colorName);
        }
      });
    }
  
    // highlight text in every line if linetext contains the specified word impt:test
    const altWords = parameters.alternativeTextToHighlight.words;
    if (!startLine && !endLine) {
      for (const entry of altWords) {
        const { colorName, words } = entry;
        if (words.length > 0) {
          highlighText(words, colorName);
        }
      }
    }

    // highlight text in specific lines if linetext contains the specified word impt:1|test,3-5|test
    altLineSpecificWords = parameters.alternativeTextToHighlight.lineSpecificWords;
    const altLineSpecificWord = altLineSpecificWords.find(item => item.lineNumber === lineNumber);
    if (altLineSpecificWord) {
      const { colorName, words } = altLineSpecificWord;
      highlighText(words, colorName);
    }
  
    // highlight text with specific text between markers impt:start:end
    const altTextBetween = parameters.alternativeTextToHighlight.textBetween;
    for (const { from, to, colorName } of altTextBetween) {
      if (caseInsensitiveLineText.includes(from.toLowerCase()) && caseInsensitiveLineText.includes(to.toLowerCase())) {
        const highlightText = `${from}${textSeparator}${to}`;
        highlighText([highlightText], colorName);
      }
    }
  
    // highlight text within specific lines with text between markers impt:5|start:end, imp:5-7|start:end
    const altLineSpecificTextBetween = parameters.alternativeTextToHighlight.lineSpecificTextBetween;
    const altSpecificTextBetween = altLineSpecificTextBetween.find(item => item.lineNumber === lineNumber);
    if (altSpecificTextBetween) {
      if (caseInsensitiveLineText.includes(altSpecificTextBetween.from.toLowerCase()) && caseInsensitiveLineText.includes(altSpecificTextBetween.to.toLowerCase())) {
        const highlightText = `${altSpecificTextBetween.from}${textSeparator}${altSpecificTextBetween.to}`;
        highlighText([highlightText], altSpecificTextBetween.colorName);
      }
    }
  
    // highlight all words in specified line impt:1,3-5
    const altAllWordsInLine = parameters.alternativeTextToHighlight.allWordsInLine;
    const altAllWordsInLineMatch = altAllWordsInLine.find(item => item.allWordsInLine.includes(lineNumber));
    if (altAllWordsInLineMatch) {
      setClass(line, decorations, caseInsensitiveLineText, '', textSeparator, altAllWordsInLineMatch.colorName);
    }
  
    return lineClass;
  }// highlightLinesOrWords
  
  function setClass(line: Line, decorations: Array<Range<Decoration>>, caseInsensitiveLineText: string, word: string, textSeparator: string, customClass = '') {
    if (word.includes(textSeparator)) {
      const [start, end] = word.split(textSeparator).map(w => w.trim().toLowerCase());
      const lineTextLength = caseInsensitiveLineText.length;
      const startLength = start.length;
      const endLength = end.length;
      const classToUse = customClass 
        ? `codeblock-customizer-highlighted-text-${customClass}` 
        : 'codeblock-customizer-highlighted-text';
      
      const firstNonWhiteSpaceIndex = caseInsensitiveLineText.match(/\S/)?.index || 0;
      let startIndex = start ? caseInsensitiveLineText.indexOf(start) : 0;

      while (startIndex !== -1) {
        const endIndex = end 
          ? caseInsensitiveLineText.indexOf(end, startIndex + startLength) 
          : lineTextLength - 1;
    
        if ((startIndex !== -1 || start === '') && (endIndex !== -1 || end === '')) {
          const from = line.from + (start ? startIndex : firstNonWhiteSpaceIndex);
          const to = line.from + (end ? endIndex + endLength : lineTextLength);
    
          if (to > from)
            decorations.push(Decoration.mark({ class: classToUse }).range(from, to));
        }
    
        startIndex = start ? caseInsensitiveLineText.indexOf(start, startIndex + 1) : -1;
      }
    } else if (word === '') {
      const classToUse = customClass ? `codeblock-customizer-highlighted-text-${customClass}` : 'codeblock-customizer-highlighted-text';
      const match = line.text.match(/\S/);
      const pos = match ? match.index : -1;
      if (pos !== undefined && pos !== -1 && line.to > line.from + pos)
        decorations.push(Decoration.mark({ class: classToUse }).range(line.from + pos, line.to));
    } else {
      const occurrences = findAllOccurrences(caseInsensitiveLineText, word);
  
      occurrences.forEach((index) => {
        const classToUse = customClass ? `codeblock-customizer-highlighted-text-${customClass}` : 'codeblock-customizer-highlighted-text';
        decorations.push(Decoration.mark({ class: classToUse }).range(line.from + index, line.from + index + word.length));
      });
    }
  }// setClass
  
  function handleWikiLink(isCursorInside: boolean, node: SyntaxNodeRef, startPosition: number, fullMatch: string, decorations: Array<Range<Decoration>>, sourcePath: string) {
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
  
  function handleMarkdownLink(isCursorInside: boolean, node: SyntaxNodeRef, startPosition: number, fullMatch: string, decorations: Array<Range<Decoration>>, sourcePath: string) {
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
  
  function handleHTTPLink(isCursorInside: boolean, node: SyntaxNodeRef, startPosition: number, fullMatch: string, decorations: Array<Range<Decoration>>, sourcePath: string) {
    if (isCursorInside) {
      decorations.push(Decoration.replace({ widget: new createLink(fullMatch, sourcePath, plugin) }).range(node.from + startPosition, node.from + startPosition + fullMatch.length));
    } else {
      decorations.push(Decoration.mark({class: `cm-url`}).range(node.from + startPosition, node.from + startPosition + fullMatch.length));
    }
  }// handleHTTPLink

  function defaultFold(state: EditorState) {
    const builder = new RangeSetBuilder<Decoration>();
  
    const addFoldDecoration = (from: number, to: number) => {
      const decoration = Decoration.replace({ effect: Collapse.of(Decoration.replace({ block: true }).range(from, to)), block: true, side: -1 });
      builder.add(from, to, decoration);
    };
  
    const processSemiFold = (start: { from: number }, end: { to: number }) => {
      const lineCount = state.doc.lineAt(end.to).number - state.doc.lineAt(start.from).number + 1;
      if (lineCount >= settings.SelectedTheme.settings.semiFold.visibleLines + fadeOutLineCount + 2) { // +2 to ignore the first and last lines
        const ranges = getRanges(state, start.from, end.to, settings.SelectedTheme.settings.semiFold.visibleLines);
        const decos = addFadeOutEffect(null, state, ranges, settings.SelectedTheme.settings.semiFold.visibleLines, null);
        for (const { from, to, decoration } of decos || []) {
          builder.add(from, to, decoration);
        }
      } else {
        addFoldDecoration(start.from, end.to);
      }
    };
  
    // process codeBlocks
      processCodeBlocks(state.doc, (start, end, lineText, fold, unfold) => { // need to get rid of this
      if (fold || (settings.SelectedTheme.settings.codeblock.inverseFold && !unfold)) {
        if (settings.SelectedTheme.settings.semiFold.enableSemiFold) {
          processSemiFold(start, end);
        } else {
          addFoldDecoration(start.from, end.to);
        }
      }
    });
  
    return builder.finish();
  }// defaultFold

  /*function defaultFold(state: EditorState, decorations: Array<Range<Decoration>>) {
    //const builder = new RangeSetBuilder<Decoration>();
  
    const addFoldDecoration = (from: number, to: number) => {
      const decoration = Decoration.replace({ effect: Collapse.of(Decoration.replace({ block: true }).range(from, to)), block: true, side: -1 });
      //builder.add(from, to, decoration);
      decorations.push(decoration.range(from, to));
    };
  
    const processSemiFold = (start: { from: number }, end: { to: number }) => {
      const lineCount = state.doc.lineAt(end.to).number - state.doc.lineAt(start.from).number + 1;
      if (lineCount >= settings.SelectedTheme.settings.semiFold.visibleLines + fadeOutLineCount + 2) { // +2 to ignore the first and last lines
        const ranges = getRanges(state, start.from, end.to, settings.SelectedTheme.settings.semiFold.visibleLines);
        const decos = addFadeOutEffect(null, state, ranges, settings.SelectedTheme.settings.semiFold.visibleLines, null);
        for (const { from, to, decoration } of decos || []) {
          //builder.add(from, to, decoration);
          decorations.push(decoration.range(from, to));
        }
      } else {
        addFoldDecoration(start.from, end.to);
      }
    };
  
    // process codeBlocks
    const positions = state.field(codeBlockPositions, false) ?? [];
    for (const pos of positions) {
      if (pos.parameters.fold || (settings.SelectedTheme.settings.codeblock.inverseFold && !pos.parameters.unfold)) {
        if (settings.SelectedTheme.settings.semiFold.enableSemiFold) {
          processSemiFold({from: pos.codeBlockStartPos}, {to: pos.codeBlockEndPos});
        } else {
          addFoldDecoration(pos.codeBlockStartPos, pos.codeBlockEndPos);
        }
      }
    }
  
    //return builder.finish();
  }// defaultFold*/

  function addFadeOutEffect(element: HTMLElement | null, state: EditorState, ranges: ReplaceFadeOutRanges, visibleLines: number, view: EditorView | null = null): void | RangeWithDecoration[] {
    const decorations: RangeWithDecoration[] = [];
    const fadeOutLines: Line[] = [];
    const transactions = [];

    const semiFoldClass = Decoration.line({ attributes: { class: `semi-folded` } });
    if (view === null) {
      decorations.push({ from: ranges.firstLine.from, to: ranges.firstLine.from, decoration: semiFoldClass });
    } else {
      transactions.push(semiFade.of(semiFoldClass.range(ranges.firstLine.from, ranges.firstLine.from)));
    }

    for (let i = 0; i < fadeOutLineCount; i++) {
      fadeOutLines.push(state.doc.line(state.doc.lineAt(ranges.fadeOutStart.from).number + i));
    }
    
    fadeOutLines.forEach((line, i) => {
      const fadeOutDecoration = Decoration.line({ attributes: { class: `codeblock-customizer-fade-out-line${i}` } });
      if (view === null) {
        decorations.push({ from: line.from, to: line.from, decoration: fadeOutDecoration });
      } else {
        transactions.push(semiFade.of(fadeOutDecoration.range(line.from, line.from)));
      }
  
      if (i === fadeOutLineCount - 1) {
        const uncollapseWidget = Decoration.widget({ widget: new uncollapseCodeWidget(visibleLines) });
        if (view === null) {
          decorations.push({ from: line.from, to: line.from, decoration: uncollapseWidget });
        } else {
          transactions.push(semiFade.of(uncollapseWidget.range(line.from, line.from)));
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
      transactions.push(semiCollapse.of(collapseDecoration.range(ranges.replaceStart.from, ranges.replaceEnd.to)));
      view.dispatch({ effects: transactions });
      view.requestMeasure();
    }
  }// addFadeOutEffect
  
  function handleClick(view: EditorView, target: HTMLElement, pos: CodeBlockPositions) {
    if (settings.SelectedTheme.settings.semiFold.enableSemiFold) {
      const lineCount = view.state.doc.lineAt(pos.codeBlockEndPos).number - view.state.doc.lineAt(pos.codeBlockStartPos).number + 1;
      if (lineCount >= settings.SelectedTheme.settings.semiFold.visibleLines + fadeOutLineCount + 2) { // +2 to ignore the first and last lines
        const ranges = getRanges(view.state, pos.codeBlockStartPos, pos.codeBlockEndPos, settings.SelectedTheme.settings.semiFold.visibleLines);
        const isFolded = isHeaderFolded(target, view, settings.SelectedTheme.settings.semiFold.visibleLines);
        if (isFolded) {
          removeFadeOutEffect(target, view, ranges);
        } else {
          addFadeOutEffect(target, view.state, ranges, settings.SelectedTheme.settings.semiFold.visibleLines, view);
        }
      } else {
        toggleCollapseCodeBlock(target, view, pos);
      }
    } else {
      toggleCollapseCodeBlock(target, view, pos);
    }
  }// handleClick
  
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

  function hasHeaderEffect(view: EditorView, startPos: number, endPos: number ) {
    const effect = view.state.field(collapseField, false);
    let hasEffect = false;
    effect?.between(startPos, endPos, () => {hasEffect = true});
  
    return hasEffect;
  }// hasHeaderEffect

  function removeFadeOutEffect(headerElement: HTMLElement, view: EditorView, ranges: ReplaceFadeOutRanges) {
    view.dispatch({ effects: semiUnCollapse.of({filter: (from: number, to: number) => to <= ranges.replaceStart.from || from >= ranges.replaceEnd.to, filterFrom: ranges.replaceStart.from, filterTo: ranges.replaceEnd.to}) });
    view.dispatch({ effects: semiUnFade.of({filter: (from: number, to: number) => to <= ranges.fadeOutStart.from - 1 || from >= ranges.replaceEnd.to, filterFrom: ranges.fadeOutStart.from - 1, filterTo: ranges.replaceEnd.to} )});
    // additional for removing the first-line fade effect, which is only the class
    view.dispatch({ effects: semiUnFade.of({filter: (from: number, to: number) => to <= ranges.firstLine.from - 1 || from >= ranges.replaceEnd.to, filterFrom: ranges.firstLine.from - 1, filterTo: ranges.replaceEnd.to} )});
    view.requestMeasure();

    const collapseIcon = headerElement.querySelector('.codeblock-customizer-header-collapse');
    if (collapseIcon)
      setIcon(collapseIcon as HTMLElement, "chevrons-up-down");
  }// removeFadeOutEffect

  function toggleCollapseCodeBlock(target: HTMLElement, view: EditorView, pos: CodeBlockPositions) {
    const collapseIcon = target.querySelector('.codeblock-customizer-header-collapse');
    const isFolded = isHeaderFolded(target, view);
    if (isFolded) {
      view.dispatch({ effects: UnCollapse.of({filter: (from: number, to: number) => to <= pos.codeBlockStartPos || from >= pos.codeBlockEndPos, filterFrom: pos.codeBlockStartPos, filterTo: pos.codeBlockEndPos} )});
      if (collapseIcon)
        setIcon(collapseIcon as HTMLElement, "chevrons-up-down");
    }
    else {
      view.dispatch({ effects: Collapse.of(Decoration.replace({block: true}).range(pos.codeBlockStartPos, pos.codeBlockEndPos)) });
      if (collapseIcon)
        setIcon(collapseIcon as HTMLElement, "chevrons-down-up");
    }
    view.requestMeasure();
  }// collapseCodeBlock

  function areObjectsEqual(obj1: Record<string, string> | null | undefined, obj2: Record<string, string> | null | undefined): boolean {
    if (obj1 === null && obj2 === null) {
      return true;
    }
  
    if ((obj1 === null || obj1 === undefined) || (obj2 === null || obj2 === undefined)) {
      return false;
    }
  
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

  function getCodeblockByHTMLTarget(view: EditorView, target: HTMLElement) {
    let codeBlockStartPos: Line | null = null;
    let codeBlockEndPos: Line | null = null;
  
    if (!target) {
      return { codeBlockStartPos, codeBlockEndPos };
    }
  
    const pos = view.posAtDOM(target as HTMLElement);
    const line = view.state.doc.lineAt(pos);
    let startBacktickCount = 0;
  
    // find start
    for (let i = line.number; i >= 1; i--) {
      const prevLine = view.state.doc.line(i);
      const backtickCount = getBacktickCount(prevLine.text);
      if (backtickCount > 0) {
        codeBlockStartPos = prevLine;
        startBacktickCount = backtickCount;
        break;
      }
    }
  
    // find end
    if (codeBlockStartPos) {
      for (let i = line.number + 1; i <= view.state.doc.lines; i++) {
        const nextLine = view.state.doc.line(i);
        const backtickCount = getBacktickCount(nextLine.text);
        if (backtickCount === startBacktickCount) {
          codeBlockEndPos = nextLine;
          break;
        }
      }
    }
  
    return { codeBlockStartPos, codeBlockEndPos };
  }// getCodeblockByHTMLTarget

  function getRanges(state: EditorState, codeBlockStartPos: number, codeBlockEndPos: number, visibleLines: number): ReplaceFadeOutRanges {
    const firstLine = state.doc.lineAt(codeBlockStartPos);
    const fadeOutStart = state.doc.line(state.doc.lineAt(codeBlockStartPos).number + visibleLines + 1);
    const fadeOutEnd = state.doc.line(state.doc.lineAt(fadeOutStart.from).number + fadeOutLineCount - 1);
  
    const replaceStart = state.doc.line(state.doc.lineAt(fadeOutEnd.from).number + 1);
    const replaceEnd = state.doc.line(state.doc.lineAt(codeBlockEndPos).number);
  
    return { replaceStart, replaceEnd, fadeOutStart, fadeOutEnd, firstLine};
  }// getRanges

  function processCodeBlocks(doc: Text, callback: (start: Line, end: Line, lineText: string, fold: boolean, unfold: boolean) => void) {
    let CollapseStart: Line | null = null;
    let CollapseEnd: Line | null = null;
    let blockFound = false;
    let bExclude = false;
    let isDefaultFold = false;
    let isDefaultUnFold = false;
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
            isDefaultUnFold = isUnFoldDefined(lineText);
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
          callback(CollapseStart, CollapseEnd, lineText, isDefaultFold, isDefaultUnFold);
          CollapseStart = null;
          CollapseEnd = null;
          isDefaultFold = false;
          isDefaultUnFold = false;
        }
        blockFound = false;
      }
    }
  }// processCodeBlocks

  function foldAll(view: EditorView, settings: CodeblockCustomizerSettings, fold: boolean, defaultState: boolean) { // needs to be re-checked
    const { enableSemiFold, visibleLines } = settings.SelectedTheme.settings.semiFold;
    const changes: StateEffect<any>[] = [];

    processCodeBlocks(view.state.doc, (start, end, lineText, isDefaultFold, isDefaultUnFold) => {
      if ((this.disableFoldUnlessSpecified && !this.plugin.settings.SelectedTheme.settings.codeblock.inverseFold && !this.parameters.fold) ||
        (this.disableFoldUnlessSpecified && this.plugin.settings.SelectedTheme.settings.codeblock.inverseFold && !this.parameters.unfold)) {
        return;
      }
      const lineCount = view.state.doc.lineAt(end.to).number - view.state.doc.lineAt(start.from).number + 1;

      if (fold || (settings.SelectedTheme.settings.codeblock.inverseFold && !isDefaultUnFold)) {
        if (enableSemiFold && lineCount >= visibleLines + fadeOutLineCount + 2) { // +2 to ignore the first and last lines
            const ranges = getRanges(view.state, start.from, end.to, settings.SelectedTheme.settings.semiFold.visibleLines);
            const Pos = view.domAtPos(start.from);
            let headerElement = null;
            if (Pos) {
              headerElement = (Pos.node as HTMLElement).previousElementSibling;
            }
  
            addFadeOutEffect(headerElement as HTMLElement, view.state, ranges, settings.SelectedTheme.settings.semiFold.visibleLines, view);
          } else {
            changes.push(Collapse.of(Decoration.replace({ block: true }).range(start.from, end.to)));
          }
        } else {
        if (!isDefaultFold || !defaultState) {
          if (enableSemiFold )
            clearFadeEffect(view, start.from, end.to);

          changes.push(UnCollapse.of({ filter: (from: number, to: number) => to <= start.from || from >= end.to, filterFrom: start.from, filterTo: end.to }));
        }
      }
    });

    if (changes.length > 0) {
      view.dispatch({ effects: changes });
      view.requestMeasure();
    }
  }// foldAll

  function clearFadeEffect(view: EditorView, CollapseStart: number, CollapseEnd: number) { // needs to be re-checked
    const hasFadeEffect = hasHeaderEffect(view, CollapseStart, CollapseEnd);
    if (hasFadeEffect) {
      view.dispatch({ effects: semiUnFade.of({filter: (from: number, to: number) => to <= CollapseStart || from >= CollapseEnd, filterFrom: CollapseStart, filterTo: CollapseEnd} )});

      view.requestMeasure();
    }
  }// clearFadeEffect

  const extensions = [codeBlockPositions, header, collapseField, viewPlugin];

  const result = {
    extensions,
    foldAll,
    customBracketMatching,
    selectionMatching
  };

  return result;
}// extensions
