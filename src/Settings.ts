import { DEFAULT_PROMPT_COLOR, PromptDefinition } from "./PromptManager";

export interface Colors {
  codeblock: {
    activeLineColor: string;
    backgroundColor: string;
    highlightColor: string;
    alternateHighlightColors: Record<string, string>;
    languageBorderColors: Record<string, string>;
    textColor: string;
    bracketHighlightColorMatch: string;
    bracketHighlightColorNoMatch: string;
    bracketHighlightBackgroundColorMatch: string;
    bracketHighlightBackgroundColorNoMatch: string;
    selectionMatchHighlightColor: string;
  },
  header: {
    backgroundColor: string;
    textColor: string;
    lineColor: string;
    codeBlockLangTextColor: string;
    codeBlockLangBackgroundColor: string;
  },
  gutter: {
    textColor: string;
    backgroundColor: string;
    activeLineNrColor: string;
  },
  inlineCode: {
    backgroundColor: string;
    textColor: string;
  },
  prompts: {
    promptColors?: Record<string, Record<string, string>>;
    rootPromptColors?: Record<string, Record<string, string>>;
    editedPromptColors: Record<string, Record<string, string>>;
    editedRootPromptColors: Record<string, Record<string, string>>;
  },
  groupedCodeBlocks: {
    activeTabBackgroundColor: string;
    activeTabTextColor: string;
    hoverTabBackgroundColor: string;
    hoverTabTextColor: string;
    headerLineColor: string;
  },
  annotations: {
    colors: Record<string, string>;
  },
  editorActiveLineColor: string;
  languageSpecificColors: Record<string, Record<string, string>>;
}

export interface ThemeColors {
  dark: Colors;
  light: Colors;
}

export enum FoldingScope {
  All = 'all',
  NoFoldSpecified = 'nofoldspecified',
}

export enum FoldingPersistence {
  Permanent = 'permanent',
  Session = 'session',
}

export enum TabPersistence {
  Permanent = 'permanent',
  Session = 'session',
}

export enum InlineCodeModifierKeys {
  CTRL = 'ctrl',
  ALT = 'alt'
}

export enum ButtonModifierKeys {
  CTRL = 'ctrl',
  ALT = 'alt',
  SHIFT = 'shift',
  NONE = 'none',
}

export enum LineNumberSeparatorStyle {
  Zigzag = 'zigzag',
  Dashed = 'dashed',
  DoubleLine = 'double-line',
}

export interface PluginSettings {
  codeblock: {
    enableLineNumbers: boolean;
    enableActiveLineHighlight: boolean;
    codeBlockBorderStylingPosition: string;
    showIndentationLines: boolean;
    enableLinks: boolean;
    enableLinkUpdate: boolean;
    enableBracketHighlight: boolean;
    highlightNonMatchingBrackets: boolean;
    enableSelectionMatching: boolean;
    unwrapcode: boolean;
    hideFenceLines: boolean;
    lineNumberSeparatorStyle: LineNumberSeparatorStyle;
    buttons: {
      alwaysShowButtons: boolean;
      alwaysShowCopyCodeButton: boolean;
      enableSelectCodeButton: boolean;
      enableWrapCodeButton: boolean;
      enableDeleteCodeButton: boolean;
      enableSnapshotButton: boolean;
      snapshotMaxWidth?: number;
      modifierKey: ButtonModifierKeys;
    },
    folding: {
      inverseFold: boolean;
      rememberFoldState: boolean;
      scope: FoldingScope;
      persistence: FoldingPersistence;
      ignoreShortBlocksOnInverseFold: boolean;
    },
  },
  textHighlight: {
    lineSeparator: string;
    textSeparator: string;
  },
  semiFold: {
    enableSemiFold: boolean;
    visibleLines: number;
    showAdditionalUncollapseButon: boolean;
    autoFoldLongCodeblocks: boolean;
    longCodeBlockLines: number;
  },
  header: {
    boldText: boolean;
    italicText: boolean;
    collapseIconPosition: string;
    collapsedCodeText: string;
    codeblockLangBoldText: boolean;
    codeblockLangItalicText: boolean;
    alwaysDisplayCodeblockLang: boolean;
    alwaysDisplayCodeblockIcon: boolean;
    displayCodeBlockLanguage: boolean;
    displayCodeBlockIcon: boolean;
    disableFoldUnlessSpecified: boolean;
  },
  gutter: {
    highlightActiveLineNr: boolean;
    enableHighlight: boolean;
  },
  inlineCode: {
    enableInlineCodeStyling: boolean;
    enableSyntaxHighlight: boolean;
    showIcons: boolean;
    enableCopyOnClick: boolean;
    copyModifierKey: InlineCodeModifierKeys;
  },
  printing: {
    enablePrintToPDFStyling: boolean;
    forceCurrentColorUse: boolean;
    uncollapseDuringPrint: boolean;
    printAnnotationsAsComments: boolean;
    avoidPageBreaks: boolean;
  },
  common: {
    enableInSourceMode: boolean;
  },
  prompts: {
    editedDefaults: Record<string, Partial<PromptDefinition>>;
    customPrompts: Record<string, PromptDefinition>;
    includePromptsInCopy: boolean;
  },
  groupedCodeBlocks: {
    rememberTabState: boolean;
    persistence: TabPersistence;
    showAddRemoveButtons: boolean;
  },
  annotations: {
    convertAllComments: boolean;
    excludeAnnotationsFromCopy: boolean;
  },
  plugins: {
    admonitions: {
      enabled: boolean;
      enableTimeOut: boolean;
      timeOut: number;
    },
    executeCode: {
      enabled: boolean;
      styleOutput: boolean;
    }
  },
  enableEditorActiveLineHighlight: boolean;
}

export interface ColorTheme {
  baseTheme?: string;
  colors: ThemeColors;
}

export interface CodeblockCustomizerSettings {
  Themes: Record<string, ColorTheme>;
  pluginSettings: PluginSettings;
  ExcludeLangs: string;
  ThemeName: string;
  SelectedTheme: ColorTheme;
  newThemeName: string;
  newPromptName: string;
  alternateHighlightColorName: string;
  settingsType: string;
  langSpecificSettingsType: string;
  languageSpecificLanguageName: string;
}

