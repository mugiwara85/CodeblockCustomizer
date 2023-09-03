export interface Colors {
  codeblock: {
    activeLineColor: string;
    backgroundColor: string;
    highlightColor: string;
    alternateHighlightColors: Record<string, string>;
    languageBorderColors: Record<string, string>;
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
}

export interface ThemeColors {
  dark: Colors;
  light: Colors;
}

export interface ThemeSettings {
  codeblock: {
    enableLineNumbers: boolean;
    enableActiveLineHighlight: boolean;
    enableDeleteCodeButton: boolean;
    codeBlockBorderStylingPosition: string;
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
  },
  enableEditorActiveLineHighlight: boolean;
}

export interface Theme {
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

const Solarized: Theme = {
  settings: {
    codeblock: {
      enableLineNumbers: true,
      enableActiveLineHighlight: true,
      enableDeleteCodeButton: false,
      codeBlockBorderStylingPosition: 'disable',
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
    },
    enableEditorActiveLineHighlight: true,
  },
  colors: {
    dark: {
      codeblock: {
        activeLineColor: D_ACTIVE_CODEBLOCK_LINE_COLOR,
        backgroundColor: D_BACKGROUND_COLOR,
        highlightColor: D_HIGHLIGHT_COLOR,
        alternateHighlightColors: {},
        languageBorderColors: {},
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
    },
    light: {
      codeblock: {
        activeLineColor: L_ACTIVE_CODEBLOCK_LINE_COLOR,
        backgroundColor: L_BACKGROUND_COLOR,
        highlightColor: L_HIGHLIGHT_COLOR,
        alternateHighlightColors: {},
        languageBorderColors: {},
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
    },
  },
}

const Obsidian: Theme = {
  settings: {
    codeblock: {
      enableLineNumbers: true,
      enableActiveLineHighlight: true,
      enableDeleteCodeButton: false,
      codeBlockBorderStylingPosition: 'disable',
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
    },
    enableEditorActiveLineHighlight: true,
  },
  colors: {
    dark: {
      codeblock: {
        activeLineColor: "--color-base-30",
        backgroundColor: "--code-background",
        highlightColor: "--text-highlight-bg",
        alternateHighlightColors: {},
        languageBorderColors: {},
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
    },
    light: {
      codeblock: {
        activeLineColor: "--color-base-30",
        backgroundColor: "--code-background",
        highlightColor: "--text-highlight-bg",
        alternateHighlightColors: {},
        languageBorderColors: {},
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
    },
  },
}

const Dracula: Theme = {
  settings: {
    codeblock: {
      enableLineNumbers: true,
      enableActiveLineHighlight: true,
      enableDeleteCodeButton: false,
      codeBlockBorderStylingPosition: 'disable',
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
    },
    enableEditorActiveLineHighlight: true,
  },
  colors: {
    dark: {
      "codeblock": {
        "activeLineColor": "#282a36",
        "backgroundColor": "#282a36",
        "highlightColor": "#44475a",
        "alternateHighlightColors": {},
        "languageBorderColors": {}
      },
      "header": {
        "backgroundColor": "#282a36",
        "textColor": "#f8f8f2",
        "lineColor": "#44475a",
        "codeBlockLangTextColor": "#6272a4",
        "codeBlockLangBackgroundColor": "#44475a"
      },
      "gutter": {
        "textColor": "#6272a4",
        "backgroundColor": "#282a36",
        "activeLineNrColor": "#bd93f9"
      },
      "inlineCode": {
        "backgroundColor": "#f8f8f2",
        "textColor": "#44475a"
      },
      "editorActiveLineColor": "#bd93f9"
    },
    light: {
      "codeblock": {
        "activeLineColor": "#f8f8f2",
        "backgroundColor": "#f8f8f2",
        "highlightColor": "#ececec",
        "alternateHighlightColors": {},
        "languageBorderColors": {}
      },
      "header": {
        "backgroundColor": "#f8f8f2",
        "textColor": "#282a36",
        "lineColor": "#ececec",
        "codeBlockLangTextColor": "#6272a4",
        "codeBlockLangBackgroundColor": "#ececec"
      },
      "gutter": {
        "textColor": "#6272a4",
        "backgroundColor": "#f8f8f2",
        "activeLineNrColor": "#bd93f9"
      },
      "inlineCode": {
        "backgroundColor": "#282a36",
        "textColor": "#f8f8f2"
      },
      "editorActiveLineColor": "#bd93f9"
    },
  }
}

const OneDark: Theme = {
  settings: {
    codeblock: {
      enableLineNumbers: true,
      enableActiveLineHighlight: true,
      enableDeleteCodeButton: false,
      codeBlockBorderStylingPosition: 'disable',
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
    },
    enableEditorActiveLineHighlight: true,
  },
  colors: {
	dark: {
    "codeblock": {
      "activeLineColor": "#282c34",
      "backgroundColor": "#282c34",
      "highlightColor": "#3e4451",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#282c34",
      "textColor": "#abb2bf",
      "lineColor": "#3e4451",
      "codeBlockLangTextColor": "#98c379",
      "codeBlockLangBackgroundColor": "#3e4451"
    },
    "gutter": {
      "textColor": "#98c379",
      "backgroundColor": "#282c34",
      "activeLineNrColor": "#61afef"
    },
    "inlineCode": {
      "backgroundColor": "#abb2bf",
      "textColor": "#3e4451"
    },
    "editorActiveLineColor": "#61afef"
	},
	light: {
    "codeblock": {
      "activeLineColor": "#e4e4e4",
      "backgroundColor": "#f5f5f5",
      "highlightColor": "#d4d4d4",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#f5f5f5",
      "textColor": "#333333",
      "lineColor": "#d4d4d4",
      "codeBlockLangTextColor": "#5a5a5a",
      "codeBlockLangBackgroundColor": "#d4d4d4"
    },
    "gutter": {
      "textColor": "#5a5a5a",
      "backgroundColor": "#f5f5f5",
      "activeLineNrColor": "#4078f2"
    },
    "inlineCode": {
      "backgroundColor": "#f5f5f5",
      "textColor": "#333333"
    },
    "editorActiveLineColor": "#4078f2"
	},
}
}

const GitHub: Theme = {
  settings: {
    codeblock: {
      enableLineNumbers: true,
      enableActiveLineHighlight: true,
      enableDeleteCodeButton: false,
      codeBlockBorderStylingPosition: 'disable',
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
    },
    enableEditorActiveLineHighlight: true,
  },
  colors: {
	dark: {
    "codeblock": {
      "activeLineColor": "#0d1117",
      "backgroundColor": "#0d1117",
      "highlightColor": "#161b22",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#0d1117",
      "textColor": "#c9d1d9",
      "lineColor": "#161b22",
      "codeBlockLangTextColor": "#58a6ff",
      "codeBlockLangBackgroundColor": "#161b22"
    },
    "gutter": {
      "textColor": "#58a6ff",
      "backgroundColor": "#0d1117",
      "activeLineNrColor": "#93a1a1"
    },
    "inlineCode": {
      "backgroundColor": "#161b22",
      "textColor": "#c9d1d9"
    },
    "editorActiveLineColor": "#93a1a1"
	},
	light: {
    "codeblock": {
      "activeLineColor": "#f3f3f3",
      "backgroundColor": "#ffffff",
      "highlightColor": "#f0f0f0",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#ffffff",
      "textColor": "#333333",
      "lineColor": "#f0f0f0",
      "codeBlockLangTextColor": "#6f42c1",
      "codeBlockLangBackgroundColor": "#f0f0f0"
    },
    "gutter": {
      "textColor": "#6f42c1",
      "backgroundColor": "#ffffff",
      "activeLineNrColor": "#0366d6"
    },
    "inlineCode": {
      "backgroundColor": "#f0f0f0",
      "textColor": "#333333"
    },
    "editorActiveLineColor": "#0366d6"
	},
}
}

const Material: Theme = {
  settings: {
    codeblock: {
      enableLineNumbers: true,
      enableActiveLineHighlight: true,
      enableDeleteCodeButton: false,
      codeBlockBorderStylingPosition: 'disable',
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
    },
    enableEditorActiveLineHighlight: true,
  },
  colors: {
	dark: {
    "codeblock": {
      "activeLineColor": "#2d2d2d",
      "backgroundColor": "#121212",
      "highlightColor": "#333333",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#121212",
      "textColor": "#e0e0e0",
      "lineColor": "#333333",
      "codeBlockLangTextColor": "#039be5",
      "codeBlockLangBackgroundColor": "#333333"
    },
    "gutter": {
      "textColor": "#039be5",
      "backgroundColor": "#121212",
      "activeLineNrColor": "#f50057"
    },
    "inlineCode": {
      "backgroundColor": "#333333",
      "textColor": "#e0e0e0"
    },
    "editorActiveLineColor": "#f50057"
	},
	light: {
    "codeblock": {
      "activeLineColor": "#ffffff",
      "backgroundColor": "#f2f2f2",
      "highlightColor": "#e0e0e0",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#ffffff",
      "textColor": "#333333",
      "lineColor": "#e0e0e0",
      "codeBlockLangTextColor": "#0277bd",
      "codeBlockLangBackgroundColor": "#e0e0e0"
    },
    "gutter": {
      "textColor": "#0277bd",
      "backgroundColor": "#f2f2f2",
      "activeLineNrColor": "#e91e63"
    },
    "inlineCode": {
      "backgroundColor": "#e0e0e0",
      "textColor": "#333333"
    },
    "editorActiveLineColor": "#e91e63"
	},
}
}

const MaterialOcean: Theme = {
  settings: {
    codeblock: {
      enableLineNumbers: true,
      enableActiveLineHighlight: true,
      enableDeleteCodeButton: false,
      codeBlockBorderStylingPosition: 'disable',
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
    },
    enableEditorActiveLineHighlight: true,
  },
  colors: {
	dark: {
    "codeblock": {
      "activeLineColor": "#2d2d2d",
      "backgroundColor": "#121212",
      "highlightColor": "#333333",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#121212",
      "textColor": "#e0e0e0",
      "lineColor": "#333333",
      "codeBlockLangTextColor": "#039be5",
      "codeBlockLangBackgroundColor": "#333333"
    },
    "gutter": {
      "textColor": "#039be5",
      "backgroundColor": "#121212",
      "activeLineNrColor": "#4caf50"
    },
    "inlineCode": {
      "backgroundColor": "#333333",
      "textColor": "#e0e0e0"
    },
    "editorActiveLineColor": "#4caf50"
	},
	light: {
    "codeblock": {
      "activeLineColor": "#ffffff",
      "backgroundColor": "#f2f2f2",
      "highlightColor": "#e0e0e0",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#ffffff",
      "textColor": "#333333",
      "lineColor": "#e0e0e0",
      "codeBlockLangTextColor": "#039be5",
      "codeBlockLangBackgroundColor": "#e0e0e0"
    },
    "gutter": {
      "textColor": "#039be5",
      "backgroundColor": "#f2f2f2",
      "activeLineNrColor": "#4caf50"
    },
    "inlineCode": {
      "backgroundColor": "#e0e0e0",
      "textColor": "#333333"
    },
    "editorActiveLineColor": "#4caf50"
	},
}
}

const Monokai: Theme = {
  settings: {
    codeblock: {
      enableLineNumbers: true,
      enableActiveLineHighlight: true,
      enableDeleteCodeButton: false,
      codeBlockBorderStylingPosition: 'disable',
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
    },
    enableEditorActiveLineHighlight: true,
  },
  colors: {
	dark: {
    "codeblock": {
      "activeLineColor": "#272822",
      "backgroundColor": "#272822",
      "highlightColor": "#49483e",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#272822",
      "textColor": "#d1d1d1",
      "lineColor": "#49483e",
      "codeBlockLangTextColor": "#f92672",
      "codeBlockLangBackgroundColor": "#49483e"
    },
    "gutter": {
      "textColor": "#f92672",
      "backgroundColor": "#272822",
      "activeLineNrColor": "#66d9ef"
    },
    "inlineCode": {
      "backgroundColor": "#49483e",
      "textColor": "#d1d1d1"
    },
    "editorActiveLineColor": "#66d9ef"
	},
	light: {
    "codeblock": {
      "activeLineColor": "#ffffff",
      "backgroundColor": "#f5f5f5",
      "highlightColor": "#e0e0e0",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#f5f5f5",
      "textColor": "#333333",
      "lineColor": "#e0e0e0",
      "codeBlockLangTextColor": "#f92672",
      "codeBlockLangBackgroundColor": "#e0e0e0"
    },
    "gutter": {
      "textColor": "#f92672",
      "backgroundColor": "#f5f5f5",
      "activeLineNrColor": "#66d9ef"
    },
    "inlineCode": {
      "backgroundColor": "#e0e0e0",
      "textColor": "#333333"
    },
    "editorActiveLineColor": "#66d9ef"
	},
}
}

const Zenburn: Theme = {
  settings: {
    codeblock: {
      enableLineNumbers: true,
      enableActiveLineHighlight: true,
      enableDeleteCodeButton: false,
      codeBlockBorderStylingPosition: 'disable',
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
    },
    enableEditorActiveLineHighlight: true,
  },
  colors: {
	dark: {
    "codeblock": {
      "activeLineColor": "#3f3f3f",
      "backgroundColor": "#3f3f3f",
      "highlightColor": "#2b2b2b",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#3f3f3f",
      "textColor": "#dcdccc",
      "lineColor": "#2b2b2b",
      "codeBlockLangTextColor": "#6d9cbe",
      "codeBlockLangBackgroundColor": "#2b2b2b"
    },
    "gutter": {
      "textColor": "#6d9cbe",
      "backgroundColor": "#3f3f3f",
      "activeLineNrColor": "#a88851"
    },
    "inlineCode": {
      "backgroundColor": "#2b2b2b",
      "textColor": "#dcdccc"
    },
    "editorActiveLineColor": "#a88851"
	},
	light: {
    "codeblock": {
      "activeLineColor": "#f0f0f0",
      "backgroundColor": "#f0f0f0",
      "highlightColor": "#e0e0e0",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#f0f0f0",
      "textColor": "#333333",
      "lineColor": "#e0e0e0",
      "codeBlockLangTextColor": "#6d9cbe",
      "codeBlockLangBackgroundColor": "#e0e0e0"
    },
    "gutter": {
      "textColor": "#6d9cbe",
      "backgroundColor": "#f0f0f0",
      "activeLineNrColor": "#a88851"
    },
    "inlineCode": {
      "backgroundColor": "#e0e0e0",
      "textColor": "#333333"
    },
    "editorActiveLineColor": "#a88851"
	},
}
}

const Nord: Theme = {
  settings: {
    codeblock: {
      enableLineNumbers: true,
      enableActiveLineHighlight: true,
      enableDeleteCodeButton: false,
      codeBlockBorderStylingPosition: 'disable',
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
    },
    enableEditorActiveLineHighlight: true,
  },
  colors: {
	dark: {
    "codeblock": {
      "activeLineColor": "#2e3440",
      "backgroundColor": "#2e3440",
      "highlightColor": "#3b4252",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#2e3440",
      "textColor": "#d8dee9",
      "lineColor": "#3b4252",
      "codeBlockLangTextColor": "#81a1c1",
      "codeBlockLangBackgroundColor": "#3b4252"
    },
    "gutter": {
      "textColor": "#81a1c1",
      "backgroundColor": "#2e3440",
      "activeLineNrColor": "#88c0d0"
    },
    "inlineCode": {
      "backgroundColor": "#3b4252",
      "textColor": "#d8dee9"
    },
    "editorActiveLineColor": "#88c0d0"
	},
	light: {
    "codeblock": {
      "activeLineColor": "#ffffff",
      "backgroundColor": "#e5e9f0",
      "highlightColor": "#d8dee9",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#e5e9f0",
      "textColor": "#333333",
      "lineColor": "#d8dee9",
      "codeBlockLangTextColor": "#81a1c1",
      "codeBlockLangBackgroundColor": "#d8dee9"
    },
    "gutter": {
      "textColor": "#81a1c1",
      "backgroundColor": "#e5e9f0",
      "activeLineNrColor": "#88c0d0"
    },
    "inlineCode": {
      "backgroundColor": "#d8dee9",
      "textColor": "#333333"
    },
    "editorActiveLineColor": "#88c0d0"
	},
}
}

const Cobalt2: Theme = {
  settings: {
    codeblock: {
      enableLineNumbers: true,
      enableActiveLineHighlight: true,
      enableDeleteCodeButton: false,
      codeBlockBorderStylingPosition: 'disable',
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
    },
    enableEditorActiveLineHighlight: true,
  },
  colors: {
	dark: {
    "codeblock": {
      "activeLineColor": "#193549",
      "backgroundColor": "#193549",
      "highlightColor": "#273c55",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#193549",
      "textColor": "#b7c8e1",
      "lineColor": "#273c55",
      "codeBlockLangTextColor": "#00a4db",
      "codeBlockLangBackgroundColor": "#273c55"
    },
    "gutter": {
      "textColor": "#00a4db",
      "backgroundColor": "#193549",
      "activeLineNrColor": "#ff5f00"
    },
    "inlineCode": {
      "backgroundColor": "#273c55",
      "textColor": "#b7c8e1"
    },
    "editorActiveLineColor": "#ff5f00"
	},
	light: {
    "codeblock": {
      "activeLineColor": "#ffffff",
      "backgroundColor": "#f5f7fa",
      "highlightColor": "#d4d9e2",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#f5f7fa",
      "textColor": "#333333",
      "lineColor": "#d4d9e2",
      "codeBlockLangTextColor": "#00a4db",
      "codeBlockLangBackgroundColor": "#d4d9e2"
    },
    "gutter": {
      "textColor": "#00a4db",
      "backgroundColor": "#f5f7fa",
      "activeLineNrColor": "#ff5f00"
    },
    "inlineCode": {
      "backgroundColor": "#d4d9e2",
      "textColor": "#333333"
    },
    "editorActiveLineColor": "#ff5f00"
	},
}
}

const NightOwl: Theme = {
  settings: {
    codeblock: {
      enableLineNumbers: true,
      enableActiveLineHighlight: true,
      enableDeleteCodeButton: false,
      codeBlockBorderStylingPosition: 'disable',
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
    },
    enableEditorActiveLineHighlight: true,
  },
  colors: {
	dark: {
    "codeblock": {
      "activeLineColor": "#1e2127",
      "backgroundColor": "#1e2127",
      "highlightColor": "#282c34",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#1e2127",
      "textColor": "#c1c4cd",
      "lineColor": "#282c34",
      "codeBlockLangTextColor": "#0081b1",
      "codeBlockLangBackgroundColor": "#282c34"
    },
    "gutter": {
      "textColor": "#0081b1",
      "backgroundColor": "#1e2127",
      "activeLineNrColor": "#ff6d00"
    },
    "inlineCode": {
      "backgroundColor": "#282c34",
      "textColor": "#c1c4cd"
    },
    "editorActiveLineColor": "#ff6d00"
	},
	light: {
    "codeblock": {
      "activeLineColor": "#ffffff",
      "backgroundColor": "#f9f9f9",
      "highlightColor": "#e6e6e6",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#f9f9f9",
      "textColor": "#333333",
      "lineColor": "#e6e6e6",
      "codeBlockLangTextColor": "#0081b1",
      "codeBlockLangBackgroundColor": "#e6e6e6"
    },
    "gutter": {
      "textColor": "#0081b1",
      "backgroundColor": "#f9f9f9",
      "activeLineNrColor": "#ff6d00"
    },
    "inlineCode": {
      "backgroundColor": "#e6e6e6",
      "textColor": "#333333"
    },
    "editorActiveLineColor": "#ff6d00"
	},
}
}

const NightRider: Theme = {
  settings: {
    codeblock: {
      enableLineNumbers: true,
      enableActiveLineHighlight: true,
      enableDeleteCodeButton: false,
      codeBlockBorderStylingPosition: 'disable',
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
    },
    enableEditorActiveLineHighlight: true,
  },
  colors: {
	dark: {
    "codeblock": {
      "activeLineColor": "#24252a",
      "backgroundColor": "#24252a",
      "highlightColor": "#30333c",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#24252a",
      "textColor": "#a2a3a7",
      "lineColor": "#30333c",
      "codeBlockLangTextColor": "#8d93ab",
      "codeBlockLangBackgroundColor": "#30333c"
    },
    "gutter": {
      "textColor": "#8d93ab",
      "backgroundColor": "#24252a",
      "activeLineNrColor": "#ff4081"
    },
    "inlineCode": {
      "backgroundColor": "#30333c",
      "textColor": "#a2a3a7"
    },
    "editorActiveLineColor": "#ff4081"
	},
	light: {
    "codeblock": {
      "activeLineColor": "#f0f0f0",
      "backgroundColor": "#f0f0f0",
      "highlightColor": "#e0e0e0",
      "alternateHighlightColors": {},
      "languageBorderColors": {}
    },
    "header": {
      "backgroundColor": "#f0f0f0",
      "textColor": "#333333",
      "lineColor": "#e0e0e0",
      "codeBlockLangTextColor": "#8d93ab",
      "codeBlockLangBackgroundColor": "#e0e0e0"
    },
    "gutter": {
      "textColor": "#8d93ab",
      "backgroundColor": "#f0f0f0",
      "activeLineNrColor": "#ff4081"
    },
    "inlineCode": {
      "backgroundColor": "#e0e0e0",
      "textColor": "#333333"
    },
    "editorActiveLineColor": "#ff4081"
	},
}
}


export const DEFAULT_SETTINGS: CodeblockCustomizerSettings = {
  Themes: {
    'Obsidian': Obsidian,
    'Solarized': Solarized,
    'Dracula': Dracula,
    'One Dark': OneDark,
    'GitHub': GitHub,
    'Material': Material,
    'Material Ocean': MaterialOcean,
    'Monokai': Monokai,
    'Zenburn ': Zenburn ,
    'Nord': Nord,
    'Cobalt2': Cobalt2,
    'Night Owl': NightOwl,
    'Night Rider ': NightRider ,
  },
  ExcludeLangs: 'dataview, ad-*',
  SelectedTheme: structuredClone(Obsidian),
  ThemeName: "Obsidian",
  newThemeName: "",
  alternateHighlightColorName: "",
  languageBorderColorName: "",
  foldAllCommand: false,
}