import { editorInfoField, MarkdownPostProcessorContext } from "obsidian";

import { EditorState, Range, RangeSet } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

import { getLanguageIcon, isSourceMode, addTextToClipboard, getInlineCodeIcon, getDisplayLanguageName } from "../Utils";
import { CodeblockCustomizerSettings, InlineCodeModifierKeys } from "../Settings";
import { INLINE_CODE_LANG_REGEX } from "../Const";
import CodeBlockCustomizerPlugin from "../main";
import { getPrismInstance, getTokenRangesFromPrismHighlighedtHTML } from "./PrismHighlight";
import { parseInlineCodeHighlightParams, getInlineCodeBgClass, InlineCodeHighlightParameters, HighlightedWord } from "../Parsing";
import { combineInlineCodeParameters, decodeHtmlEntities, findHtmlInlineCodes } from "../HtmlCodeBlocks";
import { getHtmlCodeBlockRange, getHtmlCodeBlocks } from "./CodeBlockPositions";
import { InlineCodeRenderer } from "../ReadingView/InlineCodeRenderer";

export function inlineCodeExtension(plugin: CodeBlockCustomizerPlugin, settings: CodeblockCustomizerSettings) {
  const inlineCodeViewPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    prevEnableSyntaxHighlight: boolean;
    prevUsePrismHighlight: boolean;
    prevDisableEditorSyntaxHighlight: boolean;
    prevPrismLoaded: boolean;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
      this.prevEnableSyntaxHighlight = settings.pluginSettings.inlineCode.enableSyntaxHighlight;
      this.prevUsePrismHighlight = settings.pluginSettings.codeblock.usePrismHighlight;
      this.prevDisableEditorSyntaxHighlight = settings.pluginSettings.common.disableEditorSyntaxHighlight;
      this.prevPrismLoaded = getPrismInstance() !== null;
    }

    update(update: ViewUpdate) {
      // since Prism loads async, rebuild once it is available. Otherwise the CM5 tokens stay until the next change/interaction (#168)
      const prismLoaded = getPrismInstance() !== null;
      if (update.docChanged || update.viewportChanged || update.selectionSet || plugin.settingsUpdated ||
        this.prevEnableSyntaxHighlight != settings.pluginSettings.inlineCode.enableSyntaxHighlight ||
        this.prevUsePrismHighlight != settings.pluginSettings.codeblock.usePrismHighlight ||
        this.prevDisableEditorSyntaxHighlight != settings.pluginSettings.common.disableEditorSyntaxHighlight ||
        this.prevPrismLoaded != prismLoaded) {
        this.decorations = this.buildDecorations(update.view);
        this.prevEnableSyntaxHighlight = settings.pluginSettings.inlineCode.enableSyntaxHighlight;
        this.prevUsePrismHighlight = settings.pluginSettings.codeblock.usePrismHighlight;
        this.prevDisableEditorSyntaxHighlight = settings.pluginSettings.common.disableEditorSyntaxHighlight;
        this.prevPrismLoaded = prismLoaded;
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(view.state))
        return Decoration.none;

      const decorations: Array<Range<Decoration>> = [];
      // a line can belong to more than one visible range (CodeMirror splits them at bigger widgets, e.g. a rendered HTML inline code) ==> decorate each HTML inline code only once
      const decoratedHtmlInlineCodes = new Set<number>();

      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from, to,
          enter: (node) => {
            if (!node.type.name.includes('inline-code'))
              return;

            decorations.push(Decoration.mark({ class: "codeblock-customizer-inline-code-wrapper" }).range(node.from, node.to));
            decorateInlineCode(view, node, decorations);
          },
        });

        if (settings.pluginSettings.common.enableHtmlCodeBlocks) {
          for (const node of findHtmlInlineCodesInRange(view.state, from, to)) {
            if (node.from >= node.to || decoratedHtmlInlineCodes.has(node.from)) {
              continue;
            }
            decoratedHtmlInlineCodes.add(node.from);

            decorations.push(Decoration.mark({ class: "codeblock-customizer-inline-code-wrapper codeblock-customizer-html-inline-code" }).range(node.from, node.to));
            const { codeFrom, hasIcon } = decorateInlineCode(view, node, decorations, node.parameters, true);
            // the content of the HTML element is not formatted as code by Obsidian. Only the visible code, so the icon (which replaces the prefix) is next to it, as for backticks
            if (codeFrom < node.to) {
              decorations.push(Decoration.mark({ class: `cm-inline-code${hasIcon ? ' codeblock-customizer-html-inline-code-after-icon' : ''}` }).range(codeFrom, node.to));
            }
          }
        }
      }
      return RangeSet.of(decorations, true);
    }
  }, {
    decorations: v => v.decorations,
    eventHandlers: {
      // use mousedown instead of click (#185)
      mousedown: (event, view) => {
        if (!settings.pluginSettings.inlineCode.enableCopyOnClick || event.button !== 0)
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

        if (wrapper.classList.contains('codeblock-customizer-html-inline-code')) {
          const line = view.state.doc.lineAt(pos);
          const node = findHtmlInlineCodesInRange(view.state, line.from, line.to).find(n => pos >= n.from && pos <= n.to);
          if (node) {
            void addTextToClipboard(getInlineCodeToCopy(view.state.sliceDoc(node.from, node.to), true));
          }
          return true;
        }

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

              void addTextToClipboard(getInlineCodeToCopy(text));
              found = true;

              return false;
            }
          }
        });

        // return true to prevent CodeMirror from moving the cursor (#185)
        return true;
      }
    }
  });// inlineCodeViewPlugin

  const htmlInlineCodeWidgetPlugin = ViewPlugin.fromClass(class {
    private observer: MutationObserver;
    private frame: number | null = null;
    private settingsChanged = false;

    constructor(private view: EditorView) {
      this.observer = new MutationObserver((mutations) => {
        if (!settings.pluginSettings.common.enableHtmlCodeBlocks) {
          return;
        }
        if (mutations.some(mutation => Array.from(mutation.addedNodes).some(isOrContainsCode))) {
          this.styleWidgets();
        } else if (mutations.some(mutation =>
          mutation.type === 'attributes' &&
          mutation.target.instanceOf(HTMLElement) &&
          mutation.target.tagName === 'CODE' &&
          (mutation.attributeName === 'data-cbc' || !mutation.target.classList.contains('codeblock-customizer-inline-code'))
        )) {
          this.scheduleStyling();
        }
      });
      this.observer.observe(view.contentDOM, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-cbc'] });
    }

    update(update: ViewUpdate) {
      if (plugin.settingsUpdated) {
        this.settingsChanged = true;
      }
      if (settings.pluginSettings.common.enableHtmlCodeBlocks && (update.docChanged || update.viewportChanged || update.selectionSet || plugin.settingsUpdated)) {
        this.scheduleStyling();
      }
    }

    private scheduleStyling() {
      if (this.frame !== null) {
        return;
      }

      this.frame = window.requestAnimationFrame(() => {
        this.frame = null;
        const force = this.settingsChanged;
        this.settingsChanged = false;
        this.styleWidgets(force);
      });
    }

    private styleWidgets(force = false) {
      const state = this.view.state;
      if (!settings.pluginSettings.common.enableHtmlCodeBlocks || isSourceMode(state)) {
        return;
      }

      const sourcePath = state.field(editorInfoField, false)?.file?.path ?? "";
      const context = { sourcePath, docId: "", frontmatter: undefined, addChild: () => { }, getSectionInfo: () => null } as unknown as MarkdownPostProcessorContext;

      for (const codeElement of Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>('code'))) {
        if (codeElement.closest('pre')) {
          continue;
        }

        const sourceCode = this.getSourceCode(codeElement);
        if (!sourceCode) {
          continue;
        }

        const paramsChanged = codeElement.dataset.cbcParams !== undefined && codeElement.dataset.cbcParams !== sourceCode.parameters;
        if (!force && !paramsChanged && (codeElement.dataset.cbcProcessed || codeElement.classList.contains('codeblock-customizer-inline-code'))) {
          continue;
        }

        if ((force || paramsChanged) && (codeElement.dataset.cbcProcessed || codeElement.classList.contains('codeblock-customizer-inline-code'))) {
          delete codeElement.dataset.cbcProcessed;
          for (const cls of Array.from(codeElement.classList)) {
            if (cls === 'codeblock-customizer-inline-code' || cls.startsWith('codeblock-customizer-inline-code-highlighted')) {
              codeElement.classList.remove(cls);
            }
          }
          codeElement.textContent = decodeHtmlEntities(state.sliceDoc(sourceCode.from, sourceCode.to));
        }

        codeElement.dataset.cbcParams = sourceCode.parameters;
        new InlineCodeRenderer(codeElement, plugin, context, sourceCode.parameters).load();
      }
    }// styleWidgets

    private getSourceCode(codeElement: HTMLElement): { from: number, to: number, tagTo: number, parameters: string } | null {
      let pos: number;
      try {
        pos = this.view.posAtDOM(codeElement);
      } catch {
        return null;
      }

      const line = this.view.state.doc.lineAt(pos);
      const widget = getWidgetRoot(codeElement);
      const index = widget ? Array.from(widget.querySelectorAll('code')).indexOf(codeElement) : 0;
      const allInLine = findHtmlInlineCodesInRange(this.view.state, line.from, line.to);
      const gtPos = allInLine.filter(code => code.tagTo > pos);
      const sourceCodes = gtPos.length > 0 ? gtPos : allInLine.filter(code => code.tagTo >= pos);

      return sourceCodes[index] ?? null;
    }// getSourceCode

    destroy() {
      this.observer.disconnect();
      if (this.frame !== null) {
        window.cancelAnimationFrame(this.frame);
      }
    }
  });// htmlInlineCodeWidgetPlugin

  function isOrContainsCode(node: Node): boolean {
    return node.instanceOf(HTMLElement) && (node.tagName === 'CODE' || node.querySelector('code') !== null);
  }// isOrContainsCode

  function getWidgetRoot(element: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = element;
    while (current && current.parentElement && !current.parentElement.classList.contains('cm-line')) {
      current = current.parentElement;
    }
    return current?.parentElement ? current : null;
  }// getWidgetRoot

  function getInlineCodeToCopy(text: string, isHtml = false): string {
    const match = text.match(INLINE_CODE_LANG_REGEX);
    // fix for #147
    const isValidMatch = match && match[1] && !match[1].trim().startsWith('{');
    const code = isValidMatch && match[2] ? match[2] : text;

    return isHtml ? decodeHtmlEntities(code) : code;
  }// getInlineCodeToCopy

  function findHtmlInlineCodesInRange(state: EditorState, from: number, to: number): { from: number, to: number, tagTo: number, parameters: string }[] {
    const result: { from: number, to: number, tagTo: number, parameters: string }[] = [];
    const htmlCodeBlocks = getHtmlCodeBlocks(state).map(block => getHtmlCodeBlockRange(state, block));
    const tree = syntaxTree(state);

    for (let lineNumber = state.doc.lineAt(from).number; lineNumber <= state.doc.lineAt(to).number; lineNumber++) {
      const line = state.doc.line(lineNumber);
      if (!line.text.includes('<') || htmlCodeBlocks.some(range => line.from >= range.from && line.from <= range.to)) {
        continue;
      }

      for (const code of findHtmlInlineCodes(line.text)) {
        const nodeName = tree.resolveInner(line.from + code.from, 1).name;
        if (/codeblock|inline-code|math|frontmatter|comment/.test(nodeName)) {
          continue;
        }
        result.push({ from: line.from + code.contentFrom, to: line.from + code.contentTo, tagTo: line.from + code.to, parameters: code.parameters });
      }
    }

    return result;
  }// findHtmlInlineCodesInRange

  function decorateInlineCode(view: EditorView, node: { from: number, to: number }, decorations: Array<Range<Decoration>>, attributeParameters = '', isHtml = false): { codeFrom: number, hasIcon: boolean } {
    const selection = view.state.selection.main;
    const inlineCodeText = view.state.sliceDoc(node.from, node.to);
    let match = inlineCodeText.match(INLINE_CODE_LANG_REGEX);
    if (attributeParameters.length > 0) {
      // fix for #147
      const hasPrefix = match && !match[1].trim().startsWith('{');
      const parameters = combineInlineCodeParameters(hasPrefix ? match![1] : null, attributeParameters);
      match = Object.assign([hasPrefix ? match![0] : inlineCodeText, parameters, hasPrefix ? match![2] : inlineCodeText], { index: 0, input: inlineCodeText }) as RegExpMatchArray;
    }
    // fix for #147
    if (!match || match[1].trim().startsWith('{'))
      return { codeFrom: node.from, hasIcon: false };

    const fullMatchText = match[0];
    const inlineParams = parseInlineCodeHighlightParams(match[1], settings);
    const langName = inlineParams.language ?? '';
    const code = match[2];
    if (!code)
      return { codeFrom: node.from, hasIcon: false };

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

    // HTML inline code is styled with its own classes
    const iconClass = isHtml ? 'codeblock-customizer-html-inline-code-icon' : null;
    let hasIcon = false;

    const addPrefixDecoration = (hideAlways: boolean): boolean => {
      // no prefix (language and parameters are in the attributes of the HTML element) ==> only the icon
      if (prefixLength === 0) {
        const displayLanguage = getDisplayLanguageName(langName);
        if (langName && !isCursorInside && getLanguageIcon(displayLanguage)) {
          decorations.push(Decoration.widget({ widget: new inlineCodeIconWidget(displayLanguage, highlightClassForIcon, iconClass), side: -1 }).range(node.from));
          hasIcon = true;
        }
        return false;
      }

      if (isCursorInside || isCursorNextToBacktick) {
        decorations.push(Decoration.mark({ class: "codeblock-customizer-inline-code-langauge" }).range(node.from, codeStartPos));
      } else if (langName) {
        const displayLanguage = getDisplayLanguageName(langName);
        const Icon = getLanguageIcon(displayLanguage);
        if (Icon) {
          decorations.push(Decoration.replace({ widget: new inlineCodeIconWidget(displayLanguage, highlightClassForIcon, iconClass) }).range(node.from, codeStartPos));
          hasIcon = true;
        } else {
          decorations.push(Decoration.replace({}).range(node.from, codeStartPos));
        }
        return true;
      } else if (hideAlways || inlineParams.backgroundColorClass !== null || inlineParams.textHighlight.words.length > 0 || inlineParams.textHighlight.textBetween.length > 0 || inlineParams.alternativeTextHighlights.length > 0) {
        decorations.push(Decoration.replace({}).range(node.from, codeStartPos));
        return true;
      }
      return false;
    };

    if (!settings.pluginSettings.inlineCode.enableSyntaxHighlight || settings.pluginSettings.common.disableEditorSyntaxHighlight) {
      const prefixHidden = addPrefixDecoration(false);
      addTextHighlightDecorations(code, codeStartPos, inlineParams, decorations);
      return { codeFrom: prefixHidden ? codeStartPos : node.from, hasIcon };
    }

    // syntax highlighting
    const prefixHidden = addPrefixDecoration(true);

    const prism = settings.pluginSettings.codeblock.usePrismHighlight ? getPrismInstance() : null;
    const tokenRanges = (prism && langName) ? getTokenRangesFromPrismHighlighedtHTML(code, langName) : null;
    if (tokenRanges) {
      decorations.push(Decoration.mark({ class: `cbc-prism-inline codeblock-customizer-language-${langName.toLowerCase()}` }).range(node.from, node.to));

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
    return { codeFrom: prefixHidden ? codeStartPos : node.from, hasIcon };
  }// decorateInlineCode

  class inlineCodeIconWidget extends WidgetType {
    constructor(readonly displayLanguage: string, readonly highlightClass: string | null = null, readonly extraClass: string | null = null) {
      super();
    }

    eq(other: inlineCodeIconWidget) {
      return other.displayLanguage === this.displayLanguage && other.highlightClass === this.highlightClass && other.extraClass === this.extraClass;
    }

    toDOM() {
      const container = getInlineCodeIcon(this.displayLanguage, `cm-inline-code`);
      if (this.highlightClass) {
        container.classList.add(this.highlightClass);
      }
      if (this.extraClass) {
        container.classList.add(this.extraClass);
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

    type CM5WithFindMode = typeof window.CodeMirror & {
      findModeByName: (name: string) => { mime?: string } | undefined;
    };
    const mode = window.CodeMirror.getMode(window.CodeMirror.defaults, (window.CodeMirror as CM5WithFindMode).findModeByName(modeSpec)?.mime as string);
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

  return { inlineCodeViewPlugin, htmlInlineCodeWidgetPlugin };
}// inlineCodeExtension
