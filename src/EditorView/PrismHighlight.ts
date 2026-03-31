import { loadPrism } from "obsidian";

import { StateField, RangeSet, Range } from "@codemirror/state";
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";

import { CodeblockCustomizerSettings } from "../Settings";
import CodeBlockCustomizerPlugin from "../main";
import { getLanguageConfig, isSourceMode, loadCustomPrismLanguages } from "../Utils";
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function walkPrismTokens(tokens: any[], offset: number, result: PrismTokenRange[]): number {
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

  const html = prismInstance.highlight(code, prismInstance.languages[language], language);
  const container = createSpan();
  container.innerHTML = html;

  const result: PrismTokenRange[] = [];
  let offset = 0;

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      offset += (node.textContent ?? "").length;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const classes = el.className;
      const start = offset;
      for (const child of Array.from(el.childNodes)) {
        walk(child);
      }
      if (classes && offset > start) {
        result.push({ from: start, to: offset, classes });
      }
    }
  }

  for (const child of Array.from(container.childNodes)) {
    walk(child);
  }

  return result;
}// getTokenRangesFromPrismHighlighedtHTML

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prismInstance: any = null;
let isPrismLoading = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPrismInstance(): any {
  return prismInstance;
}// getPrismInstance

export function ensurePrismLoaded(onLoaded?: () => void): void {
  if (prismInstance) {
    onLoaded?.();
    return;
  }

  if (isPrismLoading) {
    return;
  }

  isPrismLoading = true;

  loadPrism().then(p => {
    prismInstance = p;
    loadCustomPrismLanguages(p);
    isPrismLoading = false;
    onLoaded?.();
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

      if (!settings.pluginSettings.codeblock.usePrismHighlight) {
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

      if (!settings.pluginSettings.codeblock.usePrismHighlight) {
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

      for (const block of blocks) {
        if (block.parameters.exclude) {
          continue;
        }

        const firstLine = view.state.doc.lineAt(block.codeBlockStartPos);
        const lastLine = view.state.doc.lineAt(block.codeBlockEndPos);
        const codeStartLineNum = firstLine.number + 1;
        const codeEndLineNum = lastLine.number - 1;
        if (codeStartLineNum > codeEndLineNum) {
          continue;
        }

        const codeStartPos = view.state.doc.line(codeStartLineNum).from;
        const codeEndPos = view.state.doc.line(codeEndLineNum).to;
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
          const tokens = prismInstance.tokenize(code, grammar);

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

        for (let lineNum = codeStartLineNum; lineNum <= codeEndLineNum; lineNum++) {
          const linePos = view.state.doc.line(lineNum).from;
          decorations.push(Decoration.line({ class: "cbc-prism" }).range(linePos));
        }
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
