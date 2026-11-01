import { EditorView, Decoration, WidgetType, DecorationSet, ViewPlugin } from "@codemirror/view";
import { Range, StateField, RangeSet, Text, EditorState } from "@codemirror/state";

import { wrapEffect } from "./EditorEffects";
import { CodeBlockPositions } from "./CodeBlockPositions";
import { CodeblockCustomizerSettings } from "../Settings";
import { isSourceMode } from "../Utils";

export function wrapExtension(codeBlockPositionsField: StateField<CodeBlockPositions[]>, settings: CodeblockCustomizerSettings) {

  const wrappingField = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state, state.field(unwrappedCodeBlocksField), codeBlockPositionsField);
    },
    update(value, tr) {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(tr.state)) {
        return Decoration.none;
      }

      const unwrapped = tr.state.field(unwrappedCodeBlocksField);
      if (tr.docChanged || tr.reconfigured ||
          unwrapped !== tr.startState.field(unwrappedCodeBlocksField) ||
          tr.state.field(codeBlockPositionsField) !== tr.startState.field(codeBlockPositionsField)) {
        return buildDecorations(tr.state, unwrapped, codeBlockPositionsField);
      }

      return value;
    },
    provide: f => EditorView.decorations.from(f)
  });// wrappingField

  // Snapshot the effective default in editor state, not a shared mutable closure.
  const defaultUnwrapField = StateField.define<boolean>({
    create: state => settings.pluginSettings.codeblock.unwrapcode &&
      (settings.pluginSettings.common.enableInSourceMode || !isSourceMode(state)),
    update: (_value, tr) => settings.pluginSettings.codeblock.unwrapcode &&
      (settings.pluginSettings.common.enableInSourceMode || !isSourceMode(tr.state))
  });// defaultUnwrapField

  const unwrappedCodeBlocksField = StateField.define<Set<number>>({
    create(state) {
      if (!settings.pluginSettings.codeblock.unwrapcode ||
          (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(state))) {
        return new Set<number>();
      }
      return new Set((state.field(codeBlockPositionsField, false) ?? [])
        .filter(p => !p.parameters.exclude).map(p => p.codeBlockStartPos));
    },
    update(value, tr) {
      if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(tr.state)) {
        return new Set();
      }

      const positions = tr.state.field(codeBlockPositionsField, false);
      if (tr.state.field(defaultUnwrapField) !== tr.startState.field(defaultUnwrapField)) {
        return new Set(tr.state.field(defaultUnwrapField)
          ? (positions ?? []).filter(p => !p.parameters.exclude).map(p => p.codeBlockStartPos)
          : []);
      }
      let newSet = value;
      let changed = false;

      if (tr.docChanged && positions) {
        const validPositions = new Set(positions.map(p => p.codeBlockStartPos));
        const mappedSet = new Set<number>();
        let setChanged = false;

        for (const pos of value) {
          const mappedPos = tr.changes.mapPos(pos, 1);
          if (mappedPos !== pos) {
            setChanged = true;
          }
          if (validPositions.has(mappedPos)) {
            mappedSet.add(mappedPos);
          } else {
            setChanged = true;
          }
        }

        if (setChanged || mappedSet.size !== value.size) {
          newSet = mappedSet;
          changed = true;
        }
      }

      if (settings.pluginSettings.codeblock.unwrapcode && positions) {
        const previousPositions = new Set((tr.startState.field(codeBlockPositionsField, false) ?? [])
          .filter(p => !p.parameters.exclude).map(p => tr.changes.mapPos(p.codeBlockStartPos, 1)));
        for (const block of positions) {
          if (!block.parameters.exclude && !previousPositions.has(block.codeBlockStartPos)) {
            if (newSet === value) {
              newSet = new Set(value);
            }
            newSet.add(block.codeBlockStartPos);
            changed = true;
          }
        }
      }

      for (const effect of tr.effects) {
        if (effect.is(wrapEffect)) {
          if (newSet === value) {
            newSet = new Set(value);
          }

          if (effect.value.unwrap) {
            newSet.add(effect.value.pos);
          } else {
            newSet.delete(effect.value.pos);
          }

          changed = true;
        }
      }

      return changed ? newSet : value;
    },
    provide: () => defaultUnwrapField
  });// unwrappedCodeBlocksField

  const scrollSyncPlugin = ViewPlugin.define(view => {
    let syncing = false;
    const lineCache = new Map<HTMLElement, HTMLElement[]>();

    function getCachedLines(line: HTMLElement): HTMLElement[] {
      const cached = lineCache.get(line);
      if (cached) {
        return cached;
      }

      const lines = getCodeblockSiblingLines(line);
      for (const l of lines) {
        lineCache.set(l, lines);
      }
      return lines;
    }

    const handler = (e: Event) => {
      const target = e.target as HTMLElement;
      if (syncing) {
        return;
      }

      if (target?.classList?.contains('codeblock-customizer-scrollbar')) {
        syncing = true;
        try {
          const scrollLeft = target.scrollLeft;
          const endLine = target.previousElementSibling as HTMLElement | null;
          if (endLine && isCodeblockLine(endLine)) {
            const lines = getCachedLines(endLine);
            for (const line of lines) {
              syncScrollToLine(line, scrollLeft);
            }
          }
        } finally {
          syncing = false;
        }
        return;
      }

      if (!isCodeblockLine(target)) {
        return;
      }

      syncing = true;
      try {
        const scrollLeft = target.scrollLeft;
        const lines = getCachedLines(target);
        for (const line of lines) {
          if (line !== target) {
            syncScrollToLine(line, scrollLeft);
          }
        }
        const lastLine = lines[lines.length - 1];
        const scrollbarBlock = lastLine?.nextElementSibling as HTMLElement | null;
        if (scrollbarBlock?.classList?.contains('codeblock-customizer-scrollbar')) {
          scrollbarBlock.scrollLeft = scrollLeft;
        }
      } finally {
        syncing = false;
      }
    };

    view.dom.addEventListener('scroll', handler, true);

    return {
      update() {
        lineCache.clear();
      },
      destroy() {
        view.dom.removeEventListener('scroll', handler, true);
      }
    };
  });// scrollSyncPlugin

  return { wrappingField, unwrappedCodeBlocksField, scrollSyncPlugin };
}// wrapExtension

