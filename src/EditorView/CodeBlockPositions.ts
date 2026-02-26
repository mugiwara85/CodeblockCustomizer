import { StateField, EditorState, Transaction, Line } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

import { CodeblockCustomizerSettings } from "../Settings";
import { CBCParameters, getAllParameters } from "../Parsing";
import { isSourceMode, getDefaultParameters } from "../Utils";

export interface CodeBlockPositions {
  codeBlockStartPos: number;
  codeBlockEndPos: number;
  parameters: CBCParameters;
  codeBlockFirstLineText: string;
}

export type GroupedCodeBlocks = {
  [groupName: string]: CodeBlockPositions[];
};

export function createCodeBlockPositionsField(settings: CodeblockCustomizerSettings, getSettingsUpdated: () => boolean) {
  return StateField.define<CodeBlockPositions[]>({
    create(state: EditorState): CodeBlockPositions[] {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(state))
        return [];

      return findCodeBlockPositions(state, settings); //return [];
    },
    update(value: CodeBlockPositions[], transaction: Transaction): CodeBlockPositions[] {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(transaction.state)) {
        return [];
      }

      if (getSettingsUpdated()) {
        return findCodeBlockPositions(transaction.state, settings);
      }

      const { state, startState, changes } = transaction;

      // case 1: document changed
      if (transaction.docChanged) {
        // get code blocks from before the transaction, that were not directly edited
        const filtered = value.filter(pos =>
          !changes.touchesRange(pos.codeBlockStartPos, pos.codeBlockEndPos)
        );

        // determine where to start re-scanning
        let from = 0;
        changes.iterChangedRanges((fromA, _toA, _fromB, _toB) => {
          const precedingBlock = filtered.slice().reverse().find(
            block => block.codeBlockStartPos <= fromA
          );
          from = precedingBlock ? precedingBlock.codeBlockStartPos : 0;
        });

        // keep blocks before the changed section
        const preservedHead = filtered.filter(block =>
          block.codeBlockStartPos < from
        );

        // take old blocks from the tail and update their positions
        const mappedTail = filtered
          .filter(block => block.codeBlockStartPos >= from)
          .map(oldBlock => ({
            ...oldBlock,
            codeBlockStartPos: changes.mapPos(oldBlock.codeBlockStartPos),
            codeBlockEndPos: changes.mapPos(oldBlock.codeBlockEndPos)
          }));

        // re-scan from the changed pos forward
        const updatedBlocks = findCodeBlockPositions(state, settings, changes.mapPos(from), state.doc.length);

        // merge the results
        const mergedTail = new Map<number, CodeBlockPositions>();
        mappedTail.forEach(block => mergedTail.set(block.codeBlockStartPos, block));
        updatedBlocks.forEach(block => mergedTail.set(block.codeBlockStartPos, block));

        const newTail = Array.from(mergedTail.values()).sort((a, b) => a.codeBlockStartPos - b.codeBlockStartPos);

        return preservedHead.concat(newTail);
      }

      // case 2: scroll or selection change
      //if (!startState.selection.eq(state.selection) || syntaxTree(startState) !== syntaxTree(state)) {
      if (syntaxTree(startState) !== syntaxTree(state)) {
        const newPositions = findCodeBlockPositions(state, settings);
        if (value.length === newPositions.length) {
          let equal = true;
          for (let i = 0; i < value.length; i++) {
            if (value[i].codeBlockStartPos !== newPositions[i].codeBlockStartPos ||
              value[i].codeBlockEndPos !== newPositions[i].codeBlockEndPos ||
              value[i].codeBlockFirstLineText !== newPositions[i].codeBlockFirstLineText) {
              equal = false;
              break;
            }
          }
          if (equal) {
            return value;
          }
        }

        // handle lazy parsing (new positions are a subset of the old positions)
        if (newPositions.length < value.length) {
          let newIdx = 0;
          let matchCount = 0;

          for (let oldIdx = 0; oldIdx < value.length && newIdx < newPositions.length; oldIdx++) {
            const oldBlock = value[oldIdx];
            const newBlock = newPositions[newIdx];

            if (oldBlock.codeBlockStartPos === newBlock.codeBlockStartPos &&
              oldBlock.codeBlockEndPos === newBlock.codeBlockEndPos &&
              oldBlock.codeBlockFirstLineText === newBlock.codeBlockFirstLineText) {
              newIdx++;
              matchCount++;
            }
          }

          if (matchCount === newPositions.length) {
            return value;
          }
        }

        return newPositions;
      }

      // nothing changed => return values
      return value;
    }
  });// codeBlockPositionsField
}// createCodeBlockPositionsField

export function findCodeBlockPositions(state: EditorState, settings: CodeblockCustomizerSettings, from = 0, to: number = state.doc.length): CodeBlockPositions[] {
  const positions: CodeBlockPositions[] = [];
  let codeBlockStartPos = -1;
  let codeBlockEndPos = -1;
  let parameters: CBCParameters = getDefaultParameters();

  syntaxTree(state).iterate({
    from, to,
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
        positions.push({ codeBlockStartPos, codeBlockEndPos, parameters, codeBlockFirstLineText: state.doc.lineAt(codeBlockStartPos).text });
        codeBlockStartPos = -1;
        codeBlockEndPos = -1;
      }
    }
  });

  if (codeBlockStartPos !== -1 && codeBlockEndPos === -1 && parameters.fenceChar) {
    const end = findCodeBlockEnd(codeBlockStartPos, state, parameters.fenceCount, parameters.fenceChar);
    if (end)
      positions.push({ codeBlockStartPos, codeBlockEndPos: end, parameters, codeBlockFirstLineText: state.doc.lineAt(codeBlockStartPos).text });
  }

  return positions;
}// findCodeBlockPositions

export function findCodeBlockEnd(collapseStart: number, state: EditorState, fenceCount: number, fenceChar: '`' | '~') {
  const start = state.doc.lineAt(collapseStart).number;
  let end: Line | null = null;

  for (let i = start + 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    const fenceRegex = new RegExp(`^${fenceChar}+`);
    const match = line.text.trim().match(fenceRegex);
    const count = match ? match[0].length : 0;
    if (count === fenceCount && match && match[0][0] === fenceChar) {
      //if (line.text.trim().startsWith('```')) {
      end = line;
      break;
    }
  }

  return end?.to;
}// findCodeBlockEnd
