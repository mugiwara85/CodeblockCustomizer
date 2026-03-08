import { StateField } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

import { isPluginLoaded, getBorderColorByLanguage, getPropertyFromLanguageSpecificColors } from "../Utils";
import { CodeblockCustomizerSettings } from "../Settings";
import CodeBlockCustomizerPlugin from "../main";
import { createButtons, extractLinesFromHTML, renderCodeBlockLines } from "../ReadingView/ReadingViewUtils";
import { createExecuteCodeEditButton, verifyAndRevealExecuteButtons } from "../ExecuteCode";
import { getAllParameters } from "../Parsing";
import { CodeBlockPositions } from "./CodeBlockPositions";

export function executeCodeExtension(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings, codeBlockPositionsField: StateField<CodeBlockPositions[]>) {
  const executeCodeViewPlugin = ViewPlugin.fromClass(class {
    private observer: MutationObserver;

    constructor(view: EditorView) {
      this.observer = new MutationObserver((mutations) => {
        this.handleMutations(mutations, view);
      });

      if (settings.pluginSettings.plugins.executeCode.enabled && isPluginLoaded('execute-code', plugin)) {
        this.observer.observe(view.contentDOM, { childList: true, subtree: true });
      }
    }

    private handleMutations(mutations: MutationRecord[], view: EditorView) {
      if (!settings.pluginSettings.plugins.executeCode.enabled || !isPluginLoaded('execute-code', plugin)) {
        return;
      }

      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (!(node instanceof HTMLElement)) {
            continue;
          }

          const runButtons = node.querySelectorAll<HTMLElement>('.run-code-button');
          runButtons.forEach(button => this.processRunButton(button, view));
        }
      }
    }

    private processRunButton(button: HTMLElement, view: EditorView) {
      const preElement = button.closest('pre');
      if (!preElement || !preElement.isConnected || preElement.hasAttribute('data-cbc-processed')) {
        return;
      }

      // hide default edit button for rendered code blocks
      const blockContainer = preElement.closest('.cm-preview-code-block');
      if (blockContainer) {
        const editButton = blockContainer.querySelector<HTMLElement>('.edit-block-button');
        if (editButton) {
          editButton.style.display = 'none';
        }
      }

      const pos = view.posAtDOM(preElement);
      if (pos === null) {
        return;
      }

      const codeBlocks = view.state.field(codeBlockPositionsField, false) ?? [];
      const block = codeBlocks.find(b => pos >= b.codeBlockStartPos && pos <= b.codeBlockEndPos);
      if (block && block.parameters.language.startsWith('run-')) {
        const rawLines = view.state.sliceDoc(block.codeBlockStartPos, block.codeBlockEndPos);
        styleExecuteCodeWidget(preElement, rawLines);
      }
    }

    destroy() {
      this.observer.disconnect();
    }
  });// executeCodeViewPlugin

  async function styleExecuteCodeWidget(preElement: HTMLElement, rawLines: string) {
    const codeElement = preElement.querySelector('code');
    if (!codeElement) {
      return;
    }

    if (Array.from(codeElement.classList).some(className => /^language-\S+/.test(className))) {
      while (!codeElement.classList.contains("is-loaded")) {
        await new Promise(resolve => setTimeout(resolve, 2));
      }
    }

    if (preElement.hasAttribute('data-cbc-processed')) {
      return;
    }
    preElement.setAttribute('data-cbc-processed', 'true');

    const rawCodeLines = rawLines.split('\n');
    const parameters = getAllParameters(rawCodeLines[0], plugin.settings, true);
    const baseLanguage = parameters.language ? parameters.language.replace('run-', '') : ''; //langClass ? langClass.replace('language-', '') : '';
    if (!baseLanguage) {
      return;
    }

    const fullLanguage = `run-${baseLanguage}`;
    preElement.classList.add('codeblock-customizer-pre', `codeblock-customizer-language-${fullLanguage}`, `codeblock-customizer-language-${baseLanguage}`);

    if (preElement.parentElement) {
      preElement.parentElement.classList.add('codeblock-customizer-pre-parent');
    }

    const { htmlLines, textLines } = extractLinesFromHTML(codeElement);
    const lineCount = Math.max(1, rawCodeLines.length - 2);
    codeElement.innerHTML = '';

    const { fragment } = await renderCodeBlockLines({
      htmlLines,
      textLines,
      lineCount,
      parameters,
      plugin,
      settings: plugin.settings.pluginSettings,
      sourcePath: "",
      handleAnnotations: true,
      processPrompts: false,
      addIndentationGuides: true,
      parseLinks: plugin.settings.pluginSettings.codeblock.enableLinks,
    });

    codeElement.appendChild(fragment);

    const borderColor = getBorderColorByLanguage(baseLanguage, getPropertyFromLanguageSpecificColors("codeblock.borderColor", plugin.settings));
    if (borderColor.length > 0) {
      preElement.classList.add('hasLangBorderColor');
    }

    parameters.language = baseLanguage;
    const { container: buttons } = createButtons(parameters, rawCodeLines, plugin, preElement);
    const editButton = createExecuteCodeEditButton();
    buttons.appendChild(editButton);
    preElement.appendChild(buttons);

    // setTimeout(() => {
    const parent = preElement.parentElement;
    if (parent)
      verifyAndRevealExecuteButtons(parent);
    //}, 50);
  }// styleExecuteCodeWidget

  return { executeCodeViewPlugin };
}// executeCodeExtension