const scrollbarCallbacks = new WeakMap<HTMLElement, () => void>();
const sharedResizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    scrollbarCallbacks.get(entry.target as HTMLElement)?.();
  }
});

class ScrollbarWidget extends WidgetType {
  constructor(private maxChars: number) {
    super();
  }

  eq(other: ScrollbarWidget) {
    return this.maxChars === other.maxChars;
  }

  ignoreEvent() {
    return true;
  }

  toDOM(): HTMLElement {
    const wrapper = createDiv({ cls: `codeblock-customizer-scrollbar` });
    const spacer = createSpan({ cls: `codeblock-customizer-scrollbar-spacer`, });
    spacer.style.width = this.maxChars + 'ch';

    wrapper.appendChild(spacer);

    let initialized = false;
    const updateVisibility = () => {
      if (wrapper.isConnected) {
        const contentLine = findContentLine(wrapper);
        if (contentLine) {
          spacer.style.width = contentLine.scrollWidth + 'px';
        }

        wrapper.style.display = wrapper.scrollWidth > wrapper.clientWidth ? '' : 'none';

        if (!initialized) {
          initialized = true;
          const endLine = wrapper.previousElementSibling as HTMLElement | null;
          if (endLine && isCodeblockLine(endLine)) {
            for (const line of getCodeblockSiblingLines(endLine)) {
              syncScrollToLine(line, 0);
            }
          }
        }
      }
    };

    scrollbarCallbacks.set(wrapper, updateVisibility);
    sharedResizeObserver.observe(wrapper);
    requestAnimationFrame(updateVisibility);

    return wrapper;
  }

