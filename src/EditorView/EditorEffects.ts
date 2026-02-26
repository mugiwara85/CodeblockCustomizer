import { StateEffect, Annotation, Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";

export const FoldingState = {
  Unfolded: 'unfolded',
  FullyFolded: 'fully-folded',
  SemiFolded: 'semi-folded',
} as const;
export type FoldingState = (typeof FoldingState)[keyof typeof FoldingState];

export const FoldCommand = {
  Default: 0,
  FoldAll: 1,
  UnfoldAll: 2,
} as const;
export type FoldCommand = (typeof FoldCommand)[keyof typeof FoldCommand];

/* annotations, effects */

export const setFoldCommandState = StateEffect.define<FoldCommand>();
export const setFoldState = Annotation.define<{ docPath: string; startPos: number; state: FoldingState | null }>();
export const setGroupTab = Annotation.define<{ group: string; startPos: number }>();
export const CollapsedDecoration = Decoration.replace({ block: true, attributes: { "code-folded": "true" } });
export const Collapse = StateEffect.define<Range<Decoration>>();
export const UnCollapse = StateEffect.define<{ filter: (from: number, to: number) => boolean; filterFrom: number; filterTo: number }>();
export const semiCollapse = StateEffect.define<Range<Decoration>>();
export const semiUnCollapse = StateEffect.define<{ filterFrom: number, filterTo: number }>();
export const semiFade = StateEffect.define<Range<Decoration>>();
export const semiUnFade = StateEffect.define<{ filterFrom: number; filterTo: number }>();
export const unhideEffect = StateEffect.define<{ from: number; to: number }>();
export const rehideEffect = StateEffect.define<{ from: number; to: number }>();

export type CollapseEffect = Range<Decoration>;
export type UncollapseEffect = { filter: (from: number, to: number) => boolean; filterFrom: number; filterTo: number };
export type SemiUncollapseEffect = { filterFrom: number; filterTo: number };

export type CodeBlockFoldEffect =
  | StateEffect<CollapseEffect>
  | StateEffect<UncollapseEffect>
  | StateEffect<SemiUncollapseEffect>;
