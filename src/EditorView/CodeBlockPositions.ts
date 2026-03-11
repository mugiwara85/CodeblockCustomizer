import { StateField, EditorState, Transaction, Line } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

import { CodeblockCustomizerSettings } from "../Settings";
import CodeBlockCustomizerPlugin from "../main";
import { CBCParameters, getAllParameters } from "../Parsing";
import { isSourceMode, getDefaultParameters } from "../Utils";

const FENCE_DETECT_REGEX = /^(`+|~+)/;

export interface CodeBlockPositions {
  codeBlockStartPos: number;
  codeBlockEndPos: number;
  parameters: CBCParameters;
  codeBlockFirstLineText: string;
}

export type GroupedCodeBlocks = {
  [groupName: string]: CodeBlockPositions[];
};

export function createCodeBlockPositionsField(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings) {
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

      if (plugin.settingsUpdated) {
        return findCodeBlockPositions(transaction.state, settings);
      }

      const { state, startState, changes } = transaction;

      // case 1: document changed
      if (transaction.docChanged) {
        const preservedHead: CodeBlockPositions[] = [];
        const filteredTail: CodeBlockPositions[] = [];

        // determine where to start re-scanning
        let from = 0;
        changes.iterChangedRanges((fromA) => {
          if (from === 0 || fromA < from) {
            from = fromA;
          }
        });

        // keep blocks before the changed section, find preceding block
        let lastPrecedingStart = -1;
        for (const block of value) {
          if (changes.touchesRange(block.codeBlockStartPos, block.codeBlockEndPos)) {
            continue;
          }
          if (block.codeBlockStartPos <= from && block.codeBlockStartPos > lastPrecedingStart) {
            lastPrecedingStart = block.codeBlockStartPos;
          }
        }

        const rescanFrom = lastPrecedingStart >= 0 ? lastPrecedingStart : 0;

        // divide into preserved head and mapped tail
        for (const block of value) {
          if (changes.touchesRange(block.codeBlockStartPos, block.codeBlockEndPos)) {
            continue;
          }
          if (block.codeBlockStartPos < rescanFrom) {
            preservedHead.push(block);
          } else {
            filteredTail.push({
              ...block,
              codeBlockStartPos: changes.mapPos(block.codeBlockStartPos),
              codeBlockEndPos: changes.mapPos(block.codeBlockEndPos)
            });
          }
        }

        // re-scan from the changed pos forward
        const updatedBlocks = findCodeBlockPositions(state, settings, changes.mapPos(rescanFrom), state.doc.length);

        // merge mapped tail and updated blocks
        const mergedTail = new Map<number, CodeBlockPositions>();
        for (const block of filteredTail) {
          mergedTail.set(block.codeBlockStartPos, block);
        }

        for (const block of updatedBlocks) {
          mergedTail.set(block.codeBlockStartPos, block);
        }

        const newTail = Array.from(mergedTail.values()).sort((a, b) => a.codeBlockStartPos - b.codeBlockStartPos);

        return preservedHead.concat(newTail);
      }

      // case 2: scroll or selection change
      //if (!startState.selection.eq(state.selection) || syntaxTree(startState) !== syntaxTree(state)) {
      if (syntaxTree(startState) !== syntaxTree(state)) {
        // just get the positions without getting the parameters yet
        const newPositions = findCodeBlockPositions(state, settings, 0, state.doc.length, true);

        // if positions match ==> nothing changed
        if (newPositions.length === value.length) {
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

        // positions did change ==> scan and get their parameters
        return findCodeBlockPositions(state, settings);
      }

      // nothing changed => return values
      return value;
    }
  });// codeBlockPositionsField
}// createCodeBlockPositionsField

export function findCodeBlockPositions(state: EditorState, settings: CodeblockCustomizerSettings, from = 0, to: number = state.doc.length, skipParameters = false): CodeBlockPositions[] {
  const positions: CodeBlockPositions[] = [];
  let codeBlockStartPos = -1;
  let codeBlockEndPos = -1;
  let parameters: CBCParameters = getDefaultParameters();

  syntaxTree(state).iterate({
    from, to,
    enter: (node) => {
      if (node.type.name.includes("HyperMD-codeblock-begin")) {
        codeBlockStartPos = node.from;
        if (skipParameters) {
          parameters = getDefaultParameters();
          const lineText = state.doc.lineAt(node.from).text.trimStart();
          const fenceMatch = lineText.match(FENCE_DETECT_REGEX);
          if (fenceMatch) {
            parameters.fenceChar = fenceMatch[0][0] as '`' | '~';
            parameters.fenceCount = fenceMatch[0].length;
          }
        } else {
          const startLine = state.doc.lineAt(node.from);
          parameters = getAllParameters(startLine.text, settings);
        }
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

const fenceRegexCache = new Map<string, RegExp>();
function getFenceRegex(fenceChar: string): RegExp {
  let regex = fenceRegexCache.get(fenceChar);
  if (!regex) {
    regex = new RegExp(`^${fenceChar}+`);
    fenceRegexCache.set(fenceChar, regex);
  }
  return regex;
}// getFenceRegex

export function findCodeBlockEnd(collapseStart: number, state: EditorState, fenceCount: number, fenceChar: '`' | '~') {
  const start = state.doc.lineAt(collapseStart).number;
  let end: Line | null = null;
  const fenceRegex = getFenceRegex(fenceChar);

  for (let i = start + 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    const match = line.text.trim().match(fenceRegex);
    const count = match ? match[0].length : 0;
    if (count === fenceCount && match && match[0][0] === fenceChar) {
      end = line;
      break;
    }
  }

  return end?.to;
}// findCodeBlockEnd

export function getVisibleCodeBlocks(positions: CodeBlockPositions[], visibleRanges: readonly { from: number, to: number }[]): CodeBlockPositions[] {
  return positions.filter(pos => {
    return visibleRanges.some(({ from, to }) => !(pos.codeBlockEndPos < from || pos.codeBlockStartPos > to));
  });
}// getVisibleCodeBlocks