  destroy(dom: HTMLElement) {
    sharedResizeObserver.unobserve(dom);
    scrollbarCallbacks.delete(dom);
  }
}// ScrollbarWidget

function findContentLine(scrollbar: HTMLElement): HTMLElement | null {
  let el = scrollbar.previousElementSibling as HTMLElement | null;
  while (el) {
    if (isCodeblockLine(el) && !el.classList.contains('HyperMD-codeblock-begin') && !el.classList.contains('HyperMD-codeblock-end')) {
      return el;
    }

    if (el.classList.contains('HyperMD-codeblock-begin')) {
      break;
    }

    el = el.previousElementSibling as HTMLElement | null;
  }
  return null;
}// findContentLine

function buildDecorations(state: EditorState, unwrapped: Set<number>, codeBlockPositionsField: StateField<CodeBlockPositions[]>): DecorationSet {
  const positions = state.field(codeBlockPositionsField, false) ?? [];
  const decorations: Range<Decoration>[] = [];
  for (const { codeBlockStartPos, codeBlockEndPos, parameters } of positions) {
    if (parameters.exclude || !unwrapped.has(codeBlockStartPos)) {
      continue;
    }

    const maxLength = getMaxLineLength(state.doc, codeBlockStartPos, codeBlockEndPos);

    const firstLine = state.doc.lineAt(codeBlockStartPos).number;
    const lastLine = state.doc.lineAt(codeBlockEndPos).number;
    const nowrapDecoration = Decoration.line({
      attributes: {
        class: "codeblock-customizer-nowrap",
        style: `--cbc-min-scroll-width: ${maxLength}ch;`
      }
    });

    for (let i = firstLine; i <= lastLine; i++) {
      decorations.push(nowrapDecoration.range(state.doc.line(i).from));
    }

    decorations.push(Decoration.widget({ widget: new ScrollbarWidget(maxLength), block: true, side: 1 }).range(codeBlockEndPos));
  }

  return RangeSet.of(decorations, true);
}// buildDecorations

function syncScrollToLine(line: HTMLElement, scrollLeft: number) {
  if (line.classList.contains('HyperMD-codeblock-begin')) {
    line.style.setProperty('--cbc-fence-scroll', `-${scrollLeft}px`);
  } else {
    line.scrollLeft = scrollLeft;
  }
}// syncScrollToLine

function isCodeblockLine(el: HTMLElement | null): boolean {
  return el?.classList?.contains('HyperMD-codeblock') ?? false;
}// isCodeblockLine

function getCodeblockSiblingLines(line: HTMLElement): HTMLElement[] {
  const before: HTMLElement[] = [];
  let el = line.previousElementSibling as HTMLElement | null;
  while (el) {
    if (isCodeblockLine(el)) {
      if (el.classList.contains('HyperMD-codeblock-end')) {
        break;
      }

      before.push(el);

      if (el.classList.contains('HyperMD-codeblock-begin')) {
        break;
      }
    }
    el = el.previousElementSibling as HTMLElement | null;
  }
  
  before.reverse();

  const lines: HTMLElement[] = [...before, line];
  el = line.nextElementSibling as HTMLElement | null;
  while (el) {
    if (isCodeblockLine(el)) {
      if (el.classList.contains('HyperMD-codeblock-begin')) {
        break;
      }

      lines.push(el);

      if (el.classList.contains('HyperMD-codeblock-end')) {
        break;
      }
    }
    el = el.nextElementSibling as HTMLElement | null;
  }

  return lines;
}// getCodeblockSiblingLines

function getMaxLineLength(doc: Text, startPos: number, endPos: number): number {
  const firstLine = doc.lineAt(startPos).number;
  const lastLine = doc.lineAt(endPos).number;
  let maxLength = 0;

  for (let i = firstLine; i <= lastLine; i++) {
    maxLength = Math.max(maxLength, doc.line(i).length);
  }

  return maxLength;
}// getMaxLineLength
