import { StateField, EditorState, RangeSet, Range } from "@codemirror/state";
import { EditorView, Decoration, DecorationSet, WidgetType } from "@codemirror/view";

import { CodeblockCustomizerSettings } from "../Settings";
import { CBCParameters } from "../Parsing";
import { isSourceMode } from "../Utils";
import { unhideEffect, rehideEffect } from "./EditorEffects";
import { CodeBlockPositions } from "./CodeBlockPositions";

export interface HiddenRange {
  startLine: number;
  endLine: number;
  lineCount: number;
  from: number;
  to: number;
}

export class HiddenLinesWidget extends WidgetType {
  constructor(readonly lineCount: number, readonly from: number, readonly to: number, readonly isSpecific: boolean) {
    super();
  }

  eq(other: HiddenLinesWidget) {
    return other.lineCount === this.lineCount && other.from === this.from && other.to === this.to && other.isSpecific === this.isSpecific;
  }

  toDOM(view: EditorView) {
    const container = createSpan({ cls: `codeblock-customizer-hidden-line-container` });
    const gutter = createSpan({ cls: `codeblock-customizer-hidden-line-gutter${this.isSpecific ? "-specific" : ""}`, text: `...` });
    const content = createSpan({ cls: `codeblock-customizer-hidden-line-content`, text: `${this.lineCount} ${this.lineCount === 1 ? "line" : "lines"} hidden - Click to reveal` });

    container.appendChild(gutter);
    container.appendChild(content);

    container.onclick = (e) => {
      e.preventDefault();
      view.dispatch({ effects: unhideEffect.of({ from: this.from, to: this.to }) });
    };
    return container;
  }
}// HiddenLinesWidget

