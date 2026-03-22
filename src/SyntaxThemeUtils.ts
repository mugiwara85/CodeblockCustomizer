import { CodeblockCustomizerSettings } from "./Settings";
import { getCurrentMode } from "./Utils";

export function generateSyntaxThemeStyles(settings: CodeblockCustomizerSettings): string {
  const { globalSyntaxTheme, languageSpecificSyntaxThemes } = settings.pluginSettings.syntaxThemes;
  const currentMode = getCurrentMode();

  const lightVars: string[] = [];
  const darkVars: string[] = [];
  const tokenRules: string[] = [];
  const printVars: string[] = [];

  // global syntax theme
  if (globalSyntaxTheme && settings.SyntaxThemes[globalSyntaxTheme]) {
    const theme = settings.SyntaxThemes[globalSyntaxTheme];

    for (const [token, color] of Object.entries(theme.colors.light)) {
      if (color) {
        lightVars.push(`--cbc-syntax-${token}: ${color};`);
      }
    }
    for (const [token, color] of Object.entries(theme.colors.dark)) {
      if (color) {
        darkVars.push(`--cbc-syntax-${token}: ${color};`);
      }
    }

    const printColors = theme.colors[currentMode];
    for (const [token, color] of Object.entries(printColors)) {
      if (color) {
        printVars.push(`--cbc-syntax-${token}: ${color};`);
      }
    }

    const allTokens = new Set([
      ...Object.keys(theme.colors.light),
      ...Object.keys(theme.colors.dark),
    ]);

    for (const token of allTokens) {
      const varName = `--cbc-syntax-${token}`;
      tokenRules.push(`.codeblock-customizer-line-text .token.${token}, .cbc-prism .token.${token} { color: var(${varName}) !important; }`);
      tokenRules.push(`.print .codeblock-customizer-line-text .token.${token} { color: var(${varName}) !important; }`);
    }
  }

  // per-language syntax theme overrides
  for (const [language, themeName] of Object.entries(languageSpecificSyntaxThemes)) {
    const theme = settings.SyntaxThemes[themeName];
    if (!theme) {
      continue;
    }

    const langLower = language.toLowerCase();

    for (const [token, color] of Object.entries(theme.colors.light)) {
      if (color) {
        lightVars.push(`--cbc-syntax-${langLower}-${token}: ${color};`);
      }
    }
    for (const [token, color] of Object.entries(theme.colors.dark)) {
      if (color) {
        darkVars.push(`--cbc-syntax-${langLower}-${token}: ${color};`);
      }
    }

    const printColors = theme.colors[currentMode];
    for (const [token, color] of Object.entries(printColors)) {
      if (color) {
        printVars.push(`--cbc-syntax-${langLower}-${token}: ${color};`);
      }
    }

    const allTokens = new Set([
      ...Object.keys(theme.colors.light),
      ...Object.keys(theme.colors.dark),
    ]);
    for (const token of allTokens) {
      const varName = `--cbc-syntax-${langLower}-${token}`;
      tokenRules.push(`.codeblock-customizer-language-${langLower} .codeblock-customizer-line-text .token.${token}, .cbc-prism.codeblock-customizer-language-${langLower} .token.${token} { color: var(${varName}) !important; }`);
      tokenRules.push(`.print .codeblock-customizer-language-${langLower} .codeblock-customizer-line-text .token.${token} { color: var(${varName}) !important; }`);
    }
  }

  if (lightVars.length === 0 && darkVars.length === 0) {
    return '';
  }

  return `
    body.codeblock-customizer.theme-light { ${lightVars.join(' ')} }
    body.codeblock-customizer.theme-dark { ${darkVars.join(' ')} }
    .print body { ${printVars.join(' ')} }
    ${tokenRules.join(' ')}
  `;
}// generateSyntaxThemeStyles