// default settings for all themes
const defaultThemeSettings: PluginSettings = {
  codeblock: {
    enableLineNumbers: true,
    enableActiveLineHighlight: true,
    codeBlockBorderStylingPosition: 'disable',
    showIndentationLines: false,
    enableLinks: false,
    enableLinkUpdate: false,
    enableBracketHighlight: true,
    highlightNonMatchingBrackets: true,
    enableSelectionMatching: true,
    unwrapcode: false,
    hideFenceLines: false,
    lineNumberSeparatorStyle: LineNumberSeparatorStyle.Dashed,
    buttons: {
      alwaysShowButtons: false,
      alwaysShowCopyCodeButton: false,
      enableSelectCodeButton: false,
      enableDeleteCodeButton: false,
      enableWrapCodeButton: false,
      enableSnapshotButton: false,
      modifierKey: ButtonModifierKeys.CTRL,
    },
    folding: {
      inverseFold: false,
      rememberFoldState: true,
      scope: FoldingScope.NoFoldSpecified,
      persistence: FoldingPersistence.Session,
      ignoreShortBlocksOnInverseFold: false,
    },
  },
  textHighlight: {
    lineSeparator: '',
    textSeparator: '',
  },
  semiFold: {
    enableSemiFold: false,
    visibleLines: 5,
    showAdditionalUncollapseButon: false,
    autoFoldLongCodeblocks: false,
    longCodeBlockLines: 30,
  },
  header: {
    boldText: false,
    italicText: false,
    collapseIconPosition: 'hide',
    collapsedCodeText: '',
    codeblockLangBoldText: true,
    codeblockLangItalicText: true,
    alwaysDisplayCodeblockLang: false,
    alwaysDisplayCodeblockIcon: false,
    displayCodeBlockLanguage: true,
    displayCodeBlockIcon: true,
    disableFoldUnlessSpecified: false,
  },
  gutter: {
    highlightActiveLineNr: true,
    enableHighlight: false,
  },
  inlineCode: {
    enableInlineCodeStyling: true,
    enableSyntaxHighlight: true,
    showIcons: false,
    enableCopyOnClick: true,
    copyModifierKey: InlineCodeModifierKeys.CTRL,
  },
  printing: {
    enablePrintToPDFStyling: true,
    forceCurrentColorUse: false,
    uncollapseDuringPrint: true,
    printAnnotationsAsComments: false,
    avoidPageBreaks: false,
  },
  common: {
    enableInSourceMode: false,
  },
  prompts: {
    editedDefaults: {},
    customPrompts: {},
    includePromptsInCopy: false,
  },
  groupedCodeBlocks: {
    rememberTabState: true,
    persistence: TabPersistence.Session,
    showAddRemoveButtons: true,
  },
  annotations: {
    convertAllComments: false,
    excludeAnnotationsFromCopy: false,
  },
  plugins: {
    admonitions: {
      enabled: true,
      enableTimeOut: false,
      timeOut: 100,
    },
    executeCode: {
      enabled: true,
      styleOutput: true,
    }
  },
  enableEditorActiveLineHighlight: true,
};

const SELECTION_MATCH_COLOR = '#99ff7780';

const DarkPromptColors: Record<string, Record<string, string>> = {
  "bash": {
    "prompt-user": "#61afef",
    "prompt-host": "#e5c07b",
    "prompt-path": "#98c379",
  },
  "bashalt": {
    "prompt-user": "#61afef",
    "prompt-host": "#d19a66",
    "prompt-path": "#56b6c2",
    //"prompt-hash": "#ff5555",
  },
  "kali": {
    "prompt-user": "#2679F2",
    "prompt-host": "#2679F2",
    "prompt-path": "#F3F3F4",
    "prompt-kali-symbol": "#2679F2",
    "prompt-dollar": "#2679F2",
    "prompt-dash": "#56AA9B",
    "prompt-bracket-open": "#56AA9B",
    "prompt-bracket-close": "#56AA9B",
    "prompt-square-open": "#56AA9B",
    "prompt-square-close": "#56AA9B",
  },
  "zshgit": {
    "prompt-path": "#61afef",
    "prompt-branch": "#c678dd",
    "prompt-zsh-status-error": "#ff5555",
    "prompt-zsh-status-ok": "#50fa7b",
    "prompt-zsh-symbol": "#00ff00",
    "prompt-symbol": "#8be9fd",
  },
  "zsh": {
    "prompt-user": "#56b6c2",
    "prompt-host": "#e06c75",
    "prompt-path": "#98c379",
    "prompt-percent": "#abb2bf",
  },
  "fish": {
    "prompt-path": "#61afef",
  },
  "ps": {
    "prompt-path": "#5b9bd5",
    "prompt-symbol": "#e5c07b",
    "prompt-greater-than": "#e5c07b",
  },
  "cmd": {
    "prompt-path": "#87ceeb ",
    "prompt-greater-than": "#aaaaaa",
  },
  "docker": {
    "prompt-user": "#61afef",
    "prompt-host": "#e06c75",
    "prompt-path": "#98c379",
  },
  "postgres": {
    "prompt-db": "#fabd2f",
  },
  "msf": {
    "prompt-msf": "#f3f3f4",
    "prompt-keyword": "#f3f3f4",
    "prompt-module": "#E20303",
    "prompt-greater-than": "#f3f3f4",
    "prompt-bracket-open": "#f3f3f4",
    "prompt-bracket-close": "#f3f3f4",
  },
  "cstrike": {
    "prompt-beacon": "#f3f3f4",
    "prompt-greater-than": "#f3f3f4"
  },
  "global": {
    "prompt-at": DEFAULT_PROMPT_COLOR,
    "prompt-colon": DEFAULT_PROMPT_COLOR,
    "prompt-dollar": DEFAULT_PROMPT_COLOR,
    "prompt-hash": DEFAULT_PROMPT_COLOR,
    "prompt-dash":DEFAULT_PROMPT_COLOR,
    "prompt-bracket-open": DEFAULT_PROMPT_COLOR,
    "prompt-bracket-close": DEFAULT_PROMPT_COLOR,
    "prompt-square-open": DEFAULT_PROMPT_COLOR,
    "prompt-square-close": DEFAULT_PROMPT_COLOR,
    "prompt-greater-than": DEFAULT_PROMPT_COLOR,
    "prompt-symbol": "#888888",
    "prompt-user": DEFAULT_PROMPT_COLOR,
    "prompt-host": DEFAULT_PROMPT_COLOR,
    "prompt-path": DEFAULT_PROMPT_COLOR,
    "prompt-branch": DEFAULT_PROMPT_COLOR,
    "prompt-db": DEFAULT_PROMPT_COLOR,
    "prompt-zsh-symbol": DEFAULT_PROMPT_COLOR,
    "prompt-zsh-status-error": DEFAULT_PROMPT_COLOR,
    "prompt-zsh-status-ok": DEFAULT_PROMPT_COLOR,
    "prompt-msf": DEFAULT_PROMPT_COLOR,
    "prompt-keyword": DEFAULT_PROMPT_COLOR,
    "prompt-module": DEFAULT_PROMPT_COLOR,
    "prompt-beacon": DEFAULT_PROMPT_COLOR,
    "prompt-kali-symbol": DEFAULT_PROMPT_COLOR,
    "prompt-percent": DEFAULT_PROMPT_COLOR
  }
};

