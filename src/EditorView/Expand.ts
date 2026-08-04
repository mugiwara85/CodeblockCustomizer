import { EditorView, ViewPlugin } from "@codemirror/view";
import { Extension, StateField } from "@codemirror/state";
import { CodeblockCustomizerSettings } from "../Settings";
import { isSourceMode } from "../Utils";
import { wrapEffect } from "./EditorEffects";
import { CodeBlockPositions } from "./CodeBlockPositions";

const MIN_EXPAND_WIDTH = 50;
const MIN_READABLE_MARGIN = 8;
const READY_CLASS = "cbc-expand-ready";
const SCROLL_CLAMP_MS = 50;
const HEADER_SELECTOR =
  ".codeblock-customizer-header-container, .codeblock-customizer-header-container-specific";

/**
 * Edit-mode expand layout (issue #161).
 *
 * State lives on `.markdown-source-view` (`cbc-expand-ready` + CSS vars).
 * Do not put layout state on `.cm-line` - CodeMirror rebuilds those and wipes them.
 *
 * Cooperates with Obsidian readable-line-width via `--content-margin` /
 * `--line-width` / `--max-width` overrides.
 *
 * Wrapped: same column width as a normal code block (left-aligned via margin).
 * Unwrapped: hug content using `--cbc-min-scroll-width` from Wrapping.ts
 * (per-block); `.cm-scroller` scrolls when content exceeds the pane.
 */

function computeMarginFromFileLineWidth(content: HTMLElement, contentWidth: number): number {
  const raw = getComputedStyle(content).getPropertyValue("--file-line-width").trim();
  const fileLineWidth = parseFloat(raw);

  if (!Number.isFinite(fileLineWidth) || fileLineWidth < MIN_EXPAND_WIDTH) {
    return 0;
  }

  return Math.max(0, (contentWidth - fileLineWidth) / 2);
}

function isInSkippedContainer(el: HTMLElement): boolean {
  return !!el.closest(".callout, .admonition");
}

function findColumnAnchor(content: HTMLElement): HTMLElement | null {
  const begins = Array.from(
    content.querySelectorAll(".HyperMD-codeblock-begin:not(.codeblock-customizer-expand)")
  ) as HTMLElement[];

  for (const el of begins) {
    if (!isInSkippedContainer(el) && el.getBoundingClientRect().width >= 1) {
      return el;
    }
  }

  const lines = Array.from(
    content.querySelectorAll(
      ".cm-line:not(.codeblock-customizer-expand)"
      + ":not(.codeblock-customizer-header-container)"
      + ":not(.codeblock-customizer-header-container-specific)"
    )
  ) as HTMLElement[];

  for (const el of lines) {
    if (!isInSkippedContainer(el) && el.getBoundingClientRect().width >= 1) {
      return el;
    }
  }

  return null;
}

function measureMarginLeft(sourceView: HTMLElement): number | null {
  const content = sourceView.querySelector(".cm-content") as HTMLElement | null;
  const contentRect = content?.getBoundingClientRect();

  if (!content || !contentRect || contentRect.width < 1) {
    return null;
  }

  const anchor = findColumnAnchor(content);
  let marginLeft: number;

  if (anchor) {
    marginLeft = anchor.getBoundingClientRect().left - contentRect.left;
  } else {
    marginLeft = computeMarginFromFileLineWidth(content, contentRect.width);
  }

  const readable = sourceView.classList.contains("is-readable-line-width");

  if (readable && marginLeft < MIN_READABLE_MARGIN) {
    const fallback = computeMarginFromFileLineWidth(content, contentRect.width);
    if (fallback >= MIN_READABLE_MARGIN) {
      marginLeft = fallback;
    } else if (marginLeft < 0) {
      return null;
    }
  }

  if (contentRect.width - marginLeft < MIN_EXPAND_WIDTH) {
    return null;
  }

  return marginLeft;
}

function findExpandBeginLines(sourceView: HTMLElement): HTMLElement[] {
  return Array.from(
    sourceView.querySelectorAll(".HyperMD-codeblock-begin.codeblock-customizer-expand")
  ).filter(el => !isInSkippedContainer(el as HTMLElement)) as HTMLElement[];
}

