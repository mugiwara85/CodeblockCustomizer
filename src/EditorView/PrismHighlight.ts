import { StateField, RangeSet, Range } from "@codemirror/state";
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";

import { CodeblockCustomizerSettings } from "../Settings";
import CodeBlockCustomizerPlugin from "../main";
import { getLanguageConfig, getPrism, isSourceMode, loadCustomPrismLanguages, PrismInstance, PrismToken, tokenizeWithHooks } from "../Utils";
import { CodeBlockPositions, getVisibleCodeBlocks } from "./CodeBlockPositions";

export interface PrismTokenRange {
  from: number;
  to: number;
  classes: string;
}

interface CachedBlock {
  content: string;
  language: string;
  tokenRanges: PrismTokenRange[];
}

export function walkPrismTokens(tokens: Array<string | PrismToken>, offset: number, result: PrismTokenRange[]): number {
  for (const token of tokens) {
    if (typeof token === "string") {
      offset += token.length;
    } else {
      const parts = ["token", token.type];
      if (token.alias) {
        if (Array.isArray(token.alias)) {
          parts.push(...token.alias);
        } else {
          parts.push(token.alias);
        }
      }

      const classes = parts.join(" ");
      const start = offset;

      if (Array.isArray(token.content)) {
        offset = walkPrismTokens(token.content, offset, result);
      } else if (typeof token.content === "string") {
        offset += token.content.length;
      } else {
        offset = walkPrismTokens([token.content], offset, result);
      }

      if (offset > start) {
        result.push({ from: start, to: offset, classes });
      }
    }
  }
  return offset;
}// walkPrismTokens

export function getTokenRangesFromPrismHighlighedtHTML(code: string, language: string): PrismTokenRange[] | null {
  if (!prismInstance || !prismInstance.languages[language]) {
    return null;
  }

  const tokens = tokenizeWithHooks(prismInstance, code, prismInstance.languages[language], language);
  const result: PrismTokenRange[] = [];
  walkPrismTokens(tokens, 0, result);
  return result;
}// getTokenRangesFromPrismHighlighedtHTML

let prismInstance: PrismInstance | null = null;
let isPrismLoading = false;
const pendingPrismCallbacks: Array<() => void> = [];

export function getPrismInstance(): PrismInstance | null {
  return prismInstance;
}// getPrismInstance

export function ensurePrismLoaded(onLoaded?: () => void): void {
  if (prismInstance) {
    onLoaded?.();
    return;
  }

  // queue callbacks, so every editor opened while loading gets notified
  if (onLoaded) {
    pendingPrismCallbacks.push(onLoaded);
  }

  if (isPrismLoading) {
    return;
  }

  isPrismLoading = true;

  void getPrism().then(p => {
    prismInstance = p;
    loadCustomPrismLanguages(p);
    isPrismLoading = false;
    for (const callback of pendingPrismCallbacks.splice(0)) {
      callback();
    }
  });
}// ensurePrismLoaded