// default light colors, but this needs customization almost for every light theme
const ObsidianLightPromptPromptColors: Record<string, Record<string, string>> = {
  "bash": {
    "prompt-user": "#61afef",
    "prompt-host": "#e5c07b",
    "prompt-path": "#98c379",
  },
  "bashalt": {
    "prompt-user": "#61afef",
    "prompt-host": "#d19a66",
    "prompt-path": "#56b6c2",
    "prompt-hash": "#ff5555",
  },
  "kali": {
    "prompt-user": "#2679F2",
    "prompt-host": "#2679F2",
    "prompt-path": "#5c6370",
    "prompt-kali-symbol": "#2679F2",
    "prompt-dollar": "#2679F2",
    "prompt-dash": "#56AA9B",
    "prompt-bracket-open": "#56AA9B",
    "prompt-bracket-close": "#56AA9B",
    "prompt-square-open": "#56AA9B",
    "prompt-square-close": "#56AA9B",
  },
  "zshgit": {
    "prompt-path": "#61afef",
    "prompt-branch": "#c678dd",
    "prompt-zsh-status-error": "#ff5555",
    "prompt-zsh-status-ok": "#50fa7b",
    "prompt-zsh-symbol": "#00ff00",
    "prompt-symbol": "#8be9fd",
  },
  "zsh": {
    "prompt-user": "#56b6c2",
    "prompt-host": "#e06c75",
    "prompt-path": "#98c379",
    "prompt-percent": "#abb2bf",
  },
  "fish": {
    "prompt-path": "#61afef",
  },
  "ps": {
    "prompt-path": "#5b9bd5",
    "prompt-symbol": "#e5c07b",
    "prompt-greater-than": "#e5c07b",
  },
  "cmd": {
    "prompt-path": "#87ceeb",
    "prompt-greater-than": "#aaaaaa",
  },
  "docker": {
    "prompt-user": "#61afef",
    "prompt-host": "#e06c75",
    "prompt-path": "#98c379",
  },
  "postgres": {
    "prompt-db": "#fabd2f",
  },
  "msf": {
    "prompt-msf": "#5C6370",
    "prompt-keyword": "#5C6370",
    "prompt-module": "#E20303",
    "prompt-greater-than": "#5C6370",
    "prompt-bracket-open": "#5C6370",
    "prompt-bracket-close": "#5C6370",
  },
  "cstrike": {
    "prompt-beacon": "#5C6370",
    "prompt-greater-than": "#5C6370"
  },
  "global": {
    "prompt-at": DEFAULT_PROMPT_COLOR,
    "prompt-colon": DEFAULT_PROMPT_COLOR,
    "prompt-dollar": DEFAULT_PROMPT_COLOR,
    "prompt-hash": DEFAULT_PROMPT_COLOR,
    "prompt-dash":DEFAULT_PROMPT_COLOR,
    "prompt-bracket-open": DEFAULT_PROMPT_COLOR,
    "prompt-bracket-close": DEFAULT_PROMPT_COLOR,
    "prompt-square-open": DEFAULT_PROMPT_COLOR,
    "prompt-square-close": DEFAULT_PROMPT_COLOR,
    "prompt-greater-than": DEFAULT_PROMPT_COLOR,
    "prompt-symbol": "#888888",
    "prompt-user": DEFAULT_PROMPT_COLOR,
    "prompt-host": DEFAULT_PROMPT_COLOR,
    "prompt-path": DEFAULT_PROMPT_COLOR,
    "prompt-branch": DEFAULT_PROMPT_COLOR,
    "prompt-db": DEFAULT_PROMPT_COLOR,
    "prompt-zsh-symbol": DEFAULT_PROMPT_COLOR,
    "prompt-zsh-status-error": DEFAULT_PROMPT_COLOR,
    "prompt-zsh-status-ok": DEFAULT_PROMPT_COLOR,
    "prompt-msf": DEFAULT_PROMPT_COLOR,
    "prompt-keyword": DEFAULT_PROMPT_COLOR,
    "prompt-module": DEFAULT_PROMPT_COLOR,
    "prompt-beacon": DEFAULT_PROMPT_COLOR,
    "prompt-kali-symbol": DEFAULT_PROMPT_COLOR,
    "prompt-percent": DEFAULT_PROMPT_COLOR
  }
};

export const RootPromptColors: Record<string, Record<string, string>> = {
  "bash": {
    "prompt-user": "#e63946",
    "prompt-host": "#e5c07b",
    "prompt-path": "#ffb347",
    "prompt-hash": "#ff5555",
  },
  "bashalt": {
    "prompt-user": "#e63946",
    "prompt-host": "#d19a66",
    "prompt-path": "#ffb347",
    "prompt-hash": "#ff5555",
  },
  "kali": {
    "prompt-user": "#e63946",
    "prompt-host": "#e63946",
    "prompt-path": "#ffb347",
    "prompt-kali-symbol": "#e63946",
    "prompt-hash": "#ff5555",
    "prompt-dash":"#3370D7",
    "prompt-bracket-open": "#3370D7",
    "prompt-bracket-close": "#3370D7",
    "prompt-square-open": "#3370D7",
    "prompt-square-close": "#3370D7",
  },
  "zsh": {
    "prompt-user": "#e63946",
    "prompt-path": "#ffb347",
    "prompt-hash": "#ff5555",
    "prompt-end": "#ff5555",
  },
  "docker": {
    "prompt-user": "#e63946",
    "prompt-container": "#e06c75",
    "prompt-path": "#ffb347",
    "prompt-hash": "#ff5555",
  },
  "global": {}
};