function getHeaderForBegin(beginLine: HTMLElement): HTMLElement | null {
  const prev = beginLine.previousElementSibling as HTMLElement | null;
  if (
    prev?.classList.contains("codeblock-customizer-header-container")
    || prev?.classList.contains("codeblock-customizer-header-container-specific")
  ) {
    return prev;
  }
  return null;
}

function isVisibleButton(el: HTMLElement | null): el is HTMLElement {
  if (!el) {
    return false;
  }

  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  // Non-specific headers can leave an empty header button container at 0×0 while
  // the real controls live on the begin line.
  const rect = el.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1;
}

function getExpandButton(begin: HTMLElement): HTMLElement | null {
  const header = getHeaderForBegin(begin);
  const headerBtn = header?.querySelector(
    ".codeblock-customizer-header-button-container"
  ) as HTMLElement | null;
  const beginBtn = begin.querySelector(
    ".codeblock-customizer-button-container"
  ) as HTMLElement | null;

  // Prefer whichever control cluster is actually visible. With -specific headers the
  // begin-line container is display:none; with normal headers the header button box
  // can be 0×0 while begin-line buttons are shown.
  if (isVisibleButton(headerBtn)) {
    return headerBtn;
  }

  if (isVisibleButton(beginBtn)) {
    return beginBtn;
  }

  return beginBtn ?? headerBtn;
}

function syncExpandHeaders(sourceView: HTMLElement, marginLeft: number): void {
  const marginPx = `${marginLeft}px`;

  for (const begin of findExpandBeginLines(sourceView)) {
    const header = getHeaderForBegin(begin);
    if (!header) {
      continue;
    }

    header.style.setProperty("--content-margin", `${marginPx} 0`);

    const unwrapped = begin.classList.contains("codeblock-customizer-nowrap");
    if (unwrapped) {
      const width = Math.max(MIN_EXPAND_WIDTH, Math.round(begin.getBoundingClientRect().width));
      header.style.setProperty("--line-width", `${width}px`);
      header.style.setProperty("--max-width", "none");
    } else {
      header.style.removeProperty("--line-width");
      header.style.removeProperty("--max-width");
    }
  }
}

function clearExpandHeaders(sourceView: HTMLElement): void {
  for (const header of Array.from(
    sourceView.querySelectorAll(HEADER_SELECTOR)
  ) as HTMLElement[]) {
    if (!header.classList.contains("codeblock-customizer-expand")) {
      continue;
    }

    header.style.removeProperty("--content-margin");
    header.style.removeProperty("--line-width");
    header.style.removeProperty("--max-width");
  }
}

function clampExpandButtons(sourceView: HTMLElement): void {
  const scroller = sourceView.querySelector(".cm-scroller") as HTMLElement | null;
  if (!scroller) {
    return;
  }

  const scrollerRect = scroller.getBoundingClientRect();
  // Use right inset only - setting left triggers absolute shrink-to-fit and crushes
  // "Plain text" / wrap controls into a few dozen pixels.
  const begins = findExpandBeginLines(sourceView);

  for (const begin of begins) {
    const btn = getExpandButton(begin);
    if (!btn) {
      continue;
    }

    // Host must be the positioned ancestor that actually owns the button width.
    // Prefer begin line when clamping begin buttons so header 0-width widgets
    // do not become the containing block for inset math.
    const headerHost = btn.closest(HEADER_SELECTOR) as HTMLElement | null;
    const host = (headerHost && headerHost.getBoundingClientRect().width > 1)
      ? headerHost
      : begin;
    const hostRect = host.getBoundingClientRect();

    btn.style.removeProperty("left");
    btn.style.position = "absolute";
    btn.style.top = btn.classList.contains("codeblock-customizer-header-button-container") ? "0" : "6px";
    btn.style.zIndex = "50";

    // Visible viewport of the scroller (ignore host overflow past the pane)
    const visibleRight = scrollerRect.right - 6;
    const visibleLeft = scrollerRect.left + 6;
    const btnWidth = Math.max(btn.scrollWidth, btn.offsetWidth, 100);

    // Default: pin to host's right edge (same as CSS right: 6px)
    let rightInset = 6;

    if (hostRect.right - 6 > visibleRight + 1) {
      // Host extends past the pane - pull controls into the visible scroller
      const desiredLeft = Math.min(
        Math.max(visibleLeft, visibleRight - btnWidth),
        hostRect.right - btnWidth - 6
      );
      rightInset = Math.max(6, hostRect.right - (desiredLeft + btnWidth));
    }

    btn.style.right = `${rightInset}px`;
  }
}

