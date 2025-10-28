import { Notice, setIcon } from "obsidian";

import { CBCParameters } from "./Utils";
import CodeBlockCustomizerPlugin from "./main";
import { renderCodeBlockLines } from "./ReadingViewUtils";

export function addAndObserveExecuteCodeButtons(frag: DocumentFragment, targetPreElement: HTMLElement | undefined, parameters: CBCParameters, plugin: CodeBlockCustomizerPlugin): MutationObserver | null {
  const executeButton = createExecuteCodeRunButton();
  const clearButton = createExecuteCodeClearButton();
  
  frag.appendChild(executeButton);
  frag.appendChild(clearButton);

  const parentContainer = targetPreElement?.parentElement;
  if (parentContainer && targetPreElement) {
    if (plugin.executeCodeObservers.has(parentContainer)) {
      plugin.executeCodeObservers.get(parentContainer)?.disconnect();
      plugin.executeCodeObservers.delete(parentContainer);
    }
    setupButtonRevealObserver(parentContainer, targetPreElement, executeButton);
    const observer = setupExecuteCodeObserver(targetPreElement, clearButton, parameters, plugin);

    executeButton.addEventListener("click", (event) => {
      const currentPre = (event.currentTarget as HTMLElement).closest('pre');
      const currentParentContainer = currentPre?.parentElement;

      if (currentParentContainer) {
        executeCode(event, currentParentContainer, parameters);
      }
    });

    clearButton.addEventListener("click", (event) => {
      const currentPre = (event.currentTarget as HTMLElement).closest('pre');
      const currentParentContainer = currentPre?.parentElement;

      if (currentParentContainer) {
        clearOutput(event, currentParentContainer);
      }
    });

    return observer;
  }

  return null;
}// addAndObserveExecuteCodeButtons

function setupButtonRevealObserver(parentContainer: HTMLElement, targetPreElement: HTMLElement, executeButton: HTMLElement) {
  const existingRunButton = targetPreElement.querySelector('.run-code-button');
  if (existingRunButton) {
    executeButton.classList.remove('codeblock-customizer-execute-code-button-pending-verification');
  } else {
    const observer = new MutationObserver(() => {
      const originalRunButton = targetPreElement.querySelector('.run-code-button');
      if (originalRunButton) {
        executeButton.classList.remove('codeblock-customizer-execute-code-button-pending-verification');
        observer.disconnect();
      }
    });

    observer.observe(parentContainer, { childList: true, subtree: true });
  }
}// setupButtonRevealObserver

function setupExecuteCodeObserver(preElement: HTMLElement, clearButton: HTMLElement, parameters: CBCParameters, plugin: CodeBlockCustomizerPlugin) {
  const executionObserver = new MutationObserver((mutations) => {
    const originalClearButton = preElement.querySelector('.clear-button');
    if (originalClearButton) {
      clearButton.classList.remove('codeblock-customizer-execute-code-clear-button-hidden');
    } else {
      clearButton.classList.add('codeblock-customizer-execute-code-clear-button-hidden');
    }
    
    const outputElement = preElement.querySelector('code.language-output') as HTMLElement;
    if (!outputElement) {
      return;
    }

    let needsProcessing = false;
    const unprocessedSpans = outputElement.querySelectorAll('span.stdout:not([data-cbc-processed]), span.stdin:not([data-cbc-processed]), span.stderr:not([data-cbc-processed])');
    
    for (const span of Array.from(unprocessedSpans)) {
      if (span.textContent?.trim()) {
        needsProcessing = true;
        break;
      }
    }
    
    if (needsProcessing && outputElement.dataset.cbcProcessing !== 'true') {
      outputElement.dataset.cbcProcessing = 'true';
      
      if (!outputElement.classList.contains('codeblock-customizer-execute-code-output')){
        outputElement.classList.add('codeblock-customizer-execute-code-output');
      }
      processExecuteCodeOutput(outputElement as HTMLElement, executionObserver, preElement, parameters, plugin);
    }
  });

  executionObserver.observe(preElement, { childList: true, subtree: true, characterData: true });
  plugin.executeCodeObservers.set(preElement, executionObserver);

  return executionObserver;
}// setupExecuteCodeObserver

export function verifyAndRevealExecuteButtons(scope?: HTMLElement) {
  const searchEl = scope || document;
  const buttonsToVerify = searchEl.querySelectorAll('.codeblock-customizer-execute-code-button-pending-verification');

  buttonsToVerify.forEach((button: HTMLElement) => {
    const searchContainer = scope || button.closest('.codeblock-customizer-pre-parent');
    if (!searchContainer) {
      return;
    }
    
    const originalRunButton = searchContainer.querySelector('.run-code-button');

    if (originalRunButton) {
      button.classList.remove('codeblock-customizer-execute-code-button-pending-verification');
    }
  });
}// verifyAndRevealExecuteButtons

function createExecuteCodeRunButton(): HTMLElement {
  const button = document.createElement("button");
  button.classList.add(`codeblock-customizer-execute-code-button`);
  button.classList.add(`codeblock-customizer-execute-code-button-pending-verification`);
  button.setAttribute("aria-label", "Execute code");
  setIcon(button, "circle-play");

  return button;
}// createExecuteCodeRunButton