/*const ObsidianPromptColors: Record<string, Record<string, string>> = {
"bash": {
    "prompt-user": "#5c99f5",
    "prompt-host": "#b3b3b3",
    "prompt-path": "#86b300",
  },
  "bashalt": {
    "prompt-user": "#e63946",
    "prompt-host": "#d19a66",
    "prompt-path": "#56b6c2",
    "prompt-hash": "#cb4b16",
  },
  "kali": {
    "prompt-user": "#ff5555",
    "prompt-host": "#ff79c6",
    "prompt-path": "#8be9fd",
    "prompt-kali-symbol": "#5c99f5",
    "prompt-dollar": "#5c99f5",
  },
  "zshgit": {
    "prompt-path": "#5c99f5",
    "prompt-branch": "#c678dd",
    "prompt-zsh-error": "#e06c75",
    "prompt-zsh-symbol": "#86b300",
  },
  "ps": {
    "prompt-path": "#5294e2",
  },
  "cmd": {
    "prompt-path": "#3FC1FF",
  },
  "docker": {
    "prompt-user": "#5c99f5",
    "prompt-host": "#b3b3b3",
    "prompt-path": "#86b300",
  },
  "postgres": {
    "prompt-db": "#d19a66",
  },
  "global": {
    "prompt-at": "#999999",
    "prompt-colon": "#999999",
    "prompt-dollar": "#aaaaaa",
    "prompt-hash": "#aaaaaa",
    "prompt-bracket-open": "#999999",
    "prompt-bracket-close": "#999999",
    "prompt-square-open": "#999999",
    "prompt-square-close": "#999999",
    "prompt-greater-than": "#999999",
  }
};*/

// Solarized Theme
const SolarizedLightPromptColors = structuredClone(ObsidianLightPromptPromptColors);
SolarizedLightPromptColors.kali["prompt-path"] = "#586e75";
SolarizedLightPromptColors.msf["prompt-msf"] = "#586E75";
SolarizedLightPromptColors.msf["prompt-keyword"] = "#586E75";
SolarizedLightPromptColors.msf["prompt-greater-than"] = "#586E75";
SolarizedLightPromptColors.msf["prompt-bracket-open"] = "#586E75";
SolarizedLightPromptColors.msf["prompt-bracket-close"] = "#586E75";
SolarizedLightPromptColors.cstrike["prompt-beacon"] = "#586E75";
SolarizedLightPromptColors.cstrike["prompt-greater-than"] = "#586E75";

const SolarizedDarkColors = {
  codeblock: {
    activeLineColor: '#073642',
    backgroundColor: '#002B36',
    highlightColor: '#054b5c',
    alternateHighlightColors: {},
    languageBorderColors: {},
    textColor: '#A30505',
    bracketHighlightColorMatch: '#36e920',
    bracketHighlightColorNoMatch: '#FF0000',
    bracketHighlightBackgroundColorMatch: '#073642',
    bracketHighlightBackgroundColorNoMatch: '#073642',
    selectionMatchHighlightColor: SELECTION_MATCH_COLOR,
  },
  header: {
    backgroundColor: '#0a4554',
    textColor: '#DADADA',
    lineColor: '#46cced',
    codeBlockLangTextColor: '#000000',
    codeBlockLangBackgroundColor: '#008080',
  },
  gutter: {
    textColor: '#6c6c6c',
    backgroundColor: '#073642',
    activeLineNrColor: '#DADADA',
  },
  inlineCode: {
    backgroundColor: '#054b5c',
    textColor: '#DADADA',
  },
  prompts: {
    promptColors: DarkPromptColors,
    rootPromptColors: RootPromptColors,
    editedPromptColors: {},
    editedRootPromptColors: {}
  },
  groupedCodeBlocks: {
    activeTabBackgroundColor: '#B58900',
    activeTabTextColor: '#000000',
    hoverTabBackgroundColor: '#00AAAA',
    hoverTabTextColor: '#FFFFFF',
    headerLineColor: '#46cced',
  },
  annotations: {
    colors: {
      note: '#027aff', //'#268bd2',
      warn: '#e9973f', //'#b58900',
      error: '#fb464c', //'#dc322f',
      todo: '#44cf6e', //'#859900',
      question: '#a882ff', //'#6c71c4',
      see: '#53dfdd', //'#2aa198',
    }
  },
  editorActiveLineColor: '#468eeb33',
  languageSpecificColors: {},
}

const SolarizedLightColors = {
  codeblock: {
    activeLineColor: '#EDE8D6',
    backgroundColor: '#FCF6E4',
    highlightColor: '#E9DFBA',
    alternateHighlightColors: {},
    languageBorderColors: {},
    textColor: '#A30505',
    bracketHighlightColorMatch: '#ff01f7',
    bracketHighlightColorNoMatch: '#FF0000',
    bracketHighlightBackgroundColorMatch: '#EDE8D6',
    bracketHighlightBackgroundColorNoMatch:'#EDE8D6',
    selectionMatchHighlightColor: SELECTION_MATCH_COLOR,
  },
  header: {
    backgroundColor: '#D5CCB4',
    textColor: '#866704',
    lineColor: '#EDD489',
    codeBlockLangTextColor: '#C25F30',
    codeBlockLangBackgroundColor: '#B8B5AA',
  },
  gutter: {
    textColor: '#6c6c6c',
    backgroundColor: '#EDE8D6',
    activeLineNrColor: '#D8A609',
  },
  inlineCode: {
    backgroundColor: '#E9DFBA',
    textColor: '#866704',
  },
  prompts: {
    promptColors: SolarizedLightPromptColors,
    rootPromptColors: RootPromptColors,
    editedPromptColors: {},
    editedRootPromptColors: {}
  },
  groupedCodeBlocks: {
    activeTabBackgroundColor: '#FFD700',
    activeTabTextColor: '#C25F30',
    hoverTabBackgroundColor: '#A6A18F',//'#CFCAB3',
    hoverTabTextColor: '#C25F30',
    headerLineColor: '#EDD489',
  },
  annotations: {
    colors: {
      note: '#086ddd', //'#268bd2',
      warn: '#ec7500', //'#b58900',
      error: '#e93147', //'#dc322f',
      todo: '#08b94e', //'#859900',
      question: '#7852ee', //'#6c71c4',
      see: '#00bfbc', //'#2aa198',
    }
  },
  editorActiveLineColor: '#60460633',
  languageSpecificColors: {},
}

const Solarized: ColorTheme = {
  baseTheme: "Solarized",
  colors: {
    dark: SolarizedDarkColors,
    light: SolarizedLightColors,
  },
}

