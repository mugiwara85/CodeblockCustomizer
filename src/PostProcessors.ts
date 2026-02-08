import { MarkdownPostProcessorContext, MarkdownSectionInformation, MarkdownView } from "obsidian";

import { getFileCacheAndContentLines } from "./Utils";
import { CodeBlockRenderer } from "./CodeBlockRenderer";
import CodeBlockCustomizerPlugin from "./main";
import { CodeBlockData, extractCodeBlocksFromAdmonition, extractCodeBlocksFromCallout } from "./ReadingViewUtils";
import { getAllParameters } from "./Parsing";

export async function calloutPostProcessor(codeBlockElement: HTMLElement, context: MarkdownPostProcessorContext, plugin: CodeBlockCustomizerPlugin) {
  // this only handles callouts in editing mode, because in reading mode callouts are styled by default
  const callouts: HTMLElement | null = codeBlockElement.querySelector('.callout:not(.admonition)');
  if (!callouts) {
    return;
  }

  const markdownView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  if (markdownView?.getMode() !== "source") {
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

  // @ts-ignore
  const calloutText = context?.containerEl?.cmView?.widget?.text?.split("\n") || null;
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

async function waitForCmView(context: MarkdownPostProcessorContext, maxRetries = 25, delay = 2): Promise<boolean> {
  // @ts-ignore
  if (context?.containerEl?.cmView)
    return true;

  let retries = 0;
  // @ts-ignore
  while (!context?.containerEl?.cmView) {
    if (retries >= maxRetries) {
      return false;
    }
    retries++;
    await sleep(delay);
  }
  return true;
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

  const initiallyRenderedElements = Array.from(containerElement.querySelectorAll('div.admonition-content pre:not(.frontmatter)')) as HTMLElement[];
  if (initiallyRenderedElements.length >= innerCodeBlocks.length) {
    await processAdmonitionCodeBlocks(initiallyRenderedElements, innerCodeBlocks, sectionInfo, plugin, context, fileContentLines);
    return;
  }

  const timeoutId = setTimeout(() => {
    // MutationObserver for admonition never fired
  }, 2000);

  const observer = new MutationObserver(async (mutations, obs) => {
    const renderedPreElements = Array.from(containerElement.querySelectorAll('div.admonition-content pre:not(.frontmatter)')) as HTMLElement[];

    if (renderedPreElements.length >= innerCodeBlocks.length) {
      clearTimeout(timeoutId);
      obs.disconnect();
      await processAdmonitionCodeBlocks(renderedPreElements, innerCodeBlocks, sectionInfo, plugin, context, fileContentLines);
      if (plugin.settings.pluginSettings.plugins.admonitions.enableTimeOut) {
        setTimeout(async () => {
          const finalRenderedElements = Array.from(containerElement.querySelectorAll('div.admonition-content pre:not(.frontmatter)')) as HTMLElement[];
          await processAdmonitionCodeBlocks(finalRenderedElements, innerCodeBlocks, sectionInfo, plugin, context, fileContentLines);
        }, plugin.settings.pluginSettings.plugins.admonitions.timeOut);
      }
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