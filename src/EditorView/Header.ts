import { editorInfoField, Notice, setIcon } from "obsidian";

import { StateField, EditorState, Transaction, Extension, Range, RangeSet, EditorSelection } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

import { ButtonModifierKeys, CodeblockCustomizerSettings, CollapseIconStyle } from "../Settings";
import CodeBlockCustomizerPlugin from "../main";
import { CBCParameters, getAllParameters } from "../Parsing";
import { PromptManager } from "../PromptManager";
import { getLanguageIcon, createContainer, createCodeblockLang, createCodeblockIcon, createFileName, createCodeblockCollapse, getCurrentMode, isSourceMode, getLanguageSpecificColorClass, addTextToClipboard, normalizeIndentation, isPluginLoaded, generateSnapshot, isSpecificHeader, getCollapseIcons } from "../Utils";
import { CodeBlockPositions, GroupedCodeBlocks } from "./CodeBlockPositions";
import { FoldingState, rehideEffect, CodeBlockFoldEffect } from "./EditorEffects";
import { areGroupMembersEqual, areObjectsEqual } from "./CompareUtils";

export interface ButtonConfig {
  class: string;
  displayText: string;
  action: (view: EditorView, container?: HTMLElement, event?: MouseEvent) => void;
  icon: string;
  text?: string;
  enabled: boolean;
}

export function headerExtension(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings, codeBlockPositionsField: StateField<CodeBlockPositions[]>, collapseField: StateField<RangeSet<Decoration>>, activeGroupTabField: StateField<Record<string, number>>,
  groupedCodeBlocksField: StateField<GroupedCodeBlocks>, hiddenLinesUnhiddenField: StateField<Set<number>>, getFoldingState: (state: EditorState, startPos: number, endPos: number) => FoldingState,
  toggleCodeBlockFold: (view: EditorView, pos: CodeBlockPositions) => { effects: CodeBlockFoldEffect[], annotations: any[] }, addTabs: (view: EditorView, container: HTMLElement, parameters: CBCParameters, groupMembers: CodeBlockPositions[]) => void, getSettingsUpdated: () => boolean) {

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

      const unhiddenChanged = oldState.field(hiddenLinesUnhiddenField, false) !== newState.field(hiddenLinesUnhiddenField, false);
      if (!docChanged && !getSettingsUpdated() && !positionsChanged && !tabsChanged && !foldChanged && !needsSelectionUpdate && !unhiddenChanged) {
        return value;
      }
      return insertHeader(transaction.state);
    },
    provide(field: StateField<DecorationSet>): Extension {
      return EditorView.decorations.from(field);
    }
  });// headerField

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

    constructor(parameters: CBCParameters, specificHeader: boolean, pos: CodeBlockPositions, buttonConfigs: Array<ButtonConfig>, groupMembers: CodeBlockPositions[], foldingState: FoldingState, sourcePath: string, plugin: CodeBlockCustomizerPlugin, modifierKey: ButtonModifierKeys, resolvedLangColors: Record<string, string>) {
      super();
      this.parameters = parameters;
      this.specificHeader = specificHeader;
      this.pos = pos;
      this.buttonConfigs = buttonConfigs;
      this.enableLinks = plugin.settings.pluginSettings.codeblock.enableLinks;
      this.languageSpecificColors = resolvedLangColors;
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

  function createLanguageColorMap(allLangColors: Record<string, Record<string, string>>): Map<string, Record<string, string>> {
    const map = new Map<string, Record<string, string>>();
    for (const key of Object.keys(allLangColors)) {
      map.set(key.toLowerCase(), allLangColors[key]);
    }
    return map;
  }// createLanguageColorMap

  function insertHeader(state: EditorState): DecorationSet {
    if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(state))
      return Decoration.none;

    const sourcePath = state.field(editorInfoField)?.file?.path ?? "";
    const positions = state.field(codeBlockPositionsField, false) ?? [];
    const decorations: Array<Range<Decoration>> = [];
    const grouped = state.field(groupedCodeBlocksField, false) ?? {};
    const allLangColors = plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors;
    const langColorMap = createLanguageColorMap(allLangColors);

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
          const langKey = (parameters.language.length > 0 ? parameters.language : "nolang").toLowerCase();
          const resolvedLangColors = langColorMap.get(langKey) ?? {};
          decorations.push(Decoration.widget({ widget: new HeaderWidget(parameters, specificHeader, pos, buttonConfigs, currentGroupMembers, foldingState, sourcePath, plugin, modifierKey, resolvedLangColors), block: true }).range(codeBlockStartPos));
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
        class: `codeblock-customizer-rehide-lines`,
        displayText: "Re-hide unhidden lines",
        action: (view: EditorView) => {
          view.dispatch({ effects: rehideEffect.of({ from: codeBlockStartPos, to: codeBlockEndPos }) });
        },
        icon: "eye-off",
        enabled: parameters.hideLines.length > 0 && [...state.field(hiddenLinesUnhiddenField, false) || []].some(pos => pos >= codeBlockStartPos && pos <= codeBlockEndPos) && showButton
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
          if (node.classList?.contains('codeblock-customizer-button-container') ||        // first-line button container
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

  return {
    headerField,
    HeaderWidget,
    buttonWidget,
    insertHeader,
    createButtonConfigs,
    compareButtonConfigs,
    createButtonContainer,
    getCodeWithoutAnnotation
  };
}// headerExtension
