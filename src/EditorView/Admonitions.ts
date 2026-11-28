import { editorInfoField, MarkdownPostProcessorContext } from "obsidian";

import { StateField } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

import { isPluginLoaded } from "../Utils";
import { CodeblockCustomizerSettings } from "../Settings";
import CodeBlockCustomizerPlugin from "../main";
import { extractCodeBlocksFromAdmonition } from "../ReadingView/ReadingViewUtils";
import { CodeBlockRenderer } from "../ReadingView/CodeBlockRenderer";
import { CodeBlockPositions } from "./CodeBlockPositions";

export function admonitionExtension(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings, codeBlockPositionsField: StateField<CodeBlockPositions[]>) {
  const admonitionViewPlugin = ViewPlugin.fromClass(class {
    private observer: MutationObserver;

    constructor(view: EditorView) {
      this.observer = new MutationObserver((mutations) => this.handleMutations(mutations, view));
      if (settings.pluginSettings.plugins.admonitions.enabled && isPluginLoaded('obsidian-admonition', plugin)) {
        this.observer.observe(view.contentDOM, { childList: true, subtree: true });
        this.processAllAdmonitions(view.contentDOM, view);
      }
    }

    private handleMutations(mutations: MutationRecord[], view: EditorView) {
      if (!settings.pluginSettings.plugins.admonitions.enabled || !isPluginLoaded('obsidian-admonition', plugin)) {
        return;
      }

      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node.instanceOf(HTMLElement) && (node.matches('.cm-preview-code-block, .admonition') || node.closest('.admonition'))) {
            this.processAllAdmonitions(view.contentDOM, view);
            return;
          }
        }
      }
    }

    private processAllAdmonitions(container: HTMLElement, view: EditorView) {
      if (!settings.pluginSettings.plugins.admonitions.enabled || !isPluginLoaded('obsidian-admonition', plugin)) {
        return;
      }

      const admonitions = Array.from(container.querySelectorAll<HTMLElement>('.admonition:not([data-cbc-lp-processed])')).filter(el => !el.parentElement?.closest('.admonition'));

      admonitions.forEach(admonitionEl => {
        if (!admonitionEl.isConnected) {
          return;
        }

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
          admonitionEl.setAttribute('data-cbc-lp-processed', 'true');
          return;
        }

        const renderedPreElements = Array.from(admonitionEl.querySelectorAll<HTMLElement>('div.admonition-content pre:not(.frontmatter)'));
        if (renderedPreElements.length !== innerCodeBlocks.length) {
          return;
        }

        admonitionEl.setAttribute('data-cbc-lp-processed', 'true');
        const fileContentLines = view.state.doc.toString().split('\n');

        for (const [index, preElement] of renderedPreElements.entries()) {
          const blockData = innerCodeBlocks[index];
          if (!blockData) {
            continue;
          }

          const renderer = new CodeBlockRenderer(preElement, plugin, { sourcePath: view.state.field(editorInfoField)?.file?.path ?? "" } as MarkdownPostProcessorContext);
          const absoluteLineStart = view.state.doc.lineAt(admonitionBlockData.codeBlockStartPos).number + blockData.startLine;
          const absoluteLineEnd = view.state.doc.lineAt(admonitionBlockData.codeBlockStartPos).number + blockData.endLine;
          const sectionInfo = { lineStart: absoluteLineStart - 1, lineEnd: absoluteLineEnd - 1, text: blockData.contentLines.join('\n') };
          void renderer.renderExternal(blockData.firstLine, blockData.contentLines, sectionInfo, fileContentLines);
        }
      });
    }

    destroy() {
      this.observer.disconnect();
    }
  });// admonitionViewPlugin

  return { admonitionViewPlugin };
}// admonitionExtension
