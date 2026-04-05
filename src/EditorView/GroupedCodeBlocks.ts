import { editorInfoField, setIcon } from "obsidian";

import { StateField, EditorState, Transaction, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { CodeblockCustomizerSettings, TabPersistence } from "../Settings";
import CodeBlockCustomizerPlugin from "../main";
import { createCodeblockLang, isSourceMode, getDisplayLanguageName } from "../Utils";
import { CBCParameters } from "../Parsing";
import { CodeBlockPositions, GroupedCodeBlocks } from "./CodeBlockPositions";
import { setGroupTab, CodeBlockFoldEffect, FoldingState } from "./EditorEffects";

export function groupedCodeBlocksExtension(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings, codeBlockPositionsField: StateField<CodeBlockPositions[]>,
  getToggleCodeBlockFold: () => (view: EditorView, pos: CodeBlockPositions) => { effects: CodeBlockFoldEffect[], annotations: any[] }, getFoldingState?: (state: EditorState, startPos: number, endPos: number) => FoldingState) {

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
      const savedStatesForFile = docPath ? plugin.tabStoreEditor.getAll(docPath) : undefined;

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
        const docStateMap = plugin.tabStoreEditor.getAll(docPath);
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

          for (const [groupName, pos] of newDocStateMap.entries()) {
            plugin.tabStoreEditor.set(docPath, groupName, pos);
          }
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
              plugin.tabStoreEditor.set(docPath, groupName, newStartPos);
              plugin.requestSavePermanentData();
            } else {
              plugin.tabStoreEditor.set(docPath, groupName, newStartPos);
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
        const savedStatesForFile = (docPath && tabSettings.rememberTabState) ? plugin.tabStoreEditor.getAll(docPath) : undefined;

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
        handleTabClick(view, clickedMember, parameters, groupMembers);
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

  function handleTabClick(view: EditorView, member: CodeBlockPositions, parameters: CBCParameters, groupMembers: CodeBlockPositions[]) {
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
      const foldChanges = getToggleCodeBlockFold()(view, member);
      effects.push(...foldChanges.effects);
      annotations.push(...foldChanges.annotations);
      view.dispatch({ annotations, effects });
      return;
    }

    const selectionHead = view.state.selection.main.head;
    const isCursorInGroup = groupMembers.some(m =>
      selectionHead >= m.codeBlockStartPos && selectionHead <= m.codeBlockEndPos
    );

    if (isCursorInGroup) {
      // cursor is inside one of the grouped code blocks ==> move cursor
      const foldedState = getFoldingState ? getFoldingState(view.state, member.codeBlockStartPos, member.codeBlockEndPos) : FoldingState.Unfolded;

      let cursorPos: number;
      if (foldedState === FoldingState.FullyFolded) {
        // code block is fully folded ==> move cursor after the group
        const lastMember = groupMembers[groupMembers.length - 1];
        const lastMemberEndLine = view.state.doc.lineAt(lastMember.codeBlockEndPos);
        cursorPos = Math.min(lastMemberEndLine.to + 1, view.state.doc.length);
      } else {
        // code block is unfolded or semi-folded
        const firstLine = view.state.doc.lineAt(member.codeBlockStartPos);
        const lastLine = view.state.doc.lineAt(member.codeBlockEndPos);
        const hasContentLines = lastLine.number - firstLine.number > 1;

        if (!hasContentLines) {
          // code block has no content lines ==> place the cursor at the end of the opening fence line
          cursorPos = firstLine.to;
        } else {
          // code block has content lines ==> place the cursor at the start of the first content line
          cursorPos = view.state.doc.line(firstLine.number + 1).from;
        }
      }

      view.dispatch({ annotations, effects, selection: EditorSelection.cursor(cursorPos) });
    } else {
      // cursor is outside of grouped code blocks ==> leave it where it is
      view.dispatch({ annotations, effects });
    }
  }// handleTabClick

  return {
    groupedCodeBlocksField,
    activeGroupTabField,
    calculateGroupedCodeBlocks,
    addTabs,
    createTab,
    addAddTabButton,
    addRemoveTabButton,
    handleTabClick
  };
}// groupedCodeBlocksExtension
