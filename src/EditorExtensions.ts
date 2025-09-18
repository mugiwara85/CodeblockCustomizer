import { MarkdownRenderer, Notice, editorEditorField, editorInfoField, setIcon } from "obsidian";

import { StateField, StateEffect, EditorState, Transaction, Extension, Range, RangeSet, Line, EditorSelection, Annotation } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { bracketMatching, syntaxTree } from "@codemirror/language";
import { SyntaxNodeRef } from "@lezer/common";
import { highlightSelectionMatches } from "@codemirror/search";

import { getLanguageIcon, createContainer, createCodeblockLang, createCodeblockIcon, createFileName, createCodeblockCollapse, getBorderColorByLanguage, getCurrentMode, isSourceMode, getLanguageSpecificColorClass, createObjectCopy, getAllParameters, CBCParameters, findAllOccurrences, createUncollapseCodeButton, addTextToClipboard, getPropertyFromLanguageSpecificColors, getDefaultParameters, getDisplayLanguageName, getInlineCodeIcon, normalizeIndentation, isPluginLoaded, generateSnapshot} from "./Utils";
import { TooltipManager } from "./TooltipManager";
import { ButtonModifierKeys, CodeblockCustomizerSettings, FoldingPersistence, FoldingScope, InlineCodeModifierKeys, TabPersistence } from "./Settings";
import { ANNOTATION_PATTERN, DEFAULT_TEXT_SEPARATOR, fadeOutLineCount, INLINE_CODE_LANG_REGEX, rhombusSVG } from "./Const";
import CodeBlockCustomizerPlugin from "./main";
import { PromptManager } from "./PromptManager";
import { createButtons, extractCodeBlocksFromAdmonition, extractLinesFromHTML, renderCodeBlockLines } from "./ReadingViewUtils";
import { createExecuteCodeEditButton, verifyAndRevealExecuteButtons } from "./ExecuteCode";
import { CodeBlockRenderer } from "./CodeBlockRenderer";

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

export interface CodeBlockPositions {
  codeBlockStartPos: number;
  codeBlockEndPos: number;
  parameters: CBCParameters;
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

export enum FoldingState {
  Unfolded = 'unfolded',
  FullyFolded = 'fully-folded',
  SemiFolded = 'semi-folded',
}

export enum FoldCommand {
  Default,
  FoldAll,
  UnfoldAll,
}

export function extensions(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings) {
  /* annotations, effects */

  const setFoldCommandState = StateEffect.define<FoldCommand>();
  const setFoldState = Annotation.define<{ docPath: string; startPos: number; state: FoldingState | null }>();
  const setGroupTab = Annotation.define<{ group: string; startPos: number }>();
  const CollapsedDecoration = Decoration.replace({block: true, attributes: { "code-folded": "true" }});  
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
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(state))
        return Decoration.none;