export function hideLinesExtension(settings: CodeblockCustomizerSettings, codeBlockPositionsField: StateField<CodeBlockPositions[]>) {
  const hiddenLinesUnhiddenField = StateField.define<Set<number>>({
    create(): Set<number> {
      return new Set();
    },
    update(value, tr) {
      if (tr.docChanged) {
        const newSet = new Set<number>();
        for (const pos of value) {
          newSet.add(tr.changes.mapPos(pos));
        }
        value = newSet;
      }
      for (const effect of tr.effects) {
        if (effect.is(unhideEffect)) {
          value = new Set(value);
          value.add(effect.value.from);
        }
        if (effect.is(rehideEffect)) {
          const { from, to } = effect.value;
          value = new Set([...value].filter(pos => pos < from || pos > to));
        }
      }
      return value;
    }
  });// hiddenLinesUnhiddenField

  const hiddenLinesField = StateField.define<DecorationSet>({
    create(state): DecorationSet {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(state))
        return Decoration.none;

      const positions = state.field(codeBlockPositionsField, false) ?? [];
      const unhiddenPositions = state.field(hiddenLinesUnhiddenField, false) ?? new Set<number>();

      return calculateHideDecorations(state, positions, unhiddenPositions);
    },
    update(value, tr) {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(tr.state))
        return Decoration.none;

      const oldCodeBlockPositions = tr.startState.field(codeBlockPositionsField, false) ?? [];
      const newCodeBlockPositions = tr.state.field(codeBlockPositionsField, false) ?? [];
      const unhiddenPositions = tr.state.field(hiddenLinesUnhiddenField, false) ?? new Set<number>();
      const unhiddenChanged = tr.startState.field(hiddenLinesUnhiddenField, false) !== unhiddenPositions;

      if (oldCodeBlockPositions === newCodeBlockPositions && !tr.docChanged && !unhiddenChanged) {
        return value;
      }

      return calculateHideDecorations(tr.state, newCodeBlockPositions, unhiddenPositions);
    },
    provide: f => EditorView.decorations.from(f)
  });// hiddenLinesField

  function getHiddenRanges(state: EditorState, parameters: CBCParameters, codeBlockStartPos: number, codeBlockEndPos: number, unhiddenPositions?: Set<number>): HiddenRange[] {
    if (parameters.hideLines.length === 0) {
      return [];
    }

    const resolvedUnhidden = unhiddenPositions ?? state.field(hiddenLinesUnhiddenField, false) ?? new Set<number>();
    const firstLine = state.doc.lineAt(codeBlockStartPos).number;
    const lastLine = state.doc.lineAt(codeBlockEndPos).number;
    const hiddenLines = new Set(parameters.hideLines);
    const ranges: HiddenRange[] = [];

    const contentStartLine = firstLine + 1;
    const contentEndLine = lastLine - 1;

    let displayedLineNumber = parameters.lineNumberOffset;
    let jumpIdx = 0;
    const jumps = (parameters.lineNumberJumps || []).filter(j => j.lineNumber > parameters.lineNumberOffset);

    let currentRangeStartLine: number | null = null;
    let currentRangeEndLine: number | null = null;

    for (let i = 0; i < (contentEndLine - contentStartLine + 1); i++) {
      displayedLineNumber++;

      if (jumps && jumps.length > 0 && jumpIdx < jumps.length && displayedLineNumber === jumps[jumpIdx].lineNumber) {
        displayedLineNumber = jumps[jumpIdx].newStartNumber;
        jumpIdx++;
      }

      const absLineNumber = contentStartLine + i;

      if (hiddenLines.has(displayedLineNumber)) {
        if (currentRangeStartLine === null) {
          currentRangeStartLine = absLineNumber;
        }
        currentRangeEndLine = absLineNumber;
      } else {
        if (currentRangeStartLine !== null && currentRangeEndLine !== null) {
          addToHiddenRange(ranges, state, currentRangeStartLine, currentRangeEndLine, resolvedUnhidden);
          currentRangeStartLine = null;
          currentRangeEndLine = null;
        }
      }
    }

    if (currentRangeStartLine !== null && currentRangeEndLine !== null) {
      addToHiddenRange(ranges, state, currentRangeStartLine, currentRangeEndLine, resolvedUnhidden);
    }

    return ranges;
  }// getHiddenRanges

  function addToHiddenRange(ranges: HiddenRange[], state: EditorState, currentRangeStartLine: number, currentRangeEndLine: number, unhiddenPositions: Set<number>) {
    const from = state.doc.line(currentRangeStartLine).from;
    const to = state.doc.line(currentRangeEndLine).to;

    if (!unhiddenPositions.has(from)) {
      ranges.push({ startLine: currentRangeStartLine, endLine: currentRangeEndLine, lineCount: currentRangeEndLine - currentRangeStartLine + 1, from, to });
    }
  }// addToHiddenRange

  function calculateHideDecorations(state: EditorState, codeBlockPositions: CodeBlockPositions[], unhiddenPositions: Set<number>): DecorationSet {
    const decorations: Range<Decoration>[] = [];

    for (const block of codeBlockPositions) {
      const ranges = getHiddenRanges(state, block.parameters, block.codeBlockStartPos, block.codeBlockEndPos, unhiddenPositions);
      for (const range of ranges) {
        decorations.push(Decoration.replace({ block: true }).range(range.from, range.to));
      }
    }

    return RangeSet.of(decorations, true);
  }// calculateHideDecorations

  function getHiddenLines(state: EditorState, block: CodeBlockPositions, unhiddenPositions: Set<number> = new Set()): Set<number> {
    const ranges = getHiddenRanges(state, block.parameters, block.codeBlockStartPos, block.codeBlockEndPos, unhiddenPositions);
    const result = new Set<number>();
    for (const range of ranges) {
      for (let i = range.startLine; i <= range.endLine; i++) {
        result.add(i);
      }
    }
    return result;
  }// getHiddenLines

  return { hiddenLinesUnhiddenField, hiddenLinesField, getHiddenRanges, addToHiddenRange, calculateHideDecorations, getHiddenLines };
}// hideLinesExtension
