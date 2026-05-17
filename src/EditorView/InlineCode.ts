import { Range, RangeSet } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

import { getLanguageIcon, isSourceMode, addTextToClipboard, getInlineCodeIcon, getDisplayLanguageName } from "../Utils";
import { CodeblockCustomizerSettings, InlineCodeModifierKeys } from "../Settings";
import { INLINE_CODE_LANG_REGEX } from "../Const";
import CodeBlockCustomizerPlugin from "../main";
import { getPrismInstance, getTokenRangesFromPrismHighlighedtHTML } from "./PrismHighlight";
import { parseInlineCodeHighlightParams, getInlineCodeBgClass, InlineCodeHighlightParameters, HighlightedWord } from "../Parsing";

export function inlineCodeExtension(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings) {
  const inlineCodeViewPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    prevEnableSyntaxHighlight: boolean;
    prevUsePrismHighlight: boolean;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
      this.prevEnableSyntaxHighlight = settings.pluginSettings.inlineCode.enableSyntaxHighlight;
      this.prevUsePrismHighlight = settings.pluginSettings.codeblock.usePrismHighlight;
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet ||
          this.prevEnableSyntaxHighlight != settings.pluginSettings.inlineCode.enableSyntaxHighlight ||
          this.prevUsePrismHighlight != settings.pluginSettings.codeblock.usePrismHighlight) {
        this.decorations = this.buildDecorations(update.view);
        this.prevEnableSyntaxHighlight = settings.pluginSettings.inlineCode.enableSyntaxHighlight;
        this.prevUsePrismHighlight = settings.pluginSettings.codeblock.usePrismHighlight;
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(view.state))
        return Decoration.none;

      const decorations: Array<Range<Decoration>> = [];
      const selection = view.state.selection.main;

      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from, to,
          enter: (node) => {
            if (!node.type.name.includes('inline-code'))
              return;

            decorations.push(Decoration.mark({ class: "codeblock-customizer-inline-code-wrapper" }).range(node.from, node.to));

            const inlineCodeText = view.state.sliceDoc(node.from, node.to);
            const match = inlineCodeText.match(INLINE_CODE_LANG_REGEX);
            // fix for #147
            if (!match || match[1].trim().startsWith('{'))
              return;

            const fullMatchText = match[0];
            const inlineParams = parseInlineCodeHighlightParams(match[1], settings);
            const langName = inlineParams.language ?? '';
            const code = match[2];
            if (!code)
              return;

            const prefixLength = fullMatchText.length - code.length;
            const codeStartPos = node.from + prefixLength;
            const isCursorNextToBacktick = selection.from === node.from - 1 || selection.to === node.to + 1;
            const isCursorInside = selection.from >= node.from && selection.to <= node.to;

            // background highlight is always applied, even if enableSyntaxHighlight is enabled or not
            let highlightClassForIcon: string | null = null;
            if (inlineParams.backgroundColorClass !== null) {
              const bgClass = getInlineCodeBgClass(inlineParams.backgroundColorClass);
              decorations.push(Decoration.mark({ class: bgClass }).range(codeStartPos, node.to));
              highlightClassForIcon = bgClass;
            }

            const addPrefixDecoration = (hideAlways: boolean) => {
              if (isCursorInside || isCursorNextToBacktick) {
                decorations.push(Decoration.mark({ class: "codeblock-customizer-inline-code-langauge" }).range(node.from, codeStartPos));
              } else if (langName) {
                const displayLanguage = getDisplayLanguageName(langName);
                const Icon = getLanguageIcon(displayLanguage);
                if (Icon) {
                  decorations.push(Decoration.replace({ widget: new inlineCodeIconWidget(displayLanguage, highlightClassForIcon) }).range(node.from, codeStartPos));
                } else {
                  decorations.push(Decoration.replace({}).range(node.from, codeStartPos));
                }
              } else if (hideAlways || inlineParams.backgroundColorClass !== null || inlineParams.textHighlight.words.length > 0 || inlineParams.textHighlight.textBetween.length > 0 || inlineParams.alternativeTextHighlights.length > 0) {
                decorations.push(Decoration.replace({}).range(node.from, codeStartPos));
              }
            };

            if (!settings.pluginSettings.inlineCode.enableSyntaxHighlight) {
              addPrefixDecoration(false);
              addTextHighlightDecorations(code, codeStartPos, inlineParams, decorations);
              return;
            }

            // syntax highlighting
            addPrefixDecoration(true);

            const prism = settings.pluginSettings.codeblock.usePrismHighlight ? getPrismInstance() : null;
            const tokenRanges = (prism && langName) ? getTokenRangesFromPrismHighlighedtHTML(code, langName) : null;
            if (tokenRanges) {
              decorations.push(Decoration.mark({ class: "cbc-prism-inline" }).range(node.from, node.to));

              for (const range of tokenRanges) {
                const from = codeStartPos + range.from;
                const to = codeStartPos + range.to;
                if (from < to && to <= node.to) {
                  decorations.push(Decoration.mark({ class: range.classes }).range(from, to));
                }
              }
            } else if (langName) {
              const tokens = getCM5Tokens(code, langName);
              let currentPos = codeStartPos;
              for (const token of tokens) {
                if (token.style) {
                  const classes = token.style.split(' ').map(s => `cm-${s}`).join(' ');
                  if (token.text.length > 0) {
                    decorations.push(Decoration.mark({ class: classes }).range(currentPos, currentPos + token.text.length));
                  }
                }
                currentPos += token.text.length;
              }
            }

            addTextHighlightDecorations(code, codeStartPos, inlineParams, decorations);
          },
        });
      }
      return RangeSet.of(decorations, true);
    }
  }, {
    decorations: v => v.decorations,
    eventHandlers: {
      click: (event, view) => {
        if (!settings.pluginSettings.inlineCode.enableCopyOnClick)
          return;

        const requiredKey = plugin.settings.pluginSettings.inlineCode.copyModifierKey;
        if ((requiredKey === InlineCodeModifierKeys.CTRL && !event.ctrlKey && !event.metaKey) || (requiredKey === InlineCodeModifierKeys.ALT && !event.altKey))
          return;

        const target = event.target as HTMLElement;
        const wrapper = target.closest('.codeblock-customizer-inline-code-wrapper');
        if (!wrapper)
          return;

        event.preventDefault();
        event.stopImmediatePropagation();

        const pos = view.posAtDOM(target);
        if (pos === null)
          return;

        let found = false;
        syntaxTree(view.state).iterate({
          from: pos, to: pos + 2,
          enter: (node) => {
            if (found)
              return false;

            if (node.type.name.includes('inline-code')) {
              const text = view.state.sliceDoc(node.from, node.to);
              if (text.startsWith('`')) {
                return;
              }

              const match = text.match(INLINE_CODE_LANG_REGEX);
              // fix for #147
              const isValidMatch = match && match[1] && !match[1].trim().startsWith('{');
              const textToCopy = isValidMatch && match[2] ? match[2] : text;
              addTextToClipboard(textToCopy);
              found = true;

              return false;
            }
          }
        });
      }
    }
  });// inlineCodeViewPlugin

  class inlineCodeIconWidget extends WidgetType {
    constructor(readonly displayLanguage: string, readonly highlightClass: string | null = null) {
      super();
    }

    eq(other: inlineCodeIconWidget) {
      return other.displayLanguage === this.displayLanguage && other.highlightClass === this.highlightClass;
    }

    toDOM() {
      const container = getInlineCodeIcon(this.displayLanguage, `cm-inline-code`);
      if (this.highlightClass) {
        container.classList.add(this.highlightClass);
      }

      return container;
    }
  }// inlineCodeIconWidget

  interface CM5Token {
    text: string;
    style: string | null;
  }

  function getCM5Tokens(code: string, modeSpec: string): CM5Token[] {
    const tokens: CM5Token[] = [];
    //const mode = window.CodeMirror.getMode({}, modeSpec);

    // @ts-ignore
    const mode = window.CodeMirror.getMode(window.CodeMirror.defaults, window.CodeMirror.findModeByName(modeSpec)?.mime);
    if (!mode || mode.name === 'null') {
      return [{ text: code, style: null }];
    }

    const state = mode.startState ? mode.startState() : null;
    const stream = new window.CodeMirror.StringStream(code);
    while (!stream.eol()) {
      const style = mode.token(stream, state);
      tokens.push({ text: stream.current(), style: style || null });
      stream.start = stream.pos;
    }

    return tokens;
  }// getCM5Tokens

  function addTextHighlightDecorations(code: string, codeStartPos: number, inlineParams: InlineCodeHighlightParameters, decorations: Array<Range<Decoration>>) {
    const escapeRegex = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}%]/g, '\\$&');

    const addWordMatches = (words: HighlightedWord[], className: string) => {
      for (const { text, occurrences } of words) {
        if (!text) {
          continue;
        }

        const regex = new RegExp(escapeRegex(text), 'gi');
        let match: RegExpExecArray | null;
        const allMatches: { from: number; to: number }[] = [];
        while ((match = regex.exec(code)) !== null) {
          allMatches.push({ from: match.index, to: match.index + match[0].length });
        }

        const filtered = occurrences.length > 0 ? allMatches.filter((_, i) => occurrences.includes(i + 1)) : allMatches;
        for (const r of filtered) {
          decorations.push(Decoration.mark({ class: className }).range(codeStartPos + r.from, codeStartPos + r.to));
        }
      }
    };

    const addBetweenMatches = (from: string, to: string, occurrences: number[], className: string) => {
      if (!from && !to) {
        return;
      }

      const fromLower = from.toLowerCase();
      const toLower = to.toLowerCase();
      const codeLower = code.toLowerCase();
      const allMatches: { from: number; to: number }[] = [];
      let searchFrom = 0;
      while (searchFrom < codeLower.length) {
        const startIdx = from ? codeLower.indexOf(fromLower, searchFrom) : 0;
        if (startIdx === -1) {
          break;
        }

        const contentStart = from ? startIdx + from.length : startIdx;
        const endIdx = to ? codeLower.indexOf(toLower, contentStart) : codeLower.length;
        if (endIdx === -1) {
          break;
        }

        allMatches.push({ from: startIdx, to: to ? endIdx + to.length : endIdx });
        searchFrom = to ? endIdx + to.length : endIdx + 1;
        if (!to) {
          break;
        }
      }
      
      const filtered = occurrences.length > 0 ? allMatches.filter((_, i) => occurrences.includes(i + 1)) : allMatches;
      for (const r of filtered) {
        decorations.push(Decoration.mark({ class: className }).range(codeStartPos + r.from, codeStartPos + r.to));
      }
    };

    addWordMatches(inlineParams.textHighlight.words, 'codeblock-customizer-highlighted-text');
    for (const tb of inlineParams.textHighlight.textBetween) {
      addBetweenMatches(tb.from, tb.to, tb.occurrences, 'codeblock-customizer-highlighted-text');
    }

    for (const alt of inlineParams.alternativeTextHighlights) {
      const cls = `codeblock-customizer-highlighted-text-${alt.colorName.replace(/\s+/g, '-').toLowerCase()}`;
      addWordMatches(alt.highlight.words, cls);
      for (const tb of alt.highlight.textBetween) {
        addBetweenMatches(tb.from, tb.to, tb.occurrences, cls);
      }
    }
  }// addTextHighlightDecorations

  return { inlineCodeViewPlugin };
}// inlineCodeExtension