// Obsidian Theme
const ObsidianDarkColors = {
  codeblock: {
    activeLineColor: "--color-base-30",
    backgroundColor: "--code-background",
    highlightColor: "--text-highlight-bg",
    alternateHighlightColors: {},
    languageBorderColors: {},
    textColor: '#A30505',
    bracketHighlightColorMatch: '#f33bff',
    bracketHighlightColorNoMatch: '#FF0000',
    bracketHighlightBackgroundColorMatch: "--color-base-30",
    bracketHighlightBackgroundColorNoMatch: "--color-base-30",
    selectionMatchHighlightColor: SELECTION_MATCH_COLOR,
  },
  header: {
    backgroundColor: "--code-background",
    textColor: "--text-normal",
    lineColor: "--color-base-30",
    codeBlockLangTextColor: "--code-comment",
    codeBlockLangBackgroundColor: "--code-background",
  },
  gutter: {
    textColor: "--text-faint",
    backgroundColor: "--code-background",
    activeLineNrColor: "--text-muted",
  },
  inlineCode: {
    backgroundColor: "--code-background",
    textColor: "--code-normal",
  },
  prompts: {
    promptColors: DarkPromptColors,
    rootPromptColors: RootPromptColors,
    editedPromptColors: {},
    editedRootPromptColors: {}
  },
  groupedCodeBlocks: {
    activeTabBackgroundColor: '#3A3A3A',
    activeTabTextColor: "--code-comment",
    hoverTabBackgroundColor: '#333333',
    hoverTabTextColor: '#CCCCCC',
    headerLineColor: "--color-base-30",
  },
  annotations: {
    colors: {
      note: '#027aff', //'#268bd2',
      warn: '#e9973f', //'#b58900',
      error: '#fb464c', //'#dc322f',
      todo: '#44cf6e', //'#859900',
      question: '#a882ff', //'#6c71c4',
      see: '#53dfdd', //'#2aa198',
    }
  },
  editorActiveLineColor: "--color-base-20",
  languageSpecificColors: {},
}

const ObsidianLightColors = {
  codeblock: {
    activeLineColor: "--color-base-30",
    backgroundColor: "--code-background",
    highlightColor: "--text-highlight-bg",
    alternateHighlightColors: {},
    languageBorderColors: {},
    textColor: '#A30505',
    bracketHighlightColorMatch: '#f33bff',
    bracketHighlightColorNoMatch: '#FF0000',
    bracketHighlightBackgroundColorMatch: "--color-base-30",
    bracketHighlightBackgroundColorNoMatch: "--color-base-30",
    selectionMatchHighlightColor: SELECTION_MATCH_COLOR,
  },
  header: {
    backgroundColor: "--code-background",
    textColor: "--text-normal",
    lineColor: "--color-base-30",
    codeBlockLangTextColor: "--code-comment",
    codeBlockLangBackgroundColor: "--code-background",
  },
  gutter: {
    textColor: "--text-faint",
    backgroundColor: "--code-background",
    activeLineNrColor: "--text-muted",
  },
  inlineCode: {
    backgroundColor: "--code-background",
    textColor: "--code-normal",
  },
  prompts: {
    promptColors: ObsidianLightPromptPromptColors,
    rootPromptColors: RootPromptColors,
    editedPromptColors: {},
    editedRootPromptColors: {}
  },
  groupedCodeBlocks: {
    activeTabBackgroundColor: '#E6E6E6',
    activeTabTextColor: "--code-comment",
    hoverTabBackgroundColor: '#F0F0F0',
    hoverTabTextColor: '#888888',
    headerLineColor: "--color-base-30",
  },
  annotations: {
    colors: {
      note: '#086ddd', //'#268bd2',
      warn: '#ec7500', //'#b58900',
      error: '#e93147', //'#dc322f',
      todo: '#08b94e', //'#859900',
      question: '#7852ee', //'#6c71c4',
      see: '#00bfbc', //'#2aa198',
    }
  },
  editorActiveLineColor: "--color-base-20",
  languageSpecificColors: {},
}

const Obsidian: ColorTheme = {
  baseTheme: "Obsidian",
  colors: {
    dark: ObsidianDarkColors,
    light: ObsidianLightColors,
  },
}

// Gruvbox Theme
const gruvboxLightPromptColors = structuredClone(ObsidianLightPromptPromptColors);
gruvboxLightPromptColors.bash["prompt-host"] = "#504945";
gruvboxLightPromptColors.bash["prompt-path"] = "#68924A";
gruvboxLightPromptColors.cmd["prompt-path"] = "#5B9BD5";
gruvboxLightPromptColors.ps["prompt-symbol"] = "#B9791D";
gruvboxLightPromptColors.ps["prompt-greater-than"] = "#B9791D";
gruvboxLightPromptColors.postgres["prompt-db"] = "#BB8D22";
gruvboxLightPromptColors.zshgit["prompt-zsh-symbol"] = "#08B908";
gruvboxLightPromptColors.zshgit["prompt-symbol"] = "#6EB9C9";

const gruvboxLightRootPromptColors = structuredClone(RootPromptColors);
gruvboxLightRootPromptColors.bash["prompt-host"] = "#504945";
gruvboxLightRootPromptColors.bash["prompt-path"] = "#B9791D";
gruvboxLightRootPromptColors.bashalt["prompt-path"] = "#B9791D";
gruvboxLightRootPromptColors.kali["prompt-path"] = "#B9791D";
gruvboxLightRootPromptColors.zsh["prompt-path"] = "#B9791D";
gruvboxLightRootPromptColors.docker["prompt-path"] = "#B9791D";

const GruvboxDarkColors = {
  codeblock: {
    activeLineColor: '#504945',
    backgroundColor: '#3c3836',
    highlightColor: '#5B5654',
    alternateHighlightColors: {},
    languageBorderColors: {},
    textColor: '#ebdbb2',
    bracketHighlightColorMatch: '#b8bb26',
    bracketHighlightColorNoMatch: '#fb4934',
    bracketHighlightBackgroundColorMatch: '#3c3836',
    bracketHighlightBackgroundColorNoMatch: '#3c3836',
    selectionMatchHighlightColor: '#943735',
  },
  header: {
    backgroundColor: '#504945',
    textColor: '#ebdbb2',
    lineColor: '#FE8019',
    codeBlockLangTextColor: '#282828',
    codeBlockLangBackgroundColor: '#D65D0E',
  },
  gutter: {
    textColor: '#A89984',
    backgroundColor: '#504945',
    activeLineNrColor: '#ebdbb2',
  },
  inlineCode: {
    backgroundColor: '#3c3836',
    textColor: '#83a598',
  },
  prompts: {
    promptColors: DarkPromptColors,
    rootPromptColors: RootPromptColors,
    editedPromptColors: {},
    editedRootPromptColors: {}
  },
  groupedCodeBlocks: {
    activeTabBackgroundColor: '#fabd2f',
    activeTabTextColor: '#282828',
    hoverTabBackgroundColor: '#FE8019',
    hoverTabTextColor: '#ebdbb2',
    headerLineColor: '#FE8019',
  },
  annotations: {
    colors: {
      note: '#83a598',
      warn: '#fabd2f',
      error: '#fb4934',
      todo: '#b8bb26',
      question: '#d3869b',
      see: '#8ec07c',
    }
  },
  editorActiveLineColor: '#3c383680',
  languageSpecificColors: {},
}

