import { editorInfoField } from "obsidian";

import { StateField, StateEffect, EditorState, Transaction, RangeSet, Range, Line, Annotation } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, DecorationSet } from "@codemirror/view";

import { CodeblockCustomizerSettings, FoldingPersistence, FoldingScope } from "../Settings";
import { fadeOutLineCount } from "../Const";
import CodeBlockCustomizerPlugin from "../main";
import { createUncollapseCodeButton, isPluginLoaded, isSpecificHeader, determineDefaultFoldState, isSourceMode } from "../Utils";
import { CodeBlockPositions, GroupedCodeBlocks } from "./CodeBlockPositions";
import { FoldingState, FoldCommand, setFoldCommandState, setFoldState, CollapsedDecoration, Collapse, UnCollapse, semiCollapse, semiUnCollapse, semiFade, semiUnFade, CodeBlockFoldEffect, SemiUncollapseEffect } from "./EditorEffects";
import { compareCodeBlockPositions } from "./CompareUtils";

export interface ReplaceFadeOutRanges {
  replaceStart: Line;
  replaceEnd: Line;
  fadeOutStart: Line;
  fadeOutEnd: Line;
  firstLine: Line;
}

export function foldingExtension(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings, codeBlockPositionsField: StateField<CodeBlockPositions[]>, hiddenLinesUnhiddenField: StateField<Set<number>>,
  getHiddenLines: (state: EditorState, block: CodeBlockPositions, unhiddenPositions: Set<number>) => Set<number>, getGroupedCodeBlocksField: () => StateField<GroupedCodeBlocks>, getResetFoldDecorations: () => boolean) {

  class uncollapseCodeWidget extends WidgetType {
    pos: CodeBlockPositions;

    constructor(pos: CodeBlockPositions) {
      super();
      this.pos = pos;
    }

    eq(other: uncollapseCodeWidget) {
      return this.pos.codeBlockStartPos === other.pos.codeBlockStartPos && this.pos.codeBlockEndPos === other.pos.codeBlockEndPos;
    }

    toDOM(view: EditorView): HTMLElement {
      const container = createUncollapseCodeButton();

      container.onclick = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();

        const { effects, annotations } = toggleCodeBlockFold(view, this.pos);

        if (effects.length > 0 || annotations.length > 0) {
          view.dispatch({ effects: effects, annotations });
        }
      };

      return container;
    }
  }// uncollapseCodeWidget

  const foldCommandField = StateField.define<FoldCommand>({
    create(): FoldCommand {
      return FoldCommand.Default;
    },
    update(value: FoldCommand, tr: Transaction): FoldCommand {
      for (const effect of tr.effects) {
        if (effect.is(setFoldCommandState)) {
          return effect.value;
        }
      }
      return value;
    },
  });// foldCommandField

  const rememberedFoldField = StateField.define<Record<number, FoldingState>>({
    create(state: EditorState): Record<number, FoldingState> {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(state))
        return {};

      const foldSettings = settings.pluginSettings.codeblock.folding;
      if (!foldSettings.rememberFoldState)
        return {};

      const docPath = state.field(editorInfoField)?.file?.path;
      if (!docPath)
        return {};

      let savedStatesForFile: Map<number, FoldingState> | undefined;
      if (foldSettings.persistence === FoldingPersistence.Permanent) {
        savedStatesForFile = plugin.loadPermanentEditorFolds(docPath);
      } else {
        savedStatesForFile = plugin.activeEditorFolds.get(docPath);
      }

      return savedStatesForFile ? Object.fromEntries(savedStatesForFile) : {};
    },
    update(value: Record<number, FoldingState>, transaction: Transaction): Record<number, FoldingState> {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(transaction.state))
        return {};

      const foldSettings = settings.pluginSettings.codeblock.folding;
      if (!foldSettings.rememberFoldState) {
        return Object.keys(value).length > 0 ? {} : value;
      }

      const docPath = transaction.state.field(editorInfoField)?.file?.path;
      const newFoldedState = { ...value };

      if (transaction.docChanged && docPath) {
        plugin.remapFolds(docPath, transaction.changes);
      }

      // handle a fold/unfold action
      const foldStateUpdate = transaction.annotation(setFoldState);
      if (foldStateUpdate) {
        const { docPath: updatedDocPath, startPos, state } = foldStateUpdate;
        if (updatedDocPath && state) {
          const allBlocks = transaction.state.field(codeBlockPositionsField, false);
          const currentBlock = allBlocks?.find(b => b.codeBlockStartPos === startPos);
          if (currentBlock) {
            const currentBlockParameters = currentBlock.parameters;
            const shouldRemember = foldSettings.scope === FoldingScope.All || (foldSettings.scope === FoldingScope.NoFoldSpecified && !currentBlockParameters.fold && !currentBlockParameters.unfold);
            if (shouldRemember) {
              const startLine = transaction.state.doc.lineAt(currentBlock.codeBlockStartPos).number;
              const endLine = transaction.state.doc.lineAt(currentBlock.codeBlockEndPos).number;
              const lineCount = endLine - startLine + 1;

              plugin.setFoldState(updatedDocPath, startPos, state, 'editor', currentBlockParameters, lineCount);

              if (state === FoldingState.Unfolded) {
                delete newFoldedState[startPos];
              } else {
                newFoldedState[startPos] = state;
              }
            }
          }
        }
      }

      return newFoldedState;
    },
  });// rememberedFoldField

  const defaultFoldUnfoldedField = StateField.define<Set<number>>({
    create(state: EditorState): Set<number> {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(state))
        return new Set();

      const initiallyUnfolded = new Set<number>();
      const rememberedFolds = state.field(rememberedFoldField, false) ?? {};

      for (const startPosStr in rememberedFolds) {
        const startPos = Number(startPosStr);
        const foldState = rememberedFolds[startPos];
        if (foldState === null) {
          initiallyUnfolded.add(startPos);
        }
      }

      return initiallyUnfolded;
    },
    update(value: Set<number>, transaction: Transaction): Set<number> {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(transaction.state))
        return new Set();

      const newValue = new Set(value);

      if (transaction.docChanged) {
        const newUnfolded = new Set<number>();
        for (const pos of newValue) {
          //fix for #144
          if (pos > transaction.changes.length)
            continue;

          const mappedPos = transaction.changes.mapPos(pos);
          const newCodeBlocks = transaction.state.field(codeBlockPositionsField, false) || [];
          if (newCodeBlocks.some(block => block.codeBlockStartPos === mappedPos)) {
            newUnfolded.add(mappedPos);
          }
        }
        newValue.clear();
        newUnfolded.forEach(pos => newValue.add(pos));
      }

      for (const effect of transaction.effects) {
        if (effect.is(Collapse)) {
          newValue.delete(effect.value.from);
        } else if (effect.is(UnCollapse)) {
          newValue.add(effect.value.filterFrom);
        } else if (effect.is(semiCollapse)) {
          const codeBlocks = transaction.state.field(codeBlockPositionsField, false) || [];
          const block = codeBlocks.find(b =>
            effect.value.from >= b.codeBlockStartPos && effect.value.to <= b.codeBlockEndPos
          );
          if (block) {
            newValue.delete(transaction.state.doc.lineAt(block.codeBlockStartPos).from);
          }
        } else if (effect.is(semiUnCollapse)) {
          newValue.add(effect.value.filterFrom);
        }
      }
      return newValue;
    },
  });// defaultFoldUnfoldedField

  const collapseField = StateField.define<RangeSet<Decoration>>({
    create(state): RangeSet<Decoration> {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(state))
        return Decoration.none;

      const codeBlockPositions = state.field(codeBlockPositionsField, false) ?? [];
      const rememberedFolds = state.field(rememberedFoldField, false) ?? {};
      const unfoldedBlocks = state.field(defaultFoldUnfoldedField, false) ?? new Set<number>();
      const grouped = state.field(getGroupedCodeBlocksField(), false) ?? {};
      const globalFoldCmd = state.field(foldCommandField, false) ?? FoldCommand.Default;

      return calculateFoldDecorations(state, Decoration.none, codeBlockPositions, rememberedFolds, unfoldedBlocks, grouped, globalFoldCmd);
    },
    update(value, tr) {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(tr.state))
        return Decoration.none;

      value = value.map(tr.changes);
      for (const effect of tr.effects) {
        if (effect.is(Collapse)) {
          value = value.update({ add: [CollapsedDecoration.range(effect.value.from, effect.value.to)], sort: true });
        } else if (effect.is(UnCollapse)) {
          const { filterFrom, filterTo } = effect.value;
          value = value.update({
            filter: (from, to, value) => {
              const isCollapsedDeco = value.spec.attributes?.['code-folded'] === 'true';
              const isInRange = from >= filterFrom && to <= filterTo;
              return !isInRange || !isCollapsedDeco;
            },
            filterFrom: filterFrom,
            filterTo: filterTo
          });
        } else if (effect.is(semiCollapse)) {
          value = value.update({ add: [effect.value], sort: true });
        } else if (effect.is(semiUnCollapse)) {
          const { filterFrom, filterTo } = effect.value;
          value = value.update({
            filter: (from: number, to: number, value: Decoration) => {
              const isSemiCollapseReplaceDeco = value.spec.block === true && !value.spec.attributes?.['code-folded'];
              const isInRange = from >= filterFrom && to <= filterTo;
              return !isInRange || !isSemiCollapseReplaceDeco;
            },
            filterFrom: filterFrom,
            filterTo: filterTo
          });
        } else if (effect.is(semiFade)) {
          value = value.update({ add: [effect.value], sort: true });
        } else if (effect.is(semiUnFade)) {
          const { filterFrom, filterTo } = effect.value;
          value = value.update({
            filter: (from, to, value) => {
              const isFadeOutLineDeco = value.spec.attributes?.class?.includes('codeblock-customizer-fade-out-line');
              const isSemiFoldClassDeco = value.spec.attributes?.class?.includes('semi-folded');
              const isUncollapseWidgetDeco = value.spec.widget instanceof uncollapseCodeWidget;
              const isSemiFadeRelatedDeco = isFadeOutLineDeco || isSemiFoldClassDeco || isUncollapseWidgetDeco;
              const isInRange = from >= filterFrom && to <= filterTo;
              return !isInRange || !isSemiFadeRelatedDeco;
            },
            filterFrom: filterFrom,
            filterTo: filterTo
          });
        }
      }

      const oldCodeBlockPositions = tr.startState.field(codeBlockPositionsField, false) ?? [];
      const newCodeBlockPositions = tr.state.field(codeBlockPositionsField, false) ?? [];

      const oldFoldState = tr.startState.field(rememberedFoldField, false) ?? [];
      const newFoldState = tr.state.field(rememberedFoldField, false) ?? [];

      const globalFoldCmd = tr.state.field(foldCommandField, false) ?? FoldCommand.Default;
      const globalFoldCmdChanged = tr.startState.field(foldCommandField, false) !== globalFoldCmd;

      if ((newCodeBlockPositions !== oldCodeBlockPositions && !compareCodeBlockPositions(oldCodeBlockPositions, newCodeBlockPositions)) || newFoldState !== oldFoldState || getResetFoldDecorations() || globalFoldCmdChanged || tr.reconfigured) {
        if (getResetFoldDecorations() || globalFoldCmdChanged) {
          value = Decoration.none;  // remove fold e.g. when inversefold is disabled
        }

        const rememberedFolds = newFoldState ?? {};
        const unfoldedBlocks = tr.state.field(defaultFoldUnfoldedField, false) ?? new Set<number>();
        const grouped = tr.state.field(getGroupedCodeBlocksField(), false) ?? {};

        value = calculateFoldDecorations(tr.state, value, newCodeBlockPositions, rememberedFolds, unfoldedBlocks, grouped, globalFoldCmd);
      }

      return value;
    },
    provide: f => EditorView.decorations.from(f)
  });// collapseField

  /* functions */

  function calculateFoldDecorations(state: EditorState, decorations: RangeSet<Decoration>, codeBlockPositions: CodeBlockPositions[], rememberedFolds: Record<number, FoldingState>, unfoldedBlocks: Set<number>, grouped: GroupedCodeBlocks, globalFoldCmd: FoldCommand): RangeSet<Decoration> {
    const decorationsToAdd: Range<Decoration>[] = [];

    for (const pos of codeBlockPositions) {
      // don't process fold commands for `run-` code blocks
      if (settings.pluginSettings.plugins.executeCode.enabled && pos.parameters.language.toLowerCase().startsWith('run-') && isPluginLoaded("execute-code", plugin)) {
        continue;
      }

      // check if a fold decoration already exists for this block
      if (isBlockCurrentlyFoldedInSet(decorations, pos.codeBlockStartPos, pos.codeBlockEndPos)) {
        continue;
      }

      const group = pos.parameters.group;
      const isMemberOfTabbedGroup = !!(group && grouped[group] && grouped[group].some(member => member.codeBlockStartPos === pos.codeBlockStartPos));
      const lineCount = state.doc.lineAt(pos.codeBlockEndPos).number - state.doc.lineAt(pos.codeBlockStartPos).number + 1;
      const specificHeader = isSpecificHeader(pos.parameters, settings, isMemberOfTabbedGroup, lineCount, "editor");
      const { foldByDefault } = determineDefaultFoldState(pos.parameters, settings, lineCount, specificHeader, "editor");
      let foldNow = false;
      let useSemiFold = false;

      // if unfolded by user action, never fold.
      if (unfoldedBlocks.has(pos.codeBlockStartPos)) {
        foldNow = false;
      } else {
        // apply commands
        switch (globalFoldCmd) {
          case FoldCommand.FoldAll:
            foldNow = true;
            useSemiFold = settings.pluginSettings.semiFold.enableSemiFold;
            break;
          case FoldCommand.UnfoldAll:
            foldNow = false;
            break;
          case FoldCommand.Default:
          default: {
            // apply remembered state or default parameters
            const rememberedState = rememberedFolds[pos.codeBlockStartPos];
            if (rememberedState === FoldingState.FullyFolded) {
              foldNow = true; useSemiFold = false;
            } else if (rememberedState === FoldingState.SemiFolded) {
              foldNow = true; useSemiFold = true;
            } else if (rememberedState === FoldingState.Unfolded) {
              foldNow = false;
            } else if (rememberedState === undefined && foldByDefault) {
              foldNow = true;
              useSemiFold = settings.pluginSettings.semiFold.enableSemiFold;
            }
            break;
          }
        }
      }
      if (foldNow) {
        const lineCount = state.doc.lineAt(pos.codeBlockEndPos).number - state.doc.lineAt(pos.codeBlockStartPos).number + 1;
        const hiddenLines = pos.parameters.hideLines.length > 0 ? getHiddenLines(state, pos, state.field(hiddenLinesUnhiddenField, false) ?? new Set<number>()) : new Set<number>();
        const visibleLines = lineCount - 2 - hiddenLines.size;
        if (useSemiFold && visibleLines >= settings.pluginSettings.semiFold.visibleLines + fadeOutLineCount) {
          const ranges = getRanges(state, pos.codeBlockStartPos, pos.codeBlockEndPos, settings.pluginSettings.semiFold.visibleLines, hiddenLines);
          decorationsToAdd.push(...generateSemiFoldEffects(state, pos, ranges, hiddenLines).map(e => e.value));
        } else {
          decorationsToAdd.push(CollapsedDecoration.range(pos.codeBlockStartPos, pos.codeBlockEndPos));
        }
      }
    }

    if (decorationsToAdd.length > 0) {
      return decorations.update({ add: decorationsToAdd, sort: true });
    }

    return decorations;
  }// calculateFoldDecorations

  function isBlockCurrentlyFoldedInSet(decorations: DecorationSet, startPos: number, endPos: number): boolean {
    let folded = false;
    decorations.between(startPos, endPos, (decoFrom, decoTo, decoration) => {
      if (decoration.spec.attributes?.['code-folded'] === 'true' || decoration.spec.block === true) {
        folded = true;
        return false;
      }

      if (decoration.spec.widget instanceof uncollapseCodeWidget || decoration.spec.attributes?.class?.includes('semi-folded') || decoration.spec.attributes?.class?.includes('codeblock-customizer-fade-out-line')) {
        folded = true;
      }
      return undefined;
    });
    return folded;
  }// isBlockCurrentlyFoldedInSet

  function toggleCodeBlockFold(view: EditorView, pos: CodeBlockPositions): { effects: CodeBlockFoldEffect[], annotations: Annotation<any>[] } {
    const effects: CodeBlockFoldEffect[] = [];
    const annotations: Annotation<any>[] = [];
    const { codeBlockStartPos, codeBlockEndPos } = pos;
    const start = view.state.doc.lineAt(codeBlockStartPos);
    const end = view.state.doc.lineAt(codeBlockEndPos);
    const docPath = view.state.field(editorInfoField)?.file?.path;

    const enableSemiFold = settings.pluginSettings.semiFold.enableSemiFold;
    const visibleLines = settings.pluginSettings.semiFold.visibleLines;
    const lineCount = end.number - start.number + 1;
    const hiddenLines = pos.parameters.hideLines.length > 0 ? getHiddenLines(view.state, pos, view.state.field(hiddenLinesUnhiddenField, false) ?? new Set<number>()) : new Set<number>();
    const visibleContentLines = lineCount - 2 - hiddenLines.size; // -2 to ignore the first and last lines
    const canSemiFold = visibleContentLines >= visibleLines + fadeOutLineCount;

    const currentFoldState = getFoldingState(view.state, codeBlockStartPos, codeBlockEndPos);

    if (currentFoldState === FoldingState.Unfolded) {
      if (enableSemiFold && canSemiFold) {
        // semi-fold
        const ranges = getRanges(view.state, pos.codeBlockStartPos, pos.codeBlockEndPos, visibleLines, hiddenLines);
        const semiFoldEffects = generateSemiFoldEffects(view.state, pos, ranges, hiddenLines);
        effects.push(...semiFoldEffects);
        if (docPath)
          annotations.push(setFoldState.of({ docPath, startPos: codeBlockStartPos, state: FoldingState.SemiFolded }));
      } else {
        // normal fold
        effects.push(Collapse.of(CollapsedDecoration.range(start.from, end.to)));
        if (docPath)
          annotations.push(setFoldState.of({ docPath, startPos: codeBlockStartPos, state: FoldingState.FullyFolded }));
      }
    } else if (currentFoldState === FoldingState.FullyFolded) {
      // unfold
      effects.push(UnCollapse.of({ filter: (from: number, to: number) => to <= start.from || from >= end.to, filterFrom: start.from, filterTo: end.to }));
      if (docPath)
        annotations.push(setFoldState.of({ docPath, startPos: codeBlockStartPos, state: FoldingState.Unfolded }));
    } else if (currentFoldState === FoldingState.SemiFolded) {
      // semi unfold
      const clearFade = clearFadeEffect(start.from, end.to);
      if (clearFade) {
        effects.push(clearFade);
      }
      effects.push(semiUnCollapse.of({ filterFrom: start.from, filterTo: end.to }));
      if (docPath)
        annotations.push(setFoldState.of({ docPath, startPos: codeBlockStartPos, state: FoldingState.Unfolded }));
    }

    return { effects, annotations };
  }// toggleCodeBlockFold

  function getFoldingState(state: EditorState, startPos: number, endPos: number): FoldingState {
    const currentFoldedStates = state.field(rememberedFoldField, false) ?? {};
    const storedState = currentFoldedStates[startPos];

    if (storedState) {
      return storedState;
    }

    const decorations = state.field(collapseField, false);
    if (!decorations || decorations.size === 0) {
      return FoldingState.Unfolded; // no decorations ==> it's unfolded
    }

    let isFullyFolded = false;
    let isSemiFolded = false;

    decorations.between(startPos, endPos, (decoFrom, decoTo, decoration) => {
      // check if it is fully folded
      if (decoration.spec.attributes?.['code-folded'] === 'true') {
        isFullyFolded = true;
        return false;
      }

      // check if it is semi-folded
      if (decoration.spec.widget instanceof uncollapseCodeWidget || decoration.spec.attributes?.class?.includes('semi-folded') || decoration.spec.attributes?.class?.includes('codeblock-customizer-fade-out-line')) {
        isSemiFolded = true;
        return undefined;
      }

      return undefined;
    });

    if (isFullyFolded) {
      return FoldingState.FullyFolded;
    } else if (isSemiFolded) {
      return FoldingState.SemiFolded;
    } else {
      return FoldingState.Unfolded;
    }
  }// getFoldingState

  function generateSemiFoldEffects(state: EditorState, pos: CodeBlockPositions, ranges: ReplaceFadeOutRanges, hiddenLines: Set<number> = new Set()): StateEffect<Range<Decoration>>[] {
    const effects: StateEffect<Range<Decoration>>[] = [];

    const semiFoldClass = Decoration.line({ attributes: { class: `semi-folded` } });
    effects.push(semiFade.of(semiFoldClass.range(ranges.firstLine.from, ranges.firstLine.from)));

    let fadeIdx = 0;
    let lastFadeOutLine = ranges.fadeOutStart;
    const fadeOutStartNumber = state.doc.lineAt(ranges.fadeOutStart.from).number;
    const fadeOutEndNumber = state.doc.lineAt(ranges.fadeOutEnd.from).number;

    for (let i = fadeOutStartNumber; fadeIdx < fadeOutLineCount && i <= fadeOutEndNumber; i++) {
      if (hiddenLines.has(i)) {
        continue;
      }

      const fadeOutLine = state.doc.line(i);
      const fadeOutDecoration = Decoration.line({ attributes: { class: `codeblock-customizer-fade-out-line${fadeIdx}` } });
      effects.push(semiFade.of(fadeOutDecoration.range(fadeOutLine.from, fadeOutLine.from)));
      lastFadeOutLine = fadeOutLine;
      fadeIdx++;
      if (fadeIdx === fadeOutLineCount) {
        const uncollapseWidget = new uncollapseCodeWidget(pos);
        const deco = Decoration.widget({ widget: uncollapseWidget });
        const widgetPos = lastFadeOutLine.to;
        effects.push(semiFade.of(deco.range(widgetPos, widgetPos)));
      }
    }

    const collapseDecoration = Decoration.replace({ block: true });
    effects.push(semiCollapse.of(collapseDecoration.range(ranges.replaceStart.from, ranges.replaceEnd.to)));

    return effects;
  }// generateSemiFoldEffects

  function getRanges(state: EditorState, codeBlockStartPos: number, codeBlockEndPos: number, visibleLines: number, hiddenLines: Set<number> = new Set()): ReplaceFadeOutRanges {
    const firstLine = state.doc.lineAt(codeBlockStartPos);
    const contentStartLineNr = firstLine.number + 1;
    const lastLineNr = state.doc.lineAt(codeBlockEndPos).number;
    const replaceEnd = state.doc.line(lastLineNr);

    // count non-hidden visible lines
    let visibleCount = 0;
    let fadeOutStartLineNum = contentStartLineNr;
    for (let i = contentStartLineNr; i < lastLineNr; i++) {
      if (hiddenLines.has(i)) {
        continue;
      }
      visibleCount++;
      if (visibleCount > visibleLines) {
        fadeOutStartLineNum = i; break;
      }
    }
    const fadeOutStart = state.doc.line(fadeOutStartLineNum);

    // count non-hidden lines for fadeOut range
    let fadeCount = 0;
    let fadeOutEndLineNum = fadeOutStartLineNum;
    for (let i = fadeOutStartLineNum; i < lastLineNr; i++) {
      if (hiddenLines.has(i)) {
        continue;
      }

      fadeOutEndLineNum = i;
      fadeCount++;
      if (fadeCount >= fadeOutLineCount) {
        break;
      }
    }
    const fadeOutEnd = state.doc.line(fadeOutEndLineNum);

    const replaceStart = state.doc.line(fadeOutEnd.number + 1);

    return { replaceStart, replaceEnd, fadeOutStart, fadeOutEnd, firstLine };
  }// getRanges

  function foldAll(view: EditorView) {
    view.dispatch({ effects: setFoldCommandState.of(FoldCommand.FoldAll) });
    view.requestMeasure();
  }// foldAll

  function unfoldAll(view: EditorView) {
    view.dispatch({ effects: setFoldCommandState.of(FoldCommand.UnfoldAll) });
    view.requestMeasure();
  }// unfoldAll

  function restoreDefaultFold(view: EditorView) {
    view.dispatch({ effects: setFoldCommandState.of(FoldCommand.Default) });
    view.requestMeasure();
  }// restoreDefaultFold

  function clearFadeEffect(CollapseStart: number, CollapseEnd: number): StateEffect<SemiUncollapseEffect> | undefined {
    return semiUnFade.of({ filterFrom: CollapseStart, filterTo: CollapseEnd });
  }// clearFadeEffect

  return {
    collapseField,
    foldCommandField,
    rememberedFoldField,
    defaultFoldUnfoldedField,
    uncollapseCodeWidget,
    toggleCodeBlockFold,
    getFoldingState,
    foldAll,
    unfoldAll,
    restoreDefaultFold,
    clearFadeEffect,
    generateSemiFoldEffects,
    getRanges,
    isBlockCurrentlyFoldedInSet,
    calculateFoldDecorations
  };
}// foldingExtension
