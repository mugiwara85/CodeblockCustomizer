import { StateField, StateEffect, RangeSetBuilder, EditorState, Transaction, Extension, Range, RangeSet, Line, Text } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, DecorationSet } from "@codemirror/view";
import { bracketMatching, syntaxTree } from "@codemirror/language";
import { SyntaxNodeRef } from "@lezer/common";
import { highlightSelectionMatches } from "@codemirror/search";

import { getLanguageIcon, createContainer, createCodeblockLang, createCodeblockIcon, createFileName, createCodeblockCollapse, getBorderColorByLanguage, getCurrentMode, isSourceMode, getLanguageSpecificColorClass, createObjectCopy, getAllParameters, Parameters, getValueNameByLineNumber, findAllOccurrences, createUncollapseCodeButton, getBacktickCount, isExcluded, isFoldDefined, isUnFoldDefined, addTextToClipboard, removeFirstLine } from "./Utils";
import { CodeblockCustomizerSettings } from "./Settings";
import { MarkdownRenderer, editorEditorField, editorInfoField, setIcon } from "obsidian";
import { fadeOutLineCount } from "./Const";
import CodeBlockCustomizerPlugin from "./main";

export interface ReplaceFadeOutRanges {
  replaceStart: Line;
  replaceEnd: Line;
  fadeOutStart: Line;
  fadeOutEnd: Line;
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

export function extensions(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings) {
  /* StateFields */
  
  const decorations = StateField.define<DecorationSet>({
    create(state: EditorState): DecorationSet {
      return Decoration.none;
    },
    update(value: DecorationSet, transaction: Transaction): DecorationSet {
      return buildDecorations(transaction.state);
    },
    provide(field: StateField<DecorationSet>): Extension {
      return EditorView.decorations.from(field);
    }
  });// decorations

  const codeBlockPositions = StateField.define<CodeBlockPositions[]>({
    create(state: EditorState): CodeBlockPositions[] {
      return [];
    },
    update(value: CodeBlockPositions[], transaction: Transaction): CodeBlockPositions[] {
      return findCodeBlockPositions(transaction.state);
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

  /* Widgets */

  class TextAboveCodeblockWidget extends WidgetType {
    enableLinks: boolean;
    languageSpecificColors: Record<string, string>;
    parameters: Parameters;
    pos: CodeBlockPositions
    sourcePath: string;
    plugin: CodeBlockCustomizerPlugin;
  
    constructor(parameters: Parameters, pos: CodeBlockPositions, sourcePath: string, plugin: CodeBlockCustomizerPlugin) {
      super();
      this.parameters = parameters;
      this.pos = pos;
      this.enableLinks = plugin.settings.SelectedTheme.settings.codeblock.enableLinks;
      this.languageSpecificColors = createObjectCopy(plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors[this.parameters.language.length > 0 ? this.parameters.language : "nolang"] || {});
      this.sourcePath = sourcePath;
      this.plugin = plugin;
    }
  
    eq(other: TextAboveCodeblockWidget) {
      return other.parameters.headerDisplayText === this.parameters.headerDisplayText && other.parameters.language === this.parameters.language && 
      other.parameters.specificHeader === this.parameters.specificHeader && other.parameters.fold === this.parameters.fold && 
      other.parameters.hasLangBorderColor === this.parameters.hasLangBorderColor && other.enableLinks === this.enableLinks && //other.marginLeft === this.marginLeft &&
      other.parameters.indentLevel === this.parameters.indentLevel && other.pos.codeBlockStartPos === this.pos.codeBlockStartPos && other.pos.codeBlockEndPos === this.pos.codeBlockEndPos && other.sourcePath === this.sourcePath &&
      other.plugin === this.plugin && areObjectsEqual(other.languageSpecificColors, this.languageSpecificColors);
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
      const collapse = createCodeblockCollapse(this.parameters.fold);
      container.appendChild(collapse);
  
      if (this.parameters.indentLevel > 0) {
        container.setAttribute("style", `--level:${this.parameters.indentLevel}; `);
        container.classList.add(`indented-line`);
      }
      
      container.onclick = (event) => {
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
  
  class deleteCodeWidget extends WidgetType {
    collapseStart: number;
    collapseEnd: number;
  
    constructor(collapseStart: number, collapseEnd: number) {
      super();
      this.collapseStart = collapseStart;
      this.collapseEnd = collapseEnd;
    }
  
    eq(other: deleteCodeWidget) {
      return this.collapseStart === other.collapseStart && this.collapseEnd === other.collapseEnd;
    }
  
    toDOM(view: EditorView): HTMLElement {
      const container = createSpan({ cls: `codeblock-customizer-delete-code`});
      container.setAttribute("aria-label", "Delete code block content");
      setIcon(container, "trash-2");
      
      container.onclick = (event) => {
        const tr = view.state.update({ changes: { from: this.collapseStart, to: this.collapseEnd, insert: "" } });
        view.dispatch(tr);
      }
  
      return container;
    }
  }// deleteCodeWidget
  
  class copyCodeWidget extends WidgetType {
    displayLangText: string;
    collapseStart: number;
    collapseEnd: number;
  
    constructor(displayLangText: string, collapseStart: number, collapseEnd: number) {
      super();
      this.displayLangText = displayLangText;
      this.collapseStart = collapseStart;
      this.collapseEnd = collapseEnd;
    }
  
    eq(other: copyCodeWidget) {
      return this.displayLangText === other.displayLangText && this.collapseStart === other.collapseStart && this.collapseEnd === other.collapseEnd;
    }
  
    toDOM(view: EditorView): HTMLElement {
      const container = createSpan({ cls: `codeblock-customizer-copy-code`});
      container.setAttribute("aria-label", "Copy code");
  
      if (this.displayLangText.length > 0)
        container.setText(this.displayLangText);
      else
        setIcon(container, "copy");
      
      container.onclick = (event) => {
        const lines = view.state.sliceDoc(this.collapseStart, this.collapseEnd).toString();
        addTextToClipboard(removeFirstLine(lines));
      }
  
      return container;
    }
  }// copyCodeWidget
  
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

  /* functions */

  function findCodeBlockPositions(state: EditorState): CodeBlockPositions[] {
    const positions: CodeBlockPositions[] = [];
    let codeBlockStartPos = -1;
    let codeBlockEndPos = -1;
    let parameters: Parameters = {
      linesToHighlight: { lines: [], lineSpecificWords: {}, words: "" },
      alternativeLinesToHighlight: { lines: [], lineSpecificWords: [], words: [] },
      isSpecificNumber: false,
      lineNumberOffset: 0,
      showNumbers: "",
      headerDisplayText: "",
      fold: false,
      unfold: false,
      language: "",
      displayLanguage: "",
      specificHeader: false,
      hasLangBorderColor: false,
      exclude: false,
      backtickCount: 0,
      indentLevel: 0,
      indentCharacter: 0,
    };

    syntaxTree(state).iterate({
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
  
  function buildDecorations(state: EditorState): DecorationSet {
    if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(state))
      return Decoration.none;

    const sourcePath = state.field(editorInfoField)?.file?.path ?? "";
    const positions = state.field(codeBlockPositions, false) ?? [];
    const defaultCharWidth = state.field(editorEditorField).defaultCharacterWidth;
    const decorations: Array<Range<Decoration>> = [];

    /*console.log(state.field(editorEditorField));
    console.log(state.field(editorInfoField));
    console.log(state.field(editorLivePreviewField));*/
    //const visibleRanges = EditorView.visibleRanges(state);

    //console.log(state.field(editorEditorField).viewport);
    //console.log(state.field(editorEditorField).visibleRanges);
    //console.log(state.field(editorEditorField).viewportLineBlocks);

    for (const pos of positions) {
    //  console.log("Start = " + pos.codeBlockStartPos + " - End = " + pos.codeBlockEndPos);
      const { codeBlockStartPos, codeBlockEndPos, parameters } = pos;
      const firstCodeBlockLine = state.doc.lineAt(codeBlockStartPos).number;
      const lastCodeBlockLine = state.doc.lineAt(codeBlockEndPos).number;

      if (parameters.exclude)
        continue;
  
      // header
      //if (settings.SelectedTheme.settings.header.alwaysDisplayCodeblockIcon || settings.SelectedTheme.settings.header.alwaysDisplayCodeblockLang || pos.parameters.fold || pos.parameters.headerDisplayText)
      decorations.push(Decoration.widget({ widget: new TextAboveCodeblockWidget(parameters, pos, sourcePath, plugin), block: true }).range(codeBlockStartPos));
  
      if (settings.SelectedTheme.settings.codeblock.enableLinks)
        checkForLinks(state, codeBlockStartPos, codeBlockEndPos, decorations, sourcePath);
  
      // line
      let lineNumber = 0;
      const lineCount = (lastCodeBlockLine - firstCodeBlockLine - 1) + parameters.lineNumberOffset;
      const gutterWidth = lineCount.toString().length * defaultCharWidth + 12; // padding-left + padding-right
      const gutterStyle = parameters.isSpecificNumber ? lineCount.toString().length > 2 ? `--gutter-width:${gutterWidth}px` : `` : ``; // number must be at least 3 digits, otherwise the padding is too little and causes a shift to left in text
      
      for (let line = firstCodeBlockLine; line <= lastCodeBlockLine; line++) {
        const startLine = line === firstCodeBlockLine;
        const endLine = line === lastCodeBlockLine;
        const currentLine = state.doc.line(line);
        const lineStartPos = currentLine.from;

        // lines
        const lineClass = getLineClass(parameters, lineNumber, startLine, endLine, currentLine, decorations);        
        decorations.push(Decoration.line({attributes: {class: lineClass, style: gutterStyle}}).range(lineStartPos));
        
        /*if ((!pos.defaultFolded) && (pos.parameters.fold || (settings.SelectedTheme.settings.codeblock.inverseFold && !pos.parameters.unfold)))
          defaultFold(state, decorations);*/

        let spanClass = "";
        if (startLine) {
          spanClass = `codeblock-customizer-line-number-first`;
          
          // delete code button
          if (settings.SelectedTheme.settings.codeblock.enableDeleteCodeButton)
            decorations.push(Decoration.widget({ widget: new deleteCodeWidget(codeBlockStartPos + currentLine.text.length, codeBlockEndPos - parameters.backtickCount - 1)}).range(lineStartPos)); 
          
          // copy code button
          if (settings.SelectedTheme.settings.codeblock.enableCopyCodeButton)
            decorations.push(Decoration.widget({ widget: new copyCodeWidget(parameters.displayLanguage, codeBlockStartPos + parameters.backtickCount, codeBlockEndPos - parameters.backtickCount)}).range(lineStartPos));
        }
  
        if (endLine) {
          spanClass = `codeblock-customizer-line-number-last`;
        }
        
        // line number
        if (settings.SelectedTheme.settings.codeblock.enableLineNumbers || parameters.isSpecificNumber || parameters.showNumbers === "specific"){
          decorations.push(Decoration.widget({ widget: new LineNumberWidget((startLine || endLine) ? " " : (lineNumber + parameters.lineNumberOffset).toString(), parameters, spanClass),}).range(lineStartPos));
        }
  
        // indentation
        if (parameters.indentLevel > 0) {
          if (currentLine.text.length > 0) {
            decorations.push(Decoration.replace({}).range(lineStartPos, lineStartPos + parameters.indentCharacter)); 
          }
          decorations.push(Decoration.line({attributes: {"style": `--level:${parameters.indentLevel}`, class: `indented-line`}}).range(lineStartPos));
        }
        lineNumber++;
      }
    }
    return RangeSet.of(decorations, true);
  }// buildDecorations

  function getLineClass(parameters: Parameters, lineNumber: number, startLine: boolean, endLine: boolean, line: Line, decorations: Array<Range<Decoration>>) {
    let codeblockLanguageClass = "";
    let codeblockLanguageSpecificClass = "";
    let borderColor = "";
    const languageSpecificColors = settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors;
    const languageBorderColors = settings.SelectedTheme.colors[getCurrentMode()].codeblock.languageBorderColors || {};
    const language = parameters.language.length > 0 ? parameters.language : "nolang";

    codeblockLanguageClass = "codeblock-customizer-language-" + language.toLowerCase();
    codeblockLanguageSpecificClass = getLanguageSpecificColorClass(language, languageSpecificColors);
    if (parameters.language.length > 0) {      
      borderColor = getBorderColorByLanguage(parameters.language, languageBorderColors);
    }
  
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
  
    const addHighlightClass = (name = '') => {
      const className = `codeblock-customizer-line-highlighted${name ? `-${name.replace(/\s+/g, '-').toLowerCase()}` : ''}`;
      return className;
    };
  
    const highlightLine = (words: string, name = '') => {
      const caseInsensitiveWords = words.toLowerCase().split(',');
      for (const word of caseInsensitiveWords) {
        const retVal = setClass(line, decorations, caseInsensitiveLineText, word, lineClass, name.replace(/\s+/g, '-').toLowerCase());
        lineClass = retVal !== '' ? retVal : lineClass;
      }
      return lineClass;
    };
  
    if (startLine || endLine) 
      return lineClass;
  
    // highlight line by line number hl:1,3-5
    if (parameters.linesToHighlight.lines.includes(lineNumber)) {
      lineClass = addHighlightClass();
    } 
  
    // highlight specific lines if they contain a word hl:1|test,3-5|test
    const lineSpecificWords = parameters.linesToHighlight.lineSpecificWords;
    if (lineNumber in lineSpecificWords) {
      lineClass = highlightLine(lineSpecificWords[lineNumber]);
    }
  
    // highlight every line which contains a specific word hl:test
    const words = parameters.linesToHighlight.words;
    if (words.length > 0) {
      const substringsArray = words.split(',');
      substringsArray.forEach(substring => {
        lineClass = highlightLine(substring);
      });
    }
  
    // highlight line by line number imp:1,3-5
    const alternativeLinesToHighlight = parameters.alternativeLinesToHighlight.lines;
    const altHLMatch = alternativeLinesToHighlight.find(hl => hl.lineNumber === lineNumber);
    if (altHLMatch) {
      lineClass = addHighlightClass(altHLMatch.name);
    }
  
    // highlight specific lines if they contain a word imp:1|test,3-5|test
    const altLineSpecificWords = parameters.alternativeLinesToHighlight.lineSpecificWords;
    const altLineSpecificWord = altLineSpecificWords.find(item => item.lineNumber === lineNumber);
    if (altLineSpecificWord) {
      const { extractedValues } = getValueNameByLineNumber(lineNumber, altLineSpecificWords);
      extractedValues.forEach(({ value, name }) => {
        lineClass = highlightLine(value ?? '', name);
      });
    }
  
    // highlight every line which contains a specific word imp:test
    const altWords = parameters.alternativeLinesToHighlight.words;
    if (!startLine && !endLine) {
      for (const entry of altWords) {
        const { name, words } = entry;
        if (words.length > 0) {
          lineClass = highlightLine(words, name);
        }
      }
    }
  
    return lineClass;
  }// highlightLinesOrWords

  function setClass(line: Line, decorations: Array<Range<Decoration>>, caseInsensitiveLineText: string, word: string, lineClass: string, customClass = '') {
    const occurrences = findAllOccurrences(caseInsensitiveLineText, word);
  
    if (settings.SelectedTheme.settings.codeblock.textHighlight) {
      occurrences.forEach((index) => {
        const classToUse = customClass ? `codeblock-customizer-highlighted-text-${customClass}` : 'codeblock-customizer-highlighted-text';
        decorations.push(Decoration.mark({ class: classToUse }).range(line.from + index, line.from + index + word.length));
      });
      lineClass = ``;
    } else if (occurrences.length > 0) {
      lineClass = customClass ? `codeblock-customizer-line-highlighted-${customClass}` : 'codeblock-customizer-line-highlighted';
    }
  
    return lineClass;
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
    const fadeOutStart = state.doc.line(state.doc.lineAt(codeBlockStartPos).number + visibleLines + 1);
    const fadeOutEnd = state.doc.line(state.doc.lineAt(fadeOutStart.from).number + fadeOutLineCount - 1);
  
    const replaceStart = state.doc.line(state.doc.lineAt(fadeOutEnd.from).number + 1);
    const replaceEnd = state.doc.line(state.doc.lineAt(codeBlockEndPos).number);
  
    return { replaceStart, replaceEnd, fadeOutStart, fadeOutEnd, };
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
    processCodeBlocks(view.state.doc, (start, end, lineText, isDefaultFold, isDefaultUnFold) => {
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
  
          view.dispatch({ effects: UnCollapse.of({filter: (from: number, to: number) => to <= start.from || from >= end.to, filterFrom: start.from, filterTo: end.to} )});
          view.requestMeasure();
        }
      }
    });
  }// foldAll

  function clearFadeEffect(view: EditorView, CollapseStart: number, CollapseEnd: number) { // needs to be re-checked
    const hasFadeEffect = hasHeaderEffect(view, CollapseStart, CollapseEnd);
    if (hasFadeEffect) {
      view.dispatch({ effects: semiUnFade.of({filter: (from: number, to: number) => to <= CollapseStart || from >= CollapseEnd, filterFrom: CollapseStart, filterTo: CollapseEnd} )});

      view.requestMeasure();
    }
  }// clearFadeEffect

  return [codeBlockPositions, decorations, collapseField];
}// extensions

let settings: CodeblockCustomizerSettings;
export const customBracketMatching = bracketMatching({ // toggle through reconfigure?
  renderMatch: (match, state) => {
    const decorations: Range<Decoration>[] = [];
    
    if (!match.matched) {
      // @ts-ignore
      if (customBracketMatching.settings.SelectedTheme.settings.codeblock.highlightNonMatchingBrackets) {
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

const matchHighlightOptions = { maxMatches: 750, wholeWords: true };
export const selectionMatching = highlightSelectionMatches(matchHighlightOptions);