function executeCode(event: Event, parentContainer: HTMLElement, parameters: CBCParameters) {
  event.stopPropagation();
  const originalRunButton = parentContainer.querySelector('.run-code-button') as HTMLElement;
  if (originalRunButton) {
    originalRunButton.click();
    new Notice(`Executing ${parameters.language} code...`);
  } else {
    new Notice("Error: Could not find original run button.", 2000);
  }
}// executeCode

function createExecuteCodeClearButton(): HTMLElement {
  const button = document.createElement("button");
  button.classList.add(`codeblock-customizer-execute-code-clear-button`);
  button.classList.add(`codeblock-customizer-execute-code-clear-button-hidden`);
  button.setAttribute("aria-label", "Clear output");
  setIcon(button, "x");

  return button;
}// createExecuteCodeClearButton

function clearOutput(event: Event, parentContainer: HTMLElement) {
  event.stopPropagation();
  const originalClearButton = parentContainer.querySelector('.clear-button') as HTMLElement;
  if (originalClearButton) {
    originalClearButton.click();
  } else {
    new Notice("Error: Could not find original clear button.", 2000);
  }
}// clearOutput

export function createExecuteCodeEditButton(): HTMLElement {
  const button = document.createElement("button");
  button.classList.add(`codeblock-customizer-execute-code-edit-button`);
  button.setAttribute("aria-label", "Edit this block");
  setIcon(button, "code-xml");

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const preElement = (event.currentTarget as HTMLElement).closest('pre');
    if (!preElement) {
      return;
    }

    const blockContainer = preElement.closest('.cm-preview-code-block');
    if (!blockContainer) {
      return;
    }

    const originalEditButton = blockContainer.querySelector<HTMLElement>('.edit-block-button');
    if (originalEditButton) {
      originalEditButton.click();
    } else {
      new Notice("Error: Could not find original edit button.", 2000);
    }
  });

  return button;
}// createExecuteCodeEditButton

async function processExecuteCodeOutput(outputElement: HTMLElement, observer: MutationObserver, parentContainer: HTMLElement, parameters: CBCParameters, plugin: CodeBlockCustomizerPlugin) {
  observer.disconnect();

  try {
    if (plugin.settings.pluginSettings.plugins.executeCode.styleOutput) {
      let rawTextContent = "";
      outputElement.childNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          const isSourceSpan = el.tagName.toLowerCase() === 'span' && (el.classList.contains('stdout') || el.classList.contains('stdin') ||  el.classList.contains('stderr'));
          if (isSourceSpan) {
            rawTextContent += el.textContent;
          }
        }
      });

      const existingCustomOutput = outputElement.querySelector('.codeblock-customizer-output') as HTMLElement;
      
      const hideOriginalElements = () => {
        outputElement.childNodes.forEach(child => {
          if (child.nodeType === Node.ELEMENT_NODE) {
            const el = child as HTMLElement;
            const isOwnOutput = el.classList.contains('codeblock-customizer-output');
            const isInteractiveInput = el.tagName.toLowerCase() === 'input' && el.classList.contains('interactive-stdin');

            if (!isOwnOutput && !isInteractiveInput) {
              el.classList.add('codeblock-customizer-original-output-hidden');
            }
          }
        });
      };

      if (existingCustomOutput && existingCustomOutput.dataset.cbcSourceText === rawTextContent) {
        hideOriginalElements();
      } else {
        existingCustomOutput?.remove();
        outputElement.classList.remove('cbc-execution-error');

        const errorElement = outputElement.querySelector(".stderr");
        if (errorElement && errorElement.textContent?.trim()) {
          return;
        }

        const container = createDiv({ cls: 'codeblock-customizer-output' });
        container.dataset.cbcSourceText = rawTextContent;

        const lines = rawTextContent.split('\n');
        if (lines.length > 1 && lines[lines.length - 1].trim() === '') {
          lines.pop();
        }

        if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
          const lineWrapper = createDiv({ cls: "codeblock-customizer-line" });
          const lineText = createDiv({ cls: "codeblock-customizer-line-text", text: "Script executed with no output." });
          lineWrapper.appendChild(lineText);
          container.appendChild(lineWrapper);
        } else {
          const { fragment } = await renderCodeBlockLines({
            htmlLines: lines,
            textLines: lines,
            lineCount: lines.length,
            parameters,
            plugin,
            settings: plugin.settings.pluginSettings,
            sourcePath: plugin.app.workspace.getActiveFile()?.path || "",
            target: 'codeOutput',
            handleAnnotations: false,
            processPrompts: false,
            addIndentationGuides: false,
            parseLinks: false,
          });
          container.appendChild(fragment);
        }
        outputElement.appendChild(container);
        hideOriginalElements();
      }
    }
  } finally {
    outputElement.dataset.cbcProcessing = 'false';
    observer.observe(parentContainer, { childList: true, subtree: true, characterData: true });
  }
}// processExecuteCodeOutput