import { EditorState, Range, RangeSet, StateField } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";

import { isSourceMode } from "../Utils";
import { ButtonModifierKeys, CodeblockCustomizerSettings } from "../Settings";
import CodeBlockCustomizerPlugin from "../main";
import { CBCParameters } from "../Parsing";
import { CodeBlockPositions, getVisibleCodeBlocks } from "./CodeBlockPositions";
import { ButtonConfig } from "./Header";

export function hideFenceLinesExtension(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings, codeBlockPositionsField: StateField<CodeBlockPositions[]>,
  hiddenLinesUnhiddenField: StateField<Set<number>>,
  createButtonConfigs: (codeBlockStartPos: number, codeBlockEndPos: number, state: EditorState, parameters: CBCParameters) => ButtonConfig[],
  buttonWidget: new (buttonsConfig: Array<ButtonConfig>, pos: CodeBlockPositions, modifierKey: ButtonModifierKeys) => WidgetType) {

  const hideFencesPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    lastVisibleBlockStarts: Set<number> = new Set();
    lastCursorBlock: CodeBlockPositions | undefined = undefined;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      const codeBlocksChanged = update.startState.field(codeBlockPositionsField) !== update.state.field(codeBlockPositionsField);
      const unhiddenChanged = update.startState.field(hiddenLinesUnhiddenField, false) !== update.state.field(hiddenLinesUnhiddenField, false);

      // check if cursor moved into or out of a code block
      let needsSelectionUpdate = false;
      if (update.selectionSet) {
        const positions = update.state.field(codeBlockPositionsField, false) || [];
        const newHead = update.state.selection.main.head;
        const newCursorBlock = positions.find(
          block => newHead >= block.codeBlockStartPos && newHead <= block.codeBlockEndPos
        );
        if (newCursorBlock !== this.lastCursorBlock) {
          needsSelectionUpdate = true;
          this.lastCursorBlock = newCursorBlock;
        }
      }

      // full rebuild only when document changed, codeblocks changed, settings were modified, cursor moved in/out, or unhidden lines changed
      if (update.docChanged || codeBlocksChanged || plugin.settingsUpdated || needsSelectionUpdate || unhiddenChanged) {
        this.decorations = this.buildDecorations(update.view);
        return;
      }

      // only viewport changed ==> keep existing decorations, and add decos for new blocks only
      if (update.viewportChanged) {
        this.decorations = this.extendDecorations(update.view);
      }
    }

    extendDecorations(view: EditorView): DecorationSet {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(view.state)) {
        return Decoration.none;
      }

      const positions = view.state.field(codeBlockPositionsField, false) ?? [];
      const visibleBlocks = getVisibleCodeBlocks(positions, view.visibleRanges);

      const newBlocks = visibleBlocks.filter(b => !this.lastVisibleBlockStarts.has(b.codeBlockStartPos));

      if (newBlocks.length === 0) {
        return this.decorations;
      }

      newBlocks.forEach(b => this.lastVisibleBlockStarts.add(b.codeBlockStartPos));

      const newDecorations = this.buildDecorationsForBlocks(view, newBlocks);
      return this.decorations.update({ add: newDecorations, sort: true });
    }// extendDecorations

    buildDecorations(view: EditorView): DecorationSet {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(view.state)) {
        return Decoration.none;
      }

      const positions = view.state.field(codeBlockPositionsField, false) ?? [];
      const visibleBlocks = getVisibleCodeBlocks(positions, view.visibleRanges);

      this.lastVisibleBlockStarts = new Set(visibleBlocks.map(b => b.codeBlockStartPos));

      const decorations = this.buildDecorationsForBlocks(view, visibleBlocks);
      return RangeSet.of(decorations, true);
    }// buildDecorations

    buildDecorationsForBlocks(view: EditorView, blocks: CodeBlockPositions[]): Array<Range<Decoration>> {
      const decorations: Array<Range<Decoration>> = [];
      const cursorPos = view.state.selection.main.head;
      const hideFences = settings.pluginSettings.codeblock.hideFenceLines;
      const collapsedFenceDecoration = Decoration.line({ attributes: { class: 'codeblock-customizer-fence-collapsed' } });

      for (const pos of blocks) {
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

        const buttonLineStartPos = view.state.doc.lineAt(codeBlockStartPos).from;
        const buttonConfigs = createButtonConfigs(codeBlockStartPos, codeBlockEndPos, view.state, parameters);
        const modifierKey = plugin.settings.pluginSettings.codeblock.buttons.modifierKey;
        decorations.push(Decoration.widget({ widget: new buttonWidget(buttonConfigs, pos, modifierKey), side: -1 }).range(buttonLineStartPos));
      }
      return decorations;
    }
  }, {
    decorations: v => v.decorations
  });// hideFencesPlugin

  return { hideFencesPlugin };
}// hideFenceLinesExtension