function clearExpandButtonClamp(sourceView: HTMLElement): void {
  const buttons = sourceView.querySelectorAll(
    ".HyperMD-codeblock-begin.codeblock-customizer-expand .codeblock-customizer-button-container, "
    + `${HEADER_SELECTOR}.codeblock-customizer-expand .codeblock-customizer-header-button-container`
  );

  for (const btn of Array.from(buttons) as HTMLElement[]) {
    btn.style.removeProperty("left");
    btn.style.removeProperty("right");
    btn.style.removeProperty("top");
    btn.style.removeProperty("position");
    btn.style.removeProperty("z-index");
  }
}

function clearExpandLayout(sourceView: HTMLElement): void {
  sourceView.classList.remove(READY_CLASS);
  sourceView.classList.remove("cbc-expand-has-nowrap");
  sourceView.style.removeProperty("--cbc-expand-margin-left");
  clearExpandButtonClamp(sourceView);
  clearExpandHeaders(sourceView);
}

function applyExpandLayout(sourceView: HTMLElement, marginLeft: number, hasNowrap: boolean): void {
  sourceView.style.setProperty("--cbc-expand-margin-left", `${marginLeft}px`);
  sourceView.classList.toggle("cbc-expand-has-nowrap", hasNowrap);
  sourceView.classList.add(READY_CLASS);
}

function layoutExpandBlocks(
  view: EditorView,
  settings: CodeblockCustomizerSettings,
  last: { margin: number; hasNowrap: boolean },
  scheduleFollowUp?: () => void
): void {
  const sourceView = view.dom.closest(".markdown-source-view") as HTMLElement | null;
  if (!sourceView) {
    return;
  }

  if (!settings.pluginSettings.common.enableInSourceMode && isSourceMode(view.state)) {
    clearExpandLayout(sourceView);
    last.margin = -1;
    last.hasNowrap = false;
    return;
  }

  // Edit-mode expand CSS is RLL-scoped; without it expand is excluded from normal
  // nowrap scroll, so clear rather than leave a dead zone.
  if (!sourceView.classList.contains("is-readable-line-width")) {
    clearExpandLayout(sourceView);
    last.margin = -1;
    last.hasNowrap = false;
    return;
  }

  if (view.dom.offsetWidth < MIN_EXPAND_WIDTH) {
    clearExpandLayout(sourceView);
    last.margin = -1;
    last.hasNowrap = false;
    return;
  }

  const expandBegins = findExpandBeginLines(sourceView);
  if (expandBegins.length === 0) {
    clearExpandLayout(sourceView);
    last.margin = -1;
    last.hasNowrap = false;
    return;
  }

  const marginLeft = measureMarginLeft(sourceView);
  if (marginLeft === null) {
    clearExpandLayout(sourceView);
    last.margin = -1;
    last.hasNowrap = false;
    return;
  }

  const hasNowrap = expandBegins.some(begin => begin.classList.contains("codeblock-customizer-nowrap"));
  const unchanged = Math.abs(last.margin - marginLeft) < 1
    && last.hasNowrap === hasNowrap
    && sourceView.classList.contains(READY_CLASS);

  if (!unchanged) {
    applyExpandLayout(sourceView, marginLeft, hasNowrap);
    last.margin = marginLeft;
    last.hasNowrap = hasNowrap;
    // Header width needs a frame after nowrap --line-width CSS applies
    scheduleFollowUp?.();
  }

  syncExpandHeaders(sourceView, marginLeft);
  clampExpandButtons(sourceView);
}