export function prismHighlightExtension(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings, codeBlockPositionsField: StateField<CodeBlockPositions[]>) {

  const cache = new Map<number, CachedBlock>();

  const prismHighlightPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    lastVisibleBlockStarts: Set<number> = new Set();

    constructor(view: EditorView) {
      this.decorations = Decoration.none;

      if (prismInstance) {
        this.decorations = this.buildDecorations(view);
      } else {
        ensurePrismLoaded(() => view.dispatch());
      }
    }

    update(update: ViewUpdate) {
      if (!prismInstance) {
        return;
      }

      if ((!settings.pluginSettings.codeblock.usePrismHighlight && !settings.pluginSettings.common.enableHtmlCodeBlocks) || settings.pluginSettings.common.disableEditorSyntaxHighlight) {
        if (this.decorations !== Decoration.none) {
          this.decorations = Decoration.none;
        }
        return;
      }

      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(update.state))
        return;

      const codeBlocksChanged = update.startState.field(codeBlockPositionsField, false) !== update.state.field(codeBlockPositionsField, false);
      if (update.docChanged || codeBlocksChanged || plugin.settingsUpdated) {
        this.decorations = this.buildDecorations(update.view);
        return;
      }

      if (update.viewportChanged) {
        this.decorations = this.extendDecorations(update.view);
        return;
      }

      // empty dispatch. required during loading
      if (this.decorations === Decoration.none) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    extendDecorations(view: EditorView): DecorationSet {
      const positions = view.state.field(codeBlockPositionsField, false) ?? [];
      const visibleBlocks = getVisibleCodeBlocks(positions, view.visibleRanges);
      const newBlocks = visibleBlocks.filter(b => !this.lastVisibleBlockStarts.has(b.codeBlockStartPos));

      if (newBlocks.length === 0) {
        return this.decorations;
      }

      newBlocks.forEach(b => this.lastVisibleBlockStarts.add(b.codeBlockStartPos));

      const newDecorations = this.buildDecorationsForBlocks(view, newBlocks);

      return this.decorations.update({ add: newDecorations, sort: true });
    }// extendDecorations

    buildDecorations(view: EditorView): DecorationSet {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(view.state))
        return Decoration.none;

      if ((!settings.pluginSettings.codeblock.usePrismHighlight && !settings.pluginSettings.common.enableHtmlCodeBlocks) || settings.pluginSettings.common.disableEditorSyntaxHighlight) {
        return Decoration.none;
      }

      const positions = view.state.field(codeBlockPositionsField, false) ?? [];
      const visibleBlocks = getVisibleCodeBlocks(positions, view.visibleRanges);

      this.lastVisibleBlockStarts = new Set(visibleBlocks.map(b => b.codeBlockStartPos));

      const decorations = this.buildDecorationsForBlocks(view, visibleBlocks);

      return RangeSet.of(decorations, true);
    }// buildDecorations

    buildDecorationsForBlocks(view: EditorView, blocks: CodeBlockPositions[]): Range<Decoration>[] {
      const decorations: Range<Decoration>[] = [];
      if (!prismInstance) {
        return decorations;
      }

      for (const block of blocks) {
        // syntax highlight HTML code blocks, because Obsidian doesn't highlight the code
        if (block.parameters.exclude || (!settings.pluginSettings.codeblock.usePrismHighlight && !block.htmlBlock)) {
          continue;
        }

        const firstLine = view.state.doc.lineAt(block.codeBlockStartPos);
        const lastLine = view.state.doc.lineAt(block.codeBlockEndPos);

        let codeStartPos: number;
        let codeEndPos: number;
        let cbcPrismRanges: Range<Decoration>[] = [];

        if (block.htmlBlock) {
          const openMatch = firstLine.text.match(/<code(?=[\s>])[^>]*>/i);
          codeStartPos = openMatch && openMatch.index !== undefined
            ? firstLine.from + openMatch.index + openMatch[0].length
            : firstLine.to;
          if (codeStartPos === firstLine.to && firstLine.number < lastLine.number) {
            codeStartPos = view.state.doc.line(firstLine.number + 1).from;
          }

          const closeIdx = lastLine.text.toLowerCase().lastIndexOf('</code>');
          codeEndPos = closeIdx !== -1 ? lastLine.from + closeIdx : lastLine.from;
          if (codeEndPos === lastLine.from && lastLine.number > firstLine.number) {
            codeEndPos = view.state.doc.line(lastLine.number - 1).to;
          }

          if (codeEndPos <= codeStartPos) {
            continue;
          }

          const startLineNum = view.state.doc.lineAt(codeStartPos).number;
          const endLineNum = view.state.doc.lineAt(codeEndPos).number;
          for (let lineNum = startLineNum; lineNum <= endLineNum; lineNum++) {
            const docLine = view.state.doc.line(lineNum);
            if (lineNum === firstLine.number && codeStartPos > docLine.from) {
              const markEnd = Math.min(docLine.to, codeEndPos);
              if (markEnd > codeStartPos) {
                cbcPrismRanges.push(Decoration.mark({ class: "cbc-prism" }).range(codeStartPos, markEnd));
              }
            } else if (lineNum === lastLine.number && codeEndPos < docLine.to) {
              const markStart = Math.max(docLine.from, codeStartPos);
              if (codeEndPos > markStart) {
                cbcPrismRanges.push(Decoration.mark({ class: "cbc-prism" }).range(markStart, codeEndPos));
              }
            } else {
              cbcPrismRanges.push(Decoration.line({ class: "cbc-prism" }).range(docLine.from));
            }
          }
        } else {
          const codeStartLineNum = firstLine.number + 1;
          const codeEndLineNum = lastLine.number - 1;
          if (codeStartLineNum > codeEndLineNum) {
            continue;
          }

          codeStartPos = view.state.doc.line(codeStartLineNum).from;
          codeEndPos = view.state.doc.line(codeEndLineNum).to;
          for (let lineNum = codeStartLineNum; lineNum <= codeEndLineNum; lineNum++) {
            const linePos = view.state.doc.line(lineNum).from;
            cbcPrismRanges.push(Decoration.line({ class: "cbc-prism" }).range(linePos));
          }
        }

        const code = view.state.sliceDoc(codeStartPos, codeEndPos);

        let language = block.parameters.language?.toLowerCase() ?? "";
        // strip run- prefix
        if (language.startsWith("run-")) {
          language = language.substring(4);
        }

        const customLangConfig = getLanguageConfig(language, plugin);
        const prismLanguage = customLangConfig?.format ?? language;
        if (!prismLanguage || !prismInstance.languages[prismLanguage]) {
          continue;
        }

        let tokenRanges: PrismTokenRange[];
        const cached = cache.get(block.codeBlockStartPos);
        if (cached && cached.content === code && cached.language === prismLanguage) {
          tokenRanges = cached.tokenRanges;
        } else {
          const grammar = prismInstance.languages[prismLanguage];
          const tokens = tokenizeWithHooks(prismInstance, code, grammar, prismLanguage);

          tokenRanges = [];
          walkPrismTokens(tokens, 0, tokenRanges);

          cache.set(block.codeBlockStartPos, {
            content: code,
            language: prismLanguage,
            tokenRanges,
          });
        }

        for (const range of tokenRanges) {
          const from = codeStartPos + range.from;
          const to = codeStartPos + range.to;
          if (from >= to || to > view.state.doc.length) {
            continue;
          }

          decorations.push(Decoration.mark({ class: range.classes }).range(from, to));
        }

        decorations.push(...cbcPrismRanges);
      }

      return decorations;
    }// buildDecorationsForBlocks

    destroy() {
      cache.clear();
    }
  }, {
    decorations: v => v.decorations
  });

  return { prismHighlightPlugin };
}// prismHighlightExtension
