import { StateField, StateEffect, EditorState, Transaction, Line, Text, ChangeSet } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

import { CodeblockCustomizerSettings } from "../Settings";
import CodeBlockCustomizerPlugin from "../main";
import { CBCParameters, getAllParameters } from "../Parsing";
import { isSourceMode, getDefaultParameters } from "../Utils";
import { findHtmlCodeBlocks, HtmlCodeBlock } from "../HtmlCodeBlocks";

const FENCE_DETECT_REGEX = /^(`+|~+)/;

export interface CodeBlockPositions {
  codeBlockStartPos: number;
  codeBlockEndPos: number;
  parameters: CBCParameters;
  codeBlockFirstLineText: string;
  htmlBlock?: { from: number, to: number }; // the block itself is from the <code> line to the </code> line
}

const htmlCodeBlockCache = new WeakMap<Text, HtmlCodeBlock[]>();

export function getHtmlCodeBlocks(state: EditorState): HtmlCodeBlock[] {
  let blocks = htmlCodeBlockCache.get(state.doc);
  if (!blocks) {
    blocks = findHtmlCodeBlocks(i => state.doc.line(i + 1).text, state.doc.lines);
    htmlCodeBlockCache.set(state.doc, blocks);
  }
  return blocks;
}// getHtmlCodeBlocks

export function getHtmlCodeBlockRange(state: EditorState, block: HtmlCodeBlock): { from: number, to: number } {
  return { from: state.doc.line(block.preStartLine + 1).from, to: state.doc.line(block.preEndLine + 1).to };
}// getHtmlCodeBlockRange

// dispatched when Obsidian replaced the source of HTML code blocks with its rendered widget in live preview (value: start positions of the blocks)
export const htmlCodeBlocksRendered = StateEffect.define<number[]>();

// in live preview the source of an HTML code block is visible while the selection is inside it. After the selection left the block, Obsidian replaces
// the source with the rendered widget only a bit later (e.g. on mouseup), so the block stays visible until the widget is rendered (stillVisible)
function isHtmlCodeBlockSourceVisible(state: EditorState, block: HtmlCodeBlock, stillVisible?: Set<number>): boolean {
  if (isSourceMode(state)) {
    return true;
  }

  const { from, to } = getHtmlCodeBlockRange(state, block);
  return state.selection.ranges.some(range => range.from <= to && range.to >= from) || (stillVisible?.has(from) ?? false);
}// isHtmlCodeBlockSourceVisible

// HTML code blocks of the previous state, which were not rendered by Obsidian in this transaction
function getStillVisibleHtmlBlocks(previous: CodeBlockPositions[], transaction: Transaction): Set<number> {
  const stillVisible = new Set<number>();
  for (const block of previous) {
    if (block.htmlBlock) {
      stillVisible.add(transaction.changes.mapPos(block.htmlBlock.from));
    }
  }

  for (const effect of transaction.effects) {
    if (effect.is(htmlCodeBlocksRendered)) {
      effect.value.forEach(from => stillVisible.delete(from));
    }
  }

  return stillVisible;
}// getStillVisibleHtmlBlocks

function htmlBlocksOutOfSync(positions: CodeBlockPositions[], state: EditorState, settings: CodeblockCustomizerSettings, stillVisible: Set<number>): boolean {
  const current = positions.filter(p => p.htmlBlock).map(p => p.htmlBlock!.from);
  const expected = settings.pluginSettings.common.enableHtmlCodeBlocks ? getHtmlCodeBlocks(state).filter(block => isHtmlCodeBlockSourceVisible(state, block, stillVisible)).map(block => getHtmlCodeBlockRange(state, block).from) : [];

  return current.length !== expected.length || current.some((from, i) => from !== expected[i]);
}// htmlBlocksOutOfSync

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
      const positions = updatePositions(value, transaction);
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(transaction.state)) {
        return positions;
      }

      // selection moved in or out of an HTML code block in live preview
      const stillVisible = getStillVisibleHtmlBlocks(value, transaction);
      return htmlBlocksOutOfSync(positions, transaction.state, settings, stillVisible) ? findCodeBlockPositions(transaction.state, settings, 0, transaction.state.doc.length, false, stillVisible) : positions;
    }
  });// codeBlockPositionsField

  function updatePositions(value: CodeBlockPositions[], transaction: Transaction): CodeBlockPositions[] {
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
        if (touchesBlock(changes, block)) {
          continue;
        }
        if (block.codeBlockStartPos <= from && block.codeBlockStartPos > lastPrecedingStart) {
          lastPrecedingStart = block.codeBlockStartPos;
        }
      }

      const rescanFrom = lastPrecedingStart >= 0 ? lastPrecedingStart : 0;

      // divide into preserved head and mapped tail
      for (const block of value) {
        if (touchesBlock(changes, block)) {
          continue;
        }
        if (block.codeBlockStartPos < rescanFrom) {
          preservedHead.push(block);
        } else {
          filteredTail.push({
            ...block,
            codeBlockStartPos: changes.mapPos(block.codeBlockStartPos),
            codeBlockEndPos: changes.mapPos(block.codeBlockEndPos),
            ...(block.htmlBlock && { htmlBlock: { from: changes.mapPos(block.htmlBlock.from), to: changes.mapPos(block.htmlBlock.to) } })
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
  }// updatePositions
}// createCodeBlockPositionsField

export function findCodeBlockPositions(state: EditorState, settings: CodeblockCustomizerSettings, from = 0, to: number = state.doc.length, skipParameters = false, stillVisibleHtmlBlocks?: Set<number>): CodeBlockPositions[] {
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

  if (settings.pluginSettings.common.enableHtmlCodeBlocks) {
    positions.push(...findHtmlCodeBlockPositions(state, settings, from, to, skipParameters, stillVisibleHtmlBlocks));
    positions.sort((a, b) => a.codeBlockStartPos - b.codeBlockStartPos);
  }

  return positions;
}// findCodeBlockPositions

function findHtmlCodeBlockPositions(state: EditorState, settings: CodeblockCustomizerSettings, from: number, to: number, skipParameters: boolean, stillVisible?: Set<number>): CodeBlockPositions[] {
  const positions: CodeBlockPositions[] = [];

  for (const block of getHtmlCodeBlocks(state)) {
    const htmlBlock = getHtmlCodeBlockRange(state, block);
    if (htmlBlock.to < from || htmlBlock.from > to || !isHtmlCodeBlockSourceVisible(state, block, stillVisible)) {
      continue;
    }

    const firstLine = state.doc.line(block.codeOpenLine + 1);
    const parameters = skipParameters ? getDefaultParameters() : getAllParameters(firstLine.text, settings);
    parameters.fenceChar = '`';
    parameters.fenceCount = 3;
    parameters.group = ''; // not supported for HTML code blocks

    positions.push({ codeBlockStartPos: firstLine.from, codeBlockEndPos: state.doc.line(block.codeCloseLine + 1).to, parameters, codeBlockFirstLineText: firstLine.text, htmlBlock });
  }

  return positions;
}// findHtmlCodeBlockPositions

function touchesBlock(changes: ChangeSet, block: CodeBlockPositions): boolean {
  return changes.touchesRange(block.htmlBlock?.from ?? block.codeBlockStartPos, block.htmlBlock?.to ?? block.codeBlockEndPos) !== false;
}// touchesBlock

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
