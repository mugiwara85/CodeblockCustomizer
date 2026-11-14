import { editorInfoField, loadPrism, MarkdownPostProcessorContext, MarkdownSectionInformation } from "obsidian";

import { EditorState, StateField } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

import { CodeblockCustomizerSettings } from "../Settings";
import CodeBlockCustomizerPlugin from "../main";
import { getAllParameters } from "../Parsing";
import { getLanguageConfig, isSourceMode, loadCustomPrismLanguages } from "../Utils";
import { HtmlCodeBlock } from "../HtmlCodeBlocks";
import { CodeBlockRenderer } from "../ReadingView/CodeBlockRenderer";
import { getHtmlCodeBlockData, prepareHtmlCodeElement } from "../ReadingView/ReadingViewUtils";
import { CodeBlockPositions, getHtmlCodeBlockRange, getHtmlCodeBlocks, htmlCodeBlocksRendered } from "./CodeBlockPositions";

const HEADER_AND_BUTTONS_SELECTOR = '.codeblock-customizer-header-container, .codeblock-customizer-header-container-specific, .codeblock-customizer-button-container';

function isOrContainsPre(node: Node): boolean {
  return node instanceof HTMLElement && (node.tagName === 'PRE' || node.querySelector('pre') !== null);
}// isOrContainsPre

function isSelectionInside(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some(range => range.from <= to && range.to >= from);
}// isSelectionInside

export function htmlCodeBlockWidgetsExtension(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings, codeBlockPositionsField: StateField<CodeBlockPositions[]>) {
  const htmlCodeBlockWidgetPlugin = ViewPlugin.fromClass(class {
    private observer: MutationObserver;
    private frame: number | null = null;

    constructor(private view: EditorView) {
      // mutation observer callbacks run before the next paint, so the widget is styled before the unstyled version is visible
      this.observer = new MutationObserver((mutations) => {
        if (settings.pluginSettings.common.enableHtmlCodeBlocks && mutations.some(mutation => Array.from(mutation.addedNodes).some(isOrContainsPre))) {
          this.styleWidgets();
        }
      });
      this.observer.observe(view.contentDOM, { childList: true, subtree: true });
      this.scheduleStyling();
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || plugin.settingsUpdated) {
        this.scheduleStyling();
      }
    }

    private scheduleStyling() {
      if (this.frame !== null) {
        return;
      }

      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.styleWidgets();
      });
    }

    private styleWidgets() {
      const state = this.view.state;
      if (!settings.pluginSettings.common.enableHtmlCodeBlocks || isSourceMode(state)) {
        return;
      }

      const blocks = getHtmlCodeBlocks(state);
      if (blocks.length === 0) {
        return;
      }

      // blocks whose source is still decorated, although the selection has left them
      const decoratedHtmlBlocks = new Set((state.field(codeBlockPositionsField, false) ?? []).filter(p => p.htmlBlock).map(p => p.htmlBlock!.from));
      const renderedHtmlBlocks: number[] = [];

      for (const preElement of Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>('pre'))) {
        if (preElement.closest('.cm-line') || preElement.classList.contains('codeblock-customizer-pre') && decoratedHtmlBlocks.size === 0) {
          continue;
        }

        const codeElement = preElement.querySelector<HTMLElement>(':scope > code');
        if (!codeElement || preElement.dataset.cbcHtmlProcessed && decoratedHtmlBlocks.size === 0) {
          continue;
        }

        let pos: number;
        try {
          pos = this.view.posAtDOM(preElement);
        } catch {
          continue;
        }

        const block = blocks.find(b => {
          const range = getHtmlCodeBlockRange(state, b);
          return pos >= range.from && pos <= range.to;
        });
        if (!block) {
          continue;
        }

        const blockFrom = getHtmlCodeBlockRange(state, block).from;
        if (decoratedHtmlBlocks.has(blockFrom) && !isSelectionInside(state, blockFrom, getHtmlCodeBlockRange(state, block).to)) {
          renderedHtmlBlocks.push(blockFrom);
        }

        if (preElement.dataset.cbcHtmlProcessed || preElement.classList.contains('codeblock-customizer-pre')) {
          continue;
        }

        preElement.dataset.cbcHtmlProcessed = 'true';
        // hidden until it is styled, in case styling takes longer than a frame
        preElement.classList.add('codeblock-customizer-html-pending');
        renderWidget(this.view, preElement, codeElement, block).finally(() => preElement.classList.remove('codeblock-customizer-html-pending'));
      }

      // Obsidian rendered the widget ==> the source is not visible anymore, so its decorations can be removed
      if (renderedHtmlBlocks.length > 0) {
        this.view.dispatch({ effects: htmlCodeBlocksRendered.of(renderedHtmlBlocks) });
      }
    }// styleWidgets

    destroy() {
      this.observer.disconnect();
      if (this.frame !== null) {
        cancelAnimationFrame(this.frame);
      }
    }
  });// htmlCodeBlockWidgetPlugin

  async function renderWidget(view: EditorView, preElement: HTMLElement, codeElement: HTMLElement, block: HtmlCodeBlock) {
    const parameters = getAllParameters(block.firstLine, settings, true);
    if (parameters.exclude) {
      return;
    }

    const { contentLines } = getHtmlCodeBlockData(block, i => view.state.doc.line(i + 1).text);
    prepareHtmlCodeElement(preElement, codeElement);
    await highlightCode(codeElement, parameters.language);

    if (!preElement.closest('.markdown-rendered')) {
      preElement.parentElement?.classList.add('markdown-rendered');
    }

    // remove hover frame and the edit button
    preElement.closest('.cm-embed-block')?.classList.add('codeblock-customizer-html-embed');

    // clicking the header or the buttons must not move the cursor into the block
    preElement.addEventListener('mousedown', (event) => {
      if ((event.target as HTMLElement).closest(HEADER_AND_BUTTONS_SELECTOR)) {
        event.stopPropagation();
      }
    });

    const { from } = getHtmlCodeBlockRange(view.state, block);
    const sourcePath = view.state.field(editorInfoField)?.file?.path ?? "";
    const context = { sourcePath, docId: "", frontmatter: undefined, addChild: () => { }, getSectionInfo: () => null } as unknown as MarkdownPostProcessorContext;
    const sectionInfo: MarkdownSectionInformation = { lineStart: block.preStartLine, lineEnd: block.preEndLine, text: "" };
    const linesBeforeBlock = view.state.sliceDoc(0, from).split('\n');

    const renderer = new CodeBlockRenderer(preElement, plugin, context);
    await renderer.renderExternal(block.firstLine, contentLines, sectionInfo, linesBeforeBlock);
  }// renderWidget

  async function highlightCode(codeElement: HTMLElement, language: string) {
    const hasLanguageClass = /(^|\s)language-\S+/.test(codeElement.className);

    if (language && !codeElement.classList.contains('is-loaded') && !codeElement.querySelector('.token')) {
      const prism = await loadPrism();
      loadCustomPrismLanguages(prism);
      const prismLanguage = getLanguageConfig(language, plugin)?.format ?? language.toLowerCase();
      const grammar = prism.languages[prismLanguage];
      if (grammar) {
        codeElement.innerHTML = prism.highlight(codeElement.textContent ?? "", grammar, prismLanguage);
      }
    }

    if (hasLanguageClass) {
      codeElement.classList.add('is-loaded');
    }
  }// highlightCode

  return { htmlCodeBlockWidgetPlugin };
}// htmlCodeBlockWidgetsExtension
