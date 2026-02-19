import { MarkdownRenderer, Notice, editorEditorField, editorInfoField, setIcon } from "obsidian";

import { StateField, StateEffect, EditorState, Transaction, Extension, Range, RangeSet, Line, EditorSelection, Annotation } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { bracketMatching, syntaxTree } from "@codemirror/language";
import { SyntaxNodeRef } from "@lezer/common";
import { highlightSelectionMatches } from "@codemirror/search";

import { getLanguageIcon, createContainer, createCodeblockLang, createCodeblockIcon, createFileName, createCodeblockCollapse, getBorderColorByLanguage, getCurrentMode, isSourceMode, getLanguageSpecificColorClass, createObjectCopy, findAllOccurrences, createUncollapseCodeButton, addTextToClipboard, getPropertyFromLanguageSpecificColors, getDefaultParameters, getInlineCodeIcon, normalizeIndentation, isPluginLoaded, generateSnapshot, isSpecificHeader, determineDefaultFoldState, filterOccurrences, getDisplayLanguageName, getCollapseIcons } from "./Utils";
import { TooltipManager } from "./TooltipManager";
import { ButtonModifierKeys, CodeblockCustomizerSettings, FoldingPersistence, FoldingScope, InlineCodeModifierKeys, TabPersistence, CollapseIconStyle } from "./Settings";
import { ANNOTATION_PATTERN, DEFAULT_TEXT_SEPARATOR, fadeOutLineCount, INLINE_CODE_LANG_REGEX, rhombusSVG } from "./Const";
import CodeBlockCustomizerPlugin from "./main";
import { PromptLineRenderResult, PromptManager } from "./PromptManager";
import { createButtons, extractCodeBlocksFromAdmonition, extractLinesFromHTML, renderCodeBlockLines } from "./ReadingViewUtils";
import { createExecuteCodeEditButton, verifyAndRevealExecuteButtons } from "./ExecuteCode";
import { CodeBlockRenderer } from "./CodeBlockRenderer";
import { CBCParameters, getAllParameters, HighlightedWord } from "./Parsing";

let settingsUpdated = false;
export function updateValue(newValue: boolean) {
  settingsUpdated = newValue;
}

let resetFoldDecorations = false;
export function resetFoldDecos(newValue: boolean) {
  resetFoldDecorations = newValue;
}

export interface ReplaceFadeOutRanges {
  replaceStart: Line;
  replaceEnd: Line;
  fadeOutStart: Line;
  fadeOutEnd: Line;
  firstLine: Line;
}

export interface CodeBlockPositions {
  codeBlockStartPos: number;
  codeBlockEndPos: number;
  parameters: CBCParameters;
  codeBlockFirstLineText: string;
}

type GroupedCodeBlocks = {
  [groupName: string]: CodeBlockPositions[];
};

interface ButtonConfig {
  class: string;
  displayText: string;
  action: (view: EditorView, container?: HTMLElement, event?: MouseEvent) => void;
  icon: string;
  text?: string;
  enabled: boolean;
}

export const FoldingState = {
  Unfolded: 'unfolded',
  FullyFolded: 'fully-folded',
  SemiFolded: 'semi-folded',
} as const;
export type FoldingState = (typeof FoldingState)[keyof typeof FoldingState];

export const FoldCommand = {
  Default: 0,
  FoldAll: 1,
  UnfoldAll: 2,
} as const;
export type FoldCommand = (typeof FoldCommand)[keyof typeof FoldCommand];

