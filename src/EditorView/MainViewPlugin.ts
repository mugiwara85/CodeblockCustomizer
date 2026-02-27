import { editorEditorField, editorInfoField } from "obsidian";

import { EditorState, Transaction, Range, RangeSet, Line } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { StateField } from "@codemirror/state";

import { CodeblockCustomizerSettings } from "../Settings";
import CodeBlockCustomizerPlugin from "../main";
import { CBCParameters, HighlightedWord } from "../Parsing";
import { PromptLineRenderResult, PromptManager } from "../PromptManager";
import { getBorderColorByLanguage, getCurrentMode, isSourceMode, getLanguageSpecificColorClass, findAllOccurrences, getPropertyFromLanguageSpecificColors, filterOccurrences } from "../Utils";
import { ANNOTATION_PATTERN, DEFAULT_TEXT_SEPARATOR } from "../Const";
import { CodeBlockPositions, getVisibleCodeBlocks } from "./CodeBlockPositions";
import { HiddenLinesWidget } from "./HideLines";
import { FoldingState, FoldCommand, setFoldState, UnCollapse, semiUnCollapse, unhideEffect } from "./EditorEffects";

export function mainViewPluginExtension(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings, codeBlockPositionsField: StateField<CodeBlockPositions[]>, collapseField: StateField<RangeSet<Decoration>>, foldCommandField: StateField<FoldCommand>,
  hiddenLinesUnhiddenField: StateField<Set<number>>, getHiddenRanges: (state: EditorState, parameters: CBCParameters, codeBlockStartPos: number, codeBlockEndPos: number) => { startLine: number, endLine: number, lineCount: number, from: number, to: number }[],
  getUpdateValue: () => (newValue: boolean) => void, getResetFoldDecos: () => (newValue: boolean) => void, getSettingsUpdated: () => boolean) {

  const liveUpdateExtension = () => {
    return EditorView.updateListener.of((update) => {
      if (!update.docChanged) {
        return;
      }

      const fileName = update.view.state.field(editorInfoField, false)?.file;
      if (!fileName) {
        return;
      }

      const codeBlockPositions = update.startState.field(codeBlockPositionsField, false);
      if (!codeBlockPositions) {
        return;
      }

      const linesToUpdate = new Map<number, string>();

      update.changes.iterChanges((fromA) => {
        const changedLineNumber = update.startState.doc.lineAt(fromA).number;

        for (const block of codeBlockPositions) {
          const firstLineNumber = update.startState.doc.lineAt(block.codeBlockStartPos).number;

          if (changedLineNumber === firstLineNumber) {
            const zeroBasedLineNumber = firstLineNumber - 1;
            const newLineContent = update.state.doc.line(firstLineNumber).text;
            linesToUpdate.set(zeroBasedLineNumber, newLineContent);
          }
        }
      });

      if (linesToUpdate.size > 0) {
        for (const [lineStart, lineContent] of linesToUpdate.entries()) {
          const key = `${fileName.path}|${lineStart}`;
          plugin.modifiedBlocks.set(key, lineContent); // switch from edit to reading

          plugin.rerenderCodeblock(fileName, lineStart, lineContent); // paralell open
        }
      }
    });
  };// liveUpdateExtension

  const forceRefreshListener = EditorView.updateListener.of((update) => {
    if (update.docChanged || update.transactions.some(tr => tr.isUserEvent("codeblock-customizer.refresh"))) {
      return;
    }

    const foldChanged = update.startState.field(collapseField, false) !== update.state.field(collapseField, false);
    const unhiddenChanged = update.startState.field(hiddenLinesUnhiddenField, false) !== update.state.field(hiddenLinesUnhiddenField, false);
    const commandChanged = update.startState.field(foldCommandField, false) !== update.state.field(foldCommandField, false);
    if (!foldChanged && !unhiddenChanged && !commandChanged) {
      return;
    }

    const codeBlockPositions = update.state.field(codeBlockPositionsField, false);
    if (!codeBlockPositions) {
      return;
    }

    const affectedBlocks = new Set<CodeBlockPositions>();

    if (commandChanged && update.state.field(foldCommandField, false) === FoldCommand.UnfoldAll) {
      codeBlockPositions.forEach(
        block => affectedBlocks.add(block)
      );
    }

    for (const tr of update.transactions) {
      const foldStateAnnotation = tr.annotation(setFoldState);
      if (foldStateAnnotation?.state === FoldingState.Unfolded) {
        const block = codeBlockPositions.find(p => p.codeBlockStartPos === foldStateAnnotation.startPos);
        if (block) {
          affectedBlocks.add(block);
        }
      }

      for (const effect of tr.effects) {
        if (effect.is(unhideEffect)) {
          const block = codeBlockPositions.find(p => effect.value.from >= p.codeBlockStartPos && effect.value.to <= p.codeBlockEndPos);
          if (block) {
            affectedBlocks.add(block);
          }
        } else if (effect.is(UnCollapse) || effect.is(semiUnCollapse)) {
          const { filterFrom, filterTo } = effect.value;
          const block = codeBlockPositions.find(p => filterFrom >= p.codeBlockStartPos && filterTo <= p.codeBlockEndPos);
          if (block) {
            affectedBlocks.add(block);
          }
        }
      }
    }

    if (affectedBlocks.size === 0) {
      return;
    }

    for (const affectedBlock of affectedBlocks) {
      requestAnimationFrame(() => {
        let needsFix = false;

        for (const { from, to } of update.view.visibleRanges) {
          if (from > affectedBlock.codeBlockEndPos || to < affectedBlock.codeBlockStartPos) {
            continue;
          }

          const checkStart = Math.max(from, affectedBlock.codeBlockStartPos);
          const checkEnd = Math.min(to, affectedBlock.codeBlockEndPos);
          const startLineNr = update.state.doc.lineAt(checkStart).number;
          const endLineNr = update.state.doc.lineAt(checkEnd).number;

          for (let i = startLineNr; i <= endLineNr; i++) {
            const pos = update.state.doc.line(i).from;
            const lineDom = update.view.domAtPos(pos);

            if (lineDom?.node) {
              const el = lineDom.node instanceof HTMLElement ? lineDom.node : lineDom.node.parentElement;
              if (el && !el.closest('.cm-line')?.classList.contains('HyperMD-codeblock')) {
                needsFix = true;
                break;
              }
            }
          }
          if (needsFix) {
            break;
          }
        }

        if (needsFix) {
          update.view.dispatch({
            changes: { from: affectedBlock.codeBlockEndPos, to: affectedBlock.codeBlockEndPos, insert: " " },
            annotations: [
              Transaction.addToHistory.of(false),
              Transaction.userEvent.of("codeblock-customizer.refresh")
            ]
          });

          update.view.dispatch({
            changes: { from: affectedBlock.codeBlockEndPos, to: affectedBlock.codeBlockEndPos + 1, insert: "" },
            annotations: [
              Transaction.addToHistory.of(false),
              Transaction.userEvent.of("codeblock-customizer.refresh")
            ]
          });
        }
      });
    }
  });// forceRefreshListener

  const viewPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    lastVisibleBlockStarts: Set<number> = new Set();

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      const unhiddenChanged = update.startState.field(hiddenLinesUnhiddenField, false) !== update.state.field(hiddenLinesUnhiddenField, false);
      const codeBlocksChanged = update.startState.field(codeBlockPositionsField) !== update.state.field(codeBlockPositionsField)

      // full rebuild only when document changed, codeblocks changed, settings were modified, or ranges were unhidde
      if (update.docChanged || codeBlocksChanged || getSettingsUpdated() || unhiddenChanged) {
        this.decorations = this.buildDecorations(update.view);
        return;
      }

      // only viewport changed ==> keep existing decorations, and add decos for new blocks only
      if (update.viewportChanged) {
        this.decorations = this.extendDecorations(update.view);
      }
    }

    extendDecorations(view: EditorView): DecorationSet {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(view.state))
        return Decoration.none;

      const positions = view.state.field(codeBlockPositionsField, false) ?? [];
      const visibleBlocks = getVisibleCodeBlocks(positions, view.visibleRanges);

      const newBlocks = visibleBlocks.filter(b => !this.lastVisibleBlockStarts.has(b.codeBlockStartPos));
      this.lastVisibleBlockStarts = new Set(visibleBlocks.map(b => b.codeBlockStartPos));

      if (newBlocks.length === 0) {
        return this.decorations;
      }

      const newDecorations = this.buildDecorationsForBlocks(view, newBlocks);
      return this.decorations.update({ add: newDecorations, sort: true });
    }// extendDecorations

    buildDecorations(view: EditorView): DecorationSet {
      getUpdateValue()(false);
      getResetFoldDecos()(false);
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(view.state))
        return Decoration.none;

      const positions = view.state.field(codeBlockPositionsField, false) ?? [];
      const visibleBlocks = getVisibleCodeBlocks(positions, view.visibleRanges);

      this.lastVisibleBlockStarts = new Set(visibleBlocks.map(b => b.codeBlockStartPos));

      const decorations = this.buildDecorationsForBlocks(view, visibleBlocks);
      return RangeSet.of(decorations, true);
    }// buildDecorations

    buildDecorationsForBlocks(view: EditorView, blocks: CodeBlockPositions[]): Array<Range<Decoration>> {
      const defaultCharWidth = view.state.field(editorEditorField).defaultCharacterWidth;
      const decorations: Array<Range<Decoration>> = [];

      for (const { codeBlockStartPos, codeBlockEndPos, parameters } of blocks) {
        const firstCodeBlockLine = view.state.doc.lineAt(codeBlockStartPos).number;
        const lastCodeBlockLine = view.state.doc.lineAt(codeBlockEndPos).number;

        if (parameters.exclude)
          continue;

        let lineNumber = parameters.lineNumberOffset;
        const rawLineCount = lastCodeBlockLine - firstCodeBlockLine - 1;
        const gutterStyle = getGutterStyle(parameters, rawLineCount, defaultCharWidth);
        const prompt = new PromptManager(parameters, rawLineCount, settings);
        const hiddenRanges = getHiddenRanges(view.state, parameters, codeBlockStartPos, codeBlockEndPos);
        const jumps = (parameters.lineNumberJumps || []).filter(j => j.lineNumber > parameters.lineNumberOffset);
        let jumpIdx = 0;
        let previousLineEndPos: number | null = null;
        let previousLineStartPos: number | null = null;

        for (let line = firstCodeBlockLine; line <= lastCodeBlockLine; line++) {
          const startLine = line === firstCodeBlockLine;
          const endLine = line === lastCodeBlockLine;
          const currentLine = view.state.doc.line(line);
          const lineStartPos = currentLine.from;
          let promptRenderResult: PromptLineRenderResult = { styledParts: [], output: [], matchedLength: 0, lineClassName: null, isRoot: false };

          // line number jumps
          if (!startLine && !endLine) {
            lineNumber++;

            if (jumps && jumpIdx < jumps.length && lineNumber === jumps[jumpIdx].lineNumber) {
              lineNumber = jumps[jumpIdx].newStartNumber;
              jumpIdx++;

              if (previousLineEndPos !== null && previousLineStartPos !== null && line > firstCodeBlockLine + 1) {
                decorations.push(Decoration.widget({ widget: new LineSeparatorWidget(), side: 1 }).range(previousLineEndPos));
                decorations.push(Decoration.line({ attributes: { class: "codeblock-customizer-line-with-jump" } }).range(previousLineStartPos));
              }
            }
          }

          const isPromptLine = !startLine && !endLine && (parameters.parsePromptId || prompt.promptLines.has(lineNumber));
          if (isPromptLine) {
            promptRenderResult = prompt.renderLine(currentLine.text, lineNumber);
          }

          // lines
          let lineClass = getLineClass(parameters, lineNumber, startLine, endLine, currentLine, decorations);
          if (promptRenderResult.lineClassName) {
            lineClass += ` ${promptRenderResult.lineClassName}`;
          }
          if (promptRenderResult.isRoot) {
            lineClass += ` is-root`;
          }
          decorations.push(Decoration.line({ attributes: { class: lineClass, style: gutterStyle } }).range(lineStartPos));

          previousLineEndPos = currentLine.to;
          previousLineStartPos = lineStartPos;

          let spanClass = "";
          if (startLine) {
            spanClass = `codeblock-customizer-line-number-first`;
          }

          if (endLine) {
            spanClass = `codeblock-customizer-line-number-last`;
          }

          // line number
          if (settings.pluginSettings.codeblock.enableLineNumbers || parameters.isSpecificNumber || parameters.showNumbers === "specific") {
            const number = (startLine || endLine) ? " " : lineNumber.toString();
            decorations.push(Decoration.widget({ widget: new LineNumberWidget(number, parameters, spanClass), }).range(lineStartPos));
          }

          // prompt
          if (parameters.parsePromptId) {
            if (promptRenderResult.matchedLength > 0) {
              for (const part of promptRenderResult.styledParts) {
                const from = lineStartPos + part.from;
                const to = lineStartPos + part.to;
                if (from < to) {
                  decorations.push(Decoration.mark({ class: part.className }).range(from, to));
                }
              }
            }
          } else {
            if (prompt.promptLines.has(lineNumber) && !startLine && !endLine) {
              const promptPart = promptRenderResult.styledParts[0];

              if (promptPart?.node && promptPart.key) {
                decorations.push(Decoration.widget({ widget: new NodeWidget(promptPart.node, promptPart.key) }).range(lineStartPos));
              }

              if (promptRenderResult.output.length > 0) {
                for (const out of promptRenderResult.output) {
                  decorations.push(Decoration.widget({ widget: new LineWidget(out.text, out.className), side: 1 }).range(currentLine.to));
                }
              }
            }
          }

          // indentation
          if (parameters.indentLevel > 0) {
            if (currentLine.text.length > parameters.indentCharacter) {
              decorations.push(Decoration.replace({}).range(lineStartPos, lineStartPos + parameters.indentCharacter));
            }
            decorations.push(Decoration.line({ attributes: { "style": `--level:${parameters.indentLevel}`, class: `indented-line` } }).range(lineStartPos));
          }

          // hidden lines
          if (!startLine && !endLine && hiddenRanges.length > 0) {
            for (const range of hiddenRanges) {
              if (range.startLine === firstCodeBlockLine + 1 && line === range.endLine + 1) {
                // hidden range starts at first content line ==> insert widget at start of the first visible line after
                const fenceLine = view.state.doc.line(firstCodeBlockLine);
                decorations.push(Decoration.widget({ widget: new HiddenLinesWidget(range.lineCount, range.from, range.to, parameters.showNumbers === "specific"), side: -1 }).range(fenceLine.to));
                decorations.push(Decoration.line({ attributes: { class: "has-hidden-lines" } }).range(fenceLine.from));
              } else if (line === range.startLine - 1) {
                // normal case ==> insert widget at the end of the line before the hidden range
                decorations.push(Decoration.widget({ widget: new HiddenLinesWidget(range.lineCount, range.from, range.to, parameters.showNumbers === "specific"), side: 1 }).range(currentLine.to));
                decorations.push(Decoration.line({ attributes: { class: "has-hidden-lines" } }).range(previousLineStartPos));
              }
            }
          }
          //lineNumber++;
        }
      }
      return decorations;
    }
  }, {
    decorations: v => v.decorations
  });// viewPlugin

  /* Widgets */

  class LineNumberWidget extends WidgetType {
    lineNumber: string;
    parameters: CBCParameters
    spanClass: string;

    constructor(lineNumber: string, parameters: CBCParameters, spanClass: string) {
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
      container.classList.add("cbc-line-num");
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

      const lineNumber = createSpan({ cls: `codeblock-customizer-line-number-element`, text: `${this.lineNumber}` });
      container.appendChild(lineNumber);

      return container;
    }

    updateDOM(dom: HTMLElement, view: EditorView) {
      view.requestMeasure();
      return false;
    }

  }// LineNumberWidget

  class NodeWidget extends WidgetType {
    constructor(private readonly node: HTMLElement, private readonly key: string) {
      super();
    }

    eq(other: NodeWidget): boolean {
      return this.key === other.key;
    }

    toDOM(): HTMLElement {
      return this.node;
    }
  }// NodeWidget

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

  class LineSeparatorWidget extends WidgetType {
    constructor() {
      super();
    }

    eq(other: LineSeparatorWidget) {
      return true;
    }

    toDOM(): HTMLElement {
      const container = createSpan({ cls: `codeblock-customizer-line-separator` });
      const gutter = createSpan({ cls: `codeblock-customizer-line-separator-gutter`, text: `...` });
      const content = createSpan({ cls: `codeblock-customizer-line-separator-content` });

      container.appendChild(gutter);
      container.appendChild(content);

      return container;
    }
  }// LineSeparatorWidget

  /* functions */

  function getGutterStyle(parameters: CBCParameters, rawLineCount: number, defaultCharWidth: number) {
    const maxLineNumber = getMaxLineNumber(parameters, rawLineCount);
    const digits = maxLineNumber.toString().length;
    const gutterPadding = Math.round(digits * defaultCharWidth) + 16; // padding-left + padding-right
    const gutterStyle = parameters.isSpecificNumber ? digits > 3 ? `--gutter-width:calc(${digits}ch + 16px); --gutter-padding:${gutterPadding}px` : `` : ``; // number must be at least 3 digits, otherwise the padding is too little and causes a shift to left in text

    return gutterStyle;
  }// getGutterStyle

  function getMaxLineNumber(parameters: CBCParameters, rawLineCount: number) {
    let calculatedMax = parameters.lineNumberOffset;
    let currentCalc = parameters.lineNumberOffset;
    let remainingLines = rawLineCount;

    if (parameters.lineNumberJumps && parameters.lineNumberJumps.length > 0) {
      for (const jump of parameters.lineNumberJumps) {
        if (remainingLines <= 0) {
          break;
        }

        const dist = jump.lineNumber - currentCalc;
        if (dist > 0) {
          if (remainingLines >= dist) {
            remainingLines -= dist;

            const peakBeforeJump = jump.lineNumber - 1;
            if (peakBeforeJump > calculatedMax) {
              calculatedMax = peakBeforeJump;
            }

            currentCalc = jump.newStartNumber;
            if (currentCalc > calculatedMax) {
              calculatedMax = currentCalc;
            }
          } else {
            currentCalc += remainingLines;
            if (currentCalc > calculatedMax) {
              calculatedMax = currentCalc;
            }
            remainingLines = 0;
          }
        }
      }
    }

    if (remainingLines > 0) {
      currentCalc += remainingLines;
      if (currentCalc > calculatedMax) {
        calculatedMax = currentCalc;
      }
    }

    return calculatedMax;
  }// getMaxLineNumber

  function getLineClass(parameters: CBCParameters, lineNumber: number, startLine: boolean, endLine: boolean, line: Line, decorations: Array<Range<Decoration>>) {
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
    lineClass = highlightLinesOrWords(lineNumber, startLine, endLine, parameters, line, decorations, lineClass);
    lineClass = lineClass + " " + codeblockLanguageClass + " " + codeblockLanguageSpecificClass;

    if (borderColor.length > 0)
      lineClass = lineClass + " hasLangBorderColor";

    return lineClass;
  }// getLineClass

  function highlightLinesOrWords(lineNumber: number, startLine: boolean, endLine: boolean, parameters: CBCParameters, line: Line, decorations: Array<Range<Decoration>>, lineClass: string) {
    const caseInsensitiveLineText = (line.text ?? '').toLowerCase();
    const textSeparator = parameters.textSeparator || settings.pluginSettings.textHighlight.textSeparator || DEFAULT_TEXT_SEPARATOR;

    const addHighlightClass = (name = '') => {
      const className = `codeblock-customizer-line-highlighted${name ? `-${name.replace(/\s+/g, '-').toLowerCase()}` : ''}`;
      return className;
    };

    const highlighText = (words: HighlightedWord[], name = '') => {
      for (const highlightedWord of words) {
        const word = highlightedWord.text.toLowerCase();
        setClass(line, decorations, caseInsensitiveLineText, word, textSeparator, name.replace(/\s+/g, '-').toLowerCase(), highlightedWord.occurrences);
      }
    };

    if (startLine || endLine)
      return lineClass;

    // highlight line by line number hl:1,3-5
    if (parameters.defaultLinesToHighlight.lineNumbers.includes(lineNumber)) {
      lineClass = addHighlightClass();
    }

    // highlight every line which contains a specific word hl:test
    const words = parameters.defaultLinesToHighlight.words;
    if (words.length > 0 && words.some(word => caseInsensitiveLineText.includes(word))) {
      lineClass = addHighlightClass();
    }

    // highlight specific lines if they contain the specified word hl:1|test,3-5|test
    const lineSpecificWords = parameters.defaultLinesToHighlight.lineSpecificWords;
    if (lineSpecificWords.length > 0) {
      lineSpecificWords.forEach(lsWord => {
        if (lsWord.lineNumber === lineNumber && lsWord.words.some(word => caseInsensitiveLineText.includes(word))) {
          lineClass = addHighlightClass();
        }
      });
    }

    // highlight text in every line if linetext contains the specified word hlt:test
    const defaultWords = parameters.defaultTextToHighlight.words;
    if (defaultWords.length > 0) {
      highlighText(defaultWords);
    }

    // highlight text in specific lines if linetext contains the specified word hlt:1|test,3-5|test
    const defaultLineSpecificWords = parameters.defaultTextToHighlight.lineSpecificWords;
    const lineSpecificWord = defaultLineSpecificWords.filter(item => item.lineNumber === lineNumber);
    if (lineSpecificWord.length > 0) {
      lineSpecificWord.forEach(rule => {
        highlighText(rule.words);
      });
    }

    // highlight text with specific text between markers hlt:start:end
    const textBetween = parameters.defaultTextToHighlight.textBetween;
    for (const { from, to, occurrences } of textBetween) {
      if (caseInsensitiveLineText.includes(from.toLowerCase()) && caseInsensitiveLineText.includes(to.toLowerCase())) {
        const highlightText = `${from}${textSeparator}${to}`;
        const word: HighlightedWord = { text: highlightText, occurrences: occurrences };
        highlighText([word]);
      }
    }

    // highlight text within specific lines with text between markers hl:5|start:end, hlt:5-7|start:end
    const lineSpecificTextBetween = parameters.defaultTextToHighlight.lineSpecificTextBetween;
    const specificTextBetween = lineSpecificTextBetween.filter(item => item.lineNumber === lineNumber);
    if (specificTextBetween.length > 0) {
      specificTextBetween.forEach(rule => {
        if (caseInsensitiveLineText.includes(rule.from.toLowerCase()) && caseInsensitiveLineText.includes(rule.to.toLowerCase())) {
          const highlightText = `${rule.from}${textSeparator}${rule.to}`;
          const word: HighlightedWord = { text: highlightText, occurrences: rule.occurrences };
          highlighText([word]);
        }
      });
    }

    // highlight all words in specified line hlt:1,3-5
    if (parameters.defaultTextToHighlight.allWordsInLine.includes(lineNumber)) {
      setClass(line, decorations, caseInsensitiveLineText, '', textSeparator, '');
    }

    // highlight line by line number imp:1,3-5
    const alternativeLinesToHighlight = parameters.alternativeLinesToHighlight.lines;
    const altHLMatch = alternativeLinesToHighlight.filter(hl => hl.lineNumbers.includes(lineNumber));
    if (altHLMatch.length > 0) {
      altHLMatch.forEach(match => {
        lineClass = addHighlightClass(match.colorName);
      });
    }

    // highlight every line which contains a specific word imp:test
    const altwords = parameters.alternativeLinesToHighlight.words;
    if (altwords.length > 0 && altwords.some(altword => altword.words.some(word => caseInsensitiveLineText.includes(word.toLowerCase())))) {
      altwords.forEach(altword => {
        if (altword.words.some(word => caseInsensitiveLineText.includes(word.toLowerCase()))) {
          lineClass = addHighlightClass(altword.colorName);
        }
      });
    }

    // highlight specific lines if they contain the specified word imp:1|test,3-5|test
    const altLineSpecificWords = parameters.alternativeLinesToHighlight.lineSpecificWords;
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
    const altTextSpecificWords = parameters.alternativeTextToHighlight.lineSpecificWords;
    const altLineSpecificWord = altTextSpecificWords.filter(item => item.lineNumber === lineNumber);
    if (altLineSpecificWord.length > 0) {
      altLineSpecificWord.forEach(rule => {
        const { colorName, words } = rule;
        highlighText(words, colorName);
      });
    }

    // highlight text with specific text between markers impt:start:end
    const altTextBetween = parameters.alternativeTextToHighlight.textBetween;
    for (const { from, to, colorName, occurrences } of altTextBetween) {
      if (caseInsensitiveLineText.includes(from.toLowerCase()) && caseInsensitiveLineText.includes(to.toLowerCase())) {
        const highlightText = `${from}${textSeparator}${to}`;
        const word: HighlightedWord = { text: highlightText, occurrences: occurrences };
        highlighText([word], colorName);
      }
    }

    // highlight text within specific lines with text between markers impt:5|start:end, imp:5-7|start:end
    const altLineSpecificTextBetween = parameters.alternativeTextToHighlight.lineSpecificTextBetween;
    const altSpecificTextBetween = altLineSpecificTextBetween.filter(item => item.lineNumber === lineNumber);
    if (altSpecificTextBetween.length > 0) {
      altSpecificTextBetween.forEach(rule => {
        if (caseInsensitiveLineText.includes(rule.from.toLowerCase()) && caseInsensitiveLineText.includes(rule.to.toLowerCase())) {
          const highlightText = `${rule.from}${textSeparator}${rule.to}`;
          const word: HighlightedWord = { text: highlightText, occurrences: rule.occurrences };
          highlighText([word], rule.colorName);
        }
      });
    }

    // highlight all words in specified line impt:1,3-5
    const altAllWordsInLine = parameters.alternativeTextToHighlight.allWordsInLine;
    const altAllWordsInLineMatch = altAllWordsInLine.find(item => item.allWordsInLine.includes(lineNumber));
    if (altAllWordsInLineMatch) {
      setClass(line, decorations, caseInsensitiveLineText, '', textSeparator, altAllWordsInLineMatch.colorName);
    }

    return lineClass;
  }// highlightLinesOrWords

  function setClass(line: Line, decorations: Array<Range<Decoration>>, caseInsensitiveLineText: string, word: string, textSeparator: string, customClass = '', occurrencesFilter?: number[]) {
    const classToUse = customClass ? `codeblock-customizer-highlighted-text-${customClass}` : 'codeblock-customizer-highlighted-text';

    if (word.includes(textSeparator)) {
      const [start, end] = word.split(textSeparator).map(w => w.trim().toLowerCase());
      const lineTextLength = caseInsensitiveLineText.length;
      const startLength = start.length;
      const endLength = end.length;

      const firstNonWhiteSpaceIndex = caseInsensitiveLineText.match(/\S/)?.index || 0;
      const allMatches: { from: number, to: number }[] = [];

      if (start === '' && end === '') {
        const from = line.from + firstNonWhiteSpaceIndex;
        const to = line.from + lineTextLength;
        if (to > from) {
          allMatches.push({ from, to });
        }
      } else if (start === '') {
        const endIndices = findAllOccurrences(caseInsensitiveLineText, end);
        for (const endIndex of endIndices) {
          const from = line.from + firstNonWhiteSpaceIndex;
          const to = line.from + endIndex + endLength;
          if (to > from) {
            allMatches.push({ from, to });
          }
        }
      } else if (end === '') {
        const startIndices = findAllOccurrences(caseInsensitiveLineText, start);
        for (const startIndex of startIndices) {
          const from = line.from + startIndex;
          const to = line.from + lineTextLength;
          if (to > from) {
            allMatches.push({ from, to });
          }
        }
      } else {
        const startIndices = findAllOccurrences(caseInsensitiveLineText, start);
        for (const startIndex of startIndices) {
          const endIndex = caseInsensitiveLineText.indexOf(end, startIndex + startLength);
          if (endIndex !== -1) {
            const from = line.from + startIndex;
            const to = line.from + endIndex + endLength;
            if (to > from) {
              allMatches.push({ from, to });
            }
          }
        }
      }
      const matchesToHighlight = filterOccurrences(allMatches, occurrencesFilter);
      matchesToHighlight.forEach(match => {
        decorations.push(Decoration.mark({ class: classToUse }).range(match.from, match.to));
      });
    } else if (word === '') {
      const lineText = line.text;
      const startPosInLine = lineText.search(/\S/);
      if (startPosInLine === -1) {
        return;
      }

      let endBoundary = lineText.length;
      const commentMatch = lineText.match(/\s+(\/\/|\/\*|#|--)/);
      if (commentMatch && typeof commentMatch.index === 'number') {
        const commentText = lineText.substring(commentMatch.index);

        if (settings.pluginSettings.annotations.convertAllComments || ANNOTATION_PATTERN.test(commentText)) {
          endBoundary = commentMatch.index;
        }
      }

      const trimmedEndPosInLine = lineText.substring(0, endBoundary).trimEnd().length;
      const startRange = line.from + startPosInLine;
      const endRange = line.from + trimmedEndPosInLine;

      if (endRange > startRange) {
        decorations.push(Decoration.mark({ class: classToUse }).range(startRange, endRange));
      }
    } else {
      const allOccurrences = findAllOccurrences(caseInsensitiveLineText, word);
      const allMatches = allOccurrences.map(index => ({ from: line.from + index, to: line.from + index + word.length }));
      const matchesToHighlight = filterOccurrences(allMatches, occurrencesFilter);
      matchesToHighlight.forEach(match => {
        decorations.push(Decoration.mark({ class: classToUse }).range(match.from, match.to));
      });
    }
  }// setClass

  return { viewPlugin, liveUpdateExtension, forceRefreshListener };
}// mainViewPluginExtension
