# expand edit-mode fix (issue #161)

## Behavior (preview43+)

With **Readable line length** ON, live preview:

| Mode | Block width | Text | Narrow pane |
|---|---|---|---|
| Wrapped | Same as a normal column code block (left-aligned) | `pre-wrap` | Soft-wraps in column |
| Unwrapped | Hugs longest line (per-block via `--cbc-min-scroll-width`) | `pre` | `.cm-scroller` horizontal scroll; buttons clamped into view |

Reading mode expand is unchanged (separate `setupExpandObserver`). Callouts/admonitions are skipped (same as reading mode). Layout clears when RLL is off (expand CSS is RLL-scoped; no dead scroll zone).

## Architecture

1. **State on `.markdown-source-view`** - `cbc-expand-ready`, `cbc-expand-has-nowrap`, `--cbc-expand-margin-left`. Never put layout state on `.cm-line` (CM rebuilds wipe it).
2. **Selector** - `.markdown-source-view.is-readable-line-width` (class is on the source view itself).
3. **Obsidian cooperation** - override `--content-margin` / `--line-width` / `--max-width` instead of fighting `margin-inline: var(--content-margin) !important`.
4. **Per-block unwrapped width** - from Wrapping.ts `--cbc-min-scroll-width: Nch` on nowrap lines; rebuilt on `docChanged` so typing updates hug width.
5. **Headers** - both `header-container` and `header-container-specific`; clamp prefers header buttons (begin-line buttons are `display:none` with specific headers).
6. **Button clamp** - absolute `right` inset only (never `left` - shrink-to-fit crushed "Plain text").
7. **Clear on fail** - source mode, RLL off, narrow pane, measure failure, and no main-column expands all call `clearExpandLayout`.
8. **Column anchor** - prefers a normal codeblock outside callouts/admonitions.

## Files

- `src/EditorView/Expand.ts` - measure margin, ready class, header sync, button clamp
- `src/css/code-block.scss` - edit-mode expand rules
- `src/EditorView/Wrapping.ts` - skip `ScrollbarWidget` for expand; rebuild nowrap width on edit

## Dead ends (do not resurrect)

| Approach | Failure |
|---|---|
| ResizeObserver + inline width on every line | Flashing (180+ style writes) |
| Widen entire `.cm-content` | Full-pane stretch |
| `--cbc-expand-width` px + large margin | Margin+width > container → auto-center |
| Per-line `.cbc-expand-positioned` | CM wipes class |
| Direct `margin-left !important` vs Obsidian | Loses to `--content-margin !important` |
| Descendant `.is-readable-line-width .markdown-source-view` | Never matches (class is on source view) |
| Clamp via absolute `left` | Shrink-to-fit caps width; "Plain text" wraps vertically |

## Known limits

- Unwrapped expand uses pane-level scroll (no sticky per-line gutters like normal nowrap)
- RTL not specially tested
- `ch`-based width under-counts tabs vs display width
- Button clamp uses absolute `right` while scrolling horizontally

## Test

1. Readable line length ON, live preview, quit/reopen Obsidian after deploy
2. Normal block vs wrapped expand - same width and left edge
3. Unwrap - block hugs long line; wrap - returns to column
4. Narrow the pane while unwrapped - text scrolls via editor; Plain text / wrap stay visible
5. Note with only expand blocks; note with two expand blocks (one wrap, one unwrap)
6. Toggle live preview ↔ source; layout should clear in source when plugin source-mode is off
7. Titled expand (`title:...`) - header width matches body; header buttons clamp when narrow
8. Callout with a normal fence above main-column expand - expand stays on readable column
9. Unwrap then type a longer line - block width grows without wrap toggle