export function extensions(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings) {
  /* annotations, effects */

  const setFoldCommandState = StateEffect.define<FoldCommand>();
  const setFoldState = Annotation.define<{ docPath: string; startPos: number; state: FoldingState | null }>();
  const setGroupTab = Annotation.define<{ group: string; startPos: number }>();
  const CollapsedDecoration = Decoration.replace({ block: true, attributes: { "code-folded": "true" } });
  const Collapse = StateEffect.define<Range<Decoration>>();
  const UnCollapse = StateEffect.define<{ filter: (from: number, to: number) => boolean; filterFrom: number; filterTo: number }>();
  const semiCollapse = StateEffect.define<Range<Decoration>>();
  const semiUnCollapse = StateEffect.define<{ filterFrom: number, filterTo: number }>();
  const semiFade = StateEffect.define<Range<Decoration>>();
  const semiUnFade = StateEffect.define<{ filterFrom: number; filterTo: number }>();

  type CollapseEffect = Range<Decoration>;
  type UncollapseEffect = { filter: (from: number, to: number) => boolean; filterFrom: number; filterTo: number };
  type SemiUncollapseEffect = { filterFrom: number; filterTo: number };

  type CodeBlockFoldEffect =
    | StateEffect<CollapseEffect>
    | StateEffect<UncollapseEffect>
    | StateEffect<SemiUncollapseEffect>;

  /* StateFields */

  const headerField = StateField.define<DecorationSet>({
    create(state: EditorState): DecorationSet {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(state))
        return Decoration.none;

      return insertHeader(state);
    },
    update(value: DecorationSet, transaction: Transaction): DecorationSet {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(transaction.state))
        return Decoration.none;

      const docChanged = transaction.docChanged;
      const oldState = transaction.startState;
      const newState = transaction.state;

      const positionsChanged = oldState.field(codeBlockPositionsField, false) !== newState.field(codeBlockPositionsField, false);
      const tabsChanged = oldState.field(activeGroupTabField, false) !== newState.field(activeGroupTabField, false);
      const foldChanged = oldState.field(collapseField, false) !== newState.field(collapseField, false);
      const selectionChanged = !oldState.selection.eq(newState.selection);
      const alwaysShowButtons = settings.pluginSettings.codeblock.buttons.alwaysShowButtons;
      let needsSelectionUpdate = false;

      if (!alwaysShowButtons && selectionChanged) { // check if selection moved in, or out of a code block
        const oldHead = oldState.selection.main.head;
        const newHead = newState.selection.main.head;
        const oldPositions = oldState.field(codeBlockPositionsField, false) || [];
        const newPositions = newState.field(codeBlockPositionsField, false) || [];

        const oldPos = oldPositions.find(
          block => oldHead >= block.codeBlockStartPos && oldHead <= block.codeBlockEndPos
        );

        const newPos = newPositions.find(
          block => newHead >= block.codeBlockStartPos && newHead <= block.codeBlockEndPos
        );

        if (oldPos !== newPos) {
          needsSelectionUpdate = true;
        }
      }

      if (!docChanged && !settingsUpdated && !positionsChanged && !tabsChanged && !foldChanged && !needsSelectionUpdate) {
        return value;
      }
      return insertHeader(transaction.state);
    },
    provide(field: StateField<DecorationSet>): Extension {
      return EditorView.decorations.from(field);
    }
  });// headerField

  const codeBlockPositionsField = StateField.define<CodeBlockPositions[]>({
    create(state: EditorState): CodeBlockPositions[] {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(state))
        return [];

      return findCodeBlockPositions(state); //return [];
    },
    update(value: CodeBlockPositions[], transaction: Transaction): CodeBlockPositions[] {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(transaction.state)) {
        return [];
      }

      if (settingsUpdated) {
        return findCodeBlockPositions(transaction.state);
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
        changes.iterChangedRanges((fromA, toA, fromB, toB) => {
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
        const updatedBlocks = findCodeBlockPositions(state, changes.mapPos(from), state.doc.length);

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
        const newPositions = findCodeBlockPositions(state);
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

  const collapseField = StateField.define<RangeSet<Decoration>>({
    create(state): RangeSet<Decoration> {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(state))
        return Decoration.none;

      const codeBlockPositions = state.field(codeBlockPositionsField, false) ?? [];
      const rememberedFolds = state.field(rememberedFoldField, false) ?? {};
      const unfoldedBlocks = state.field(defaultFoldUnfoldedField, false) ?? new Set<number>();
      const grouped = state.field(groupedCodeBlocksField, false) ?? {};
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

      if ((newCodeBlockPositions !== oldCodeBlockPositions && !compareCodeBlockPositions(oldCodeBlockPositions, newCodeBlockPositions)) || newFoldState !== oldFoldState || resetFoldDecorations || globalFoldCmdChanged || tr.reconfigured) {
        if (resetFoldDecorations || globalFoldCmdChanged) {
          value = Decoration.none;  // remove fold e.g. when inversefold is disabled
        }

        const rememberedFolds = newFoldState ?? {};
        const unfoldedBlocks = tr.state.field(defaultFoldUnfoldedField, false) ?? new Set<number>();
        const grouped = tr.state.field(groupedCodeBlocksField, false) ?? {};

        value = calculateFoldDecorations(tr.state, value, newCodeBlockPositions, rememberedFolds, unfoldedBlocks, grouped, globalFoldCmd);
      }

      return value;
    },
    provide: f => EditorView.decorations.from(f)
  });// collapseField

  const activeGroupTabField = StateField.define<Record<string, number>>({
    create(state: EditorState) {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(state))
        return {};

      const tabSettings = settings.pluginSettings.groupedCodeBlocks;
      if (!tabSettings.rememberTabState) {
        return {};
      }

      const initialGrouped = state.field(groupedCodeBlocksField, false) ?? {};
      const initialTabs: { [groupName: string]: number } = {};
      const docPath = state.field(editorInfoField)?.file?.path;

      let savedStatesForFile: Map<string, number> | undefined;
      if (docPath) {
        if (tabSettings.persistence === TabPersistence.Permanent) {
          savedStatesForFile = plugin.loadPermanentEditorTabs(docPath);
        } else {
          savedStatesForFile = plugin.activeEditorTabs.get(docPath);
        }
      }

      // restore saved state if present
      for (const groupName in initialGrouped) {
        const groupMembers = initialGrouped[groupName];
        if (groupMembers.length > 0) {
          let activePos = groupMembers[0].codeBlockStartPos; // default to first tab

          if (savedStatesForFile) {
            const savedPos = savedStatesForFile.get(groupName);
            if (savedPos !== undefined) {
              const blockExists = groupMembers.some(b => b.codeBlockStartPos === savedPos);
              if (blockExists) {
                activePos = savedPos;
              }
            }
          }
          initialTabs[groupName] = activePos;
        }
      }

      return initialTabs;
    },
    update(value, transaction) {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(transaction.state))
        return {};

      const docPath = transaction.state.field(editorInfoField)?.file?.path;

      // on every document change immediately update the persistent storage
      if (transaction.docChanged && docPath) {
        plugin.remapTabs(docPath, transaction.changes);
        const docStateMap = plugin.activeEditorTabs.get(docPath);
        if (docStateMap && docStateMap.size > 0) {
          const newDocStateMap = new Map<string, number>();
          for (const [groupName, savedPos] of docStateMap.entries()) {
            //fix for #144
            if (savedPos > transaction.changes.length)
              continue;

            const newPos = transaction.changes.mapPos(savedPos);
            if (newPos !== -1) {
              newDocStateMap.set(groupName, newPos);
            }
          }
          plugin.activeEditorTabs.set(docPath, newDocStateMap);
        }
      }

      // case 1: a tab was clicked => save
      const groupUpdate = transaction.annotation(setGroupTab);
      if (groupUpdate) {
        const tabSettings = settings.pluginSettings.groupedCodeBlocks;
        if (tabSettings.rememberTabState && docPath) {
          const newStartPos = transaction.changes.mapPos(groupUpdate.startPos);
          if (newStartPos !== -1) {
            const groupName = groupUpdate.group;

            if (tabSettings.persistence === TabPersistence.Permanent) {
              if (!plugin.permanentEditorTabs[docPath]) {
                plugin.permanentEditorTabs[docPath] = {};
              }
              plugin.permanentEditorTabs[docPath][groupName] = newStartPos;
              plugin.requestSavePermanentData();
            } else {
              let docStateMap = plugin.activeEditorTabs.get(docPath);
              if (!docStateMap) {
                docStateMap = new Map<string, number>();
                plugin.activeEditorTabs.set(docPath, docStateMap);
              }
              docStateMap.set(groupName, newStartPos);
            }
          }
        }
        const newStartPos = transaction.changes.mapPos(groupUpdate.startPos);
        if (newStartPos !== -1) {
          return { ...value, [groupUpdate.group]: newStartPos };
        }
        return value;
      }

      const oldGroups = transaction.startState.field(groupedCodeBlocksField, false);
      const newGroups = transaction.state.field(groupedCodeBlocksField, false);

      // case 2: document changed or new groups scrolled into view
      if (transaction.docChanged || oldGroups !== newGroups) {
        const newState: Record<string, number> = {};
        const newGroupedCodeBlocks = newGroups ?? {};
        const tabSettings = settings.pluginSettings.groupedCodeBlocks;

        let savedStatesForFile: Map<string, number> | undefined;
        if (docPath && tabSettings.rememberTabState) {
          if (tabSettings.persistence === TabPersistence.Permanent) {
            savedStatesForFile = plugin.loadPermanentEditorTabs(docPath);
          } else {
            savedStatesForFile = plugin.activeEditorTabs.get(docPath);
          }
        }

        for (const groupName in newGroupedCodeBlocks) {
          const groupMembers = newGroupedCodeBlocks[groupName];
          if (groupMembers.length === 0)
            continue;

          let activePos: number | undefined;

          if (savedStatesForFile) {
            const savedPos = savedStatesForFile.get(groupName);
            if (savedPos !== undefined) {
              const correspondingBlock = groupMembers.find(b => b.codeBlockStartPos === savedPos);
              if (correspondingBlock) {
                activePos = correspondingBlock.codeBlockStartPos;
              }
            }
          }

          // if no saved state was found, default to the first tab
          newState[groupName] = activePos ?? groupMembers[0].codeBlockStartPos;
        }

        return newState;
      }

      // case 3: nothing changed => return values
      return value;
    },
  });// activeGroupTabField

  const groupedCodeBlocksField = StateField.define<GroupedCodeBlocks>({
    create(state: EditorState): GroupedCodeBlocks {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(state))
        return {};

      return calculateGroupedCodeBlocks(state);
    },

    update(grouped: GroupedCodeBlocks, transaction: Transaction): GroupedCodeBlocks {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(transaction.state))
        return {};

      const newCodeBlockPositions = transaction.state.field(codeBlockPositionsField, false) ?? [];
      const oldCodeBlockPositions = transaction.startState.field(codeBlockPositionsField, false) ?? [];

      if (newCodeBlockPositions !== oldCodeBlockPositions) {
        return calculateGroupedCodeBlocks(transaction.state);
      }

      return grouped;
    },
  });// groupedCodeBlocksField

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

  /* Extensions */

  const customBracketMatching = bracketMatching({
    renderMatch: (match, state) => {
      const decorations: Range<Decoration>[] = [];

      if (!match.matched) {
        if (settings.pluginSettings.codeblock.highlightNonMatchingBrackets) {
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

  /* ViewPlugins */

  const viewPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.startState.field(codeBlockPositionsField) !== update.state.field(codeBlockPositionsField) || settingsUpdated) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      updateValue(false);
      resetFoldDecos(false);
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(view.state))
        return Decoration.none;

      const defaultCharWidth = view.state.field(editorEditorField).defaultCharacterWidth;
      const positions = view.state.field(codeBlockPositionsField, false) ?? [];
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

        let lineNumber = parameters.lineNumberOffset;
        const rawLineCount = lastCodeBlockLine - firstCodeBlockLine - 1;
        const gutterStyle = getGutterStyle(parameters, rawLineCount, defaultCharWidth);
        const prompt = new PromptManager(parameters, rawLineCount, settings);
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
          //lineNumber++;
        }
      }
      return RangeSet.of(decorations, true);
    }
  }, {
    decorations: v => v.decorations
  });// viewPlugin

  const inlineCodeViewPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    prevEnableSyntaxHighlight: boolean;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
      this.prevEnableSyntaxHighlight = settings.pluginSettings.inlineCode.enableSyntaxHighlight;
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || this.prevEnableSyntaxHighlight != settings.pluginSettings.inlineCode.enableSyntaxHighlight) {
        this.decorations = this.buildDecorations(update.view);
        this.prevEnableSyntaxHighlight = settings.pluginSettings.inlineCode.enableSyntaxHighlight;
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(view.state))
        return Decoration.none;

      const decorations: Array<Range<Decoration>> = [];
      const selection = view.state.selection.main;

      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from, to,
          enter: (node) => {
            if (!node.type.name.startsWith('inline-code'))
              return;

            decorations.push(Decoration.mark({ class: "codeblock-customizer-inline-code-wrapper" }).range(node.from, node.to));
            if (!settings.pluginSettings.inlineCode.enableSyntaxHighlight) {
              return;
            }

            const inlineCodeText = view.state.sliceDoc(node.from, node.to);
            const match = inlineCodeText.match(INLINE_CODE_LANG_REGEX);
            // fix for #147
            if (!match || match[1].trim().startsWith('{'))
              return;

            const fullMatchText = match[0];
            const langName = match[1].toLowerCase();
            const code = match[2];
            if (!code)
              return;

            const prefixLength = fullMatchText.length - code.length;
            const codeStartPos = node.from + prefixLength;
            const isCursorNextToBacktick = selection.from === node.from - 1 || selection.to === node.to + 1;
            const isCursorInside = selection.from >= node.from && selection.to <= node.to;
            if (isCursorInside || isCursorNextToBacktick) {
              decorations.push(Decoration.mark({ class: "codeblock-customizer-inline-code-langauge" }).range(node.from, codeStartPos));
            } else {
              const displayLanguage = getDisplayLanguageName(langName);
              const Icon = getLanguageIcon(displayLanguage);
              if (Icon) {
                decorations.push(Decoration.replace({ widget: new inlineCodeIconWidget(displayLanguage) }).range(node.from, codeStartPos));
              }
              else {
                decorations.push(Decoration.replace({}).range(node.from, codeStartPos));
              }
            }

            const tokens = getCM5Tokens(code, langName);
            let currentPos = codeStartPos;
            for (const token of tokens) {
              if (token.style) {
                const classes = token.style.split(' ').map(s => `cm-${s}`).join(' ');
                if (token.text.length > 0) {
                  decorations.push(Decoration.mark({ class: classes }).range(currentPos, currentPos + token.text.length));
                }
              }
              currentPos += token.text.length;
            }
          },
        });
      }
      return RangeSet.of(decorations, true);
    }
  }, {
    decorations: v => v.decorations,
    eventHandlers: {
      click: (event, view) => {
        if (!settings.pluginSettings.inlineCode.enableCopyOnClick)
          return;

        const requiredKey = plugin.settings.pluginSettings.inlineCode.copyModifierKey;
        if ((requiredKey === InlineCodeModifierKeys.CTRL && !event.ctrlKey) || (requiredKey === InlineCodeModifierKeys.ALT && !event.altKey))
          return;

        const target = event.target as HTMLElement;
        const wrapper = target.closest('.codeblock-customizer-inline-code-wrapper');
        if (!wrapper)
          return;

        event.preventDefault();
        event.stopImmediatePropagation();

        const pos = view.posAtDOM(target);
        if (pos === null)
          return;

        let found = false;
        syntaxTree(view.state).iterate({
          from: pos, to: pos,
          enter: (node) => {
            if (found)
              return false;

            if (node.type.name.startsWith('inline-code')) {
              const text = view.state.sliceDoc(node.from, node.to);
              const match = text.match(INLINE_CODE_LANG_REGEX);
              // fix for #147
              const isValidMatch = match && match[1] && !match[1].trim().startsWith('{');
              const textToCopy = isValidMatch && match[2] ? match[2] : text;
              addTextToClipboard(textToCopy);
              found = true;

              return false;
            }
          }
        });
      }
    }
  });// inlineCodeViewPlugin

  const linkViewPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || update.startState.field(codeBlockPositionsField) !== update.state.field(codeBlockPositionsField)) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(view.state)) {
        return Decoration.none;
      }

      if (!settings.pluginSettings.codeblock.enableLinks) {
        return Decoration.none;
      }

      const decorations: Array<Range<Decoration>> = [];
      const sourcePath = view.state.field(editorInfoField)?.file?.path ?? "";
      const codeBlockPositions = view.state.field(codeBlockPositionsField, false) ?? [];
      const visibleRanges = view.visibleRanges;
      const visibleBlocks = codeBlockPositions.filter(pos => {
        return visibleRanges.some(({ from, to }) => !(pos.codeBlockEndPos < from || pos.codeBlockStartPos > to));
      });

      for (const { codeBlockStartPos, codeBlockEndPos, parameters } of visibleBlocks) {
        if (parameters.exclude) {
          continue;
        }

        checkForLinks(view.state, codeBlockStartPos, codeBlockEndPos, decorations, sourcePath);
      }

      return RangeSet.of(decorations, true);
    }
  }, {
    decorations: v => v.decorations
  });// linkViewPlugin

  const annotationViewPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    prevConvertAllComments: boolean;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
      this.prevConvertAllComments = plugin.settings.pluginSettings.annotations.convertAllComments;
    }

    update(update: ViewUpdate) {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(update.view.state))
        return Decoration.none;

      const oldCursorLine = update.startState.doc.lineAt(update.startState.selection.main.head).number;
      const newCursorLine = update.state.doc.lineAt(update.state.selection.main.head).number;
      const settingChanged = this.prevConvertAllComments !== plugin.settings.pluginSettings.annotations.convertAllComments;

      if (update.docChanged || update.viewportChanged || oldCursorLine !== newCursorLine || settingChanged) {
        this.decorations = this.buildDecorations(update.view);
        if (settingChanged) {
          this.prevConvertAllComments = plugin.settings.pluginSettings.annotations.convertAllComments;
        }
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      const decorations: Array<Range<Decoration>> = [];
      const codeBlockPositions = view.state.field(codeBlockPositionsField, false) ?? [];
      const cursorPos = view.state.selection.main.head;
      const cursorLineNumber = view.state.doc.lineAt(cursorPos).number;

      for (const pos of codeBlockPositions) {
        syntaxTree(view.state).iterate({
          from: pos.codeBlockStartPos, to: pos.codeBlockEndPos,
          enter: (node) => {
            if (!node.type.name.includes("comment"))
              return;

            const annotationLineNumber = view.state.doc.lineAt(node.from).number;
            if (cursorLineNumber === annotationLineNumber) {
              return;
            }

            const commentText = view.state.sliceDoc(node.from, node.to);
            const cleanCommentText = commentText.replace(/^\s*(?:\/\/|#|--|\/\*)\s*|\s*\*\/$/g, '').trim();
            const match = cleanCommentText.match(ANNOTATION_PATTERN);

            let type: string;
            let content: string;
            let title: string | undefined;

            if (match && match.groups) {
              type = match.groups.type;
              content = match.groups.content;
              title = match.groups.title;
            } else if (plugin.settings.pluginSettings.annotations.convertAllComments) {
              type = 'note';
              content = cleanCommentText;
            } else {
              return;
            }
            const line = view.state.doc.lineAt(node.from);
            // hide comment node
            decorations.push(Decoration.replace({}).range(node.from, node.to));
            decorations.push(Decoration.widget({ widget: new AnnotationIconWidget(type, content.trim(), plugin, title), side: -1 }).range(line.from));
          },
        });
      }

      return RangeSet.of(decorations, true);
    }
  }, {
    decorations: v => v.decorations
  });// annotationViewPlugin

  const hideFencesPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || update.startState.field(codeBlockPositionsField) !== update.state.field(codeBlockPositionsField) || settingsUpdated) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      updateValue(false);
      resetFoldDecos(false);
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(view.state)) {
        return Decoration.none;
      }

      const positions = view.state.field(codeBlockPositionsField, false) ?? [];
      const visibleRanges = view.visibleRanges;
      const decorations: Array<Range<Decoration>> = [];
      const cursorPos = view.state.selection.main.head;

      const visibleBlocks = positions.filter(pos => {
        return visibleRanges.some(({ from, to }) => !(pos.codeBlockEndPos < from || pos.codeBlockStartPos > to));
      });

      const hideFences = settings.pluginSettings.codeblock.hideFenceLines;
      const collapsedFenceDecoration = Decoration.line({ attributes: { class: 'codeblock-customizer-fence-collapsed' } });

      for (const pos of visibleBlocks) {
        const { codeBlockStartPos, codeBlockEndPos, parameters } = pos;

        if (parameters.exclude) {
          continue;
        }

        const firstCodeBlockLine = view.state.doc.lineAt(codeBlockStartPos).number;
        const lastCodeBlockLine = view.state.doc.lineAt(codeBlockEndPos).number;
        const isCursorInsideThisBlock = cursorPos >= codeBlockStartPos && cursorPos <= codeBlockEndPos;
        const lineCount = lastCodeBlockLine - firstCodeBlockLine + 1;

        const hideFenceLines = hideFences && !isCursorInsideThisBlock && lineCount > 2;

        if (hideFenceLines) {
          const firstLine = view.state.doc.lineAt(codeBlockStartPos);
          decorations.push(collapsedFenceDecoration.range(firstLine.from));

          if (codeBlockStartPos !== codeBlockEndPos) {
            const lastLine = view.state.doc.lineAt(codeBlockEndPos);
            decorations.push(collapsedFenceDecoration.range(lastLine.from));
          }
        }

        let buttonLineStartPos: number;
        const firstCodeBlockLineNum = view.state.doc.lineAt(codeBlockStartPos).number;

        if (hideFenceLines) {
          // buttons go in the first line
          buttonLineStartPos = view.state.doc.line(firstCodeBlockLineNum + 1).from;
        } else {
          // buttons go in the opening code block line
          buttonLineStartPos = view.state.doc.lineAt(codeBlockStartPos).from;
        }

        const buttonConfigs = createButtonConfigs(codeBlockStartPos, codeBlockEndPos, view.state, parameters);
        const modifierKey = plugin.settings.pluginSettings.codeblock.buttons.modifierKey;
        decorations.push(Decoration.widget({ widget: new buttonWidget(buttonConfigs, pos, modifierKey), side: -1 }).range(buttonLineStartPos));
      }
      return RangeSet.of(decorations, true);
    }
  }, {
    decorations: v => v.decorations
  });// hideFencesPlugin

  const executeCodeViewPlugin = ViewPlugin.fromClass(class {
    private observer: MutationObserver;

    constructor(view: EditorView) {
      this.observer = new MutationObserver((mutations) => {
        this.handleMutations(mutations, view);
      });

      if (plugin.settings.pluginSettings.plugins.executeCode.enabled && isPluginLoaded('execute-code', plugin)) {
        this.observer.observe(view.contentDOM, { childList: true, subtree: true });
      }
    }

    private handleMutations(mutations: MutationRecord[], view: EditorView) {
      if (!plugin.settings.pluginSettings.plugins.executeCode.enabled || !isPluginLoaded('execute-code', plugin)) {
        return;
      }

      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (!(node instanceof HTMLElement)) {
            continue;
          }

          const runButtons = node.querySelectorAll<HTMLElement>('.run-code-button');
          runButtons.forEach(button => this.processRunButton(button, view));
        }
      }
    }

    private processRunButton(button: HTMLElement, view: EditorView) {
      const preElement = button.closest('pre');
      if (!preElement || !preElement.isConnected || preElement.hasAttribute('data-cbc-processed')) {
        return;
      }

      // hide default edit button for rendered code blocks
      const blockContainer = preElement.closest('.cm-preview-code-block');
      if (blockContainer) {
        const editButton = blockContainer.querySelector<HTMLElement>('.edit-block-button');
        if (editButton) {
          editButton.style.display = 'none';
        }
      }

      const pos = view.posAtDOM(preElement);
      if (pos === null) {
        return;
      }

      const codeBlocks = view.state.field(codeBlockPositionsField, false) ?? [];
      const block = codeBlocks.find(b => pos >= b.codeBlockStartPos && pos <= b.codeBlockEndPos);
      if (block && block.parameters.language.startsWith('run-')) {
        const rawLines = view.state.sliceDoc(block.codeBlockStartPos, block.codeBlockEndPos);
        styleExecuteCodeWidget(preElement, rawLines);
      }
    }

    destroy() {
      this.observer.disconnect();
    }
  });// executeCodeViewPlugin

  const admonitionViewgPlugin = ViewPlugin.fromClass(class {
    private observer: MutationObserver;

    constructor(view: EditorView) {
      this.observer = new MutationObserver((mutations) => this.handleMutations(mutations, view));
      if (plugin.settings.pluginSettings.plugins.admonitions.enabled && isPluginLoaded('obsidian-admonition', plugin)) {
        this.observer.observe(view.contentDOM, { childList: true, subtree: true });
        this.processAllAdmonitions(view.contentDOM, view);
      }
    }

    private handleMutations(mutations: MutationRecord[], view: EditorView) {
      if (!plugin.settings.pluginSettings.plugins.admonitions.enabled || !isPluginLoaded('obsidian-admonition', plugin)) {
        return;
      }

      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof HTMLElement) {
            if (node.matches('.cm-preview-code-block, .admonition')) {
              this.processAllAdmonitions(node, view);
            }
          }
        }
      }
    }

    private processAllAdmonitions(container: HTMLElement, view: EditorView) {
      if (!plugin.settings.pluginSettings.plugins.admonitions.enabled || !isPluginLoaded('obsidian-admonition', plugin)) {
        return;
      }

      const admonitions = container.querySelectorAll<HTMLElement>('.admonition:not([data-cbc-lp-processed])');

      admonitions.forEach(admonitionEl => {
        if (!admonitionEl.isConnected) {
          return;
        }

        admonitionEl.setAttribute('data-cbc-lp-processed', 'true');

        const pos = view.posAtDOM(admonitionEl);
        if (pos === null) {
          return;
        }

        const allBlocksInView = view.state.field(codeBlockPositionsField, false) ?? [];
        const admonitionBlockData = allBlocksInView.find(b => pos >= b.codeBlockStartPos && pos <= b.codeBlockEndPos);
        if (!admonitionBlockData) {
          return;
        }

        const admonitionSourceText = view.state.sliceDoc(admonitionBlockData.codeBlockStartPos, admonitionBlockData.codeBlockEndPos);
        const admonitionSourceLines = admonitionSourceText.split('\n');

        const innerCodeBlocks = extractCodeBlocksFromAdmonition(admonitionSourceLines);
        if (innerCodeBlocks.length === 0) {
          return;
        }

        const renderedPreElements = Array.from(admonitionEl.querySelectorAll('div.admonition-content pre:not(.frontmatter)')) as HTMLElement[];
        if (renderedPreElements.length !== innerCodeBlocks.length) {
          return;
        }

        const fileContentLines = view.state.doc.toString().split('\n');

        for (const [index, preElement] of renderedPreElements.entries()) {
          const blockData = innerCodeBlocks[index];
          if (!blockData) {
            continue;
          }

          const renderer = new CodeBlockRenderer(preElement, plugin, { sourcePath: view.state.field(editorInfoField)?.file?.path ?? "" } as any);
          const absoluteLineStart = view.state.doc.lineAt(admonitionBlockData.codeBlockStartPos).number + blockData.startLine;
          const absoluteLineEnd = view.state.doc.lineAt(admonitionBlockData.codeBlockStartPos).number + blockData.endLine;
          const sectionInfo = { lineStart: absoluteLineStart - 1, lineEnd: absoluteLineEnd - 1, text: blockData.contentLines.join('\n') };
          renderer.renderExternal(blockData.firstLine, blockData.contentLines, sectionInfo, fileContentLines);
        }
      });
    }

    destroy() {
      this.observer.disconnect();
    }
  });// admonitionViewgPlugin

  /* Widgets */

  class HeaderWidget extends WidgetType {
    enableLinks: boolean;
    languageSpecificColors: Record<string, string>;
    parameters: CBCParameters;
    specificHeader: boolean;
    pos: CodeBlockPositions
    buttonConfigs: Array<ButtonConfig>;
    groupMembers: CodeBlockPositions[];
    foldingState: FoldingState;
    sourcePath: string;
    disableFoldUnlessSpecified: boolean;
    showAddRemoveButtons: boolean;
    modifierKey: ButtonModifierKeys;
    plugin: CodeBlockCustomizerPlugin;
    collapseIconStyle: CollapseIconStyle;

    constructor(parameters: CBCParameters, specificHeader: boolean, pos: CodeBlockPositions, buttonConfigs: Array<ButtonConfig>, groupMembers: CodeBlockPositions[], foldingState: FoldingState, sourcePath: string, plugin: CodeBlockCustomizerPlugin, modifierKey: ButtonModifierKeys) {
      super();
      this.parameters = parameters;
      this.specificHeader = specificHeader;
      this.pos = pos;
      this.buttonConfigs = buttonConfigs;
      this.enableLinks = plugin.settings.pluginSettings.codeblock.enableLinks;

      const allLangColors = plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors;
      const langKey = this.parameters.language.length > 0 ? this.parameters.language : "nolang";
      const lowerCaseLangKey = langKey.toLowerCase();
      const result = Object.keys(allLangColors).find(k => k.toLowerCase() === lowerCaseLangKey);
      this.languageSpecificColors = createObjectCopy(result ? allLangColors[result] : {});
      this.groupMembers = groupMembers;
      this.foldingState = foldingState;
      this.sourcePath = sourcePath;
      this.disableFoldUnlessSpecified = plugin.settings.pluginSettings.header.disableFoldUnlessSpecified;
      this.showAddRemoveButtons = plugin.settings.pluginSettings.groupedCodeBlocks.showAddRemoveButtons;
      this.plugin = plugin;
      this.modifierKey = modifierKey;
      this.collapseIconStyle = plugin.settings.pluginSettings.header.collapseIconStyle;
    }

    eq(other: HeaderWidget) {
      return other.parameters.headerDisplayText === this.parameters.headerDisplayText && other.parameters.language === this.parameters.language &&
        other.specificHeader === this.specificHeader && other.parameters.fold === this.parameters.fold &&
        other.parameters.hasLangBorderColor === this.parameters.hasLangBorderColor && other.enableLinks === this.enableLinks && //other.marginLeft === this.marginLeft &&
        other.parameters.indentLevel === this.parameters.indentLevel && other.pos.codeBlockStartPos === this.pos.codeBlockStartPos && other.pos.codeBlockEndPos === this.pos.codeBlockEndPos && other.sourcePath === this.sourcePath &&
        other.plugin === this.plugin && areObjectsEqual(other.languageSpecificColors, this.languageSpecificColors) && compareButtonConfigs(this.buttonConfigs, other.buttonConfigs) &&
        other.disableFoldUnlessSpecified === this.disableFoldUnlessSpecified && other.foldingState === this.foldingState && areGroupMembersEqual(this.groupMembers, other.groupMembers) && other.showAddRemoveButtons === this.showAddRemoveButtons &&
        other.modifierKey === this.modifierKey && other.collapseIconStyle === this.collapseIconStyle;
    }

    toDOM(view: EditorView): HTMLElement {
      const codeblockLanguageSpecificClass = getLanguageSpecificColorClass(this.parameters.language, null, this.languageSpecificColors);
      const container = createContainer(this.specificHeader, this.parameters.language, this.parameters.hasLangBorderColor, codeblockLanguageSpecificClass);
      const minGroupSize = this.plugin.settings.pluginSettings.groupedCodeBlocks.showAddRemoveButtons ? 1 : 2;
      const isGrouped = this.parameters.group.length > 0 && this.groupMembers.length >= minGroupSize;

      if (this.parameters.displayLanguage) {
        const Icon = getLanguageIcon(this.parameters.displayLanguage);
        if (Icon) {
          container.appendChild(createCodeblockIcon(this.parameters.displayLanguage));
          container.classList.add('has-icon');
        } else if (isGrouped) {
          // set default icon for tab when language is not defined
          container.appendChild(createCodeblockIcon("NoIcon"));
        }
      } else if (isGrouped) {
        // set default icon for tab when the language defined does not has an icon
        container.appendChild(createCodeblockIcon("NoIcon"));
      }

      if (isGrouped)
        addTabs(view, container, this.parameters, this.groupMembers);

      if (this.parameters.displayLanguage && !isGrouped) {
        container.appendChild(createCodeblockLang(this.parameters.language));
      }

      container.appendChild(createFileName(this.parameters.headerDisplayText, this.enableLinks, this.sourcePath, this.plugin));

      // header buttons
      const buttonContainer = createButtonContainer(this.buttonConfigs, view, `codeblock-customizer-header-button-container`)
      container.appendChild(buttonContainer);

      if ((this.disableFoldUnlessSpecified && !this.plugin.settings.pluginSettings.codeblock.folding.inverseFold && !this.parameters.fold) ||
        (this.disableFoldUnlessSpecified && this.plugin.settings.pluginSettings.codeblock.folding.inverseFold && !this.parameters.unfold)) {
        container.classList.add(`noCollapseIcon`);
      } else {
        const icons = getCollapseIcons(this.collapseIconStyle);
        const collapse = createCodeblockCollapse(this.parameters.fold, this.collapseIconStyle);
        container.appendChild(collapse);

        if (this.foldingState === FoldingState.FullyFolded) {
          setIcon(collapse, icons.collapsed); // fully folded icon
          container.classList.add('collapsed');
        } else if (this.foldingState === FoldingState.SemiFolded) {
          setIcon(collapse, icons.collapsed);
          container.classList.add('semi-collapsed');
        } else {
          setIcon(collapse, icons.uncollapsed); // unfolded icon
        }
      }

      if (this.parameters.indentLevel > 0) {
        container.setAttribute("style", `--level:${this.parameters.indentLevel}; `);
        container.classList.add(`indented-line`);
      }

      container.onclick = (event) => {
        // don't collapse/uncollapse if a tab was clicked
        if (!event.target || ((event.target as HTMLElement).closest('.codeblock-customizer-header-group-tab') ||
          (event.target as HTMLElement).closest('.codeblock-customizer-button-container') ||
          (event.target as HTMLElement).closest('.codeblock-customizer-uncollapse-button'))) {
          return;
        }

        if ((this.disableFoldUnlessSpecified && !this.plugin.settings.pluginSettings.codeblock.folding.inverseFold && !this.parameters.fold) ||
          (this.disableFoldUnlessSpecified && this.plugin.settings.pluginSettings.codeblock.folding.inverseFold && !this.parameters.unfold)) {
          return;
        }

        const { effects, annotations } = toggleCodeBlockFold(view, this.pos);
        if (effects.length > 0 || annotations.length > 0) {
          view.dispatch({ effects, annotations });
        }
      };
      //EditorView.requestMeasure;

      return container;
    }

    updateDOM(dom: HTMLElement, view: EditorView) {
      view.requestMeasure();
      return false;
    }
  }// HeaderWidget

  class inlineCodeIconWidget extends WidgetType {
    constructor(readonly displayLanguage: string) {
      super();
    }

    eq(other: inlineCodeIconWidget) {
      return other.displayLanguage === this.displayLanguage;
    }

    toDOM() {
      return getInlineCodeIcon(this.displayLanguage, `cm-inline-code`);
    }
  }// inlineCodeIconWidget

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

  class buttonWidget extends WidgetType {
    buttonsConfig: Array<ButtonConfig>;
    pos: CodeBlockPositions;
    modifierKey: ButtonModifierKeys;

    constructor(buttonsConfig: Array<ButtonConfig>, pos: CodeBlockPositions, modifierKey: ButtonModifierKeys) {
      super();
      this.buttonsConfig = buttonsConfig;
      this.pos = pos;
      this.modifierKey = modifierKey;
    }

    eq(other: buttonWidget): boolean {
      return compareButtonConfigs(this.buttonsConfig, other.buttonsConfig) && other.pos.codeBlockStartPos === this.pos.codeBlockStartPos && other.pos.codeBlockEndPos === this.pos.codeBlockEndPos &&
        other.modifierKey === this.modifierKey;
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
      const span = createSpan({ cls: "codeblock-customizer-link" });
      MarkdownRenderer.render(this.plugin.app, this.link, span, this.sourcePath, this.plugin);
      return span;
    }
  }// createLink

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
      const container = createSpan();
      container.className = "codeblock-customizer-line-separator";

      const gutter = createSpan();
      gutter.className = "codeblock-customizer-line-separator-gutter";
      gutter.textContent = "...";

      const content = createSpan();
      content.className = "codeblock-customizer-line-separator-content";

      container.appendChild(gutter);
      container.appendChild(content);

      return container;
    }
  }// LineSeparatorWidget

  class AnnotationIconWidget extends WidgetType {
    constructor(readonly type: string, readonly content: string, readonly plugin: CodeBlockCustomizerPlugin, readonly title?: string) {
      super();
    }

    eq(other: AnnotationIconWidget) {
      return other.type === this.type && other.content === this.content && other.plugin === this.plugin && other.title === this.title;
    }

    toDOM(view: EditorView): HTMLElement {
      const iconContainer = createSpan({ cls: `codeblock-customizer-annotation-icon codeblock-customizer-annotation-icon-${this.type}` });
      //iconContainer.setAttribute("aria-label", `Annotation: ${this.type}`);
      iconContainer.innerHTML = rhombusSVG;

      const sourcePath = view.state.field(editorInfoField)?.file?.path ?? "";

      new TooltipManager(iconContainer, this.content, this.type, this.plugin, sourcePath, this.title);

      return iconContainer;
    }
  }// AnnotationIconWidget

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
        if (useSemiFold && lineCount >= settings.pluginSettings.semiFold.visibleLines + fadeOutLineCount + 2) {
          const ranges = getRanges(state, pos.codeBlockStartPos, pos.codeBlockEndPos, settings.pluginSettings.semiFold.visibleLines);
          decorationsToAdd.push(...generateSemiFoldEffects(state, pos, ranges).map(e => e.value));
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

  async function styleExecuteCodeWidget(preElement: HTMLElement, rawLines: string) {
    const codeElement = preElement.querySelector('code');
    if (!codeElement) {
      return;
    }

    if (Array.from(codeElement.classList).some(className => /^language-\S+/.test(className))) {
      while (!codeElement.classList.contains("is-loaded")) {
        await new Promise(resolve => setTimeout(resolve, 2));
      }
    }

    if (preElement.hasAttribute('data-cbc-processed')) {
      return;
    }
    preElement.setAttribute('data-cbc-processed', 'true');

    const rawCodeLines = rawLines.split('\n');
    const parameters = getAllParameters(rawCodeLines[0], plugin.settings, true);
    const baseLanguage = parameters.language ? parameters.language.replace('run-', '') : ''; //langClass ? langClass.replace('language-', '') : '';
    if (!baseLanguage) {
      return;
    }

    const fullLanguage = `run-${baseLanguage}`;
    preElement.classList.add('codeblock-customizer-pre', `codeblock-customizer-language-${fullLanguage}`, `codeblock-customizer-language-${baseLanguage}`);

    if (preElement.parentElement) {
      preElement.parentElement.classList.add('codeblock-customizer-pre-parent');
    }

    const { htmlLines, textLines } = extractLinesFromHTML(codeElement);
    const lineCount = Math.max(1, rawCodeLines.length - 2);
    codeElement.innerHTML = '';

    const { fragment } = await renderCodeBlockLines({
      htmlLines,
      textLines,
      lineCount,
      parameters,
      plugin,
      settings: plugin.settings.pluginSettings,
      sourcePath: "",
      handleAnnotations: true,
      processPrompts: false,
      addIndentationGuides: true,
      parseLinks: plugin.settings.pluginSettings.codeblock.enableLinks,
    });

    codeElement.appendChild(fragment);

    const borderColor = getBorderColorByLanguage(baseLanguage, getPropertyFromLanguageSpecificColors("codeblock.borderColor", plugin.settings));
    if (borderColor.length > 0) {
      preElement.classList.add('hasLangBorderColor');
    }

    parameters.language = baseLanguage;
    const { container: buttons } = createButtons(parameters, rawCodeLines, plugin, preElement);
    const editButton = createExecuteCodeEditButton();
    buttons.appendChild(editButton);
    preElement.appendChild(buttons);

    // setTimeout(() => {
    const parent = preElement.parentElement;
    if (parent)
      verifyAndRevealExecuteButtons(parent);
    //}, 50); 
  }// styleExecuteCodeWidget

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

  interface CM5Token {
    text: string;
    style: string | null;
  }

  function getCM5Tokens(code: string, modeSpec: string): CM5Token[] {
    const tokens: CM5Token[] = [];
    //const mode = window.CodeMirror.getMode({}, modeSpec);

    // @ts-ignore
    const mode = window.CodeMirror.getMode(window.CodeMirror.defaults, window.CodeMirror.findModeByName(modeSpec)?.mime);
    if (!mode || mode.name === 'null') {
      return [{ text: code, style: null }];
    }

    const state = mode.startState ? mode.startState() : null;
    const stream = new window.CodeMirror.StringStream(code);
    while (!stream.eol()) {
      const style = mode.token(stream, state);
      tokens.push({ text: stream.current(), style: style || null });
      stream.start = stream.pos;
    }

    return tokens;
  }// getCM5Tokens

  function areParametersDeepEqual(params1: CBCParameters, params2: CBCParameters): boolean {
    if (params1.isSpecificNumber !== params2.isSpecificNumber)
      return false;
    if (params1.lineNumberOffset !== params2.lineNumberOffset)
      return false;
    if (params1.showNumbers !== params2.showNumbers)
      return false;
    if (params1.headerDisplayText !== params2.headerDisplayText)
      return false;
    if (params1.fold !== params2.fold)
      return false;
    if (params1.unfold !== params2.unfold)
      return false;
    if (params1.language !== params2.language)
      return false;
    if (params1.displayLanguage !== params2.displayLanguage)
      return false;
    if (params1.hasLangBorderColor !== params2.hasLangBorderColor)
      return false;
    if (params1.exclude !== params2.exclude)
      return false;
    if (params1.fenceCount !== params2.fenceCount)
      return false;
    if (params1.fenceChar !== params2.fenceChar)
      return false;
    if (params1.indentLevel !== params2.indentLevel)
      return false;
    if (params1.indentCharacter !== params2.indentCharacter)
      return false;
    if (params1.lineSeparator !== params2.lineSeparator)
      return false;
    if (params1.textSeparator !== params2.textSeparator)
      return false;
    if (params1.group !== params2.group)
      return false;
    if (params1.tab !== params2.tab)
      return false;

    return true;
  }// areParametersDeepEqual

  function areCodeBlockPositionsEqual(pos1: CodeBlockPositions, pos2: CodeBlockPositions): boolean {
    if (pos1.codeBlockStartPos !== pos2.codeBlockStartPos)
      return false;
    if (pos1.codeBlockEndPos !== pos2.codeBlockEndPos)
      return false;
    if (!areParametersDeepEqual(pos1.parameters, pos2.parameters))
      return false;

    return true;
  }// areCodeBlockPositionsEqual

  function areGroupMembersEqual(members1: CodeBlockPositions[], members2: CodeBlockPositions[]): boolean {
    if (members1.length !== members2.length)
      return false;
    for (let i = 0; i < members1.length; i++) {
      if (!areCodeBlockPositionsEqual(members1[i], members2[i]))
        return false;
    }
    return true;
  }// areGroupMembersEqual

  function compareCodeBlockPositions(pos1: CodeBlockPositions[], pos2: CodeBlockPositions[]): boolean {
    if (pos1.length !== pos2.length) {
      return false;
    }

    for (let i = 0; i < pos1.length; i++) {
      const p1 = pos1[i];
      const p2 = pos2[i];

      if (p1.codeBlockFirstLineText !== p2.codeBlockFirstLineText) {
        return false;
      }

      const len1 = p1.codeBlockEndPos - p1.codeBlockStartPos;
      const len2 = p2.codeBlockEndPos - p2.codeBlockStartPos;
      if (len1 !== len2) {
        return false;
      }
    }

    return true;
  }// compareCodeBlockPositions

  function addTabs(view: EditorView, container: HTMLElement, parameters: CBCParameters, groupMembers: CodeBlockPositions[]) {
    const tabsContainer = createDiv({ cls: "codeblock-customizer-header-group-tabs" });
    //const activeStartPos = view.state.field(activeGroupTabStateField)[parameters.group];
    const activeGroup = view.state.field(activeGroupTabField, false) ?? {};
    const activeStartPos = activeGroup?.[parameters.group];

    groupMembers.forEach((member, index) => {
      const tab = createTab(view, member, activeStartPos, index, parameters.group);
      tab.dataset.startPos = String(member.codeBlockStartPos);
      tabsContainer.appendChild(tab);
    });

    if (plugin.settings.pluginSettings.groupedCodeBlocks.showAddRemoveButtons) {
      addAddTabButton(parameters, groupMembers, view, tabsContainer);
    }

    tabsContainer.onclick = (event) => {
      const tabElement = (event.target as HTMLElement).closest<HTMLElement>('.codeblock-customizer-header-group-tab');
      if (!tabElement) {
        return;
      }

      if ((event.target as HTMLElement).closest('.codeblock-customizer-tab-remove')) {
        return;
      }

      const startPos = Number(tabElement.dataset.startPos);
      const clickedMember = groupMembers.find(m => m.codeBlockStartPos === startPos);
      if (clickedMember) {
        handleTabClick(view, clickedMember, parameters);
      }
    };

    container.appendChild(tabsContainer);
  }// addTabs

  function createTab(view: EditorView, member: CodeBlockPositions, activeStartPos: number, index: number, groupName: string): HTMLElement {
    const displayLangName = getDisplayLanguageName(member.parameters.language);
    const tabText = member.parameters.tab || displayLangName || `Tab ${index + 1}`;
    const tab = createCodeblockLang(member.parameters.language, `codeblock-customizer-header-group-tab`, tabText);

    if (member.codeBlockStartPos === activeStartPos) {
      tab.classList.add("active");
    }

    if (plugin.settings.pluginSettings.groupedCodeBlocks.showAddRemoveButtons) {
      addRemoveTabButton(view, member, groupName, tab);
    }

    return tab;
  }// createTab

  function addAddTabButton(parameters: CBCParameters, groupMembers: CodeBlockPositions[], view: EditorView, tabsContainer: HTMLDivElement) {
    const addButton = createDiv({ cls: "codeblock-customizer-tab-add" });
    setIcon(addButton, "plus");
    addButton.setAttribute("aria-label", "Add new code block to group");

    addButton.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();

      const groupName = parameters.group;
      if (!groupName || groupMembers.length === 0) {
        return;
      }

      const lastMember = groupMembers[groupMembers.length - 1];
      const insertPos = lastMember.codeBlockEndPos;
      const fenceChar = lastMember.parameters.fenceChar || '`';
      const fenceCount = lastMember.parameters.fenceCount || 3;
      const fence = fenceChar.repeat(fenceCount);
      const newBlockText = `\n${fence} group:${groupName}\n\n${fence}`;

      view.dispatch({ changes: { from: insertPos, to: insertPos, insert: newBlockText } });
    };

    tabsContainer.appendChild(addButton);
  }// addAddTabButton

  function addRemoveTabButton(view: EditorView, member: CodeBlockPositions, groupName: string, tab: HTMLDivElement) {
    const removeButton = createSpan({ cls: "codeblock-customizer-tab-remove" });
    setIcon(removeButton, "x");
    removeButton.setAttribute("aria-label", "Remove from group");

    removeButton.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();

      const line = view.state.doc.lineAt(member.codeBlockStartPos);
      const regex = new RegExp(`\\s*group([:=])(["']?${groupName}["']?)\\s*`);
      const newLineText = line.text.replace(regex, ' ').trim();

      view.dispatch({ changes: { from: line.from, to: line.to, insert: newLineText } });
    };

    tab.appendChild(removeButton);
  }// addRemoveTabButton

  function handleTabClick(view: EditorView, member: CodeBlockPositions, parameters: CBCParameters) {
    const groupName = parameters.group;
    if (!groupName) {
      console.error("Cannot dispatch tab selection: invalid group name.");
      return;
    }

    const activeGroup = view.state.field(activeGroupTabField, false) ?? {};
    const activeStartPos = activeGroup?.[parameters.group];
    const isClickedTabActive = member.codeBlockStartPos === activeStartPos;

    const annotations = [setGroupTab.of({ group: groupName, startPos: member.codeBlockStartPos })];
    const effects: CodeBlockFoldEffect[] = [];

    if (isClickedTabActive) {
      const foldChanges = toggleCodeBlockFold(view, member);
      effects.push(...foldChanges.effects);
      annotations.push(...foldChanges.annotations);
    }

    view.dispatch({ annotations, effects });
  }// handleTabClick

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
    const canSemiFold = lineCount >= visibleLines + fadeOutLineCount + 2; // +2 to ignore the first and last lines

    const currentFoldState = getFoldingState(view.state, codeBlockStartPos, codeBlockEndPos);

    if (currentFoldState === FoldingState.Unfolded) {
      if (enableSemiFold && canSemiFold) {
        // semi-fold
        const ranges = getRanges(view.state, pos.codeBlockStartPos, pos.codeBlockEndPos, visibleLines);
        const semiFoldEffects = generateSemiFoldEffects(view.state, pos, ranges);
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

  function findCodeBlockPositions(state: EditorState, from = 0, to: number = state.doc.length): CodeBlockPositions[] {
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

  function findCodeBlockEnd(collapseStart: number, state: EditorState, fenceCount: number, fenceChar: '`' | '~') {
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

  function calculateGroupedCodeBlocks(state: EditorState): GroupedCodeBlocks {
    const grouped: GroupedCodeBlocks = {};
    const positions: CodeBlockPositions[] = state.field(codeBlockPositionsField, false) ?? [];

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const { parameters } = pos;
      const group = parameters.group;

      if (!group || parameters.exclude)
        continue;

      if (!grouped[group]) {
        const currentConsecutiveSequence: CodeBlockPositions[] = [pos];
        let currentPos = pos;
        let nextPosIndex = i + 1;

        while (nextPosIndex < positions.length) {
          const potentialNextPos = positions[nextPosIndex];
          if (potentialNextPos.parameters.group === group && potentialNextPos.codeBlockStartPos - currentPos.codeBlockEndPos <= 1) {
            currentConsecutiveSequence.push(potentialNextPos);
            currentPos = potentialNextPos;
            nextPosIndex++;
          } else {
            break;
          }
        }

        const minGroupSize = settings.pluginSettings.groupedCodeBlocks.showAddRemoveButtons ? 1 : 2;
        if (currentConsecutiveSequence.length >= minGroupSize) {
          grouped[group] = currentConsecutiveSequence;
        }
      }
    }
    return grouped;
  }// calculateGroupedCodeBlocks

  function insertHeader(state: EditorState): DecorationSet {
    if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(state))
      return Decoration.none;

    const sourcePath = state.field(editorInfoField)?.file?.path ?? "";
    const positions = state.field(codeBlockPositionsField, false) ?? [];
    const decorations: Array<Range<Decoration>> = [];
    const grouped = state.field(groupedCodeBlocksField, false) ?? {};

    for (const pos of positions) {
      const { codeBlockStartPos, codeBlockEndPos, parameters } = pos;
      const foldingState = getFoldingState(state, codeBlockStartPos, codeBlockEndPos);
      const group = parameters.group;

      if (parameters.exclude)
        continue;

      let currentGroupMembers: CodeBlockPositions[] = [];
      let hideBlock = false;
      let createHeader = true;

      const minGroupSize = settings.pluginSettings.groupedCodeBlocks.showAddRemoveButtons ? 1 : 2;
      const groupMembers = (group && grouped[group]) ? grouped[group] : [];
      const isMemberOfTabbedGroup = !!(group && groupMembers.length >= minGroupSize && groupMembers.some(member => member.codeBlockStartPos === codeBlockStartPos));

      if (isMemberOfTabbedGroup) {
        const groupMembers = grouped[group];
        //const currentActiveTab = state.field(activeGroupTabField)[group];
        const activeGroup = state.field(activeGroupTabField, false) ?? {};
        const currentActiveTab = activeGroup?.[group];
        const activeTabPos = (currentActiveTab !== undefined && groupMembers.some(member => member.codeBlockStartPos === currentActiveTab)) ? currentActiveTab : groupMembers[0].codeBlockStartPos;
        const isActiveTab = activeTabPos === codeBlockStartPos;

        if (isActiveTab) {
          currentGroupMembers = groupMembers;
        } else {
          hideBlock = true;
          createHeader = false;
        }
      }

      if (hideBlock) {
        const firstLineEnd = state.doc.lineAt(codeBlockStartPos).to;
        if (firstLineEnd < codeBlockEndPos) {
          decorations.push(Decoration.replace({ block: true }).range(codeBlockStartPos, codeBlockEndPos));
        }
      }

      if (createHeader) {
        const isExecuteCodeBlock = parameters.language.toLowerCase().startsWith('run-');
        if (!isExecuteCodeBlock || !isPluginLoaded("execute-code", plugin)) {
          const specificHeader = isSpecificHeader(parameters, settings, isMemberOfTabbedGroup, state.doc.lineAt(pos.codeBlockEndPos).number - state.doc.lineAt(pos.codeBlockStartPos).number + 1, "editor");
          const buttonConfigs = createButtonConfigs(codeBlockStartPos, codeBlockEndPos, state, parameters);
          const modifierKey = plugin.settings.pluginSettings.codeblock.buttons.modifierKey;
          decorations.push(Decoration.widget({ widget: new HeaderWidget(parameters, specificHeader, pos, buttonConfigs, currentGroupMembers, foldingState, sourcePath, plugin, modifierKey), block: true }).range(codeBlockStartPos));
        }
      }
    }
    return RangeSet.of(decorations, true);
  }// insertHeader

  function createButtonConfigs(codeBlockStartPos: number, codeBlockEndPos: number, state: EditorState, parameters: CBCParameters) {
    const cursorPos = state.selection.main.head;
    const isCursorInCodeBlock = cursorPos >= codeBlockStartPos && cursorPos <= codeBlockEndPos;

    let showButton = false;
    if ((!settings.pluginSettings.codeblock.buttons.alwaysShowButtons) && !isCursorInCodeBlock)
      showButton = true;
    else if (settings.pluginSettings.codeblock.buttons.alwaysShowButtons)
      showButton = true;

    const modifierKey = plugin.settings.pluginSettings.codeblock.buttons.modifierKey;
    const getModifierState = (event?: MouseEvent): boolean => {
      if (!event || modifierKey === ButtonModifierKeys.NONE) {
        return false;
      }

      switch (modifierKey) {
        case ButtonModifierKeys.CTRL:
          return event.ctrlKey;
        case ButtonModifierKeys.ALT:
          return event.altKey;
        case ButtonModifierKeys.SHIFT:
          return event.shiftKey;
        default:
          return false;
      }
    };

    return [
      {
        class: `codeblock-customizer-copy-code`,
        displayText: "Copy code",
        action: (view: EditorView, container?: HTMLElement, event?: MouseEvent) => {
          const includeFences = getModifierState(event);
          const from = includeFences ? codeBlockStartPos : state.doc.lineAt(codeBlockStartPos).to + 1;
          const to = includeFences ? codeBlockEndPos : state.doc.lineAt(codeBlockEndPos).from - 1;

          if (from > to) {
            addTextToClipboard("");
            return;
          }

          let blockContent;
          if (includeFences) {
            blockContent = view.state.sliceDoc(from, to);
          } else {
            let initialLines: string[];

            if (settings.pluginSettings.prompts.includePromptsInCopy) {
              const lines: string[] = [];
              const firstContentLineNum = state.doc.lineAt(from).number;
              const lastContentLineNum = state.doc.lineAt(to).number;
              const lineCount = lastContentLineNum - firstContentLineNum + 1;
              const promptManager = new PromptManager(parameters, lineCount, settings);

              for (let i = firstContentLineNum; i <= lastContentLineNum; i++) {
                const line = state.doc.line(i);
                const relativeLineNumber = i - firstContentLineNum + 1;

                if (promptManager.promptLines.has(relativeLineNumber)) {
                  const { prompt, output } = promptManager.getPromptAndOutputTextForLine(line.text);
                  lines.push(`${prompt}${line.text}`);

                  if (output.length > 0) {
                    lines.push(...output);
                  }
                } else {
                  lines.push(line.text);
                }
              }
              initialLines = lines;
            } else {
              const content = settings.pluginSettings.annotations.excludeAnnotationsFromCopy ? getCodeWithoutAnnotation(view, from, to) : view.state.sliceDoc(from, to);
              initialLines = content.split('\n');
            }

            const processedLines = normalizeIndentation(initialLines);
            blockContent = processedLines.join('\n');
          }
          addTextToClipboard(blockContent);
        },
        icon: "copy",
        text: parameters.displayLanguage,
        enabled: showButton
      },
      {
        class: `codeblock-customizer-snapshot-button`,
        displayText: "Copy as image",
        action: async (view: EditorView, container?: HTMLElement) => {
          await createSnapshot(container, view, codeBlockStartPos, codeBlockEndPos, state);
        },
        icon: "camera",
        enabled: settings.pluginSettings.codeblock.buttons.enableSnapshotButton && showButton
      },
      {
        class: `codeblock-customizer-select-code`,
        displayText: "Select code",
        action: (view: EditorView, container?: HTMLElement, event?: MouseEvent) => {
          const includeFences = getModifierState(event);
          const from = includeFences ? codeBlockStartPos : state.doc.lineAt(codeBlockStartPos).to + 1;
          const to = includeFences ? codeBlockEndPos : state.doc.lineAt(codeBlockEndPos).from - 1;

          if (to < from) {
            view.dispatch(view.state.update({ selection: EditorSelection.cursor(from) }));
          } else {
            view.dispatch(view.state.update({ selection: EditorSelection.range(from, to) }));
          }
        },
        icon: "text",
        enabled: settings.pluginSettings.codeblock.buttons.enableSelectCodeButton && showButton
      },
      {
        class: `codeblock-customizer-delete-code`,
        displayText: "Delete code block content",
        action: (view: EditorView, container?: HTMLElement, event?: MouseEvent) => {
          const includeFences = getModifierState(event);
          const from = includeFences ? codeBlockStartPos : state.doc.lineAt(codeBlockStartPos).to + 1;
          const to = includeFences ? codeBlockEndPos : state.doc.lineAt(codeBlockEndPos).from - 1;

          if (to >= from) {
            const transaction = view.state.update({ changes: { from: from, to: to, insert: "" } });
            view.dispatch(transaction);
          }
        },
        icon: "trash-2",
        enabled: settings.pluginSettings.codeblock.buttons.enableDeleteCodeButton && showButton
      }
    ];
  }// createButtonConfig

  async function createSnapshot(container: HTMLElement | undefined, view: EditorView, codeBlockStartPos: number, codeBlockEndPos: number, state: EditorState) {
    let startingEl: HTMLElement | null = null;
    const headerEl = container?.closest('.codeblock-customizer-header-container-specific');
    if (headerEl) {
      startingEl = headerEl as HTMLElement;
    } else {
      const buttonLine = container?.closest('.cm-line') as HTMLElement | null;
      if (buttonLine) {
        let trueStart: Element | null = buttonLine;
        while (trueStart?.previousElementSibling?.classList.contains('HyperMD-codeblock')) {
          trueStart = trueStart.previousElementSibling;
        }
        startingEl = trueStart as HTMLElement;
      }
    }

    if (!startingEl || !startingEl.parentElement) {
      new Notice("Error: Could not find code block container.");
      return;
    }

    /*if (container) {
      container.style.visibility = 'hidden';
    }*/

    try {
      const elementsToSnapshot: HTMLElement[] = [startingEl];
      let currentEl: Element | null = startingEl;

      const currentFoldState = getFoldingState(view.state, codeBlockStartPos, codeBlockEndPos);
      if (currentFoldState === FoldingState.SemiFolded) {
        while (currentEl && currentEl.nextElementSibling) {
          const nextEl = currentEl.nextElementSibling as HTMLElement;
          if (nextEl.classList.contains('codeblock-customizer-header-container-specific') || !nextEl.classList.contains('cm-line')) {
            break;
          }

          elementsToSnapshot.push(nextEl as HTMLElement);
          currentEl = nextEl;
        }
      } else {
        const lineCount = state.doc.lineAt(codeBlockEndPos).number - state.doc.lineAt(codeBlockStartPos).number + 1;
        const loopIterations = headerEl ? lineCount : lineCount - 1;

        for (let i = 0; i < loopIterations; i++) {
          currentEl = currentEl.nextElementSibling;
          if (currentEl) {
            elementsToSnapshot.push(currentEl as HTMLElement);
          } else {
            break;
          }
        }
      }

      const cloneContainer = document.createElement('div');
      elementsToSnapshot.forEach(el => {
        cloneContainer.appendChild(el.cloneNode(true));
      });

      const parent = view.contentDOM.parentElement;
      if (!parent) {
        new Notice("Error: Could not get contentDOM.parentElement.");
        return;
      }

      const snapshotOptions = {
        filter: (node: HTMLElement) => {
          if (node.classList?.contains('codeblock-customizer-button-container') ||          // first-line button container
            node.classList?.contains('codeblock-customizer-header-button-container') ||   // header button container
            node.classList?.contains('codeblock-customizer-header-collapse') ||           // header collapse icon
            node.classList?.contains('codeblock-customizer-tab-remove') ||                // grouped code block 'x' button
            node.classList?.contains('codeblock-customizer-tab-add')) {                   // grouped code block '+' button
            return false;
          }
          return !(node.tagName === 'IMG' && node.classList.contains('cm-widgetBuffer'));
        }
      };

      const firstLine = view.state.doc.lineAt(codeBlockStartPos).text;
      const parameters = getAllParameters(firstLine, plugin.settings, false);
      await generateSnapshot(cloneContainer, startingEl, parent, plugin.settings, parameters, snapshotOptions);
    } finally {
      /*if (container) {
        container.style.visibility = 'visible';
      }*/
    }
  }// createSnapshot

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
    const container = createDiv({ cls: buttonContainerClass || `codeblock-customizer-button-container` });

    buttonsConfig.forEach(config => {
      if (!config.enabled)
        return;

      const button = createSpan({ cls: config.class });
      button.setAttribute("aria-label", config.displayText);
      button.onclick = (event) => config.action(view, container, event);

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

  function getCodeWithoutAnnotation(view: EditorView, from: number, to: number) {
    const ANNOTATION_PATTERN = /\[!/;
    const rangesToRemove: { from: number, to: number }[] = [];
    const codeText = view.state.sliceDoc(from, to);

    syntaxTree(view.state).iterate({
      from: from, to: to,
      enter: (node) => {
        if (node.type.name.includes("comment")) {
          const commentText = view.state.sliceDoc(node.from, node.to);
          if (ANNOTATION_PATTERN.test(commentText)) {
            rangesToRemove.push({ from: node.from - from, to: node.to - from });
          }
        }
      }
    });

    if (rangesToRemove.length > 0) {
      let newContent = "";
      let lastIndex = 0;
      for (const range of rangesToRemove) {
        newContent += codeText.substring(lastIndex, range.from);
        lastIndex = range.to;
      }
      newContent += codeText.substring(lastIndex);
      return newContent;
    }

    return codeText;
  }// getCodeWithoutAnnotation

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

  function checkForLinks(state: EditorState, collapseFrom: number, collapseTo: number, decorations: Array<Range<Decoration>>, sourcePath: string) {
    const cursorPos = state.selection.main.head;
    const regex = /(?:\[\[([^[\]]+?)(?:\|([^\]]+?))?]]|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s]+))/g;

    syntaxTree(state).iterate({
      from: collapseFrom, to: collapseTo,
      enter(node) {
        if (!node.type.name.includes("comment")) {
          return;
        }

        const commentText = state.sliceDoc(node.from, node.to);
        const matches = commentText.matchAll(regex);

        for (const match of matches) {
          const fullMatch = match[0];
          const startPosition = match.index || 0;
          const from = node.from + startPosition;
          const to = from + fullMatch.length;
          const isCursorInside = cursorPos >= from && cursorPos <= to;

          if (isCursorInside) {
            renderLink(fullMatch, match, node, startPosition, decorations);
          } else {
            decorations.push(Decoration.replace({ widget: new createLink(fullMatch, sourcePath, plugin) }).range(from, to));
          }
        }
      }
    });
  }// checkForLinks

  function renderLink(fullMatch: string, match: RegExpMatchArray, node: SyntaxNodeRef, startPosition: number, decorations: Array<Range<Decoration>>) {
    const rangeFrom = node.from + startPosition;
    const rangeTo = rangeFrom + fullMatch.length;

    // WikiLink -> [[link]] or [[Link|DisplayText]]
    if (match[1] !== undefined) {
      decorations.push(Decoration.mark({ class: "cm-formatting-link cm-formatting-link-start" }).range(rangeFrom, rangeFrom + 2));
      decorations.push(Decoration.mark({ class: "cm-hmd-internal-link" }).range(rangeFrom + 2, rangeTo - 2));
      decorations.push(Decoration.mark({ class: "cm-formatting-link cm-formatting-link-end" }).range(rangeTo - 2, rangeTo));
      return;
    }

    // Markdown Link -> [DisplayText](Link)
    if (match[3] !== undefined) {
      const endOfText = rangeFrom + fullMatch.indexOf("](");
      const startOfLink = endOfText + 2;

      // [DisplayText] part
      decorations.push(Decoration.mark({ class: "cm-formatting cm-formatting-link cm-link" }).range(rangeFrom, rangeFrom + 1));
      decorations.push(Decoration.mark({ class: "cm-link" }).range(rangeFrom + 1, endOfText));
      decorations.push(Decoration.mark({ class: "cm-formatting cm-formatting-link cm-link" }).range(endOfText, endOfText + 1));

      // (Link) part
      decorations.push(Decoration.mark({ class: "cm-formatting cm-formatting-link-string cm-string cm-url" }).range(endOfText + 1, startOfLink));
      decorations.push(Decoration.mark({ class: "cm-string cm-url" }).range(startOfLink, rangeTo - 1));
      decorations.push(Decoration.mark({ class: "cm-formatting cm-formatting-link-string cm-string cm-url" }).range(rangeTo - 1, rangeTo));
      return;
    }

    // HTTP or HTTPS URL
    if (match[5] !== undefined) {
      decorations.push(Decoration.mark({ class: "cm-url" }).range(rangeFrom, rangeTo));
      return;
    }
  }// renderLink

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

  function generateSemiFoldEffects(state: EditorState, pos: CodeBlockPositions, ranges: ReplaceFadeOutRanges): StateEffect<Range<Decoration>>[] {
    const effects: StateEffect<Range<Decoration>>[] = [];

    const semiFoldClass = Decoration.line({ attributes: { class: `semi-folded` } });
    effects.push(semiFade.of(semiFoldClass.range(ranges.firstLine.from, ranges.firstLine.from)));

    for (let i = 0; i < fadeOutLineCount; i++) {
      const fadeOutLine = state.doc.line(state.doc.lineAt(ranges.fadeOutStart.from).number + i);
      const fadeOutDecoration = Decoration.line({ attributes: { class: `codeblock-customizer-fade-out-line${i}` } });
      effects.push(semiFade.of(fadeOutDecoration.range(fadeOutLine.from, fadeOutLine.from)));

      if (i === fadeOutLineCount - 1) {
        const uncollapseWidget = new uncollapseCodeWidget(pos);
        const deco = Decoration.widget({ widget: uncollapseWidget });
        const widgetPos = ranges.fadeOutEnd.to;
        effects.push(semiFade.of(deco.range(widgetPos, widgetPos)));
      }
    }

    const collapseDecoration = Decoration.replace({ block: true });
    effects.push(semiCollapse.of(collapseDecoration.range(ranges.replaceStart.from, ranges.replaceEnd.to)));

    return effects;
  }// generateSemiFoldEffects

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

  function getRanges(state: EditorState, codeBlockStartPos: number, codeBlockEndPos: number, visibleLines: number): ReplaceFadeOutRanges {
    const firstLine = state.doc.lineAt(codeBlockStartPos);
    const fadeOutStart = state.doc.line(state.doc.lineAt(codeBlockStartPos).number + visibleLines + 1);
    const fadeOutEnd = state.doc.line(state.doc.lineAt(fadeOutStart.from).number + fadeOutLineCount - 1);

    const replaceStart = state.doc.line(state.doc.lineAt(fadeOutEnd.from).number + 1);
    const replaceEnd = state.doc.line(state.doc.lineAt(codeBlockEndPos).number);

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

  const extensions = [
    codeBlockPositionsField,
    groupedCodeBlocksField,
    activeGroupTabField,
    rememberedFoldField,
    foldCommandField,
    defaultFoldUnfoldedField,
    collapseField,
    headerField,
    viewPlugin,
    linkViewPlugin,
    inlineCodeViewPlugin,
    annotationViewPlugin,
    hideFencesPlugin,
    executeCodeViewPlugin,
    admonitionViewgPlugin,
    liveUpdateExtension(),
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        const target = event.target as HTMLElement;
        if (target.closest('[class*="codeblock-customizer-fade-out-line"]')) {
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
        return false;
      }
    })
  ];

  const result = {
    extensions,
    foldAll,
    unfoldAll,
    restoreDefaultFold,
    customBracketMatching,
    selectionMatching
  };

  return result;
}// extensions
