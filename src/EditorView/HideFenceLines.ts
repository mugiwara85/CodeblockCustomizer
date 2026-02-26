import { EditorState, Range, RangeSet, StateField } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";

import { isSourceMode } from "../Utils";
import { CodeblockCustomizerSettings } from "../Settings";
import CodeBlockCustomizerPlugin from "../main";
import { CBCParameters } from "../Parsing";
import { CodeBlockPositions } from "./CodeBlockPositions";
import { ButtonConfig } from "./Header";

export function hideFenceLinesExtension(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings, codeBlockPositionsField: StateField<CodeBlockPositions[]>,
  createButtonConfigs: (codeBlockStartPos: number, codeBlockEndPos: number, state: EditorState, parameters: CBCParameters) => ButtonConfig[],
  buttonWidget: new (buttonsConfig: Array<ButtonConfig>, pos: CodeBlockPositions, modifierKey: any) => WidgetType, getUpdateValue: () => (newValue: boolean) => void,
  getResetFoldDecos: () => (newValue: boolean) => void, getSettingsUpdated: () => boolean) {

  const hideFencesPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || update.startState.field(codeBlockPositionsField) !== update.state.field(codeBlockPositionsField) || getSettingsUpdated()) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      getUpdateValue()(false);
      getResetFoldDecos()(false);
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

  return { hideFencesPlugin };
}// hideFenceLinesExtension
