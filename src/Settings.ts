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
  editorActiveLineColor: string;
  languageSpecificColors: Record<string, Record<string, string>>;
}

export interface ThemeColors {
  dark: Colors;
  light: Colors;
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
    inverseFold: boolean;
    enableSelectionMatching: boolean;
    unwrapcode: boolean;
    buttons: {
      alwaysShowButtons: boolean;
      alwaysShowCopyCodeButton: boolean;
      enableSelectCodeButton: boolean;
      enableWrapCodeButton: boolean;
      enableDeleteCodeButton: boolean;
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
  },
  printing: {
    enablePrintToPDFStyling: boolean;
    forceCurrentColorUse: boolean;
    uncollapseDuringPrint: boolean;
  },
  common: {
    enableInSourceMode: boolean;
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
  alternateHighlightColorName: string;
  languageBorderColorName: string;
  foldAllCommand: boolean;
  settingsType: string;
  langSpecificSettingsType: string;
  languageSpecificLanguageName: string;
}

// dark
export const D_ACTIVE_CODEBLOCK_LINE_COLOR = '#073642';
export const D_ACTIVE_LINE_COLOR = '#468eeb33';
export const D_BACKGROUND_COLOR = '#002B36';
export const D_HIGHLIGHT_COLOR = '#054b5c';
export const D_HEADER_COLOR = '#0a4554';
export const D_HEADER_TEXT_COLOR = '#DADADA';
export const D_HEADER_LINE_COLOR = '#46cced';
export const D_GUTTER_TEXT_COLOR = '#6c6c6c';
export const D_GUTTER_BACKGROUND_COLOR = '#073642';
export const D_LANG_COLOR = '#000000';
export const D_LANG_BACKGROUND_COLOR = '#008080';
export const D_GUTTER_ACTIVE_LINENR_COLOR = '#DADADA';
export const D_INLINE_CODE_BACKGROUND_COLOR = '#054b5c';
export const D_INLINE_CODE_TEXT_COLOR = '#DADADA';

// light
export const L_ACTIVE_CODEBLOCK_LINE_COLOR = '#EDE8D6';
export const L_ACTIVE_LINE_COLOR = '#60460633';
export const L_BACKGROUND_COLOR = '#FCF6E4';
export const L_HIGHLIGHT_COLOR = '#E9DFBA';
export const L_HEADER_COLOR = '#D5CCB4';
export const L_HEADER_TEXT_COLOR = '#866704';
export const L_HEADER_LINE_COLOR = '#EDD489';
export const L_GUTTER_TEXT_COLOR = '#6c6c6c';
export const L_GUTTER_BACKGROUND_COLOR = '#EDE8D6';
export const L_LANG_COLOR = '#C25F30';
export const L_LANG_BACKGROUND_COLOR = '#B8B5AA';
export const L_GUTTER_ACTIVE_LINENR_COLOR = '#866704';
export const L_INLINE_CODE_BACKGROUND_COLOR = '#E9DFBA';
export const L_INLINE_CODE_TEXT_COLOR = '#866704';

const SELECTION_MATCH_COLOR = '#99ff7780';

const SolarizedDarkColors = {
  codeblock: {
    activeLineColor: D_ACTIVE_CODEBLOCK_LINE_COLOR,
    backgroundColor: D_BACKGROUND_COLOR,
    highlightColor: D_HIGHLIGHT_COLOR,
    alternateHighlightColors: {},
    languageBorderColors: {},
    textColor: '#A30505',
    bracketHighlightColorMatch: '#36e920',
    bracketHighlightColorNoMatch: '#FF0000',
    bracketHighlightBackgroundColorMatch: D_ACTIVE_CODEBLOCK_LINE_COLOR,
    bracketHighlightBackgroundColorNoMatch:D_ACTIVE_CODEBLOCK_LINE_COLOR,
    selectionMatchHighlightColor: SELECTION_MATCH_COLOR,
  },
  header: {
    backgroundColor: D_HEADER_COLOR,
    textColor: D_HEADER_TEXT_COLOR,
    lineColor: D_HEADER_LINE_COLOR,
    codeBlockLangTextColor: D_LANG_COLOR,
    codeBlockLangBackgroundColor: D_LANG_BACKGROUND_COLOR,
  },
  gutter: {
    textColor: D_GUTTER_TEXT_COLOR,
    backgroundColor: D_GUTTER_BACKGROUND_COLOR,
    activeLineNrColor: D_GUTTER_ACTIVE_LINENR_COLOR,
  },
  inlineCode: {
    backgroundColor: D_INLINE_CODE_BACKGROUND_COLOR,
    textColor: D_INLINE_CODE_TEXT_COLOR,
  },
  editorActiveLineColor: D_ACTIVE_LINE_COLOR,
  languageSpecificColors: {},
}

const SolarizedLightColors = {
  codeblock: {
    activeLineColor: L_ACTIVE_CODEBLOCK_LINE_COLOR,
    backgroundColor: L_BACKGROUND_COLOR,
    highlightColor: L_HIGHLIGHT_COLOR,
    alternateHighlightColors: {},
    languageBorderColors: {},
    textColor: '#A30505',
    bracketHighlightColorMatch: '#ff01f7',
    bracketHighlightColorNoMatch: '#FF0000',
    bracketHighlightBackgroundColorMatch: L_ACTIVE_CODEBLOCK_LINE_COLOR,
    bracketHighlightBackgroundColorNoMatch:L_ACTIVE_CODEBLOCK_LINE_COLOR,
    selectionMatchHighlightColor: SELECTION_MATCH_COLOR,
  },
  header: {
    backgroundColor: L_HEADER_COLOR,
    textColor: L_HEADER_TEXT_COLOR,
    lineColor: L_HEADER_LINE_COLOR,
    codeBlockLangTextColor: L_LANG_COLOR,
    codeBlockLangBackgroundColor: L_LANG_BACKGROUND_COLOR,
  },
  gutter: {
    textColor: L_GUTTER_TEXT_COLOR,
    backgroundColor: L_GUTTER_BACKGROUND_COLOR,
    activeLineNrColor: L_GUTTER_ACTIVE_LINENR_COLOR,
  },
  inlineCode: {
    backgroundColor: L_INLINE_CODE_BACKGROUND_COLOR,
    textColor: L_INLINE_CODE_TEXT_COLOR,
  },
  editorActiveLineColor: L_ACTIVE_LINE_COLOR,
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
      inverseFold: false,
      enableSelectionMatching: false,
      unwrapcode: false,
      buttons: {
        alwaysShowButtons: false,
        alwaysShowCopyCodeButton: false,
        enableSelectCodeButton: false,
        enableDeleteCodeButton: false,
        enableWrapCodeButton: false,
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
      enableInlineCodeStyling: false,
    },
    printing: {
      enablePrintToPDFStyling: false,
      forceCurrentColorUse: false,
      uncollapseDuringPrint: true,
    },
    common: {
      enableInSourceMode: false,
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
      inverseFold: false,
      enableSelectionMatching: false,
      unwrapcode: false,
      buttons: {
        alwaysShowButtons: false,
        alwaysShowCopyCodeButton: false,
        enableSelectCodeButton: false,
        enableDeleteCodeButton: false,
        enableWrapCodeButton: false,
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
      enableInlineCodeStyling: false,
    },
    printing: {
      enablePrintToPDFStyling: false,
      forceCurrentColorUse: false,
      uncollapseDuringPrint: true,
    },
    common: {
      enableInSourceMode: false,
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
  alternateHighlightColorName: "",
  languageBorderColorName: "",
  foldAllCommand: false,
  settingsType: "basic",
  langSpecificSettingsType: "",
  languageSpecificLanguageName: "",
}