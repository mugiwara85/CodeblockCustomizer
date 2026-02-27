import { MarkdownRenderer, editorInfoField } from "obsidian";

import { EditorState, Range, RangeSet, StateField } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { SyntaxNodeRef } from "@lezer/common";

import { isSourceMode } from "../Utils";
import { CodeblockCustomizerSettings } from "../Settings";
import { LINK_REGEX } from "../Const";
import CodeBlockCustomizerPlugin from "../main";
import { CodeBlockPositions, getVisibleCodeBlocks } from "./CodeBlockPositions";

export function linksExtension(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings, codeBlockPositionsField: StateField<CodeBlockPositions[]>) {
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
      const visibleBlocks = getVisibleCodeBlocks(codeBlockPositions, view.visibleRanges);

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

  function checkForLinks(state: EditorState, collapseFrom: number, collapseTo: number, decorations: Array<Range<Decoration>>, sourcePath: string) {
    const cursorPos = state.selection.main.head;
    
    syntaxTree(state).iterate({
      from: collapseFrom, to: collapseTo,
      enter(node) {
        if (!node.type.name.includes("comment")) {
          return;
        }

        const commentText = state.sliceDoc(node.from, node.to);
        const matches = commentText.matchAll(LINK_REGEX);

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

  return { linkViewPlugin };
}// linksExtension
