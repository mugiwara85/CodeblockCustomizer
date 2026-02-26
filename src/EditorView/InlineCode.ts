import { Range, RangeSet } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

import { getLanguageIcon, isSourceMode, addTextToClipboard, getInlineCodeIcon, getDisplayLanguageName } from "../Utils";
import { CodeblockCustomizerSettings, InlineCodeModifierKeys } from "../Settings";
import { INLINE_CODE_LANG_REGEX } from "../Const";
import CodeBlockCustomizerPlugin from "../main";

export function inlineCodeExtension(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings) {
  const inlineCodeViewPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    prevEnableSyntaxHighlight: boolean;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
      this.prevEnableSyntaxHighlight = settings.pluginSettings.inlineCode.enableSyntaxHighlight;
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || this.prevEnableSyntaxHighlight != settings.pluginSettings.inlineCode.enableSyntaxHighlight) {
        this.decorations = this.buildDecorations(update.view);
        this.prevEnableSyntaxHighlight = settings.pluginSettings.inlineCode.enableSyntaxHighlight;
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
            if (!node.type.name.startsWith('inline-code'))
              return;

            decorations.push(Decoration.mark({ class: "codeblock-customizer-inline-code-wrapper" }).range(node.from, node.to));
            if (!settings.pluginSettings.inlineCode.enableSyntaxHighlight) {
              return;
            }

            const inlineCodeText = view.state.sliceDoc(node.from, node.to);
            const match = inlineCodeText.match(INLINE_CODE_LANG_REGEX);
            // fix for #147
            if (!match || match[1].trim().startsWith('{'))
              return;

            const fullMatchText = match[0];
            const langName = match[1].toLowerCase();
            const code = match[2];
            if (!code)
              return;

            const prefixLength = fullMatchText.length - code.length;
            const codeStartPos = node.from + prefixLength;
            const isCursorNextToBacktick = selection.from === node.from - 1 || selection.to === node.to + 1;
            const isCursorInside = selection.from >= node.from && selection.to <= node.to;
            if (isCursorInside || isCursorNextToBacktick) {
              decorations.push(Decoration.mark({ class: "codeblock-customizer-inline-code-langauge" }).range(node.from, codeStartPos));
            } else {
              const displayLanguage = getDisplayLanguageName(langName);
              const Icon = getLanguageIcon(displayLanguage);
              if (Icon) {
                decorations.push(Decoration.replace({ widget: new inlineCodeIconWidget(displayLanguage) }).range(node.from, codeStartPos));
              }
              else {
                decorations.push(Decoration.replace({}).range(node.from, codeStartPos));
              }
            }

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
        if ((requiredKey === InlineCodeModifierKeys.CTRL && !event.ctrlKey) || (requiredKey === InlineCodeModifierKeys.ALT && !event.altKey))
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
          from: pos, to: pos,
          enter: (node) => {
            if (found)
              return false;

            if (node.type.name.startsWith('inline-code')) {
              const text = view.state.sliceDoc(node.from, node.to);
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
    constructor(readonly displayLanguage: string) {
      super();
    }

    eq(other: inlineCodeIconWidget) {
      return other.displayLanguage === this.displayLanguage;
    }

    toDOM() {
      return getInlineCodeIcon(this.displayLanguage, `cm-inline-code`);
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

  return { inlineCodeViewPlugin };
}// inlineCodeExtension