const GruvboxLightColors = {
  codeblock: {
    activeLineColor: '#E0D2AE',
    backgroundColor: '#EBDBB2',
    highlightColor: '#d5c4a1',
    alternateHighlightColors: {},
    languageBorderColors: {},
    textColor: '#3c3836',
    bracketHighlightColorMatch: '#282828',
    bracketHighlightColorNoMatch: '#CC241D',
    bracketHighlightBackgroundColorMatch: '#8EC07C',
    bracketHighlightBackgroundColorNoMatch: '#BDAE93',
    selectionMatchHighlightColor: '#83a598', //'#D47769',
  },
  header: {
    backgroundColor: '#D5C4A1',
    textColor: '#3c3836',
    lineColor: '#D65D0E',
    codeBlockLangTextColor: '#282828',
    codeBlockLangBackgroundColor: '#BDAE93',
  },
  gutter: {
    textColor: '#928374',
    backgroundColor: '#E0D2AE',
    activeLineNrColor: '#3c3836',
  },
  inlineCode: {
    backgroundColor: '#ebdbb2',
    textColor: '#83a598',
  },
  prompts: {
    promptColors: gruvboxLightPromptColors,
    rootPromptColors: gruvboxLightRootPromptColors,
    editedPromptColors: {},
    editedRootPromptColors: {}
  },
  groupedCodeBlocks: {
    activeTabBackgroundColor: '#D65D0E',
    activeTabTextColor: '#282828',
    hoverTabBackgroundColor: '#D65D0E',
    hoverTabTextColor: '#282828',//'#83A598',
    headerLineColor: '#D65D0E',
  },
  annotations: {
    colors: {
      note: '#458588',
      warn: '#d79921',
      error: '#cc241d',
      todo: '#98971a',
      question: '#b16286',
      see: '#689d6a',
    }
  },
  editorActiveLineColor: '#ebdbb280',
  languageSpecificColors: {},
}

const Gruvbox: ColorTheme = {
  baseTheme: "Gruvbox",
  colors: {
    dark: GruvboxDarkColors,
    light: GruvboxLightColors,
  },
}

// Dracula Theme
const dracula = {
  background: '#44475a',
  currentLine: '#44475a',
  selection: '#44475a',
  foreground: '#f8f8f2',
  comment: '#6272a4',
  cyan: '#8be9fd',
  green: '#50fa7b',
  orange: '#ffb86c',
  pink: '#ff79c6',
  purple: '#bd93f9',
  red: '#ff5555',
  yellow: '#f1fa8c',
};

const DraculaDarkColors = {
  codeblock: {
    activeLineColor: '#3B3D4E',
    backgroundColor: dracula.background,
    highlightColor: dracula.comment,
    alternateHighlightColors: {},
    languageBorderColors: {},
    textColor: dracula.foreground,
    bracketHighlightColorMatch: dracula.pink,
    bracketHighlightColorNoMatch: dracula.red,
    bracketHighlightBackgroundColorMatch: dracula.currentLine,
    bracketHighlightBackgroundColorNoMatch: dracula.currentLine,
    selectionMatchHighlightColor: dracula.purple,
  },
  header: {
    backgroundColor: dracula.currentLine,
    textColor: dracula.foreground,
    lineColor: dracula.purple,
    codeBlockLangTextColor: dracula.foreground,
    codeBlockLangBackgroundColor: dracula.comment,
  },
  gutter: {
    textColor: '#f8f8f299',
    backgroundColor: '#3B3D4E',
    activeLineNrColor: dracula.foreground,
  },
  inlineCode: {
    backgroundColor: dracula.currentLine,
    textColor: dracula.cyan,
  },
  prompts: {
    promptColors: DarkPromptColors,
    rootPromptColors: RootPromptColors,
    editedPromptColors: {},
    editedRootPromptColors: {}
  },
  groupedCodeBlocks: {
    activeTabBackgroundColor: dracula.purple,
    activeTabTextColor: dracula.foreground,
    hoverTabBackgroundColor: dracula.purple,
    hoverTabTextColor: dracula.foreground,
    headerLineColor: dracula.purple,
  },
  annotations: {
    colors: {
      note: dracula.cyan,
      warn: dracula.yellow,
      error: dracula.red,
      todo: dracula.orange,
      question: dracula.purple,
      see: dracula.green,
    }
  },
  editorActiveLineColor: `${dracula.currentLine}80`,
  languageSpecificColors: {},
};

const DraculaLightColors = {
  codeblock: {
    activeLineColor: '#e9e9f2',
    backgroundColor: '#f8f8f2',
    highlightColor: '#e1d6f5',
    alternateHighlightColors: {},
    languageBorderColors: {},
    textColor: '#282a36',
    bracketHighlightColorMatch: '#F8F8F2',
    bracketHighlightColorNoMatch: '#f8f8f2',
    bracketHighlightBackgroundColorMatch: '#6272A4',
    bracketHighlightBackgroundColorNoMatch: dracula.red,
    selectionMatchHighlightColor: '#bd93f9',
  },
  header: {
    backgroundColor: '#e9e9f2',
    textColor: '#282a36',
    lineColor: dracula.pink,
    codeBlockLangTextColor: '#f8f8f2',
    codeBlockLangBackgroundColor: dracula.comment,
  },
  gutter: {
    textColor: '#AEAEB8',
    backgroundColor: '#e9e9f2',
    activeLineNrColor: '#44475A',
  },
  inlineCode: {
    backgroundColor: '#e9e9f2',
    textColor: dracula.purple,
  },
  prompts: {
    promptColors: ObsidianLightPromptPromptColors,
    rootPromptColors: RootPromptColors,
    editedPromptColors: {},
    editedRootPromptColors: {}
  },
  groupedCodeBlocks: {
    activeTabBackgroundColor: dracula.pink,
    activeTabTextColor: '#282a36',
    hoverTabBackgroundColor: dracula.pink,
    hoverTabTextColor: '#282a36',
    headerLineColor: dracula.pink,
  },
  annotations: {
    colors: {
      note: '#009688', 
      warn: '#d79921',
      error: '#cc241d',
      todo: '#d65d0e',
      question: '#b16286',
      see: '#43a047',
    }
  },
  editorActiveLineColor: '#e9e9f280',
  languageSpecificColors: {},
};

