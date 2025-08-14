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
    hoverTabBackgroundColor: string;
    hoverTabTextColor: string;
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

export interface ThemeSettings {
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
    buttons: {
      alwaysShowButtons: boolean;
      alwaysShowCopyCodeButton: boolean;
      enableSelectCodeButton: boolean;
      enableWrapCodeButton: boolean;
      enableDeleteCodeButton: boolean;
    },
    folding: {
      inverseFold: boolean;
      rememberFoldState: boolean;
      scope: FoldingScope;
      persistence: FoldingPersistence;
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
  },
  annotations: {
    convertAllComments: boolean;
    excludeAnnotationsFromCopy: boolean;
  },
  enableEditorActiveLineHighlight: boolean;
}

export interface Theme {
  baseTheme?: string;
  settings: ThemeSettings;
  colors: ThemeColors;
}

export interface CodeblockCustomizerSettings {
  Themes: Record<string, Theme>;
  ExcludeLangs: string;
  ThemeName: string;
  SelectedTheme: Theme;
  newThemeName: string;
  newPromptName: string;
  alternateHighlightColorName: string;
  languageBorderColorName: string;
  settingsType: string;
  langSpecificSettingsType: string;
  languageSpecificLanguageName: string;
}

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

const SolarizedLightPromptColors: Record<string, Record<string, string>> = {
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
    "prompt-path": "#586e75",
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
    "prompt-msf": "#586E75",
    "prompt-keyword": "#586E75",
    "prompt-module": "#E20303",
    "prompt-greater-than": "#586E75",
    "prompt-bracket-open": "#586E75",
    "prompt-bracket-close": "#586E75",
  },
  "cstrike": {
    "prompt-beacon": "#586E75",
    "prompt-greater-than": "#586E75"
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
    hoverTabBackgroundColor: '#00AAAA',
    hoverTabTextColor: '#FFFFFF',
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
    activeLineNrColor: '#866704',
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
    hoverTabBackgroundColor: '#A6A18F',//'#CFCAB3',
    hoverTabTextColor: '#C25F30',
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

const Solarized: Theme = {
  baseTheme: "Solarized",
  settings: {
    codeblock: {
      enableLineNumbers: true,
      enableActiveLineHighlight: true,
      codeBlockBorderStylingPosition: 'disable',
      showIndentationLines: false,
      enableLinks: false,
      enableLinkUpdate: false,
      enableBracketHighlight: true,
      highlightNonMatchingBrackets: true,
      enableSelectionMatching: false,
      unwrapcode: false,
      hideFenceLines: false,
      buttons: {
        alwaysShowButtons: false,
        alwaysShowCopyCodeButton: false,
        enableSelectCodeButton: false,
        enableDeleteCodeButton: false,
        enableWrapCodeButton: false,
      },
      folding: {
        inverseFold: false,
        rememberFoldState: true,
        scope: FoldingScope.NoFoldSpecified,
        persistence: FoldingPersistence.Session,
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
      displayCodeBlockIcon: false,
      disableFoldUnlessSpecified: false,
    },
    gutter: {
      highlightActiveLineNr: false,
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
    },
    annotations: {
      convertAllComments: false,
      excludeAnnotationsFromCopy: false,
    },
    enableEditorActiveLineHighlight: true,
  },
  colors: {
    dark: SolarizedDarkColors,
    light: SolarizedLightColors,
  },
}

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
    hoverTabBackgroundColor: '#333333',
    hoverTabTextColor: '#CCCCCC',
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
    hoverTabBackgroundColor: '#F0F0F0',
    hoverTabTextColor: '#888888',
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

const Obsidian: Theme = {
  baseTheme: "Obsidian",
  settings: {
    codeblock: {
      enableLineNumbers: true,
      enableActiveLineHighlight: true,
      codeBlockBorderStylingPosition: 'disable',
      showIndentationLines: false,
      enableLinks: false,
      enableLinkUpdate: false,
      enableBracketHighlight: true,
      highlightNonMatchingBrackets: true,
      enableSelectionMatching: false,
      unwrapcode: false,
      hideFenceLines: false,
      buttons: {
        alwaysShowButtons: false,
        alwaysShowCopyCodeButton: false,
        enableSelectCodeButton: false,
        enableDeleteCodeButton: false,
        enableWrapCodeButton: false,
      },
      folding: {
        inverseFold: false,
        rememberFoldState: true,
        scope: FoldingScope.NoFoldSpecified,
        persistence: FoldingPersistence.Session,
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
      displayCodeBlockIcon: false,
      disableFoldUnlessSpecified: false,
    },
    gutter: {
      highlightActiveLineNr: true,
      enableHighlight: true,
    },
    inlineCode: {
      enableInlineCodeStyling: true,
      enableSyntaxHighlight: true,
      showIcons: false,
      enableCopyOnClick: true,
      copyModifierKey: InlineCodeModifierKeys.CTRL
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
    },
    annotations: {
      convertAllComments: false,
      excludeAnnotationsFromCopy: false,
    },
    enableEditorActiveLineHighlight: true,
  },
  colors: {
    dark: ObsidianDarkColors,
    light: ObsidianLightColors,
  },
}

export const DEFAULT_THEMES = {
  'Obsidian': Obsidian,
  'Solarized': Solarized,
}

export const DEFAULT_SETTINGS: CodeblockCustomizerSettings = {
  Themes: structuredClone(DEFAULT_THEMES),
  ExcludeLangs: 'dataview, ad-*',
  SelectedTheme: structuredClone(Obsidian),
  ThemeName: "Obsidian",
  newThemeName: "",
  newPromptName: "",
  alternateHighlightColorName: "",
  languageBorderColorName: "",
  settingsType: "basic",
  langSpecificSettingsType: "",
  languageSpecificLanguageName: "",
}