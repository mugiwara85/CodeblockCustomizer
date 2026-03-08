import { editorInfoField } from "obsidian";

import { Range, RangeSet, StateField } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

import { isSourceMode } from "../Utils";
import { TooltipManager } from "../TooltipManager";
import { CodeblockCustomizerSettings } from "../Settings";
import { ANNOTATION_PATTERN, rhombusSVG } from "../Const";
import CodeBlockCustomizerPlugin from "../main";
import { CodeBlockPositions, getVisibleCodeBlocks } from "./CodeBlockPositions";

const COMMENT_REGEX = /^\s*(?:\/\/|#|--|\/\*)\s*|\s*\*\/$/g;

export function annotationsExtension(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings, codeBlockPositionsField: StateField<CodeBlockPositions[]>) {
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
      const visibleBlocks = getVisibleCodeBlocks(codeBlockPositions, view.visibleRanges);
      const cursorPos = view.state.selection.main.head;
      const cursorLineNumber = view.state.doc.lineAt(cursorPos).number;

      for (const pos of visibleBlocks) {
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
            const cleanCommentText = commentText.replace(COMMENT_REGEX, '').trim();
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

  return { annotationViewPlugin };
}// annotationsExtension