const Dracula: ColorTheme = {
  baseTheme: "Dracula",
  colors: {
    dark: DraculaDarkColors,
    light: DraculaLightColors,
  },
}

// Nord Theme
const nordLightPromptColors = structuredClone(ObsidianLightPromptPromptColors);
nordLightPromptColors.zshgit["prompt-symbol"] = "#77C8DA";

const nord = {
  polarNight0: '#2E3440', // Darkest Background
  polarNight1: '#3B4252', // Lighter Background
  polarNight2: '#434C5E',
  polarNight3: '#4C566A', // Lightest Background / Comments
  snowStorm0: '#D8DEE9', // White
  snowStorm1: '#E5E9F0',
  snowStorm2: '#ECEFF4', // Purest White
  frost0: '#8FBCBB', // Frost Green
  frost1: '#88C0D0', // Frost Light Blue
  frost2: '#81A1C1', // Frost Blue
  frost3: '#5E81AC', // Frost Darker Blue
  aurora0: '#BF616A', // Red
  aurora1: '#D08770', // Orange
  aurora2: '#EBCB8B', // Yellow
  aurora3: '#A3BE8C', // Green
  aurora4: '#B48EAD', // Purple
};

const NordDarkColors = {
  codeblock: {
    activeLineColor: nord.polarNight2,
    backgroundColor: nord.polarNight1,
    highlightColor: nord.polarNight3,
    alternateHighlightColors: {},
    languageBorderColors: {},
    textColor: nord.snowStorm1,
    bracketHighlightColorMatch: nord.aurora2,
    bracketHighlightColorNoMatch: nord.aurora0,
    bracketHighlightBackgroundColorMatch: nord.polarNight2,
    bracketHighlightBackgroundColorNoMatch: nord.polarNight2,
    selectionMatchHighlightColor: '#865562',
  },
  header: {
    backgroundColor: nord.polarNight2,
    textColor: nord.snowStorm1,
    lineColor: nord.aurora2,
    codeBlockLangTextColor: nord.snowStorm1,
    codeBlockLangBackgroundColor: nord.aurora1,
  },
  gutter: {
    textColor: `${nord.snowStorm0}99`,
    backgroundColor: nord.polarNight2,
    activeLineNrColor: nord.snowStorm2,
  },
  inlineCode: {
    backgroundColor: nord.polarNight1,
    textColor: nord.frost1,
  },
  prompts: {
    promptColors: DarkPromptColors,
    rootPromptColors: RootPromptColors,
    editedPromptColors: {},
    editedRootPromptColors: {}
  },
  groupedCodeBlocks: {
    activeTabBackgroundColor: nord.aurora2,
    activeTabTextColor: nord.polarNight0,
    hoverTabBackgroundColor: nord.aurora2,
    hoverTabTextColor: nord.polarNight0,
    headerLineColor: nord.aurora2,
  },
  annotations: {
    colors: {
      note: nord.frost1,
      warn: nord.aurora2,
      error: nord.aurora0,
      todo: nord.aurora1,
      question: nord.aurora4,
      see: nord.aurora3,
    }
  },
  editorActiveLineColor: `#bf616a33`,
  languageSpecificColors: {},
};

const NordLightColors = {
  codeblock: {
    activeLineColor: nord.snowStorm0,
    backgroundColor: nord.snowStorm2,
    highlightColor: '#5E81AC66',
    alternateHighlightColors: {},
    languageBorderColors: {},
    textColor: nord.polarNight1,
    bracketHighlightColorMatch: nord.snowStorm2,
    bracketHighlightColorNoMatch: nord.snowStorm2,
    bracketHighlightBackgroundColorMatch: nord.frost3,
    bracketHighlightBackgroundColorNoMatch: nord.aurora0,
    selectionMatchHighlightColor: '#CC9BA3',
  },
  header: {
    backgroundColor: nord.snowStorm0,
    textColor: nord.polarNight0,
    lineColor: nord.aurora0,
    codeBlockLangTextColor: nord.polarNight0,
    codeBlockLangBackgroundColor: nord.aurora1,
  },
  gutter: {
    textColor: nord.polarNight3,
    backgroundColor: nord.snowStorm0,
    activeLineNrColor: nord.aurora0,
  },
  inlineCode: {
    backgroundColor: nord.snowStorm0,
    textColor: nord.frost1,
  },
  prompts: {
    promptColors: nordLightPromptColors,
    rootPromptColors: RootPromptColors,
    editedPromptColors: {},
    editedRootPromptColors: {}
  },
  groupedCodeBlocks: {
    activeTabBackgroundColor: nord.aurora0,
    activeTabTextColor: nord.snowStorm2,
    hoverTabBackgroundColor: nord.aurora0,
    hoverTabTextColor: nord.snowStorm2,
    headerLineColor: nord.aurora0,
  },
  annotations: {
    colors: {
      note: nord.frost3,
      warn: nord.aurora1,
      error: nord.aurora0,
      todo: nord.aurora1,
      question: nord.aurora4,
      see: nord.aurora3,
    }
  },
  editorActiveLineColor: `#bf616a1a`,
  languageSpecificColors: {},
};

const Nord: ColorTheme = {
  baseTheme: "Nord",
  colors: {
    dark: NordDarkColors,
    light: NordLightColors,
  },
};

// Tokyo Night Theme
const tokyoLightPromptColors = structuredClone(ObsidianLightPromptPromptColors);
tokyoLightPromptColors.bash["prompt-host"] = "#A88E5C";
tokyoLightPromptColors.bash["prompt-path"] = "#81A566";
tokyoLightPromptColors.zshgit["prompt-zsh-symbol"] = "#08B908";
tokyoLightPromptColors.zshgit["prompt-symbol"] = "#6EB9C9";
tokyoLightPromptColors.docker["prompt-path"] = "#81A566";
tokyoLightPromptColors.zsh["prompt-path"] = "#81A566";
tokyoLightPromptColors.ps["prompt-symbol"] = "#B9791D";
tokyoLightPromptColors.ps["prompt-greater-than"] = "#B9791D";
tokyoLightPromptColors.cmd["prompt-path"] = "#5B9BD5";
tokyoLightPromptColors.postgres["prompt-db"] = "#BB8D22";

