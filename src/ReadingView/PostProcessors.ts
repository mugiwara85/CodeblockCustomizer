import { MarkdownPostProcessorContext, MarkdownSectionInformation } from "obsidian";

import { getFileCacheAndContentLines } from "../Utils";
import { CodeBlockRenderer } from "./CodeBlockRenderer";
import CodeBlockCustomizerPlugin from "../main";
import { CodeBlockData, extractCodeBlocksFromAdmonition, extractCodeBlocksFromCallout } from "./ReadingViewUtils";
import { getAllParameters } from "../Parsing";

export async function calloutPostProcessor(codeBlockElement: HTMLElement, context: MarkdownPostProcessorContext, plugin: CodeBlockCustomizerPlugin) {
  // this only handles callouts in editing mode, because in reading mode callouts are styled by default
  const callouts: HTMLElement | null = codeBlockElement.matches('.callout:not(.admonition)')
    ? codeBlockElement
    : codeBlockElement.querySelector('.callout:not(.admonition)');
  if (!callouts) {
    return;
  }

  const firstCodeEl = callouts.querySelector('pre > code');
  if (codeBlockElement.closest('.markdown-preview-view, .print, .cm-callout') || (firstCodeEl && context.getSectionInfo(firstCodeEl as HTMLElement))) {
    return;
  }

  const { fileContentLines } = await getFileCacheAndContentLines(plugin, context.sourcePath);
  if (!fileContentLines) {
    return;
  }

  const foundCmView = await waitForCmView(context);
  if (!foundCmView) {
    return;
  }

  type ContextWithContainerEl = MarkdownPostProcessorContext & {
    containerEl?: HTMLElement & {
      cmView?: {
        widget?: {
          text?: string;
        };
      };
    };
  };

  const calloutText = (context as ContextWithContainerEl)?.containerEl?.cmView?.widget?.text?.split("\n") || null;
  if (!calloutText) {
    return;
  }

  const calloutPreElements: Array<HTMLElement> = Array.from(callouts.querySelectorAll('pre:not(.frontmatter)'));
  if (!calloutPreElements) {
    return;
  }

  const allBlocks = extractCodeBlocksFromCallout(calloutText);
  if (calloutPreElements.length !== allBlocks.length) {
    return;
  }

  for (const [index, preElement] of calloutPreElements.entries()) {
    const blockData = allBlocks[index];
    if (getAllParameters(blockData.firstLine, plugin.settings, true).exclude) {
      continue;
    }

    const renderer = new CodeBlockRenderer(preElement, plugin, context);
    const sectionInfo: MarkdownSectionInformation = { lineStart: blockData.startLine, lineEnd: blockData.endLine, text: blockData.contentLines.join('\n') };
    await renderer.renderExternal(blockData.firstLine, blockData.contentLines, sectionInfo, fileContentLines);
  }
}// calloutPostProcessor

function waitForCmView(context: MarkdownPostProcessorContext, maxFrames = 10): Promise<boolean> {
  type ContextWithContainerEl = MarkdownPostProcessorContext & { containerEl?: HTMLElement & { cmView?: unknown } };
  if ((context as ContextWithContainerEl)?.containerEl?.cmView) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    let frames = 0;
    function check() {
      if ((context as ContextWithContainerEl)?.containerEl?.cmView) {
        resolve(true);
      } else if (frames >= maxFrames) {
        resolve(false);
      } else {
        frames++;
        window.requestAnimationFrame(check);
      }
    }
    window.requestAnimationFrame(check);
  });
}// waitForCmView

export async function admonitionPostProcessor(containerElement: HTMLElement, context: MarkdownPostProcessorContext, plugin: CodeBlockCustomizerPlugin) {
  if (!plugin.settings.pluginSettings.plugins.admonitions.enabled) {
    return;
  }

  if (containerElement.dataset.cbcAdmonitionProcessed) {
    return;
  }

  const admonition = containerElement.querySelector('code[class^="language-ad-"]');
  if (!admonition) {
    return;
  }

  containerElement.dataset.cbcAdmonitionProcessed = 'true';

  const sectionInfo = context.getSectionInfo(admonition as HTMLElement);
  if (!sectionInfo) {
    return;
  }

  const { fileContentLines } = await getFileCacheAndContentLines(plugin, context.sourcePath);
  if (!fileContentLines) {
    return;
  }

  const admonitionBlockLines = fileContentLines.slice(sectionInfo.lineStart, sectionInfo.lineEnd + 1);
  const innerCodeBlocks = extractCodeBlocksFromAdmonition(admonitionBlockLines);

  if (innerCodeBlocks.length === 0) {
    return;
  }

  const initiallyRenderedElements = Array.from(containerElement.querySelectorAll<HTMLElement>('div.admonition-content pre:not(.frontmatter)'));
  if (initiallyRenderedElements.length >= innerCodeBlocks.length) {
    await processAdmonitionCodeBlocks(initiallyRenderedElements, innerCodeBlocks, sectionInfo, plugin, context, fileContentLines);
    return;
  }

  const timeoutId = window.setTimeout(() => {
    // MutationObserver for admonition never fired
  }, 2000);

  const observer = new MutationObserver((mutations, obs) => {
    const renderedPreElements = Array.from(containerElement.querySelectorAll<HTMLElement>('div.admonition-content pre:not(.frontmatter)'));

    if (renderedPreElements.length >= innerCodeBlocks.length) {
      window.clearTimeout(timeoutId);
      obs.disconnect();
      void (async () => {
        await processAdmonitionCodeBlocks(renderedPreElements, innerCodeBlocks, sectionInfo, plugin, context, fileContentLines);
        if (plugin.settings.pluginSettings.plugins.admonitions.enableTimeOut) {
          window.setTimeout(() => {
            const finalRenderedElements = Array.from(containerElement.querySelectorAll<HTMLElement>('div.admonition-content pre:not(.frontmatter)'));
            void processAdmonitionCodeBlocks(finalRenderedElements, innerCodeBlocks, sectionInfo, plugin, context, fileContentLines);
          }, plugin.settings.pluginSettings.plugins.admonitions.timeOut);
        }
      })();
    }
  });

  observer.observe(containerElement, { childList: true, subtree: true });
}// admonitionPostProcessor

async function processAdmonitionCodeBlocks(renderedPreElements: HTMLElement[], innerCodeBlocks: CodeBlockData[], sectionInfo: MarkdownSectionInformation, plugin: CodeBlockCustomizerPlugin, context: MarkdownPostProcessorContext, fileContentLines: string[]) {
  for (const [index, preElement] of renderedPreElements.entries()) {
    const blockData = innerCodeBlocks[index];
    if (!blockData) {
      continue;
    }

    const renderer = new CodeBlockRenderer(preElement, plugin, context);
    const absoluteSectionInfo: MarkdownSectionInformation = {
      lineStart: sectionInfo.lineStart + blockData.startLine,
      lineEnd: sectionInfo.lineStart + blockData.endLine,
      text: blockData.contentLines.join('\n')
    };

    await renderer.renderExternal(blockData.firstLine, blockData.contentLines, absoluteSectionInfo, fileContentLines);
  }
}// processAdmonitionCodeBlocks