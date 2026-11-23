import { editorEditorField, editorInfoField, MarkdownView, TFile } from "obsidian";

import { EditorState, Transaction, Range, RangeSet, Line } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { StateField } from "@codemirror/state";

import { CodeblockCustomizerSettings } from "../Settings";
import CodeBlockCustomizerPlugin from "../main";
import { CBCParameters, HighlightedWord } from "../Parsing";
import { HighlightRules, createHighlightRules } from "../HighlightRules";
import { PromptLineRenderResult, PromptManager } from "../PromptManager";
import { getBorderColorByLanguage, getCurrentMode, isSourceMode, getLanguageSpecificColorClass, findAllOccurrences, getPropertyFromLanguageSpecificColors, filterOccurrences, HighlightMarkRange, layerHighlightRanges } from "../Utils";
import { htmlLineToFenceLine } from "../HtmlCodeBlocks";
import { ANNOTATION_PATTERN, DEFAULT_TEXT_SEPARATOR } from "../Const";
import { CodeBlockPositions, getHtmlCodeBlockRange, getHtmlCodeBlocks, getVisibleCodeBlocks } from "./CodeBlockPositions";
import { HiddenLinesWidget } from "./HideLines";
import { FoldingState, FoldCommand, setFoldState, UnCollapse, semiUnCollapse, unhideEffect } from "./EditorEffects";