export function expandExtension(
  codeBlockPositionsField: StateField<CodeBlockPositions[]>,
  settings: CodeblockCustomizerSettings
): Extension[] {
  const viewPlugin = ViewPlugin.define(view => {
    const last = { margin: -1, hasNowrap: false };
    let rafId = 0;
    let followUpRafId = 0;
    let retryAttempts = 0;
    let scroller: HTMLElement | null = null;
    let scrollTimer = 0;
    let resizeObserver: ResizeObserver | null = null;

    const onScroll = () => {
      if (scrollTimer !== 0) {
        return;
      }

      scrollTimer = window.setTimeout(() => {
        scrollTimer = 0;
        const sourceView = view.dom.closest(".markdown-source-view") as HTMLElement | null;
        if (sourceView?.classList.contains(READY_CLASS)) {
          syncExpandHeaders(sourceView, last.margin >= 0 ? last.margin : 0);
          clampExpandButtons(sourceView);
        }
      }, SCROLL_CLAMP_MS);
    };

    const bindScroller = () => {
      const next = view.dom.closest(".markdown-source-view")?.querySelector(".cm-scroller") as HTMLElement | null;
      if (next === scroller) {
        return;
      }

      scroller?.removeEventListener("scroll", onScroll);
      resizeObserver?.disconnect();
      scroller = next;
      scroller?.addEventListener("scroll", onScroll, { passive: true });

      if (scroller && typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          last.margin = -1;
          scheduleLayout();
        });
        resizeObserver.observe(scroller);
      }
    };

    const scheduleFollowUp = () => {
      if (followUpRafId !== 0) {
        return;
      }

      followUpRafId = requestAnimationFrame(() => {
        followUpRafId = 0;
        const sourceView = view.dom.closest(".markdown-source-view") as HTMLElement | null;
        if (sourceView?.classList.contains(READY_CLASS) && last.margin >= 0) {
          syncExpandHeaders(sourceView, last.margin);
          clampExpandButtons(sourceView);
        }
      });
    };

    const scheduleLayout = () => {
      if (rafId !== 0) {
        return;
      }

      rafId = requestAnimationFrame(() => {
        rafId = 0;
        bindScroller();
        layoutExpandBlocks(view, settings, last, scheduleFollowUp);

        const sourceView = view.dom.closest(".markdown-source-view") as HTMLElement | null;
        const mainExpands = sourceView ? findExpandBeginLines(sourceView).length : 0;
        const positions = view.state.field(codeBlockPositionsField, false) ?? [];
        const positionsHaveExpand = positions.some(p => p.parameters.expand);

        // Retry while main-column expands exist but layout isn't ready yet.
        // Cap short when positions claim expand but DOM has none (callouts-only / first paint).
        const needsRetry = !!sourceView
          && !sourceView.classList.contains(READY_CLASS)
          && (
            (mainExpands > 0 && retryAttempts < 60)
            || (mainExpands === 0 && positionsHaveExpand && retryAttempts < 10)
          );

        if (needsRetry) {
          retryAttempts++;
          scheduleLayout();
        } else {
          retryAttempts = 0;
        }
      });
    };

    scheduleLayout();

    return {
      update(u) {
        if (u.docChanged || u.geometryChanged) {
          last.margin = -1;
          retryAttempts = 0;
          scheduleLayout();
          return;
        }

        const sourceView = u.view.dom.closest(".markdown-source-view") as HTMLElement | null;
        const positions = u.view.state.field(codeBlockPositionsField, false) ?? [];
        const hasExpand = positions.some(p => p.parameters.expand);

        if (hasExpand && sourceView && !sourceView.classList.contains(READY_CLASS)) {
          scheduleLayout();
          return;
        }

        // RLL may flip without a CM geometry event - re-check each update when ready looks wrong
        if (sourceView?.classList.contains(READY_CLASS)
          && !sourceView.classList.contains("is-readable-line-width")) {
          clearExpandLayout(sourceView);
          last.margin = -1;
          last.hasNowrap = false;
          return;
        }

        if (u.transactions.some(tr => tr.effects.some(effect => effect.is(wrapEffect)))) {
          last.margin = -1;
          last.hasNowrap = false;
          scheduleLayout();
        }
      },
      destroy() {
        if (rafId !== 0) {
          cancelAnimationFrame(rafId);
        }

        if (followUpRafId !== 0) {
          cancelAnimationFrame(followUpRafId);
        }

        if (scrollTimer !== 0) {
          clearTimeout(scrollTimer);
        }

        scroller?.removeEventListener("scroll", onScroll);
        resizeObserver?.disconnect();
        resizeObserver = null;
        scroller = null;

        const sourceView = view.dom.closest(".markdown-source-view") as HTMLElement | null;
        if (sourceView) {
          clearExpandLayout(sourceView);
        }
      }
    };
  });

  return [viewPlugin];
}
