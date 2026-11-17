import { editorInfoField, MarkdownPostProcessorContext } from "obsidian";

import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

import { isSourceMode } from "../Utils";
import { CodeblockCustomizerSettings } from "../Settings";
import { getAllParameters } from "../Parsing";
import CodeBlockCustomizerPlugin from "../main";
import { extractCodeBlocksFromCallout } from "../ReadingView/ReadingViewUtils";
import { CodeBlockRenderer } from "../ReadingView/CodeBlockRenderer";

const PROCESSED_ATTR = "data-cbc-callout-processed";

export function calloutExtension(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings) {
  const calloutViewPlugin = ViewPlugin.fromClass(class {
    private observer: MutationObserver;
    private scheduled = false;
    private rafId: number | null = null;
    private destroyed = false;

    constructor(private view: EditorView) {
      this.observer = new MutationObserver((mutations) => this.handleMutations(mutations));
      this.observer.observe(view.contentDOM, { childList: true, subtree: true });
      this.scheduleProcessing();
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.scheduleProcessing();
      }
    }

    private handleMutations(mutations: MutationRecord[]) {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (!(node.instanceOf(HTMLElement))) {
            continue;
          }

          if (node.matches('.cm-callout, .callout, pre') || node.closest('.cm-callout') || node.querySelector('.cm-callout, .callout pre:not(.frontmatter)')) {
            this.scheduleProcessing();
            return;
          }
        }
      }
    }

    private scheduleProcessing() {
      if (this.scheduled || this.destroyed) {
        return;
      }

      this.scheduled = true;
      this.rafId = window.requestAnimationFrame(() => {
        this.scheduled = false;
        this.rafId = null;
        if (!this.destroyed) {
          this.processCallouts();
        }
      });
    }

    private processCallouts() {
      if (isSourceMode(this.view.state)) {
        return;
      }

      const calloutWidgets = Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>('.cm-callout'))
        .filter(el => !el.parentElement?.closest('.cm-callout'));

      if (calloutWidgets.length === 0) {
        return;
      }

      let fileContentLines: string[] | null = null;
      const sourcePath = this.view.state.field(editorInfoField, false)?.file?.path ?? "";

      for (const cmCalloutEl of calloutWidgets) {
        if (!cmCalloutEl.isConnected) {
          continue;
        }

        const hasCallout = cmCalloutEl.querySelector('.callout:not(.admonition)');
        if (!hasCallout) {
          continue;
        }

        const renderedPreElements = Array.from(cmCalloutEl.querySelectorAll<HTMLElement>('pre:not(.frontmatter)'));
        if (renderedPreElements.length === 0) {
          continue;
        }

        const hasUnprocessed = renderedPreElements.some(pre => !pre.hasAttribute(PROCESSED_ATTR) && !pre.classList.contains('codeblock-customizer-pre'));
        if (!hasUnprocessed) {
          continue;
        }

        const range = this.getCalloutLineRange(cmCalloutEl);
        if (!range) {
          continue;
        }

        const calloutLines: string[] = [];
        for (let lineNum = range.startLine; lineNum <= range.endLine; lineNum++) {
          calloutLines.push(this.view.state.doc.line(lineNum).text);
        }

        const innerCodeBlocks = extractCodeBlocksFromCallout(calloutLines);
        if (renderedPreElements.length !== innerCodeBlocks.length) {
          continue;
        }

        if (!fileContentLines) {
          fileContentLines = this.view.state.doc.toString().split('\n');
        }

        for (const [index, preElement] of renderedPreElements.entries()) {
          if (preElement.hasAttribute(PROCESSED_ATTR) || preElement.classList.contains('codeblock-customizer-pre')) {
            continue;
          }

          const blockData = innerCodeBlocks[index];
          if (!blockData) {
            continue;
          }

          preElement.setAttribute(PROCESSED_ATTR, 'true');

          if (getAllParameters(blockData.firstLine, settings, true).exclude) {
            continue;
          }

          const renderer = new CodeBlockRenderer(preElement, plugin, { sourcePath } as MarkdownPostProcessorContext);
          const absoluteLineStart = range.startLine + blockData.startLine;
          const absoluteLineEnd = range.startLine + blockData.endLine;
          const sectionInfo = { lineStart: absoluteLineStart - 1, lineEnd: absoluteLineEnd - 1, text: blockData.contentLines.join('\n') };
          void renderer.renderExternal(blockData.firstLine, blockData.contentLines, sectionInfo, fileContentLines);
        }
      }
    }

    private getCalloutLineRange(cmCalloutEl: HTMLElement): { startLine: number; endLine: number } | null {
      let pos: number;
      try {
        pos = this.view.posAtDOM(cmCalloutEl);
      } catch {
        return null;
      }

      const doc = this.view.state.doc;
      let lineNum = doc.lineAt(pos).number;

      if (!/^\s*>/.test(doc.line(lineNum).text)) {
        if (lineNum > 1 && /^\s*>/.test(doc.line(lineNum - 1).text)) {
          lineNum -= 1;
        } else if (lineNum < doc.lines && /^\s*>/.test(doc.line(lineNum + 1).text)) {
          lineNum += 1;
        } else {
          return null;
        }
      }

      let startLine = lineNum;
      while (startLine > 1 && /^\s*>/.test(doc.line(startLine - 1).text)) {
        startLine--;
      }

      let endLine = lineNum;
      while (endLine < doc.lines && /^\s*>/.test(doc.line(endLine + 1).text)) {
        endLine++;
      }

      return { startLine, endLine };
    }

    destroy() {
      this.destroyed = true;
      this.observer.disconnect();
      if (this.rafId !== null) {
        window.cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    }
  });// calloutViewPlugin

  return { calloutViewPlugin };
}// calloutExtension