      return Decoration.none;
    },
    update(value: DecorationSet, transaction: Transaction): DecorationSet {
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(transaction.state))
        return Decoration.none;

      return insertHeader(transaction.state);
    },
    provide(field: StateField<DecorationSet>): Extension {
      return EditorView.decorations.from(field);
    }
  });// headerField

  const codeBlockPositionsField = StateField.define<CodeBlockPositions[]>({
    create(state: EditorState): CodeBlockPositions[] {
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(state))
        return [];

      return findCodeBlockPositions(state); //return [];
    },
    update(value: CodeBlockPositions[], transaction: Transaction): CodeBlockPositions[] {
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(transaction.state)) {
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
        
        const newTail = Array.from(mergedTail.values()).sort((a,b) => a.codeBlockStartPos - b.codeBlockStartPos);

        return preservedHead.concat(newTail);
      }

      // case 2: scroll or selection change
      //if (!startState.selection.eq(state.selection) || syntaxTree(startState) !== syntaxTree(state)) {
      if (syntaxTree(startState) !== syntaxTree(state)) {
        return findCodeBlockPositions(state);
      }

      // nothing changed => return values
      return value;
    }
  });// codeBlockPositionsField

  const collapseField = StateField.define<RangeSet<Decoration>>({
    create(state): RangeSet<Decoration> {
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(state))
        return Decoration.none;

      return Decoration.none;
    },
    update(value, tr) {
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(tr.state))
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
              const isUncollapseWidgetDeco = value.spec.widget?.constructor.name === 'uncollapseCodeWidget';
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

      const globalFoldCmd = tr.state.field(foldCommandField, false) ?? [];
      const globalFoldCmdChanged = tr.startState.field(foldCommandField, false) !== globalFoldCmd;

      if (newCodeBlockPositions !== oldCodeBlockPositions || newFoldState !== oldFoldState|| settingsUpdated || tr.reconfigured) {
        const decorationsToAdd: Range<Decoration>[] = [];
        const state = tr.state;
        const rememberedFolds = newFoldState ?? {};
        const unfoldedBlocks = state.field(defaultFoldUnfoldedField, false) ?? new Set<number>();

        if (globalFoldCmdChanged) {
          value = Decoration.none;
        }

        for (const pos of newCodeBlockPositions) {
          // don't process fold commands for `run-` code blocks
          if (pos.parameters.language.toLowerCase().startsWith('run-')) {
            continue;
          }

          // check if a fold decoration already exists for this block
          if (isBlockCurrentlyFoldedInSet(value, pos.codeBlockStartPos, pos.codeBlockEndPos)) {
            continue;
          }

          const shouldFoldByDefault = pos.parameters.fold || (settings.SelectedTheme.settings.codeblock.folding.inverseFold && !pos.parameters.unfold);
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
                useSemiFold = settings.SelectedTheme.settings.semiFold.enableSemiFold;
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
                } else if (rememberedState === undefined && shouldFoldByDefault) {
                  foldNow = true;
                  useSemiFold = settings.SelectedTheme.settings.semiFold.enableSemiFold;
                }
                break;
              }
            }
          }
          if (foldNow) {
            const lineCount = state.doc.lineAt(pos.codeBlockEndPos).number - state.doc.lineAt(pos.codeBlockStartPos).number + 1;
            if (useSemiFold && lineCount >= settings.SelectedTheme.settings.semiFold.visibleLines + fadeOutLineCount + 2) {
              const ranges = getRanges(state, pos.codeBlockStartPos, pos.codeBlockEndPos, settings.SelectedTheme.settings.semiFold.visibleLines);
              decorationsToAdd.push(...generateSemiFoldEffects(state, pos, ranges).map(e => e.value));
            } else {
              decorationsToAdd.push(CollapsedDecoration.range(pos.codeBlockStartPos, pos.codeBlockEndPos));
            }
          }
        }

        if (decorationsToAdd.length > 0) {
          value = value.update({ add: decorationsToAdd, sort: true });
        }
      }

      return value;
    },
    provide: f => EditorView.decorations.from(f)
  });// collapseField

  const activeGroupTabField = StateField.define<Record<string, number>>({
    create(state: EditorState) {
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(state))
        return {};

      const tabSettings = settings.SelectedTheme.settings.groupedCodeBlocks;
      if (!tabSettings.rememberTabState) {
        return {};
      }

      const initialGrouped = state.field(groupedCodeBlocksField, false) ?? {};
      const initialTabs: {[groupName: string]: number} = {};
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
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(transaction.state))
        return {};

      const docPath = transaction.state.field(editorInfoField)?.file?.path;

      // on every document change immediately update the persistent storage
      if (transaction.docChanged && docPath) {
        plugin.remapTabs(docPath, transaction.changes); 
        const docStateMap = plugin.activeEditorTabs.get(docPath);
        if (docStateMap && docStateMap.size > 0) {
          const newDocStateMap = new Map<string, number>();
          for (const [groupName, savedPos] of docStateMap.entries()) {
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
        const tabSettings = settings.SelectedTheme.settings.groupedCodeBlocks;
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
        const tabSettings = settings.SelectedTheme.settings.groupedCodeBlocks;

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
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(state))
        return {};

      return calculateGroupedCodeBlocks(state);
    },

    update(grouped: GroupedCodeBlocks, transaction: Transaction): GroupedCodeBlocks {
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(transaction.state))
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
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(state))
        return {};

      const foldSettings = settings.SelectedTheme.settings.codeblock.folding;
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
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(transaction.state))
        return {};

      const foldSettings = settings.SelectedTheme.settings.codeblock.folding;
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
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(state))
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
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(transaction.state))
        return new Set();

      const newValue = new Set(value);

      if (transaction.docChanged) {
        const newUnfolded = new Set<number>();
        for (const pos of newValue) {
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
          newValue.delete(effect.value.from);
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
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(view.state))
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
        
        let lineNumber = 0;
        const lineCount = (lastCodeBlockLine - firstCodeBlockLine - 1) + parameters.lineNumberOffset;
        const gutterWidth = lineCount.toString().length * defaultCharWidth + 12; // padding-left + padding-right
        const gutterStyle = parameters.isSpecificNumber ? lineCount.toString().length > 2 ? `--gutter-width:${gutterWidth}px` : `` : ``; // number must be at least 3 digits, otherwise the padding is too little and causes a shift to left in text
        
        const rawLineCount = lastCodeBlockLine - firstCodeBlockLine - 1;
        const prompt = new PromptManager(parameters, rawLineCount, settings);

        for (let line = firstCodeBlockLine; line <= lastCodeBlockLine; line++) {
          const startLine = line === firstCodeBlockLine;
          const endLine = line === lastCodeBlockLine;
          const currentLine = view.state.doc.line(line);
          const lineStartPos = currentLine.from;

          // lines
          const lineClass = getLineClass(parameters, lineNumber, startLine, endLine, currentLine, decorations);
          decorations.push(Decoration.line({attributes: {class: lineClass, style: gutterStyle}}).range(lineStartPos));
            
          let spanClass = "";
          if (startLine) {
            spanClass = `codeblock-customizer-line-number-first`;
          }
    
          if (endLine) {
            spanClass = `codeblock-customizer-line-number-last`;
          }
          
          // line number
          if (settings.SelectedTheme.settings.codeblock.enableLineNumbers || parameters.isSpecificNumber || parameters.showNumbers === "specific"){
            decorations.push(Decoration.widget({ widget: new LineNumberWidget((startLine || endLine) ? " " : (lineNumber + parameters.lineNumberOffset).toString(), parameters, spanClass),}).range(lineStartPos));
          }

          // prompt
          if (prompt.promptLines.has(lineNumber + parameters.lineNumberOffset) && !startLine && !endLine) {
            const { node: promptNode, key, output } = prompt.renderLine(currentLine.text);

            decorations.push(Decoration.widget({ widget: new NodeWidget(promptNode, key) }).range(lineStartPos));

            if (output.length > 0) {
              for (const out of output) {
                decorations.push(Decoration.widget({ widget: new LineWidget(out.text, out.className), side: 1 }).range(currentLine.to));
              }
            }
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

  const inlineCodeViewPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    prevEnableSyntaxHighlight: boolean;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
      this.prevEnableSyntaxHighlight = settings.SelectedTheme.settings.inlineCode.enableSyntaxHighlight;
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || this.prevEnableSyntaxHighlight != settings.SelectedTheme.settings.inlineCode.enableSyntaxHighlight) {
        this.decorations = this.buildDecorations(update.view);
        this.prevEnableSyntaxHighlight = settings.SelectedTheme.settings.inlineCode.enableSyntaxHighlight;
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(view.state))
        return Decoration.none;

      const decorations: Array<Range<Decoration>> = [];
      const selection = view.state.selection.main;

      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({ from, to,
          enter: (node) => {
            if (!node.type.name.startsWith('inline-code'))
              return;

            decorations.push(Decoration.mark({ class: "codeblock-customizer-inline-code-wrapper" }).range(node.from, node.to));
            if (!settings.SelectedTheme.settings.inlineCode.enableSyntaxHighlight) {
              return;
            }

            const inlineCodeText = view.state.sliceDoc(node.from, node.to);
            const match = inlineCodeText.match(INLINE_CODE_LANG_REGEX);
            if (!match) 
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
    eventHandlers : {
      click: (event, view) => {
        if (!settings.SelectedTheme.settings.inlineCode.enableCopyOnClick) 
          return;

        const requiredKey = plugin.settings.SelectedTheme.settings.inlineCode.copyModifierKey;
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
        syntaxTree(view.state).iterate({ from: pos, to: pos,
          enter: (node) => {
            if (found) 
              return false;

            if (node.type.name.startsWith('inline-code')) {
              const text = view.state.sliceDoc(node.from, node.to);
              const match = text.match(INLINE_CODE_LANG_REGEX);
              const textToCopy = match && match[2] ? match[2] : text;
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
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(view.state)) {
        return Decoration.none;
      }

      if (!settings.SelectedTheme.settings.codeblock.enableLinks) {
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
      this.prevConvertAllComments = plugin.settings.SelectedTheme.settings.annotations.convertAllComments;
    }

    update(update: ViewUpdate) {
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(update.view.state))
        return Decoration.none;

      const oldCursorLine = update.startState.doc.lineAt(update.startState.selection.main.head).number;
      const newCursorLine = update.state.doc.lineAt(update.state.selection.main.head).number;
      const settingChanged = this.prevConvertAllComments !== plugin.settings.SelectedTheme.settings.annotations.convertAllComments;
        
      if (update.docChanged || update.viewportChanged || oldCursorLine !== newCursorLine || settingChanged) {
        this.decorations = this.buildDecorations(update.view);
        if (settingChanged) {
         this.prevConvertAllComments = plugin.settings.SelectedTheme.settings.annotations.convertAllComments;
        }
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      const decorations: Array<Range<Decoration>> = [];
      const codeBlockPositions = view.state.field(codeBlockPositionsField, false) ?? [];
      const cursorPos = view.state.selection.main.head;
      const cursorLineNumber = view.state.doc.lineAt(cursorPos).number;

      for (const pos of codeBlockPositions) {
        syntaxTree(view.state).iterate({ from: pos.codeBlockStartPos, to: pos.codeBlockEndPos,
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
            } else if (plugin.settings.SelectedTheme.settings.annotations.convertAllComments) {
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
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(view.state)) {
        return Decoration.none;
      }

      const positions = view.state.field(codeBlockPositionsField, false) ?? [];
      const visibleRanges = view.visibleRanges;
      const decorations: Array<Range<Decoration>> = [];
      const cursorPos = view.state.selection.main.head;

      const visibleBlocks = positions.filter(pos => {
        return visibleRanges.some(({ from, to }) => !(pos.codeBlockEndPos < from || pos.codeBlockStartPos > to));
      });

      const hideFences = settings.SelectedTheme.settings.codeblock.hideFenceLines;
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

        if (hideFenceLines ) {
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
        decorations.push(Decoration.widget({ widget: new buttonWidget(buttonConfigs, pos), side: -1 }).range(buttonLineStartPos));
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

      if (plugin.settings.SelectedTheme.settings.plugins.executeCode.enabled && isPluginLoaded('execute-code', plugin)) {
        this.observer.observe(view.contentDOM, { childList: true, subtree: true });
      }
    }

    private handleMutations(mutations: MutationRecord[], view: EditorView) {
      if (!plugin.settings.SelectedTheme.settings.plugins.executeCode.enabled || !isPluginLoaded('execute-code', plugin)) {
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
      if (plugin.settings.SelectedTheme.settings.plugins.admonitions.enabled && isPluginLoaded('obsidian-admonition', plugin)) {
        this.observer.observe(view.contentDOM, { childList: true, subtree: true });
        this.processAllAdmonitions(view.contentDOM, view);
      }
    }

    private handleMutations(mutations: MutationRecord[], view: EditorView) {
      if (!plugin.settings.SelectedTheme.settings.plugins.admonitions.enabled || !isPluginLoaded('obsidian-admonition', plugin)) {
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
      if (!plugin.settings.SelectedTheme.settings.plugins.admonitions.enabled || !isPluginLoaded('obsidian-admonition', plugin)) {
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
    pos: CodeBlockPositions
    buttonConfigs: Array<ButtonConfig>;
    groupMembers: CodeBlockPositions[];
    foldingState: FoldingState;
    sourcePath: string;
    disableFoldUnlessSpecified: boolean;
    plugin: CodeBlockCustomizerPlugin;
  
    constructor(parameters: CBCParameters, pos: CodeBlockPositions, buttonConfigs: Array<ButtonConfig>, groupMembers: CodeBlockPositions[], foldingState: FoldingState, sourcePath: string, plugin: CodeBlockCustomizerPlugin) {
      super();
      this.parameters = parameters;
      this.pos = pos;
      this.buttonConfigs = buttonConfigs;
      this.enableLinks = plugin.settings.SelectedTheme.settings.codeblock.enableLinks;

      const allLangColors = plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors;
      const langKey = this.parameters.language.length > 0 ? this.parameters.language : "nolang";
      const lowerCaseLangKey = langKey.toLowerCase();
      const result = Object.keys(allLangColors).find(k => k.toLowerCase() === lowerCaseLangKey);
      this.languageSpecificColors = createObjectCopy(result ? allLangColors[result] : {});
      this.groupMembers = groupMembers;
      this.foldingState = foldingState;
      this.sourcePath = sourcePath;
      this.disableFoldUnlessSpecified = plugin.settings.SelectedTheme.settings.header.disableFoldUnlessSpecified;
      this.plugin = plugin;
    }
  
    eq(other: HeaderWidget) {
      return other.parameters.headerDisplayText === this.parameters.headerDisplayText && other.parameters.language === this.parameters.language && 
      other.parameters.specificHeader === this.parameters.specificHeader && other.parameters.fold === this.parameters.fold && 
      other.parameters.hasLangBorderColor === this.parameters.hasLangBorderColor && other.enableLinks === this.enableLinks && //other.marginLeft === this.marginLeft &&
      other.parameters.indentLevel === this.parameters.indentLevel && other.pos.codeBlockStartPos === this.pos.codeBlockStartPos && other.pos.codeBlockEndPos === this.pos.codeBlockEndPos && other.sourcePath === this.sourcePath &&
      other.plugin === this.plugin && areObjectsEqual(other.languageSpecificColors, this.languageSpecificColors) && compareButtonConfigs(this.buttonConfigs, other.buttonConfigs) &&
      other.disableFoldUnlessSpecified === this.disableFoldUnlessSpecified && other.foldingState === this.foldingState && areGroupMembersEqual(this.groupMembers, other.groupMembers);
    }
  
    toDOM(view: EditorView): HTMLElement {
      const codeblockLanguageSpecificClass = getLanguageSpecificColorClass(this.parameters.language, null, this.languageSpecificColors);
      const container = createContainer(this.parameters.specificHeader, this.parameters.language, this.parameters.hasLangBorderColor, codeblockLanguageSpecificClass);
      const isGrouped = this.parameters.group.length > 0 && this.groupMembers.length > 1;

      if (this.parameters.displayLanguage){
        const Icon = getLanguageIcon(this.parameters.displayLanguage);
        if (Icon) {
          container.appendChild(createCodeblockIcon(this.parameters.displayLanguage));
        } else if (isGrouped) // set default icon for tab when language is not defined
        container.appendChild(createCodeblockIcon("NoIcon"));
      } else if (isGrouped) // set default icon for tab when the language defined does not has an icon
        container.appendChild(createCodeblockIcon("NoIcon"));

      if (isGrouped)
        addTabs(view, container, this.parameters, this.groupMembers);
  
      if (this.parameters.displayLanguage && !isGrouped) {
        container.appendChild(createCodeblockLang(this.parameters.language));
      }
  
      container.appendChild(createFileName(this.parameters.headerDisplayText, this.enableLinks, this.sourcePath, this.plugin));
      
      // header buttons
      const buttonContainer = createButtonContainer(this.buttonConfigs, view, `codeblock-customizer-header-button-container`)
      container.appendChild(buttonContainer);
      
      if ((this.disableFoldUnlessSpecified && !this.plugin.settings.SelectedTheme.settings.codeblock.folding.inverseFold && !this.parameters.fold) ||
          (this.disableFoldUnlessSpecified && this.plugin.settings.SelectedTheme.settings.codeblock.folding.inverseFold && !this.parameters.unfold)) {
        container.classList.add(`noCollapseIcon`);
      } else {
        const collapse = createCodeblockCollapse(this.parameters.fold);
        container.appendChild(collapse);

        if (this.foldingState === FoldingState.FullyFolded) {
          setIcon(collapse, "chevrons-down-up"); // fully folded icon
          container.classList.add('collapsed');
        } else if (this.foldingState === FoldingState.SemiFolded) {
          setIcon(collapse, "chevrons-down-up");
          container.classList.add('semi-collapsed');
        } else {
          setIcon(collapse, "chevrons-up-down"); // unfolded icon
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

        if ((this.disableFoldUnlessSpecified && !this.plugin.settings.SelectedTheme.settings.codeblock.folding.inverseFold && !this.parameters.fold) ||
            (this.disableFoldUnlessSpecified && this.plugin.settings.SelectedTheme.settings.codeblock.folding.inverseFold && !this.parameters.unfold)) {
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

  class AnnotationIconWidget extends WidgetType {
    constructor(readonly type: string, readonly content: string, readonly plugin: CodeBlockCustomizerPlugin, readonly title?: string) {
      super();
    }

    eq(other: AnnotationIconWidget) {
      return other.type === this.type && other.content === this.content && other.plugin === this.plugin && other.title === this.title;
    }

    toDOM(view: EditorView): HTMLElement {
      const iconContainer = createSpan({cls: `codeblock-customizer-annotation-icon codeblock-customizer-annotation-icon-${this.type}`});
      //iconContainer.setAttribute("aria-label", `Annotation: ${this.type}`);
      iconContainer.innerHTML = rhombusSVG;

      const sourcePath = view.state.field(editorInfoField)?.file?.path ?? "";

      new TooltipManager(iconContainer, this.content, this.type, this.plugin, sourcePath, this.title);

      return iconContainer;
    }
  }// AnnotationIconWidget

  /* functions */

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
      settings: plugin.settings.SelectedTheme.settings,
      sourcePath: "",
      handleAnnotations: true,
      processPrompts: false,
      addIndentationGuides: true,
      parseLinks: plugin.settings.SelectedTheme.settings.codeblock.enableLinks,
    });

    codeElement.appendChild(fragment);
    
    const borderColor = getBorderColorByLanguage(baseLanguage, getPropertyFromLanguageSpecificColors("codeblock.borderColor", plugin.settings));
    if (borderColor.length > 0) {
      preElement.classList.add('hasLangBorderColor');
    }

    parameters.language = baseLanguage;
    const {container: buttons} = createButtons(parameters, rawCodeLines, plugin, preElement);
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

      if (decoration.spec.widget?.constructor.name === 'uncollapseCodeWidget' || decoration.spec.attributes?.class?.includes('semi-folded') || decoration.spec.attributes?.class?.includes('codeblock-customizer-fade-out-line')) {
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
    if (params1.specificHeader !== params2.specificHeader) 
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

  function addTabs(view: EditorView, container: HTMLElement, parameters: CBCParameters, groupMembers: CodeBlockPositions[] ) {
    const tabsContainer = createDiv({ cls: "codeblock-customizer-header-group-tabs" });
    //const activeStartPos = view.state.field(activeGroupTabStateField)[parameters.group];
    const activeGroup = view.state.field(activeGroupTabField, false) ?? {};
    const activeStartPos = activeGroup?.[parameters.group];

    groupMembers.forEach((member, index) => {
      const tab = createTab(member, activeStartPos, index);
      tab.dataset.startPos = String(member.codeBlockStartPos);
      tabsContainer.appendChild(tab);
    });

    tabsContainer.onclick = (event) => {
      const tabElement = (event.target as HTMLElement).closest<HTMLElement>('.codeblock-customizer-header-group-tab');

      if (!tabElement) {
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

  function createTab(member: CodeBlockPositions, activeStartPos: number, index: number): HTMLElement {
    const displayLangName = getDisplayLanguageName(member.parameters.language);
    const tabText = member.parameters.tab || displayLangName || `Tab ${index + 1}`;
    const tab = createCodeblockLang(member.parameters.language, `codeblock-customizer-header-group-tab`, tabText);

    if (member.codeBlockStartPos === activeStartPos) {
      tab.classList.add("active");
    }

    return tab;
  }// createTab

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

    const enableSemiFold = settings.SelectedTheme.settings.semiFold.enableSemiFold;
    const visibleLines = settings.SelectedTheme.settings.semiFold.visibleLines;
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
  
    if (codeBlockStartPos !== -1 && codeBlockEndPos === -1 && parameters.fenceChar) {
      const end = findCodeBlockEnd(codeBlockStartPos, state, parameters.fenceCount, parameters.fenceChar);
      if (end)
        positions.push({ codeBlockStartPos, codeBlockEndPos: end, parameters });
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

        while(nextPosIndex < positions.length) {
          const potentialNextPos = positions[nextPosIndex];
          if (potentialNextPos.parameters.group === group && potentialNextPos.codeBlockStartPos - currentPos.codeBlockEndPos <= 1) {
            currentConsecutiveSequence.push(potentialNextPos);
            currentPos = potentialNextPos;
            nextPosIndex++;
          } else {
            break;
          }
        }

        if (currentConsecutiveSequence.length > 1) {
          grouped[group] = currentConsecutiveSequence;
        }
      }
    }
    return grouped;
  }// calculateGroupedCodeBlocks

  function insertHeader(state: EditorState): DecorationSet {
    if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(state))
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

      const isMemberOfTabbedGroup = group && grouped[group] && grouped[group].some(member => member.codeBlockStartPos === codeBlockStartPos);

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
          decorations.push(Decoration.replace({block: true}).range(codeBlockStartPos, codeBlockEndPos));
        }
      }

      if (createHeader) {
        if (!parameters.specificHeader && isMemberOfTabbedGroup)
          parameters.specificHeader = true; // code blocks which are members of a group, but do not have file/title set must be specific!
        
        if (!parameters.language.toLowerCase().startsWith('run-')) {
          const buttonConfigs = createButtonConfigs(codeBlockStartPos, codeBlockEndPos, state, parameters);
          decorations.push(Decoration.widget({ widget: new HeaderWidget(parameters, pos, buttonConfigs, currentGroupMembers, foldingState, sourcePath, plugin), block: true }).range(codeBlockStartPos));
        }
      }
    }
    return RangeSet.of(decorations, true);
  }// insertHeader
  
  function createButtonConfigs(codeBlockStartPos: number, codeBlockEndPos: number, state: EditorState, parameters: CBCParameters){
    const cursorPos = state.selection.main.head;
    const isCursorInCodeBlock = cursorPos >= codeBlockStartPos && cursorPos <= codeBlockEndPos;
    
    let showButton = false;
    if ((!settings.SelectedTheme.settings.codeblock.buttons.alwaysShowButtons) && !isCursorInCodeBlock)
      showButton = true;
    else if (settings.SelectedTheme.settings.codeblock.buttons.alwaysShowButtons)
      showButton = true;

    const modifierKey = plugin.settings.SelectedTheme.settings.codeblock.buttons.modifierKey;
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

            if (settings.SelectedTheme.settings.prompts.includePromptsInCopy) {
              const lines: string[] = [];
              const firstContentLineNum = state.doc.lineAt(from).number;
              const lastContentLineNum = state.doc.lineAt(to).number;
              const lineCount = lastContentLineNum - firstContentLineNum + 1;
              const promptManager = new PromptManager(parameters, lineCount, settings);
              
              for (let i = firstContentLineNum; i <= lastContentLineNum; i++) {
                const line = state.doc.line(i);
                const relativeLineNumber = i - firstContentLineNum + 1;

                if (promptManager.promptLines.has(relativeLineNumber)) {
                  const { node, output } = promptManager.renderLine(line.text);
                  lines.push(`${node.textContent}${line.text}`);

                  if (output && output.length > 0) {
                    for (const out of output) {
                      lines.push(out.text);
                    }
                  }
                } else {
                  lines.push(line.text);
                }
              }
              initialLines = lines;
            } else {
              const content = settings.SelectedTheme.settings.annotations.excludeAnnotationsFromCopy ? getCodeWithoutAnnotation(view, from, to) : view.state.sliceDoc(from, to);
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
        enabled: settings.SelectedTheme.settings.codeblock.buttons.enableSnapshotButton && showButton
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
        enabled: settings.SelectedTheme.settings.codeblock.buttons.enableSelectCodeButton && showButton
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
        enabled: settings.SelectedTheme.settings.codeblock.buttons.enableDeleteCodeButton && showButton
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

    const originalContainer = startingEl.parentElement;

    if (container) {
      container.style.visibility = 'hidden';
    }

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
          if (node.classList?.contains('codeblock-customizer-button-container')) {
            return false;
          }
          return !(node.tagName === 'IMG' && node.classList.contains('cm-widgetBuffer'));
        }
      };

      await generateSnapshot(cloneContainer, originalContainer, parent, plugin.settings, snapshotOptions);
    } finally {
      if (container) {
        container.style.visibility = 'visible';
      }
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
    const container = createDiv({cls: buttonContainerClass || `codeblock-customizer-button-container`});

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

    syntaxTree(view.state).iterate({from: from, to: to,
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
    lineClass = highlightLinesOrWords(lineNumber + parameters.lineNumberOffset, startLine, endLine, parameters, line, decorations, lineClass);
    lineClass = lineClass + " " + codeblockLanguageClass + " " + codeblockLanguageSpecificClass;

    if (borderColor.length > 0)
      lineClass = lineClass + " hasLangBorderColor";
  
    return lineClass;
  }// getLineClass

  function checkForLinks(state: EditorState, collapseFrom: number, collapseTo: number, decorations: Array<Range<Decoration>>, sourcePath: string) {
    const cursorPos = state.selection.main.head;
    const regex = /(?:\[\[([^[\]]+?)(?:\|([^\]]+?))?]]|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s]+))/g;
    
    syntaxTree(state).iterate({ from: collapseFrom, to: collapseTo,
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
      decorations.push(Decoration.mark({class: "cm-formatting-link cm-formatting-link-start"}).range(rangeFrom, rangeFrom + 2));
      decorations.push(Decoration.mark({class: "cm-hmd-internal-link"}).range(rangeFrom + 2, rangeTo - 2));
      decorations.push(Decoration.mark({class: "cm-formatting-link cm-formatting-link-end"}).range(rangeTo - 2, rangeTo));
      return;
    }
    
    // Markdown Link -> [DisplayText](Link)
    if (match[3] !== undefined) {
      const endOfText = rangeFrom + fullMatch.indexOf("](");
      const startOfLink = endOfText + 2;

      // [DisplayText] part
      decorations.push(Decoration.mark({class: "cm-formatting cm-formatting-link cm-link"}).range(rangeFrom, rangeFrom + 1));
      decorations.push(Decoration.mark({class: "cm-link"}).range(rangeFrom + 1, endOfText));
      decorations.push(Decoration.mark({class: "cm-formatting cm-formatting-link cm-link"}).range(endOfText, endOfText + 1));
      
      // (Link) part
      decorations.push(Decoration.mark({class: "cm-formatting cm-formatting-link-string cm-string cm-url"}).range(endOfText + 1, startOfLink));
      decorations.push(Decoration.mark({class: "cm-string cm-url"}).range(startOfLink, rangeTo - 1));
      decorations.push(Decoration.mark({class: "cm-formatting cm-formatting-link-string cm-string cm-url"}).range(rangeTo - 1, rangeTo));
      return;
    }
    
    // HTTP or HTTPS URL
    if (match[5] !== undefined) {
      decorations.push(Decoration.mark({class: "cm-url"}).range(rangeFrom, rangeTo));
      return;
    }
  }// renderLink

  function highlightLinesOrWords(lineNumber: number, startLine: boolean, endLine: boolean, parameters: CBCParameters, line: Line, decorations: Array<Range<Decoration>>, lineClass: string) {
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
    const lineSpecificWord = lineSpecificWords.filter(item => item.lineNumber === lineNumber);
    if (lineSpecificWord.length > 0) {
      lineSpecificWord.forEach(rule => {
        highlighText(rule.words);
      });
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
    const specificTextBetween = lineSpecificTextBetween.filter(item => item.lineNumber === lineNumber);
    if (specificTextBetween.length > 0) {
      specificTextBetween.forEach(rule => {
        if (caseInsensitiveLineText.includes(rule.from.toLowerCase()) && caseInsensitiveLineText.includes(rule.to.toLowerCase())) {
          const highlightText = `${rule.from}${textSeparator}${rule.to}`;
          highlighText([highlightText]);
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
    const altLineSpecificWord = altLineSpecificWords.filter(item => item.lineNumber === lineNumber);
    if (altLineSpecificWord.length > 0) {
      altLineSpecificWord.forEach(rule => {
        const { colorName, words } = rule;
        highlighText(words, colorName);
      });
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
    const altSpecificTextBetween = altLineSpecificTextBetween.filter(item => item.lineNumber === lineNumber);
    if (altSpecificTextBetween.length > 0) {
      altSpecificTextBetween.forEach(rule => {
        if (caseInsensitiveLineText.includes(rule.from.toLowerCase()) && caseInsensitiveLineText.includes(rule.to.toLowerCase())) {
          const highlightText = `${rule.from}${textSeparator}${rule.to}`;
          highlighText([highlightText], rule.colorName);
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
      const lineText = line.text;
      const startPosInLine = lineText.search(/\S/);
      if (startPosInLine === -1) {
        return;
      }

      let endBoundary = lineText.length;
      const commentMatch = lineText.match(/\s+(\/\/|\/\*|#|--)/);
      if (commentMatch && typeof commentMatch.index === 'number') {
        const commentText = lineText.substring(commentMatch.index);
        
        if (settings.SelectedTheme.settings.annotations.convertAllComments || ANNOTATION_PATTERN.test(commentText)) {
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
      const occurrences = findAllOccurrences(caseInsensitiveLineText, word);
  
      occurrences.forEach((index) => {
        const classToUse = customClass ? `codeblock-customizer-highlighted-text-${customClass}` : 'codeblock-customizer-highlighted-text';
        decorations.push(Decoration.mark({ class: classToUse }).range(line.from + index, line.from + index + word.length));
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
      if (decoration.spec.widget?.constructor.name === 'uncollapseCodeWidget' || decoration.spec.attributes?.class?.includes('semi-folded') || decoration.spec.attributes?.class?.includes('codeblock-customizer-fade-out-line')) {
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
  
    return { replaceStart, replaceEnd, fadeOutStart, fadeOutEnd, firstLine};
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
    return semiUnFade.of({filterFrom: CollapseStart, filterTo: CollapseEnd});
  }// clearFadeEffect

  const extensions = [
    codeBlockPositionsField, 
    groupedCodeBlocksField, 
    activeGroupTabField, 
    collapseField, 
    headerField, 
    defaultFoldUnfoldedField, 
    rememberedFoldField, 
    foldCommandField, 
    viewPlugin, 
    linkViewPlugin, 
    inlineCodeViewPlugin, 
    annotationViewPlugin, 
    hideFencesPlugin, 
    executeCodeViewPlugin,
    admonitionViewgPlugin,
    liveUpdateExtension()
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
