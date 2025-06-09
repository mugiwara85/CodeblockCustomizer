import { StateField, StateEffect, RangeSetBuilder, EditorState, Transaction, Extension, Range, RangeSet, Line, Text, EditorSelection, Annotation } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { bracketMatching, syntaxTree } from "@codemirror/language";
import { SyntaxNodeRef } from "@lezer/common";
import { highlightSelectionMatches } from "@codemirror/search";

import { getLanguageIcon, createContainer, createCodeblockLang, createCodeblockIcon, createFileName, createCodeblockCollapse, getBorderColorByLanguage, getCurrentMode, isSourceMode, getLanguageSpecificColorClass, createObjectCopy, getAllParameters, Parameters, findAllOccurrences, createUncollapseCodeButton, isExcluded, isFoldDefined, isUnFoldDefined, addTextToClipboard, removeFirstLine, getPropertyFromLanguageSpecificColors, getDefaultParameters, PromptEnvironment, PromptDefinition, getPWD, createPromptContext, PromptCache, renderPromptLine, computePromptLines, getDisplayLanguageName} from "./Utils";
import { CodeblockCustomizerSettings } from "./Settings";
import { MarkdownRenderer, editorEditorField, editorInfoField, setIcon } from "obsidian";
import { DEFAULT_TEXT_SEPARATOR, fadeOutLineCount } from "./Const";
import CodeBlockCustomizerPlugin from "./main";

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

interface RangeWithDecoration {
  from: number;
  to: number;
  decoration: Decoration;
}

export interface CodeBlockPositions {
  codeBlockStartPos: number;
  codeBlockEndPos: number;
  parameters: Parameters;
}

type GroupedCodeBlocks = {
  [groupName: string]: CodeBlockPositions[];
};

interface ButtonConfig {
  class: string;
  displayText: string;
  action: (view: EditorView) => void;
  icon: string;
  text?: string;
  enabled: boolean;
}

