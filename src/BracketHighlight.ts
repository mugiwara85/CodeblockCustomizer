import { EditorView, ViewUpdate, ViewPlugin, DecorationSet, Decoration } from "@codemirror/view";
import { Range, RangeSet  } from "@codemirror/state";

import CodeBlockCustomizerPlugin from "./main";
import { isExcluded } from "./Utils";

export function bracketHighlight(plugin: CodeBlockCustomizerPlugin) {
  const viewPlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      plugin: CodeBlockCustomizerPlugin;

      constructor(view: EditorView) {
        this.plugin = plugin;
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView): DecorationSet {
        const decorations: Array<Range<Decoration>> = [];
        const brackets: { [key: string]: string } = {
          '(': ')',
          '[': ']',
          '{': '}',
          ')': '(',
          ']': '[',
          '}': '{'
        };

        const cursorPos = view.state.selection.main.head;
        const codeBlockInfo = getCodeBlockText(view, cursorPos, this.plugin);

        if (!codeBlockInfo) {
          return Decoration.none;
        }

        const { text, start: codeBlockStart } = codeBlockInfo;
        const relativePos = cursorPos - codeBlockStart;

        const findMatchingBracket = (startPos: number, direction: 1 | -1, bracket: string) => {
          let depth = 0;
          const matchingBracket = brackets[bracket];
          let pos = startPos;

          while (direction === 1 ? pos < text.length : pos >= 0) {
            const char = text.charAt(pos);
            if (char === bracket) {
              depth++;
            } else if (char === matchingBracket) {
              depth--;
            }
            if (depth === 0) {
              return pos;
            }
            pos += direction;
          }
          return null;
        };// findMatchingBracket

        let highlightedBracket = false;

        const highlightBrackets = (charPos: number, char: string) => {
          if (highlightedBracket && brackets[char] !== undefined) {
            return;
          }
          highlightedBracket = brackets[char] !== undefined;

          const direction = ['(', '[', '{'].includes(char) ? 1 : -1;
          const matchingPos = findMatchingBracket(charPos, direction, char);
          if (matchingPos !== null) {
            decorations.push(Decoration.mark({ class: "codeblock-customizer-bracket-highlight" }).range(codeBlockStart + charPos, codeBlockStart + charPos + 1));
            decorations.push(Decoration.mark({ class: "codeblock-customizer-bracket-highlight" }).range(codeBlockStart + matchingPos, codeBlockStart + matchingPos + 1));
          }
        };// highlightBrackets

        const char = text.charAt(relativePos);
        if (brackets[char] !== undefined) {
          highlightBrackets(relativePos, char);
        }
        if (relativePos - 1 >= 0 && relativePos - 1 < text.length) {
          const charBefore = text.charAt(relativePos - 1);
          if (brackets[charBefore] !== undefined) {
            highlightBrackets(relativePos - 1, charBefore);
          }
        }

        return RangeSet.of(decorations, true);
      }// buildDecorations

      destroy() {}
    },
    {
      decorations: value => value.decorations,
    }
  );

  // @ts-ignore
  viewPlugin.name = "bracketHighlight";
  return viewPlugin;
}

function getCodeBlockText(view: EditorView, pos: number, plugin: CodeBlockCustomizerPlugin) {
  const currentFile = plugin.app.workspace.activeEditor?.file?.path;
  if (!currentFile) 
    return null;

  const file = plugin.app.vault.getAbstractFileByPath(currentFile);
  if (!file) {
    console.error(`File not found: ${currentFile}`);
    return null;
  }

  const cache = plugin.app.metadataCache.getCache(currentFile);
  if (cache?.sections) {
    const currentLineNumber = view.state.doc.lineAt(pos).number;

    for (const section of cache.sections) {
      if (section.type === "code" || section.type === "list") {
        const startLine = section.position.start.line + 1; // MetadataCache uses 0-based line numbers, CodeMirror uses 1-based
        const endLine = section.position.end.line + 1;

        if (currentLineNumber >= startLine && currentLineNumber <= endLine) {
          const startPos = view.state.doc.line(startLine).from;
          const endPos = view.state.doc.line(endLine).to;
          const sectionText = view.state.doc.sliceString(startPos, endPos);

          if (section.type === "code") {
            const firstLine = sectionText.split('\n')[0];
            const bExclude = isExcluded(firstLine, plugin.settings.ExcludeLangs);
            if (bExclude)
              return null;

            return { text: sectionText, start: startPos, end: endPos };
          }

          if (section.type === "list") {
            const codeBlockInfo = findCodeBlockInList(sectionText, pos - startPos, startPos);
            if (codeBlockInfo) {
              const firstLine = codeBlockInfo.text.split('\n')[0];
              const bExclude = isExcluded(firstLine, plugin.settings.ExcludeLangs);
              if (bExclude)
                return null;

              return codeBlockInfo;
            }
          }
        }
      }
    }
  } else {
    console.error(`Metadata cache not found for file: ${currentFile}`);
    return null;
  }
  return null;
}// getCodeBlockText

function findCodeBlockInList(text: string, relativePos: number, startPos: number) {
  const codeBlockRegex = /```(?:[\s\S]*?)```/g;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const matchStart = match.index;
    const matchEnd = codeBlockRegex.lastIndex;

    if (relativePos >= matchStart && relativePos <= matchEnd) {
      return { text: text.slice(matchStart, matchEnd), start: matchStart + startPos, end: matchEnd + startPos };
    }
  }

  return null;
}// findCodeBlockInList