export function mainViewPluginExtension(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings, codeBlockPositionsField: StateField<CodeBlockPositions[]>, collapseField: StateField<RangeSet<Decoration>>, foldCommandField: StateField<FoldCommand>,
  hiddenLinesUnhiddenField: StateField<Set<number>>, getHiddenRanges: (state: EditorState, parameters: CBCParameters, codeBlockStartPos: number, codeBlockEndPos: number) => { startLine: number, endLine: number, lineCount: number, from: number, to: number }[]) {

  const INLINE_CODE_PATTERN = /`|<code[\s>]/i;
  const readingViewSyncTimers = new Map<string, number>();

  function scheduleReadingViewSync(view: EditorView, file: TFile) {
    const timer = readingViewSyncTimers.get(file.path);
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }

    readingViewSyncTimers.set(file.path, window.setTimeout(() => {
      readingViewSyncTimers.delete(file.path);
      syncReadingViews(view.state, file);
    }, 250));
  }// scheduleReadingViewSync

  function syncReadingViews(state: EditorState, file: TFile) {
    const editorLines = state.doc.toJSON();

    for (const leaf of plugin.app.workspace.getLeavesOfType('markdown')) {
      const markdownView = leaf.view;
      if (!(markdownView instanceof MarkdownView) || markdownView.file?.path !== file.path || markdownView.getMode() !== 'preview') {
        continue;
      }

      const previewLines = markdownView.previewMode.get().split('\n');
      // lines added or removed ==> wait until the file is saved
      if (previewLines.length !== editorLines.length) {
        continue;
      }

      const changedLines = editorLines.flatMap((line, index) => line !== previewLines[index] ? [index] : []);
      if (changedLines.length > 0 && canUpdateLinesBeforeSave(state, changedLines)) {
        markdownView.previewMode.set(editorLines.join('\n'), false);
      }
    }
  }// syncReadingViews

  function canUpdateLinesBeforeSave(state: EditorState, lineIndexes: number[]): boolean {
    const codeBlockRanges = [
      ...(state.field(codeBlockPositionsField, false) ?? []).map(block => ({ from: block.htmlBlock?.from ?? block.codeBlockStartPos, to: block.htmlBlock?.to ?? block.codeBlockEndPos })),
      ...getHtmlCodeBlocks(state).map(block => getHtmlCodeBlockRange(state, block)),
    ];

    return lineIndexes.every(index => {
      const line = state.doc.line(index + 1);
      return !/^\s*>/.test(line.text) && !codeBlockRanges.some(range => line.from <= range.to && line.to >= range.from);
    });
  }// canUpdateLinesBeforeSave

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
      let inlineCodeChanged = false;

      update.changes.iterChanges((fromA, toA, fromB, toB) => {
        const startChangedLine = update.startState.doc.lineAt(fromA).number;
        const endChangedLine = update.startState.doc.lineAt(toA).number;

        if (!inlineCodeChanged) {
          const oldText = update.startState.doc.sliceString(update.startState.doc.lineAt(fromA).from, update.startState.doc.lineAt(toA).to);
          const newText = update.state.doc.sliceString(update.state.doc.lineAt(fromB).from, update.state.doc.lineAt(toB).to);
          inlineCodeChanged = INLINE_CODE_PATTERN.test(oldText) || INLINE_CODE_PATTERN.test(newText);
        }

        for (const block of codeBlockPositions) {
          const firstLineNumber = update.startState.doc.lineAt(block.codeBlockStartPos).number;

          if (firstLineNumber >= startChangedLine && firstLineNumber <= endChangedLine) {
            const zeroBasedLineNumber = firstLineNumber - 1;
            const rawLine = update.state.doc.line(firstLineNumber).text;
            const newLineContent = block.htmlBlock ? (htmlLineToFenceLine(rawLine) ?? rawLine) : rawLine;
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

      if (inlineCodeChanged) {
        scheduleReadingViewSync(update.view, fileName);
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

    const unfoldedRanges: { from: number; to: number; blockEndPos: number }[] = [];

    if (commandChanged && update.state.field(foldCommandField, false) === FoldCommand.UnfoldAll) {
      codeBlockPositions.forEach(block =>
        unfoldedRanges.push({ from: block.codeBlockStartPos, to: block.codeBlockEndPos, blockEndPos: block.codeBlockEndPos })
      );
    }

    for (const tr of update.transactions) {
      const foldStateAnnotation = tr.annotation(setFoldState);
      if (foldStateAnnotation?.state === FoldingState.Unfolded) {
        const block = codeBlockPositions.find(p => p.codeBlockStartPos === foldStateAnnotation.startPos);
        if (block) {
          unfoldedRanges.push({ from: block.codeBlockStartPos, to: block.codeBlockEndPos, blockEndPos: block.codeBlockEndPos });
        }
      }

      for (const effect of tr.effects) {
        if (effect.is(unhideEffect)) {
          const block = codeBlockPositions.find(p => effect.value.from >= p.codeBlockStartPos && effect.value.to <= p.codeBlockEndPos);
          if (block) {
            unfoldedRanges.push({ from: effect.value.from, to: effect.value.to, blockEndPos: block.codeBlockEndPos });
          }
        } else if (effect.is(UnCollapse) || effect.is(semiUnCollapse)) {
          const { filterFrom, filterTo } = effect.value;
          const block = codeBlockPositions.find(p => filterFrom >= (p.htmlBlock?.from ?? p.codeBlockStartPos) && filterTo <= (p.htmlBlock?.to ?? p.codeBlockEndPos));
          if (block) {
            unfoldedRanges.push({ from: filterFrom, to: filterTo, blockEndPos: block.codeBlockEndPos });
          }
        }
      }
    }

    if (unfoldedRanges.length === 0) {
      return;
    }

    window.requestAnimationFrame(() => {
      const blockEndPositions = new Set<number>();

      for (const range of unfoldedRanges) {
        if (blockEndPositions.has(range.blockEndPos)) {
          continue;
        }

        for (const { from: visFrom, to: visTo } of update.view.visibleRanges) {
          if (visFrom > range.to || visTo < range.from) {
            continue;
          }

          const checkStart = Math.max(visFrom, range.from);
          const checkEnd = Math.min(visTo, range.to);
          const startLineNr = update.state.doc.lineAt(checkStart).number;
          const endLineNr = update.state.doc.lineAt(checkEnd).number;

          let needsFix = false;
          for (let i = startLineNr; i <= endLineNr; i++) {
            const pos = update.state.doc.line(i).from;
            const lineDom = update.view.domAtPos(pos);
            if (lineDom?.node) {
              const el = lineDom.node.instanceOf(HTMLElement) ? lineDom.node : lineDom.node.parentElement;
              if (el && !el.closest('.cm-line')?.classList.contains('HyperMD-codeblock')) {
                needsFix = true;
                break;
              }
            }
          }
          if (needsFix) {
            blockEndPositions.add(range.blockEndPos);
            break;
          }
        }
      }

      if (blockEndPositions.size === 0) {
        return;
      }

      const sorted = [...blockEndPositions].sort((a, b) => a - b);

      update.view.dispatch({
        changes: sorted.map(pos => ({ from: pos, to: pos, insert: " " })),
        annotations: [
          Transaction.addToHistory.of(false),
          Transaction.userEvent.of("codeblock-customizer.refresh")
        ]
      });

      update.view.dispatch({
        changes: sorted.map((pos, idx) => ({ from: pos + idx, to: pos + idx + 1, insert: "" })),
        annotations: [
          Transaction.addToHistory.of(false),
          Transaction.userEvent.of("codeblock-customizer.refresh")
        ]
      });
    });
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

      // full rebuild only when document changed, codeblocks changed, settings were modified, or ranges were unhidden
      if (update.docChanged || codeBlocksChanged || plugin.settingsUpdated || unhiddenChanged) {
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

      if (newBlocks.length === 0) {
        return this.decorations;
      }

      newBlocks.forEach(b => this.lastVisibleBlockStarts.add(b.codeBlockStartPos));

      const newDecorations = this.buildDecorationsForBlocks(view, newBlocks);
      return this.decorations.update({ add: newDecorations, sort: true });
    }// extendDecorations

    buildDecorations(view: EditorView): DecorationSet {
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

      for (const { codeBlockStartPos, codeBlockEndPos, parameters, htmlBlock } of blocks) {
        const firstCodeBlockLine = view.state.doc.lineAt(codeBlockStartPos).number;
        const lastCodeBlockLine = view.state.doc.lineAt(codeBlockEndPos).number;

        if (parameters.exclude)
          continue;

        const firstLineText = view.state.doc.line(firstCodeBlockLine).text;
        const lastLineText = view.state.doc.line(lastCodeBlockLine).text;
        const openTagMatch = htmlBlock ? firstLineText.match(/<code(?=[\s>])[^>]*>/i) : null;
        const htmlCodeStartCol = openTagMatch && openTagMatch.index !== undefined ? openTagMatch.index + openTagMatch[0].length : 0;
        const htmlStartHasCode = Boolean(htmlBlock && openTagMatch && htmlCodeStartCol < firstLineText.length);
        const closeTagIdx = htmlBlock ? lastLineText.toLowerCase().lastIndexOf('</code>') : -1;
        const htmlEndHasCode = Boolean(htmlBlock && closeTagIdx > 0);

        let lineNumber = parameters.lineNumberOffset;
        const rawLineCount = (lastCodeBlockLine - firstCodeBlockLine - 1) + (htmlStartHasCode ? 1 : 0) + (htmlEndHasCode ? 1 : 0);
        const gutterStyle = getGutterStyle(parameters, rawLineCount, defaultCharWidth);
        const prompt = new PromptManager(parameters, rawLineCount, settings);
        const hiddenRanges = getHiddenRanges(view.state, parameters, codeBlockStartPos, codeBlockEndPos);
        const highlightRules = createHighlightRules(parameters);
        const jumps = (parameters.lineNumberJumps || []).filter(j => j.lineNumber > parameters.lineNumberOffset);
        let jumpIdx = 0;
        let previousLineEndPos: number | null = null;
        let previousLineStartPos: number | null = null;
        const blockFirstLine = htmlBlock ? view.state.doc.lineAt(htmlBlock.from).number : firstCodeBlockLine;
        const blockLastLine = htmlBlock ? view.state.doc.lineAt(htmlBlock.to).number : lastCodeBlockLine;

        for (let line = firstCodeBlockLine; line <= lastCodeBlockLine; line++) {
          const isOpenLine = line === firstCodeBlockLine;
          const isCloseLine = line === lastCodeBlockLine;
          const startLine = isOpenLine && !htmlStartHasCode;
          const endLine = isCloseLine && !htmlEndHasCode;
          const currentLine = view.state.doc.line(line);
          const lineStartPos = currentLine.from;
          const codeSliceStart = (isOpenLine && htmlStartHasCode) ? htmlCodeStartCol : 0;
          const codeSliceEnd = (isCloseLine && htmlEndHasCode) ? closeTagIdx : currentLine.text.length;
          let promptRenderResult: PromptLineRenderResult = { styledParts: [], output: [], matchedLength: 0, lineClassName: null, isRoot: false };

          // line number jumps
          if (!startLine && !endLine) {
            lineNumber++;

            if (jumps && jumpIdx < jumps.length && lineNumber === jumps[jumpIdx].lineNumber) {
              lineNumber = jumps[jumpIdx].newStartNumber;
              jumpIdx++;

              const firstContentLine = htmlStartHasCode ? firstCodeBlockLine : firstCodeBlockLine + 1;
              if (previousLineEndPos !== null && previousLineStartPos !== null && line > firstContentLine) {
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
          let lineClass = getLineClass(parameters, lineNumber, startLine, endLine, currentLine, decorations, highlightRules, promptRenderResult, codeSliceStart, codeSliceEnd);
          if (htmlBlock) {
            lineClass += ` ${getHtmlCodeBlockLineClass(line === blockFirstLine, line === blockLastLine)}`;
          }
          decorations.push(Decoration.line({ attributes: { class: lineClass, style: gutterStyle } }).range(lineStartPos));

          previousLineEndPos = currentLine.to;
          previousLineStartPos = lineStartPos;

          let spanClass = "";
          if (line === blockFirstLine) {
            spanClass = `codeblock-customizer-line-number-first`;
          }

          if (line === blockLastLine) {
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
                decorations.push(Decoration.line({ attributes: { class: `has-prompt-output` } }).range(lineStartPos));
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
        }

        // <pre> and </pre> lines outside of the <code> and </code> lines are styled like the fence lines
        for (let line = blockFirstLine; line <= blockLastLine; line++) {
          if (line >= firstCodeBlockLine && line <= lastCodeBlockLine) {
            continue;
          }

          const currentLine = view.state.doc.line(line);
          const beforeCode = line < firstCodeBlockLine;
          const emptyPromptResult: PromptLineRenderResult = { styledParts: [], output: [], matchedLength: 0, lineClassName: null, isRoot: false };
          const lineClass = getLineClass(parameters, lineNumber, beforeCode, !beforeCode, currentLine, decorations, highlightRules, emptyPromptResult) + ` ${getHtmlCodeBlockLineClass(line === blockFirstLine, line === blockLastLine)}`;
          decorations.push(Decoration.line({ attributes: { class: lineClass, style: gutterStyle } }).range(currentLine.from));

          if (settings.pluginSettings.codeblock.enableLineNumbers || parameters.isSpecificNumber || parameters.showNumbers === "specific") {
            const spanClass = line === blockFirstLine ? `codeblock-customizer-line-number-first` : line === blockLastLine ? `codeblock-customizer-line-number-last` : "";
            decorations.push(Decoration.widget({ widget: new LineNumberWidget(" ", parameters, spanClass), }).range(currentLine.from));
          }
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

    toDOM(): HTMLElement {
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

    toDOM(): HTMLElement {
      const span = createSpan({ cls: `${this.className}`, text: this.output });
      return span
    }
  }// LineWidget

  class LineSeparatorWidget extends WidgetType {
    constructor() {
      super();
    }

    eq() {
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

  function getHtmlCodeBlockLineClass(startLine: boolean, endLine: boolean) {
    let lineClass = `HyperMD-codeblock HyperMD-codeblock-bg codeblock-customizer-html-line`;
    if (startLine) {
      lineClass += ` HyperMD-codeblock-begin HyperMD-codeblock-begin-bg`;
    }
    if (endLine) {
      lineClass += ` HyperMD-codeblock-end HyperMD-codeblock-end-bg`;
    }
    return lineClass;
  }// getHtmlCodeBlockLineClass

  function getLineClass(parameters: CBCParameters, lineNumber: number, startLine: boolean, endLine: boolean, line: Line, decorations: Array<Range<Decoration>>, rules: HighlightRules, promptRenderResult: PromptLineRenderResult, codeSliceStart = 0, codeSliceEnd?: number) {
    const languageSpecificColors = settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors;
    const languageBorderColors = getPropertyFromLanguageSpecificColors("codeblock.borderColor", settings);
    const language = parameters.language.length > 0 ? parameters.language : "nolang";

    const codeblockLanguageClass = "codeblock-customizer-language-" + language.toLowerCase();
    const codeblockLanguageSpecificClass = getLanguageSpecificColorClass(language, languageSpecificColors);
    const borderColor = getBorderColorByLanguage(parameters.language, languageBorderColors); // handles nolang

    let lineClass = `codeblock-customizer-line`;
    const textSeparator = parameters.textSeparator || settings.pluginSettings.textHighlight.textSeparator || DEFAULT_TEXT_SEPARATOR;
    lineClass = highlightLinesOrWords(lineNumber, startLine, endLine, line, decorations, lineClass, rules, textSeparator, codeSliceStart, codeSliceEnd);
    lineClass = lineClass + " " + codeblockLanguageClass + " " + codeblockLanguageSpecificClass;

    if (borderColor.length > 0) {
      lineClass = lineClass + " hasLangBorderColor";
    }

    if (promptRenderResult.lineClassName) {
      lineClass += ` ${promptRenderResult.lineClassName}`;
    }

    if (promptRenderResult.isRoot) {
      lineClass += ` is-root`;
    }

    if (parameters.expand) {
      lineClass = lineClass + " codeblock-customizer-expand";
    }

    return lineClass;
  }// getLineClass

  function highlightLinesOrWords(lineNumber: number, startLine: boolean, endLine: boolean, line: Line, decorations: Array<Range<Decoration>>, lineClass: string, rules: HighlightRules, textSeparator: string, codeSliceStart = 0, codeSliceEnd?: number) {
    const sliceEnd = codeSliceEnd ?? line.text.length;
    const effectiveLine = (codeSliceStart > 0 || sliceEnd < line.text.length)
      ? { from: line.from + codeSliceStart, text: line.text.slice(codeSliceStart, sliceEnd) }
      : { from: line.from, text: line.text };
    const caseInsensitiveLineText = (effectiveLine.text ?? '').toLowerCase();
    const lineMarks: HighlightMarkRange[] = [];

    const addHighlightClass = (name = '') => {
      const className = `codeblock-customizer-line-highlighted${name ? `-${name.replace(/\s+/g, '-').toLowerCase()}` : ''}`;
      return className;
    };

    const highlighText = (words: HighlightedWord[], name = '', order = 0) => {
      for (const highlightedWord of words) {
        const word = highlightedWord.text.toLowerCase();
        setClass(effectiveLine, lineMarks, caseInsensitiveLineText, word, textSeparator, name.replace(/\s+/g, '-').toLowerCase(), highlightedWord.occurrences, order);
      }
    };

    if (startLine || endLine)
      return lineClass;

    // highlight line by line number hl:1,3-5
    if (rules.defaultLinesToHighlight.has(lineNumber)) {
      lineClass = addHighlightClass();
    }

    // highlight every line which contains a specific word hl:test
    if (rules.defaultLinesToHighlightByWords.length > 0 && rules.defaultLinesToHighlightByWords.some(word => caseInsensitiveLineText.includes(word))) {
      lineClass = addHighlightClass();
    }

    // highlight specific lines if they contain the specified word hl:1|test,3-5|test
    const lineSpecificWords = rules.defaultLineSpecificWords.get(lineNumber);
    if (lineSpecificWords && lineSpecificWords.some(word => caseInsensitiveLineText.includes(word))) {
      lineClass = addHighlightClass();
    }

    // highlight text in every line if linetext contains the specified word hlt:test
    if (rules.defaultTextToHighlight.length > 0) {
      highlighText(rules.defaultTextToHighlight);
    }

    // highlight text in specific lines if linetext contains the specified word hlt:1|test,3-5|test
    const defaultTextLineSpecific = rules.defaultTextLineSpecificWords.get(lineNumber);
    if (defaultTextLineSpecific) {
      for (const rule of defaultTextLineSpecific) {
        highlighText(rule.words);
      }
    }

    // highlight text with specific text between markers hlt:start:end
    for (const { fromLower, toLower, from, to, occurrences } of rules.defaultTextBetween) {
      if (caseInsensitiveLineText.includes(fromLower) && caseInsensitiveLineText.includes(toLower)) {
        const highlightText = `${from}${textSeparator}${to}`;
        const word: HighlightedWord = { text: highlightText, occurrences: occurrences };
        highlighText([word]);
      }
    }

    // highlight text within specific lines with text between markers hlt:5|start:end,5-7|start:end
    const specificTextBetween = rules.defaultTextLineSpecificBetween.get(lineNumber);
    if (specificTextBetween) {
      for (const rule of specificTextBetween) {
        if (caseInsensitiveLineText.includes(rule.fromLower) && caseInsensitiveLineText.includes(rule.toLower)) {
          const highlightText = `${rule.from}${textSeparator}${rule.to}`;
          const word: HighlightedWord = { text: highlightText, occurrences: rule.occurrences };
          highlighText([word]);
        }
      }
    }

    // highlight all words in specified line hlt:1,3-5
    if (rules.defaultTextAllWordsInLine.has(lineNumber)) {
      setClass(effectiveLine, lineMarks, caseInsensitiveLineText, '', textSeparator, '', undefined, 0);
    }

    let altOrder = 1;

    // highlight line by line number imp:1,3-5
    const altColorNames = rules.alternativeLinesToHighlight.get(lineNumber);
    if (altColorNames) {
      for (const colorName of altColorNames) {
        lineClass = addHighlightClass(colorName);
      }
    }

    // highlight every line which contains a specific word imp:test
    for (const altword of rules.alternativeLinesToHighlightByWords) {
      if (altword.words.some(word => caseInsensitiveLineText.includes(word))) {
        lineClass = addHighlightClass(altword.colorName);
      }
    }

    // highlight specific lines if they contain the specified word imp:1|test,3-5|test
    const altLineSpecific = rules.alternativeLineSpecificWords.get(lineNumber);
    if (altLineSpecific) {
      for (const lsWord of altLineSpecific) {
        if (lsWord.words.some(word => caseInsensitiveLineText.includes(word))) {
          lineClass = addHighlightClass(lsWord.colorName);
        }
      }
    }

    // highlight text in every line if linetext contains the specified word impt:test
    for (const entry of rules.alternativeTextToHighlight) {
      highlighText(entry.words, entry.colorName, altOrder++);
    }

    // highlight text in specific lines if linetext contains the specified word impt:1|test,3-5|test
    const altTextLineSpecific = rules.alternativeTextLineSpecificWords.get(lineNumber);
    if (altTextLineSpecific) {
      for (const rule of altTextLineSpecific) {
        highlighText(rule.words, rule.colorName, altOrder++);
      }
    }

    // highlight text with specific text between markers impt:start:end
    for (const { fromLower, toLower, from, to, colorName, occurrences } of rules.alternativeTextBetween) {
      if (caseInsensitiveLineText.includes(fromLower) && caseInsensitiveLineText.includes(toLower)) {
        const highlightText = `${from}${textSeparator}${to}`;
        const word: HighlightedWord = { text: highlightText, occurrences: occurrences };
        highlighText([word], colorName, altOrder++);
      }
    }

    // highlight text within specific lines with text between markers impt:5|start:end, imp:5-7|start:end
    const altSpecificTextBetween = rules.alternativeTextLineSpecificBetween.get(lineNumber);
    if (altSpecificTextBetween) {
      for (const rule of altSpecificTextBetween) {
        if (caseInsensitiveLineText.includes(rule.fromLower) && caseInsensitiveLineText.includes(rule.toLower)) {
          const highlightText = `${rule.from}${textSeparator}${rule.to}`;
          const word: HighlightedWord = { text: highlightText, occurrences: rule.occurrences };
          highlighText([word], rule.colorName, altOrder++);
        }
      }
    }

    // highlight all words in specified line impt:1,3-5
    const altAllWordsColor = rules.alternativeTextAllWordsInLine.get(lineNumber);
    if (altAllWordsColor !== undefined) {
      setClass(effectiveLine, lineMarks, caseInsensitiveLineText, '', textSeparator, altAllWordsColor, undefined, altOrder);
    }

    for (const mark of layerHighlightRanges(lineMarks)) {
      decorations.push(Decoration.mark({ class: mark.className }).range(mark.from, mark.to));
    }

    return lineClass;
  }// highlightLinesOrWords

  function setClass(line: { from: number; text: string }, lineMarks: HighlightMarkRange[], caseInsensitiveLineText: string, word: string, textSeparator: string, customClass = '', occurrencesFilter?: number[], order = 0) {
    const classToUse = customClass ? `codeblock-customizer-highlighted-text-${customClass}` : 'codeblock-customizer-highlighted-text';

    if (word.includes(textSeparator)) {
      const [start, end] = word.split(textSeparator).map(w => w.trim().toLowerCase());
      const lineTextLength = caseInsensitiveLineText.length;
      const startLength = start.length;
      const endLength = end.length;

      const firstNonWhiteSpaceIndex = caseInsensitiveLineText.match(/\S/)?.index || 0;
      const allMatches: { from: number, to: number }[] = [];
      let isFiltered = false;

      if (start === '' && end === '') {
        const from = line.from + firstNonWhiteSpaceIndex;
        const to = line.from + lineTextLength;
        if (to > from) {
          allMatches.push({ from, to });
        }
      } else if (start === '') {
        const endIndices = findAllOccurrences(caseInsensitiveLineText, end);
        const filter = (!occurrencesFilter || occurrencesFilter.length === 0) ? [1] : occurrencesFilter;
        const filteredEndIndices = filterOccurrences(endIndices.map(i => ({ from: i, to: i })), filter);
        for (const { from: endIndex } of filteredEndIndices) {
          const from = line.from + firstNonWhiteSpaceIndex;
          const to = line.from + endIndex + endLength;
          if (to > from) {
            allMatches.push({ from, to });
          }
        }
        isFiltered = true;
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
      const matchesToHighlight = isFiltered ? allMatches : filterOccurrences(allMatches, occurrencesFilter);
      matchesToHighlight.forEach(match => {
        lineMarks.push({ from: match.from, to: match.to, className: classToUse, order });
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
        lineMarks.push({ from: startRange, to: endRange, className: classToUse, order });
      }
    } else {
      const allOccurrences = findAllOccurrences(caseInsensitiveLineText, word);
      const allMatches = allOccurrences.map(index => ({ from: line.from + index, to: line.from + index + word.length }));
      const matchesToHighlight = filterOccurrences(allMatches, occurrencesFilter);
      matchesToHighlight.forEach(match => {
        lineMarks.push({ from: match.from, to: match.to, className: classToUse, order });
      });
    }
  }// setClass

  return { viewPlugin, liveUpdateExtension, forceRefreshListener };
}// mainViewPluginExtension
