import { MarkdownPostProcessorContext, MarkdownSectionInformation } from "obsidian";

import { getFileCacheAndContentLines } from "../Utils";
import { CodeBlockRenderer } from "./CodeBlockRenderer";
import CodeBlockCustomizerPlugin from "../main";
import { CodeBlockData, extractCodeBlocksFromAdmonition } from "./ReadingViewUtils";

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

  // stop waiting if not all code blocks get rendered (e.g. one of them is a dataview block)
  const timeoutId = window.setTimeout(() => observer.disconnect(), 2000);

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