const tokyoLightRootPromptColors = structuredClone(RootPromptColors);
tokyoLightRootPromptColors.bash["prompt-host"] = "#A88E5C";
tokyoLightRootPromptColors.bash["prompt-path"] = "#B98131";
tokyoLightRootPromptColors.bashalt["prompt-path"] = "#B98131";
tokyoLightRootPromptColors.docker["prompt-path"] = "#B9791D";
tokyoLightRootPromptColors.zsh["prompt-path"] = "#B9791D";
tokyoLightRootPromptColors.kali["prompt-path"] = "#B9791D";

const tokyoNight = {
  bg: '#1a1b26',
  bgDark: '#16161e',
  bgHighlight: '#292e42',
  terminalBlack: '#414868',
  fg: '#c0caf5',
  fgDark: '#a9b1d6',
  fgGutter: '#3b4261',
  dark3: '#545c7e',
  comment: '#565f89',
  blue: '#7aa2f7',
  cyan: '#7dcfff',
  green: '#9ece6a',
  orange: '#ff9e64',
  pink: '#f7768e',
  purple: '#bb9af7',
  red: '#f7768e',
  yellow: '#e0af68',
};

const TokyoNightDarkColors = {
  codeblock: {
    activeLineColor: tokyoNight.bgHighlight,
    backgroundColor: '#24283b',
    highlightColor: tokyoNight.terminalBlack,
    alternateHighlightColors: {},
    languageBorderColors: {},
    textColor: tokyoNight.fg,
    bracketHighlightColorMatch: tokyoNight.green,
    bracketHighlightColorNoMatch: tokyoNight.red,
    bracketHighlightBackgroundColorMatch: tokyoNight.bgHighlight,
    bracketHighlightBackgroundColorNoMatch: tokyoNight.bgHighlight,
    selectionMatchHighlightColor: '#384676',
  },
  header: {
    backgroundColor: tokyoNight.bgHighlight,
    textColor: tokyoNight.fg,
    lineColor: '#387575',
    codeBlockLangTextColor: tokyoNight.fg,
    codeBlockLangBackgroundColor: tokyoNight.comment,
  },
  gutter: {
    textColor: tokyoNight.comment,
    backgroundColor: tokyoNight.bgHighlight,
    activeLineNrColor: tokyoNight.fgDark,
  },
  inlineCode: {
    backgroundColor: '#24283b',
    textColor: '#c0caf5',
  },
  prompts: {
    promptColors: DarkPromptColors,
    rootPromptColors: RootPromptColors,
    editedPromptColors: {},
    editedRootPromptColors: {}
  },
  groupedCodeBlocks: {
    activeTabBackgroundColor: '#387575',
    activeTabTextColor: tokyoNight.fg,
    hoverTabBackgroundColor: '#387575',
    hoverTabTextColor: tokyoNight.fg,
    headerLineColor: '#387575',
  },
  annotations: {
    colors: {
      note: tokyoNight.cyan,
      warn: tokyoNight.yellow,
      error: tokyoNight.red,
      todo: tokyoNight.orange,
      question: tokyoNight.purple,
      see: tokyoNight.green,
    }
  },
  editorActiveLineColor: '#3D4462BF',
  languageSpecificColors: {},
};

const TokyoNightLightColors = {
  codeblock: {
    activeLineColor: '#B5B7BA',
    backgroundColor: '#c3c5c9',
    highlightColor: '#d5d6e2',
    alternateHighlightColors: {},
    languageBorderColors: {},
    textColor: '#343b58',
    bracketHighlightColorMatch: '#e1e2ef',
    bracketHighlightColorNoMatch: '#e1e2ef',
    bracketHighlightBackgroundColorMatch: tokyoNight.green,
    bracketHighlightBackgroundColorNoMatch: tokyoNight.red,
    selectionMatchHighlightColor: '#6A7A9A',
  },
  header: {
    backgroundColor: '#B5B7BA',
    textColor: '#343b58',
    lineColor: tokyoNight.blue,
    codeBlockLangTextColor: '#f8f8f2',
    codeBlockLangBackgroundColor: '#8292AD',
  },
  gutter: {
    textColor: tokyoNight.comment,
    backgroundColor: '#B5B7BA',
    activeLineNrColor: '#f8f8f2',
  },
  inlineCode: {
    backgroundColor: '#c3c5c9',
    textColor: '#343b58',
  },
  prompts: {
    promptColors: tokyoLightPromptColors,
    rootPromptColors: tokyoLightRootPromptColors,
    editedPromptColors: {},
    editedRootPromptColors: {}
  },
  groupedCodeBlocks: {
    activeTabBackgroundColor: tokyoNight.blue,
    activeTabTextColor: '#343b58',
    hoverTabBackgroundColor: tokyoNight.blue,
    hoverTabTextColor: '#343b58',
    headerLineColor: tokyoNight.blue,
  },
  annotations: {
    colors: {
      note: '#2e75b4',
      warn: '#c68a42',
      error: '#c54961',
      todo: '#d87943',
      question: '#9671d4',
      see: '#69a43c',
    }
  },
  editorActiveLineColor: '#A9ABB880',
  languageSpecificColors: {},
};

const TokyoNight: ColorTheme = {
  baseTheme: "Tokyo Night",
  colors: {
    dark: TokyoNightDarkColors,
    light: TokyoNightLightColors,
  },
};

export const DEFAULT_THEMES = {
  'Obsidian': Obsidian,
  'Dracula': Dracula,
  'Gruvbox': Gruvbox,
  'Nord': Nord,
  'Solarized': Solarized,
  'Tokyo Night': TokyoNight,
}

export const DEFAULT_SETTINGS: CodeblockCustomizerSettings = {
  Themes: structuredClone(DEFAULT_THEMES),
  pluginSettings: structuredClone(defaultThemeSettings),
  ExcludeLangs: 'dataview, ad-*',
  SelectedTheme: structuredClone(Obsidian),
  ThemeName: "Obsidian",
  newThemeName: "",
  newPromptName: "",
  alternateHighlightColorName: "",
  settingsType: "basic",
  langSpecificSettingsType: "",
  languageSpecificLanguageName: "",
}