export function extensions(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings) {
  /* annotations, effects */

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
      document.body.classList.remove('codeblock-customizer-header-collapse-command');
      settings.foldAllCommand = false;
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
      if (!startState.selection.eq(state.selection) || syntaxTree(startState) !== syntaxTree(state)) {
        // re-scan
        const newBlocks = findCodeBlockPositions(state);

        // merge the new findings with the existing state
        const merged = new Map<number, CodeBlockPositions>();
        
        // add existing blocks
        value.forEach(block => merged.set(block.codeBlockStartPos, block));
        
        // add/overwrite with newly found blocks
        newBlocks.forEach(block => merged.set(block.codeBlockStartPos, block));

        const result = Array.from(merged.values()).sort((a,b) => a.codeBlockStartPos - b.codeBlockStartPos);
        return result;
      }

      // nothing changed => return values
      return value;
    }
  });// codeBlockPositionsField

  const collapseField = StateField.define<RangeSet<Decoration>>({
    create(state): RangeSet<Decoration> {
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(state))
        return Decoration.none;

      return defaultFold(state);
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
      return value;
    },
    provide: f => EditorView.decorations.from(f)
  });// collapseField

  const activeGroupTabField = StateField.define<Record<string, number>>({
    create(state: EditorState) {
      if (!settings.SelectedTheme.settings.common.enableInSourceMode && isSourceMode(state))
        return {};

      const initialGrouped = state.field(groupedCodeBlocksField, false) ?? {};
      const initialTabs: {[groupName: string]: number} = {};
      const docPath = state.field(editorInfoField)?.file?.path;
      const savedStatesForFile = docPath ? plugin.activeEditorTabs.get(docPath) : undefined;

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
        const docStateMap = plugin.activeEditorTabs.get(docPath);
        if (docStateMap && docStateMap.size > 0) {
          const newDocStateMap = new Map<string, number>();
          for (const [groupName, savedPos] of docStateMap.entries()) {
            const newPos = transaction.changes.mapPos(savedPos);
            newDocStateMap.set(groupName, newPos);
          }
          plugin.activeEditorTabs.set(docPath, newDocStateMap);
        }
      }

      // case 1: a tab was clicked => save
      const groupUpdate = transaction.annotation(setGroupTab);
      if (groupUpdate) {
        const newStartPos = transaction.changes.mapPos(groupUpdate.startPos);
        const groupName = groupUpdate.group;
        
        if (docPath) {
          let docStateMap = plugin.activeEditorTabs.get(docPath);
          if (!docStateMap) {
            docStateMap = new Map<string, number>();
            plugin.activeEditorTabs.set(docPath, docStateMap);
          }
          docStateMap.set(groupName, newStartPos);
        }
        return { ...value, [groupName]: newStartPos };
      }

      const oldGroups = transaction.startState.field(groupedCodeBlocksField, false);
      const newGroups = transaction.state.field(groupedCodeBlocksField, false);

      // case 2: document changed or new groups scrolled into view
      if (transaction.docChanged || oldGroups !== newGroups) {
        const newState: Record<string, number> = {};
        const newGroupedCodeBlocks = newGroups ?? {};
        const savedStatesForFile = docPath ? plugin.activeEditorTabs.get(docPath) : undefined;

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

      const sourcePath = view.state.field(editorInfoField)?.file?.path ?? "";
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
    
        if (settings.SelectedTheme.settings.codeblock.enableLinks)
          checkForLinks(view.state, codeBlockStartPos, codeBlockEndPos, decorations, sourcePath);
    
        let lineNumber = 0;
        const lineCount = (lastCodeBlockLine - firstCodeBlockLine - 1) + parameters.lineNumberOffset;
        const gutterWidth = lineCount.toString().length * defaultCharWidth + 12; // padding-left + padding-right
        const gutterStyle = parameters.isSpecificNumber ? lineCount.toString().length > 2 ? `--gutter-width:${gutterWidth}px` : `` : ``; // number must be at least 3 digits, otherwise the padding is too little and causes a shift to left in text
        
        const rawLineCount = lastCodeBlockLine - firstCodeBlockLine - 1;
        const promptLines = computePromptLines(parameters, rawLineCount, settings);
        const { context, initialEnv } = createPromptContext(parameters, settings);
        let promptEnv = { ...initialEnv };
        let cache: PromptCache = { key: "", node: null };

        for (let line = firstCodeBlockLine; line <= lastCodeBlockLine; line++) {
          const startLine = line === firstCodeBlockLine;
          const endLine = line === lastCodeBlockLine;
          const currentLine = view.state.doc.line(line);
          const lineStartPos = currentLine.from;

          // lines
          const lineClass = getLineClass(parameters, lineNumber, startLine, endLine, currentLine, decorations);
          decorations.push(Decoration.line({attributes: {class: lineClass, style: gutterStyle}}).range(lineStartPos));
          
          /*if ((!pos.defaultFolded) && (pos.parameters.fold || (settings.SelectedTheme.settings.codeblock.inverseFold && !pos.parameters.unfold)))
            defaultFold(state, decorations);*/
  
          let spanClass = "";
          if (startLine) {
            spanClass = `codeblock-customizer-line-number-first`;
            
            // first-line buttons
            const buttonConfigs = createButtonConfigs(codeBlockStartPos, codeBlockEndPos, view.state, parameters);
            decorations.push(Decoration.widget({ widget: new buttonWidget(buttonConfigs, { codeBlockStartPos, codeBlockEndPos, parameters } ), side: -1}).range(lineStartPos));
          }
    
          if (endLine) {
            spanClass = `codeblock-customizer-line-number-last`;
          }
          
          // line number
          if (settings.SelectedTheme.settings.codeblock.enableLineNumbers || parameters.isSpecificNumber || parameters.showNumbers === "specific"){
            decorations.push(Decoration.widget({ widget: new LineNumberWidget((startLine || endLine) ? " " : (lineNumber + parameters.lineNumberOffset).toString(), parameters, spanClass),}).range(lineStartPos));
          }

          // prompt
          const isPromptLine = promptLines.has(lineNumber + parameters.lineNumberOffset) && !startLine && !endLine;
          if (isPromptLine) {
            const snapshot = { ...promptEnv };
            const lineText = currentLine.text;
            addCommandOutput(lineText, decorations, currentLine, promptEnv, context.promptDef);
            const { newEnv, newCache, node, key } = renderPromptLine(lineText, snapshot, cache, context);
            decorations.push(Decoration.widget({ widget: new NodeWidget(node, key) }).range(lineStartPos));
            promptEnv = newEnv;
            cache = newCache;
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

  /* Widgets */

  class TextAboveCodeblockWidget extends WidgetType {
    enableLinks: boolean;
    languageSpecificColors: Record<string, string>;
    parameters: Parameters;
    pos: CodeBlockPositions
    buttonConfigs: Array<ButtonConfig>;
    groupMembers: CodeBlockPositions[];
    foldingState: FoldingState;
    sourcePath: string;
    disableFoldUnlessSpecified: boolean;
    plugin: CodeBlockCustomizerPlugin;
  
    constructor(parameters: Parameters, pos: CodeBlockPositions, buttonConfigs: Array<ButtonConfig>, groupMembers: CodeBlockPositions[], foldingState: FoldingState, sourcePath: string, plugin: CodeBlockCustomizerPlugin) {
      super();
      this.parameters = parameters;
      this.pos = pos;
      this.buttonConfigs = buttonConfigs;
      this.enableLinks = plugin.settings.SelectedTheme.settings.codeblock.enableLinks;
      this.languageSpecificColors = createObjectCopy(plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors[this.parameters.language.length > 0 ? this.parameters.language : "nolang"] || {});
      this.groupMembers = groupMembers;
      this.foldingState = foldingState;
      this.sourcePath = sourcePath;
      this.disableFoldUnlessSpecified = plugin.settings.SelectedTheme.settings.header.disableFoldUnlessSpecified;
      this.plugin = plugin;
    }
  
    eq(other: TextAboveCodeblockWidget) {
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
      
      if ((this.disableFoldUnlessSpecified && !this.plugin.settings.SelectedTheme.settings.codeblock.inverseFold && !this.parameters.fold) ||
          (this.disableFoldUnlessSpecified && this.plugin.settings.SelectedTheme.settings.codeblock.inverseFold && !this.parameters.unfold)) {
        container.classList.add(`noCollapseIcon`);
      } else {
        const collapse = createCodeblockCollapse(this.parameters.fold);
        container.appendChild(collapse);

        if (this.foldingState === FoldingState.FullyFolded || this.foldingState === FoldingState.SemiFolded) {
          setIcon(collapse, "chevrons-down-up"); // fully folded icon
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

        if ((this.disableFoldUnlessSpecified && !this.plugin.settings.SelectedTheme.settings.codeblock.inverseFold && !this.parameters.fold) ||
            (this.disableFoldUnlessSpecified && this.plugin.settings.SelectedTheme.settings.codeblock.inverseFold && !this.parameters.unfold)) {
          return;
        }

        const effects = toggleCodeBlockFold(view, this.pos);
        if (effects.length > 0) {
          view.dispatch({ effects: effects });
        }
      };
      //EditorView.requestMeasure;
  
      return container;
    }
  
    updateDOM(dom: HTMLElement, view: EditorView) {
      view.requestMeasure();
      return false;
    }  
  }// TextAboveCodeblockWidget

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

        const effects = toggleCodeBlockFold(view, this.pos);

        if (effects.length > 0) {
          view.dispatch({ effects: effects });
        }
      };

      return container;
    }
  }// uncollapseCodeWidget

  class LineNumberWidget extends WidgetType {
    lineNumber: string;
    parameters: Parameters
    spanClass: string;
  
    constructor(lineNumber: string, parameters: Parameters, spanClass: string) {
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

  /*interface PromptWidgetOptions {
    promptData: string | { text: string; class?: string }[];
    promptType: string;
    promptDef: PromptDefinition;
    promptEnv: PromptEnvironment;
    settings: CodeblockCustomizerSettings;
  }

  class PromptWidget extends WidgetType {
    constructor(private opts: PromptWidgetOptions) {
      super();
    }

    eq(other: PromptWidget): boolean {
      return (
        this.opts.promptType === other.opts.promptType &&
        JSON.stringify(this.opts.promptData) === JSON.stringify(other.opts.promptData) &&
        this.opts.promptEnv.user === other.opts.promptEnv.user &&
        this.opts.promptEnv.host === other.opts.promptEnv.host &&
        this.opts.promptEnv.dir === other.opts.promptEnv.dir
      );
    }

    toDOM(): HTMLElement {
      const isRoot = this.opts.promptEnv.user === "root";
      return addClassesToPrompt(this.opts.promptData, this.opts.promptType, this.opts.promptDef, this.opts.settings, isRoot);
    }
  }// PromptWidget*/
  
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

  /* functions */

  function areParametersDeepEqual(params1: Parameters, params2: Parameters): boolean {
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
    if (params1.backtickCount !== params2.backtickCount) 
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

  function addTabs(view: EditorView, container: HTMLElement, parameters: Parameters, groupMembers: CodeBlockPositions[] ) {
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

  function handleTabClick(view: EditorView, member: CodeBlockPositions, parameters: Parameters) {
    const groupName = parameters.group;
    if (!groupName) {
      console.error("Cannot dispatch tab selection: invalid group name.");
      return;
    }

    const activeGroup = view.state.field(activeGroupTabField, false) ?? {};
    const activeStartPos = activeGroup?.[parameters.group];
    const isClickedTabActive = member.codeBlockStartPos === activeStartPos;
    
    const annotations = [setGroupTab.of({ group: groupName, startPos: member.codeBlockStartPos })];
    let effects: CodeBlockFoldEffect[] = [];

    if (isClickedTabActive) {
      // if active tab is clicked do collapse/uncollapse
      effects = toggleCodeBlockFold(view, member);
    }

    view.dispatch({ annotations, effects });
  }// handleTabClick

  function toggleCodeBlockFold(view: EditorView, pos: CodeBlockPositions): CodeBlockFoldEffect[] {
    const effects: CodeBlockFoldEffect[] = [];
    const { codeBlockStartPos, codeBlockEndPos } = pos;
    const start = view.state.doc.lineAt(codeBlockStartPos);
    const end = view.state.doc.lineAt(codeBlockEndPos);

    const enableSemiFold = settings.SelectedTheme.settings.semiFold.enableSemiFold;
    const visibleLines = settings.SelectedTheme.settings.semiFold.visibleLines;
    const lineCount = end.number - start.number + 1;
    const canSemiFold = lineCount >= visibleLines + fadeOutLineCount + 2; // +2 to ignore the first and last lines

    const currentFoldState = getFoldingState(view, codeBlockStartPos, codeBlockEndPos);

    if (currentFoldState === FoldingState.Unfolded) {
      if (enableSemiFold && canSemiFold) {
        // semi-fold
        const firstLine = start;
        const blockEndLineNr = end.number;
        const fadeOutStartLineNr = firstLine.number + visibleLines;
        const fadeOutEndLineNr = Math.min(blockEndLineNr, fadeOutStartLineNr + fadeOutLineCount - 1);
        const replaceStartLineNr = fadeOutEndLineNr + 1;

        const fadeOutStartLine = (fadeOutStartLineNr <= blockEndLineNr) ? view.state.doc.line(fadeOutStartLineNr) : null;
        const fadeOutEndLine = (fadeOutEndLineNr <= blockEndLineNr) ? view.state.doc.line(fadeOutEndLineNr) : null;
        const replaceStartLine = (replaceStartLineNr <= blockEndLineNr) ? view.state.doc.line(replaceStartLineNr) : null;

        const ranges: ReplaceFadeOutRanges = {firstLine: firstLine, fadeOutStart: fadeOutStartLine as Line, fadeOutEnd: fadeOutEndLine as Line, replaceStart: replaceStartLine as Line, replaceEnd: end};
        const semiFoldEffects = generateSemiFoldEffects(view.state, pos, ranges);
        effects.push(...semiFoldEffects);
      } else {
        // normal fold
        effects.push(Collapse.of(CollapsedDecoration.range(start.from, end.to)));
      }
    } else if (currentFoldState === FoldingState.FullyFolded) {
      // unfold
      effects.push(UnCollapse.of({ filter: (from: number, to: number) => to <= start.from || from >= end.to, filterFrom: start.from, filterTo: end.to }));
    } else if (currentFoldState === FoldingState.SemiFolded) {
      // semi unfold
      const clearFade = clearFadeEffect(start.from, end.to);
      if (clearFade) {
        effects.push(clearFade);
      }
      effects.push(semiUnCollapse.of({ filterFrom: start.from, filterTo: end.to }));
    }

    if (effects.length > 0) {
      view.dispatch({ effects: effects });
    }

    return effects;
  }// toggleCodeBlockFold

  function findCodeBlockPositions(state: EditorState, from = 0, to: number = state.doc.length): CodeBlockPositions[] {
    const positions: CodeBlockPositions[] = [];
    let codeBlockStartPos = -1;
    let codeBlockEndPos = -1;
    let parameters: Parameters = getDefaultParameters();

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
  
    if (codeBlockStartPos !== -1 && codeBlockEndPos === -1) {
      const end = findCodeBlockEnd(codeBlockStartPos, state, parameters.backtickCount);
      if (end)
        positions.push({ codeBlockStartPos, codeBlockEndPos: end, parameters });
    }
  
    return positions;
  }// findCodeBlockPositions

  function findCodeBlockEnd(collapseStart: number, state: EditorState, backtickCount: number) {
    const start = state.doc.lineAt(collapseStart).number;
    let end: Line | null = null;
    for (let i = start + 1; i <= state.doc.lines; i++) {
      const line = state.doc.line(i);
      const match = line.text.match(/^`+/);
      const count = match ? match[0].length : 0;
      if (count === backtickCount) {
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

    /*console.log(state.field(editorEditorField));
    console.log(state.field(editorInfoField));
    console.log(state.field(editorLivePreviewField));*/
    //const visibleRanges = EditorView.visibleRanges(state);

    //console.log(state.field(editorEditorField).viewport);
    //console.log(state.field(editorEditorField).visibleRanges);
    //console.log(state.field(editorEditorField).viewportLineBlocks);

    /*const viewport = state.field(editorEditorField).viewport;
    const filteredPositions = positions.filter(position => {
      return (position.codeBlockStartPos >= viewport.from && position.codeBlockStartPos <= viewport.to) ||
             (position.codeBlockEndPos >= viewport.from && position.codeBlockEndPos <= viewport.to);
    });*/

    const grouped = state.field(groupedCodeBlocksField, false) ?? {};
    const view = state.field(editorEditorField);
    
    for (const pos of positions) {
      const { codeBlockStartPos, codeBlockEndPos, parameters } = pos;
      const foldingState = getFoldingState(view, codeBlockStartPos, codeBlockEndPos);
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
        const buttonConfigs = createButtonConfigs(codeBlockStartPos, codeBlockEndPos, state, parameters);
        decorations.push(Decoration.widget({ widget: new TextAboveCodeblockWidget(parameters, pos, buttonConfigs, currentGroupMembers, foldingState, sourcePath, plugin), block: true }).range(codeBlockStartPos));
      }
    }
    return RangeSet.of(decorations, true);
  }// insertHeader

  function addCommandOutput(lineText: string, decorations: Array<Range<Decoration>>, currentLine: Line, env: PromptEnvironment, promptDef: PromptDefinition | undefined) {
    // pwd command
    if (/^\s*pwd\s*$/.test(lineText)){
      /*const shouldSimplify = shouldSimplifyHomePath(promptDef);
      const pwdOutput = shouldSimplify ? simplifyHomePath(env.dir, env.homeDir) : (env.dir === "~" ? env.homeDir : env.dir);*/
      decorations.push(Decoration.widget({ widget: new LineWidget(getPWD(env), `codeblock-customizer-prompt-cmd-output codeblock-customizer-workingdir`), side: 1 }).range(currentLine.to));
    }
    
    // whoami command
    if (/^\s*whoami\s*$/.test(lineText))
      decorations.push(Decoration.widget({ widget: new LineWidget(env.user, `codeblock-customizer-prompt-cmd-output codeblock-customizer-whoami`), side: 1 }).range(currentLine.to));
  }// addCommandOutput
  
  function createButtonConfigs(codeBlockStartPos: number, codeBlockEndPos: number, state: EditorState, parameters: Parameters){
    const cursorPos = state.selection.main.head;
    const isCursorInCodeBlock = cursorPos >= codeBlockStartPos && cursorPos <= codeBlockEndPos;
    
    let showButton = false;
    if ((!settings.SelectedTheme.settings.codeblock.buttons.alwaysShowButtons) && !isCursorInCodeBlock)
      showButton = true;
    else if (settings.SelectedTheme.settings.codeblock.buttons.alwaysShowButtons)
      showButton = true;

    return [
      {
        class: `codeblock-customizer-copy-code`,
        displayText: "Copy code",
        action: (view: EditorView) => {
          const collapseStart = codeBlockStartPos + parameters.backtickCount;
          const collapseEnd = codeBlockEndPos - parameters.backtickCount;
          const lines = view.state.sliceDoc(collapseStart, collapseEnd).toString();
          addTextToClipboard(removeFirstLine(lines));
        },
        icon: "copy",
        text: parameters.displayLanguage,
        enabled: showButton
      },
      {
        class: `codeblock-customizer-select-code`,
        displayText: "Select code",
        action: (view: EditorView) => {
          const collapseStart = codeBlockStartPos;
          const collapseEnd = codeBlockEndPos;
          const transaction = view.state.update({ selection: EditorSelection.range(collapseStart, collapseEnd) });
          view.dispatch(transaction);
        },
        icon: "text",
        enabled: settings.SelectedTheme.settings.codeblock.buttons.enableSelectCodeButton && showButton
      },
      {
        class: `codeblock-customizer-delete-code`,
        displayText: "Delete code block content",
        action: (view: EditorView) => {
          const collapseStart = codeBlockStartPos + state.doc.lineAt(codeBlockStartPos).length;
          const collapseEnd = codeBlockEndPos - parameters.backtickCount - 1;
          const transaction = view.state.update({ changes: { from: collapseStart, to: collapseEnd, insert: "" } });
          view.dispatch(transaction);
        },
        icon: "trash-2",
        enabled: settings.SelectedTheme.settings.codeblock.buttons.enableDeleteCodeButton && showButton
      }
    ];
  }// createButtonConfig

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
      button.onclick = () => config.action(view);

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

  function getLineClass(parameters: Parameters, lineNumber: number, startLine: boolean, endLine: boolean, line: Line, decorations: Array<Range<Decoration>>) {
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
    //const regex = /(?:\[\[([^[\]]*)\]\]|\[([^\]]+)\]\(([^)]+)\))(?!\r?\n)/g;
    //const regex = /(?:\[\[([^[\]]*)\]\]|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s]+))/g;
    const regex = /(?:\[\[([^[\]]+?)(?:\|([^\]]+?))?]]|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s]+))/g;
    
    syntaxTree(state).iterate({ from: collapseFrom, to: collapseTo,
      enter(node) {
        //----------------------------------------------
        // only for comments
        /*let comment = '';
        if (node.type.name.includes("HyperMD-codeblock-begin") || node.type.name.includes("comment_hmd-codeblock")) {
          comment = state.sliceDoc(node.from, node.to);
        }*/
        if (!node.type.name.includes("HyperMD-codeblock-begin") && !node.type.name.includes("comment_hmd-codeblock")) 
          return;
        
        const comment = state.sliceDoc(node.from, node.to);
        const matches = [...comment.matchAll(regex)];
        //----------------------------------------------
        //const matches = [...originalLineText.matchAll(regex)]; // not only for comments
        for (const match of matches) {
          const fullMatch = match[0];
          const startPosition = match.index !== undefined ? match.index : -1;
          if (startPosition === -1) 
            continue;

          const isCursorInside = (cursorPos >= node.from + startPosition && cursorPos <= node.from + startPosition + fullMatch.length);
    
          if (match[1] !== undefined && match[1] !== '') { // Double square bracket link: [[link]] or [[Link|DisplayText]]
            handleWikiLink(isCursorInside, node, startPosition, fullMatch, decorations, sourcePath);
          } else if (match[3] !== undefined && match[3] !== '') { // Square bracket followed by parentheses link: [DisplayText](Link)
            handleMarkdownLink(isCursorInside, node, startPosition, fullMatch, decorations, sourcePath);
          } else if (match[5] !== undefined && match[5] !== '') { // HTTP or HTTPS URL
            handleHTTPLink(isCursorInside, node, startPosition, fullMatch, decorations, sourcePath);
          }
        }
      }
    });
  }// checkForLinks

  function highlightLinesOrWords(lineNumber: number, startLine: boolean, endLine: boolean, parameters: Parameters, line: Line, decorations: Array<Range<Decoration>>, lineClass: string) {
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
    const lineSpecificWord = lineSpecificWords.find(item => item.lineNumber === lineNumber);
    if (lineSpecificWord) {
      highlighText(lineSpecificWord.words);
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
    const specificTextBetween = lineSpecificTextBetween.find(item => item.lineNumber === lineNumber);
    if (specificTextBetween) {
      if (caseInsensitiveLineText.includes(specificTextBetween.from.toLowerCase()) && caseInsensitiveLineText.includes(specificTextBetween.to.toLowerCase())) {
        const highlightText = `${specificTextBetween.from}${textSeparator}${specificTextBetween.to}`;
        highlighText([highlightText]);
      }
    }
  
    // highlight all words in specified line hlt:1,3-5
    if (parameters.defaultTextToHighlight.allWordsInLine.includes(lineNumber)) {
      setClass(line, decorations, caseInsensitiveLineText, '', textSeparator, '');
    }
  
    // highlight line by line number imp:1,3-5
    const alternativeLinesToHighlight = parameters.alternativeLinesToHighlight.lines;
    const altHLMatch = alternativeLinesToHighlight.find(hl => hl.lineNumbers.includes(lineNumber));
    if (altHLMatch) {
      lineClass = addHighlightClass(altHLMatch.colorName);
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
    const altLineSpecificWord = altLineSpecificWords.find(item => item.lineNumber === lineNumber);
    if (altLineSpecificWord) {
      const { colorName, words } = altLineSpecificWord;
      highlighText(words, colorName);
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
    const altSpecificTextBetween = altLineSpecificTextBetween.find(item => item.lineNumber === lineNumber);
    if (altSpecificTextBetween) {
      if (caseInsensitiveLineText.includes(altSpecificTextBetween.from.toLowerCase()) && caseInsensitiveLineText.includes(altSpecificTextBetween.to.toLowerCase())) {
        const highlightText = `${altSpecificTextBetween.from}${textSeparator}${altSpecificTextBetween.to}`;
        highlighText([highlightText], altSpecificTextBetween.colorName);
      }
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
      const match = line.text.match(/\S/);
      const pos = match ? match.index : -1;
      if (pos !== undefined && pos !== -1 && line.to > line.from + pos)
        decorations.push(Decoration.mark({ class: classToUse }).range(line.from + pos, line.to));
    } else {
      const occurrences = findAllOccurrences(caseInsensitiveLineText, word);
  
      occurrences.forEach((index) => {
        const classToUse = customClass ? `codeblock-customizer-highlighted-text-${customClass}` : 'codeblock-customizer-highlighted-text';
        decorations.push(Decoration.mark({ class: classToUse }).range(line.from + index, line.from + index + word.length));
      });
    }
  }// setClass
  
  function handleWikiLink(isCursorInside: boolean, node: SyntaxNodeRef, startPosition: number, fullMatch: string, decorations: Array<Range<Decoration>>, sourcePath: string) {
    const linkClass = "cm-formatting-link";
    const startClass = `${linkClass} cm-formatting-link-start`;
    const endClass = `${linkClass} cm-formatting-link-end`;
    const startPosSquareBrackets = fullMatch.indexOf("[[");
    const endPosSquareBrackets = fullMatch.lastIndexOf("]]");

    if (!isCursorInside) {
      decorations.push(Decoration.replace({ widget: new createLink(fullMatch, sourcePath, plugin) }).range(node.from + startPosition, node.from + startPosition + fullMatch.length));
    } else {
      decorations.push(Decoration.mark({class: startClass}).range(node.from + startPosition + startPosSquareBrackets, node.from + startPosition + startPosSquareBrackets + 2));
      decorations.push(Decoration.mark({class: endClass}).range(node.from + startPosition + endPosSquareBrackets, node.from + startPosition + endPosSquareBrackets+2));
      if (fullMatch.length > 0)
        decorations.push(Decoration.mark({class:"cm-hmd-internal-link"}).range(node.from + startPosition + startPosSquareBrackets + 2, node.from + startPosition + fullMatch.length - 2));
    }
  }// handleWikiLink
  
  function handleMarkdownLink(isCursorInside: boolean, node: SyntaxNodeRef, startPosition: number, fullMatch: string, decorations: Array<Range<Decoration>>, sourcePath: string) {
    const linkClass = "cm-formatting-link";
    const startPosSquareBrackets = fullMatch.indexOf("[");
    const endPosSquareBrackets = fullMatch.lastIndexOf("]");
    const startPosParentheses = fullMatch.indexOf("(");
    const endPosParentheses = fullMatch.lastIndexOf(")");
  
    if (!isCursorInside) {
      decorations.push(Decoration.replace({ widget: new createLink(fullMatch, sourcePath, plugin) }).range(node.from + startPosition, node.from + startPosition + fullMatch.length));
    } else {
      decorations.push(Decoration.mark({class: `cm-formatting ${linkClass} cm-link`}).range(node.from + startPosition + startPosSquareBrackets, node.from + startPosition + startPosSquareBrackets + 1));
      decorations.push(Decoration.mark({class: `cm-link`}).range(node.from + startPosition + startPosSquareBrackets + 1, node.from + startPosition + endPosSquareBrackets));
      decorations.push(Decoration.mark({class: `cm-formatting ${linkClass} cm-link`}).range(node.from + startPosition + endPosSquareBrackets, node.from + startPosition + endPosSquareBrackets + 1));
  
      decorations.push(Decoration.mark({class: `cm-formatting ${linkClass}-string cm-string cm-url`}).range(node.from + startPosition + startPosParentheses, node.from + startPosition + startPosParentheses + 1));
      decorations.push(Decoration.mark({class: `cm-string cm-url`}).range(node.from + startPosition + startPosParentheses, node.from + startPosition + endPosParentheses));
      decorations.push(Decoration.mark({class: `cm-formatting ${linkClass}-string cm-string cm-url`}).range(node.from + startPosition + endPosParentheses, node.from + startPosition + endPosParentheses + 1));
    }
  }// handleMarkdownLink
  
  function handleHTTPLink(isCursorInside: boolean, node: SyntaxNodeRef, startPosition: number, fullMatch: string, decorations: Array<Range<Decoration>>, sourcePath: string) {
    if (isCursorInside) {
      decorations.push(Decoration.replace({ widget: new createLink(fullMatch, sourcePath, plugin) }).range(node.from + startPosition, node.from + startPosition + fullMatch.length));
    } else {
      decorations.push(Decoration.mark({class: `cm-url`}).range(node.from + startPosition, node.from + startPosition + fullMatch.length));
    }
  }// handleHTTPLink

  function defaultFold(state: EditorState) {
    const builder = new RangeSetBuilder<Decoration>();
  
    const addFoldDecoration = (from: number, to: number) => {
      builder.add(from, to, CollapsedDecoration);
    };
  
    const processSemiFold = (start: { from: number }, end: { to: number }) => {
      const lineCount = state.doc.lineAt(end.to).number - state.doc.lineAt(start.from).number + 1;
      if (lineCount >= settings.SelectedTheme.settings.semiFold.visibleLines + fadeOutLineCount + 2) { // +2 to ignore the first and last lines
        const ranges = getRanges(state, start.from, end.to, settings.SelectedTheme.settings.semiFold.visibleLines);
        const currentPos: CodeBlockPositions = { codeBlockStartPos: start.from, codeBlockEndPos: end.to, parameters: getDefaultParameters()}; // parameters are not needed
        const decos = addFadeOutEffect(state, currentPos, ranges);
        for (const { from, to, decoration } of decos || []) {
          builder.add(from, to, decoration);
        }
      } else {
        addFoldDecoration(start.from, end.to);
      }
    };
  
    // process codeBlocks
    processCodeBlocks(state.doc, (start, end, lineText, fold, unfold) => { // need to get rid of this
      if (fold || (settings.SelectedTheme.settings.codeblock.inverseFold && !unfold)) {
        if (settings.SelectedTheme.settings.semiFold.enableSemiFold) {
          processSemiFold(start, end);
        } else {
          addFoldDecoration(start.from, end.to);
        }
      }
    });
  
    return builder.finish();
  }// defaultFold

  /*function defaultFold(state: EditorState, decorations: Array<Range<Decoration>>) {
    //const builder = new RangeSetBuilder<Decoration>();
  
    const addFoldDecoration = (from: number, to: number) => {
      const decoration = Decoration.replace({ effect: Collapse.of(Decoration.replace({ block: true }).range(from, to)), block: true, side: -1 });
      //builder.add(from, to, decoration);
      decorations.push(decoration.range(from, to));
    };
  
    const processSemiFold = (start: { from: number }, end: { to: number }) => {
      const lineCount = state.doc.lineAt(end.to).number - state.doc.lineAt(start.from).number + 1;
      if (lineCount >= settings.SelectedTheme.settings.semiFold.visibleLines + fadeOutLineCount + 2) { // +2 to ignore the first and last lines
        const ranges = getRanges(state, start.from, end.to, settings.SelectedTheme.settings.semiFold.visibleLines);
        const decos = addFadeOutEffect(null, state, ranges, settings.SelectedTheme.settings.semiFold.visibleLines, null);
        for (const { from, to, decoration } of decos || []) {
          //builder.add(from, to, decoration);
          decorations.push(decoration.range(from, to));
        }
      } else {
        addFoldDecoration(start.from, end.to);
      }
    };
  
    // process codeBlocks
    const positions = state.field(codeBlockPositions, false) ?? [];
    for (const pos of positions) {
      if (pos.parameters.fold || (settings.SelectedTheme.settings.codeblock.inverseFold && !pos.parameters.unfold)) {
        if (settings.SelectedTheme.settings.semiFold.enableSemiFold) {
          processSemiFold({from: pos.codeBlockStartPos}, {to: pos.codeBlockEndPos});
        } else {
          addFoldDecoration(pos.codeBlockStartPos, pos.codeBlockEndPos);
        }
      }
    }
  
    //return builder.finish();
  }// defaultFold*/

  function addFadeOutEffect(state: EditorState, pos: CodeBlockPositions, ranges: ReplaceFadeOutRanges): RangeWithDecoration[] {
    const effects: StateEffect<Range<Decoration>>[] = generateSemiFoldEffects(state, pos, ranges);

    // convert StateEffect<Range<Decoration>>[] to RangeWithDecoration[]
    const decorations: RangeWithDecoration[] = effects.map(effect => {
      const rangeDecoration = effect.value;
      return {from: rangeDecoration.from, to: rangeDecoration.to, decoration: rangeDecoration.value};
    });

    return decorations;
  }// addFadeOutEffect
    
  enum FoldingState {
    Unfolded = 'unfolded',
    FullyFolded = 'fully-folded',
    SemiFolded = 'semi-folded',
  }

  function getFoldingState(view: EditorView, startPos: number, endPos: number): FoldingState {
    const decorations = view.state.field(collapseField, false);
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
      if (decoration.spec.widget?.constructor.name === 'uncollapseCodeWidget' ||
        decoration.spec.attributes?.class?.includes('semi-folded') ||
        decoration.spec.attributes?.class?.includes('codeblock-customizer-fade-out-line')) {
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

  function processCodeBlocks(doc: Text, callback: (start: Line, end: Line, lineText: string, fold: boolean, unfold: boolean) => void) {
    let CollapseStart: Line | null = null;
    let CollapseEnd: Line | null = null;
    let blockFound = false;
    let bExclude = false;
    let isDefaultFold = false;
    let isDefaultUnFold = false;
    let inCodeBlock = false;
    let openingBackticks = 0;
    
    for (let i = 1; i <= doc.lines; i++) {
      const lineText = doc.line(i).text.toString().trim();
      const line = doc.line(i);
      bExclude = isExcluded(lineText, settings.ExcludeLangs);
      const backtickMatch = lineText.match(/^`+(?!.*`)/);
      if (backtickMatch) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          openingBackticks = backtickMatch[0].length;
          if (bExclude)
            continue;
          if (CollapseStart === null) {
            isDefaultFold = isFoldDefined(lineText);
            isDefaultUnFold = isUnFoldDefined(lineText);
            CollapseStart = line;
          }
        } else {
          if (backtickMatch[0].length === openingBackticks) {
            inCodeBlock = false;
            openingBackticks = 0; // Reset the opening backticks count
            blockFound = true;
            CollapseEnd = line;
          } else {
            // Nested code block with different number of backticks
          }
        }
      } else if (inCodeBlock) {
        // Lines inside the code block
      } else {
        // Lines outside the code block
      }
  
      if (blockFound) {
        if (CollapseStart != null && CollapseEnd != null) {
          callback(CollapseStart, CollapseEnd, lineText, isDefaultFold, isDefaultUnFold);
          CollapseStart = null;
          CollapseEnd = null;
          isDefaultFold = false;
          isDefaultUnFold = false;
        }
        blockFound = false;
      }
    }
  }// processCodeBlocks

  function foldAll(view: EditorView, settings: CodeblockCustomizerSettings, fold: boolean, defaultState: boolean) {
    const { enableSemiFold, visibleLines } = settings.SelectedTheme.settings.semiFold;
    const changes: CodeBlockFoldEffect[] = [];
    const disableFoldUnlessSpecified = settings.SelectedTheme.settings.header.disableFoldUnlessSpecified;
    const inverseFoldGloballyEnabled = settings.SelectedTheme.settings.codeblock.inverseFold;

    processCodeBlocks(view.state.doc, (start, end, lineText) => {
      const codeBlockStartPos = start.from;
      const codeBlockEndPos = end.to;
      const currentBlockParameters = getAllParameters(lineText, settings);

      if ((disableFoldUnlessSpecified && !inverseFoldGloballyEnabled && !currentBlockParameters.fold) ||
          (disableFoldUnlessSpecified && inverseFoldGloballyEnabled && !currentBlockParameters.unfold)) {
        return;
      }

      const lineCount = view.state.doc.lineAt(codeBlockEndPos).number - view.state.doc.lineAt(codeBlockStartPos).number + 1;
      const foldBlock = fold || (inverseFoldGloballyEnabled && !currentBlockParameters.unfold);
      
      if (foldBlock) {
        if (enableSemiFold && lineCount >= visibleLines + fadeOutLineCount + 2) { // +2 to account for first and last lines of the code block
          const ranges = getRanges(view.state, codeBlockStartPos, codeBlockEndPos, visibleLines);
          const pos: CodeBlockPositions = {codeBlockStartPos: codeBlockStartPos, codeBlockEndPos: codeBlockEndPos, parameters: currentBlockParameters};
          const semiFoldEffects = generateSemiFoldEffects(view.state, pos, ranges);
          changes.push(...semiFoldEffects);
        } else {
          changes.push(Collapse.of(CollapsedDecoration.range(codeBlockStartPos, codeBlockEndPos)));
        }
      } else {
        if (enableSemiFold) {
          const clearFade = clearFadeEffect(codeBlockStartPos, codeBlockEndPos); 
          if (clearFade) {
            changes.push(clearFade);
          }
          changes.push(semiUnCollapse.of({ filterFrom: codeBlockStartPos, filterTo: codeBlockEndPos }));
        }
        changes.push(UnCollapse.of({ filter: (from: number, to: number) => to <= codeBlockStartPos || from >= codeBlockEndPos, filterFrom: codeBlockStartPos, filterTo: codeBlockEndPos }));
      }
    });

    if (changes.length > 0) {
      view.dispatch({ effects: changes });
      view.requestMeasure();
    }
  }// foldAll

  function clearFadeEffect(CollapseStart: number, CollapseEnd: number): StateEffect<SemiUncollapseEffect> | undefined {
    return semiUnFade.of({filterFrom: CollapseStart, filterTo: CollapseEnd});
  }// clearFadeEffect

  const extensions = [codeBlockPositionsField, groupedCodeBlocksField, activeGroupTabField, collapseField, headerField, viewPlugin];

  const result = {
    extensions,
    foldAll,
    customBracketMatching,
    selectionMatching
  };

  return result;
}// extensions
