import { Range } from "@codemirror/state";
import { EditorView, Decoration } from "@codemirror/view";
import { bracketMatching } from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";

import { CodeblockCustomizerSettings } from "../Settings";
import CodeBlockCustomizerPlugin from "../main";
import { createCodeBlockPositionsField } from "./CodeBlockPositions";
import { hideLinesExtension } from "./HideLines";
import { foldingExtension } from "./Folding";
import { groupedCodeBlocksExtension } from "./GroupedCodeBlocks";
import { headerExtension } from "./Header";
import { mainViewPluginExtension } from "./MainViewPlugin";
import { hideFenceLinesExtension } from "./HideFenceLines";
import { inlineCodeExtension } from "./InlineCode";
import { linksExtension } from "./Links";
import { annotationsExtension } from "./Annotations";
import { executeCodeExtension } from "./ExecuteCodePlugin";
import { admonitionExtension } from "./Admonitions";
import { wrapExtension } from "./Wrapping";
import { prismHighlightExtension } from "./PrismHighlight";


export function extensions(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings) {
  const codeBlockPositionsField = createCodeBlockPositionsField(plugin, settings);
  const { hiddenLinesUnhiddenField, hiddenLinesField, getHiddenRanges, getHiddenLines } = hideLinesExtension(settings, codeBlockPositionsField);
  const { wrappingField, unwrappedCodeBlocksField, scrollSyncPlugin } = wrapExtension(codeBlockPositionsField, settings);
  const {
    collapseField, foldCommandField, rememberedFoldField, defaultFoldUnfoldedField, toggleCodeBlockFold, getFoldingState, foldAll, unfoldAll, restoreDefaultFold
  } = foldingExtension(plugin, settings, codeBlockPositionsField, hiddenLinesUnhiddenField, getHiddenLines, () => groupedCodeBlocksField);
  const { groupedCodeBlocksField, activeGroupTabField, addTabs } = groupedCodeBlocksExtension(plugin, settings, codeBlockPositionsField, () => toggleCodeBlockFold, getFoldingState);
  const { headerField, buttonWidget, createButtonConfigs } = headerExtension(plugin, settings, codeBlockPositionsField, collapseField, activeGroupTabField, groupedCodeBlocksField, hiddenLinesUnhiddenField, unwrappedCodeBlocksField, getFoldingState, toggleCodeBlockFold, addTabs, getHiddenRanges);
  const { viewPlugin, liveUpdateExtension, forceRefreshListener } = mainViewPluginExtension(plugin, settings, codeBlockPositionsField, collapseField, foldCommandField, hiddenLinesUnhiddenField, getHiddenRanges);
  const { hideFencesPlugin } = hideFenceLinesExtension(plugin, settings, codeBlockPositionsField, hiddenLinesUnhiddenField, createButtonConfigs, buttonWidget);
  const { inlineCodeViewPlugin } = inlineCodeExtension(plugin, settings);
  const { linkViewPlugin } = linksExtension(plugin, settings, codeBlockPositionsField);
  const { annotationViewPlugin } = annotationsExtension(plugin, settings, codeBlockPositionsField);
  const { executeCodeViewPlugin } = executeCodeExtension(plugin, settings, codeBlockPositionsField);
  const { admonitionViewPlugin } = admonitionExtension(plugin, settings, codeBlockPositionsField);
  const { prismHighlightPlugin } = prismHighlightExtension(plugin, settings, codeBlockPositionsField);

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

  const extensions = [
    codeBlockPositionsField,
    groupedCodeBlocksField,
    activeGroupTabField,
    rememberedFoldField,
    foldCommandField,
    defaultFoldUnfoldedField,
    collapseField,
    headerField,
    hiddenLinesUnhiddenField,
    hiddenLinesField,
    wrappingField,
    unwrappedCodeBlocksField,
    viewPlugin,
    linkViewPlugin,
    inlineCodeViewPlugin,
    annotationViewPlugin,
    hideFencesPlugin,
    executeCodeViewPlugin,
    admonitionViewPlugin,
    prismHighlightPlugin,
    scrollSyncPlugin,
    liveUpdateExtension(),
    forceRefreshListener,
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
