import { setIcon, editorLivePreviewField } from "obsidian";
import { EditorState } from "@codemirror/state";

import { Languages, manualLang, Icons } from "./Const";
import { CodeblockCustomizerSettings, Colors, ThemeColors, ThemeSettings } from "./Settings";

export function getCurrentMode() {
  const body = document.querySelector('body');
  if (body !== null){
    if (body.classList.contains('theme-light')) {
      return "light";
    } else if (body.classList.contains('theme-dark')) {
      return "dark";
    }
  } else {
    //console.log('Error - getCurrentTheme');
  }
  return 'dark'; // fall back to dark
}// getCurrentTheme

export function splitAndTrimString(str: string) {
  if (!str) {
    return [];
  }
  
  // Replace * with .*
  str = str.replace(/\*/g, '.*');
  
  if (!str.includes(",")) {
    return [str];
  }
  
  return str.split(",").map(s => s.trim());
}// splitAndTrimString

function extractValue(str: string, searchTerm: string) {
  const originalStr = str;
  str = str.toLowerCase();
  
  if (str.includes(searchTerm)) {
    const startIndex = str.indexOf(searchTerm) + searchTerm.length;
    let result = "";
    if (str[startIndex] === "\"") {
      const endIndex = str.indexOf("\"", startIndex + 1);
      if (endIndex !== -1) {
        result = originalStr.substring(startIndex + 1, endIndex);
      } else {
        result = originalStr.substring(startIndex + 1);
      }
    } else {
      const endIndex = str.indexOf(" ", startIndex);
      if (endIndex !== -1) {
        result = originalStr.substring(startIndex, endIndex);
      } else {
        result = originalStr.substring(startIndex);
      }
    }
    return result.trim();
  }
  
  return null;
}// extractValue

export function extractFileTitle(str: string): string | null {
  const file =  extractValue(str, "file:");
  const title =  extractValue(str, "title:");

  if (file && title)
    return file;
  else if (file && !title)
    return file;
  else if (!file && title)
    return title;
  else
    return null;
}// extractFileTitle

export function getCodeBlockLanguage(str: string): string | null {
  const searchTerm = "```";
  const originalStr = str;
  str = str.toLowerCase();

  function removeLeadingBackticks(input: string): string {
    let cleanedInput = input;
    while (cleanedInput.startsWith("`")) {
      cleanedInput = cleanedInput.substring(1);
    }
    return cleanedInput;
  }

  if (str.startsWith(searchTerm)) {
    const startIndex = searchTerm.length;
    const endIndex = str.indexOf(" ", startIndex);
    let word = "";
    if (endIndex !== -1) {
      word = originalStr.substring(startIndex, endIndex);
    } else {
      word = originalStr.substring(startIndex);
    }

    if (!word.includes(":")) {
      if (word.toLowerCase() === "fold") 
        return null;
      else
        return removeLeadingBackticks(word);
    }
  }
  return null;
}// getCodeBlockLanguage

export function isFoldDefined(str: string): boolean {
  return isParameterDefined("fold", str);
}// isFoldDefined

export function isParameterDefined(searchTerm: string, str: string): boolean {
  str = str.toLowerCase();
  searchTerm = searchTerm.toLowerCase();

  if (str.includes(` ${searchTerm} `)) {
    return true;
  }
  const index = str.indexOf(searchTerm);
  if (index !== -1 && index === str.length - searchTerm.length && str[index - 1] === " ") {
    return true;
  }
  if (str.includes("```" + searchTerm + " ")) {
    return true;
  }
  if (str.includes("```" + searchTerm) && str.indexOf("```" + searchTerm) + ("```" + searchTerm).length === str.length) {
    return true;
  }
  return false;
}// isParameterDefined

export function extractParameter(str: string, searchTerm: string): string | null {
  const originalStr = str;
  str = str.toLowerCase();
  searchTerm = searchTerm.toLowerCase();

  if (str.includes(searchTerm)) {
    const startIndex = str.indexOf(searchTerm) + searchTerm.length;
    const endIndex = str.indexOf(" ", startIndex);
    if (endIndex !== -1) {
      return originalStr.substring(startIndex, endIndex).trim();
    } else {
      return originalStr.substring(startIndex).trim();
    }
  }

  return null;
}// extractParameter

export function getHighlightedLines(params: string | null): number[] {
  if (!params) {
    return [];
  }

  const trimmedParams = params.trim();
  const lines = trimmedParams.split(",");

  return lines.map(line => {
    if (line.includes("-")) {
      const range = line.split("-");
      const start = parseInt(range[0], 10);
      const end = parseInt(range[1], 10);
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
    return parseInt(line, 10);
  }).flat();
}// getHighlightedLines

export function isExcluded(lineText: string, excludeLangs: string) : boolean {
  if (isParameterDefined("exclude", lineText))
    return true;
  
  const codeBlockLang = getCodeBlockLanguage(lineText);
  const regexLangs = splitAndTrimString(excludeLangs).map(lang => new RegExp(`^${lang.replace(/\*/g, '.*')}$`, 'i'));
  
  for (const regexLang of regexLangs) {
    if (codeBlockLang && regexLang.test(codeBlockLang)) {
      return true;
    }
  }
  
  return false;
}// isExcluded

export function getLanguageIcon(DisplayName: string) {
  if (!DisplayName)
    return "";
    
  if (Icons.hasOwnProperty(DisplayName)) {
    return Icons[DisplayName];
  }
  
  return null;
}// getLanguageIcon

export function getDisplayLanguageName(code: string | null) {
  if (!code)
    return "";
  
  code = code.toLowerCase();
  
  if (Languages.hasOwnProperty(code)) {
    return Languages[code];
  } else if (manualLang.hasOwnProperty(code)) {
    return manualLang[code];
  } else if (code){
      return code.charAt(0).toUpperCase() + code.slice(1);
  }
  
  return "";
}// getDisplayLanguageName

export const BLOBS: Record<string, string> = {};
export function loadIcons(){
  for (const [key, value] of Object.entries(Icons)) {
    BLOBS[key.replace(/\s/g, "_")] = URL.createObjectURL(new Blob([`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 32 32">${value}</svg>`], { type: "image/svg+xml" }));
  }
}// loadIcons

// Functions for displaying header BEGIN
export function createContainer(specific: boolean, languageName: string, hasLangBorderColor: boolean) {
  const container = document.createElement("div");
  container.classList.add(`codeblock-customizer-header-container${specific ? '-specific' : ''}`);
  
  if (languageName)
    container.classList.add(`codeblock-customizer-language-${languageName.toLowerCase()}`);

  if (hasLangBorderColor)
    container.classList.add(`hasLangBorderColor`);

  return container;
}// createContainer

export function createCodeblockLang(lang: string) {
  const codeblockLang = document.createElement("div");
  codeblockLang.innerText = getDisplayLanguageName(lang);
  codeblockLang.classList.add(`codeblock-customizer-header-language-tag-${lang.toLowerCase()}`);
  return codeblockLang;
}// createCodeblockLang

export function createCodeblockIcon(displayLang: string) {
  const div = document.createElement("div");
  const img = document.createElement("img");
  img.classList.add("codeblock-customizer-icon");
  img.width = 28; //32
  img.src = BLOBS[displayLang.replace(/\s/g, "_")];

  div.appendChild(img);
  
  return div;
}// createCodeblockIcon

export function createCodeblockCollapse(defaultFold: boolean) {
  const collapse = document.createElement("div");
  //collapse.innerText = defaultFold ? "+" : "-";
  if (defaultFold)
    setIcon(collapse, "chevrons-down-up");
  else
    setIcon(collapse, "chevrons-up-down");
    
  collapse.classList.add(`codeblock-customizer-header-collapse`);
  return collapse;
}// createCodeblockLang

export function createFileName(text: string) {
  const fileName = document.createElement("div");
  fileName.innerText = text;
  fileName.classList.add("codeblock-customizer-header-text");
  return fileName;
}// createFileName

export function createUncollapseCodeButton() {
  const uncollapseCodeButton = document.createElement("span");
  uncollapseCodeButton.classList.add("codeblock-customizer-uncollapse-code");
  uncollapseCodeButton.setAttribute("aria-label", "Uncollapse code block");
  setIcon(uncollapseCodeButton, "chevron-down");

  return uncollapseCodeButton;
}// createUncollapseCodeButton

export function getBorderColorByLanguage(languageName: string, languageBorderColors: Record<string, string>): string {
  const lowercaseLanguageName = languageName.toLowerCase();

  for (const key in languageBorderColors) {
    if (key.toLowerCase() === lowercaseLanguageName) {
      return languageBorderColors[key];
    }
  }

  return "";
}// getBorderColorByLanguage

// Functions for displaying header END
interface StylesDict {
  [key: string]: string;
}

const stylesDict: StylesDict = {
  "codeblock.activeLineColor": 'codeblock-active-line-color',
  "editorActiveLineColor": 'editor-active-line-color',
  "codeblock.backgroundColor": 'codeblock-background-color',
  "codeblock.highlightColor": 'codeblock-highlight-color',
  "header.backgroundColor": 'header-background-color',
  "header.textColor": 'header-text-color',
  "header.lineColor": 'header-line-color',
  "gutter.textColor": 'gutter-text-color',
  "gutter.backgroundColor": 'gutter-background-color',
  "header.codeBlockLangTextColor": 'header-language-tag-text-color',
  "header.codeBlockLangBackgroundColor": 'header-language-tag-background-color',
  "gutter.activeLineNrColor": 'gutter-active-linenr-color',
  "inlineCode.backgroundColor": 'inline-code-background-color',
  "inlineCode.textColor": 'inline-code-text-color',
}// stylesDict

export function updateSettingStyles(settings: CodeblockCustomizerSettings) {
  const styleId = 'codeblock-customizer-styles';
  let styleTag = document.getElementById(styleId);
  if (typeof(styleTag) == 'undefined' || styleTag == null) {
    styleTag = document.createElement('style');
    styleTag.id = styleId;
    document.getElementsByTagName('head')[0].appendChild(styleTag);
  }
  const currentMode = getCurrentMode();

  const altHighlightStyling = Object.entries(settings.SelectedTheme.colors[currentMode].codeblock.alternateHighlightColors || {}).reduce((styling, [colorName, hexValue]) => {
    return styling + `
      .codeblock-customizer-line-highlighted-${colorName.replace(/\s+/g, '-').toLowerCase()} {
        background-color: var(--codeblock-customizer-highlight-${colorName.replace(/\s+/g, '-').toLowerCase()}-color, ${hexValue}) !important;
      }
    `;
  }, '');

  const borderLangColorStyling = Object.entries(settings.SelectedTheme.colors[currentMode].codeblock.languageBorderColors || {}).reduce((styling, [colorName, hexValue]) => {
    return styling + `
    .codeblock-customizer-language-${colorName.toLowerCase()} {
      --border-color: ${hexValue};
    }
    `;
  }, '');

  const textSettingsStyles = `
    body.codeblock-customizer [class^="codeblock-customizer-header-language-tag"] {
      --codeblock-customizer-language-tag-text-bold: ${settings.SelectedTheme.settings.header.codeblockLangBoldText ? 'bold' : 'normal'};
      --codeblock-customizer-language-tag-text-italic: ${settings.SelectedTheme.settings.header.codeblockLangItalicText ? 'italic' : 'normal'};
    }
    body.codeblock-customizer .codeblock-customizer-header-text {
      --codeblock-customizer-header-text-bold: ${settings.SelectedTheme.settings.header.boldText ? 'bold' : 'normal'};
      --codeblock-customizer-header-text-italic: ${settings.SelectedTheme.settings.header.italicText ? 'italic' : 'normal'};
    }
  `;
  styleTag.innerText = (formatStyles(settings.SelectedTheme.colors, settings.SelectedTheme.colors[currentMode].codeblock.alternateHighlightColors, settings.SelectedTheme.settings.printing.forceCurrentColorUse) + altHighlightStyling + borderLangColorStyling + textSettingsStyles).trim().replace(/[\r\n\s]+/g, ' ');
  
  updateSettingClasses(settings.SelectedTheme.settings);
}// updateSettingStyles

function updateSettingClasses(settings: ThemeSettings) {
  document.body.classList.remove("codeblock-customizer-active-line-highlight", "codeblock-customizer-active-line-highlight-codeblock", "codeblock-customizer-active-line-highlight-editor")
  if (settings.enableEditorActiveLineHighlight && settings.codeblock.enableActiveLineHighlight) {
    // Inside and outside of codeblocks with different colors
    document.body.classList.add("codeblock-customizer-active-line-highlight");
  } else if (settings.enableEditorActiveLineHighlight && !settings.codeblock.enableActiveLineHighlight) {
    // Only outside codeblocks
    document.body.classList.add("codeblock-customizer-active-line-highlight-editor");
  } else if (!settings.enableEditorActiveLineHighlight && settings.codeblock.enableActiveLineHighlight) {
    // Only inside codeblocks
    document.body.classList.add("codeblock-customizer-active-line-highlight-codeblock");
  }
  
  if (settings.codeblock.enableLineNumbers) {
    document.body.classList.add("codeblock-customizer-show-line-numbers");
  } else {
    document.body.classList.remove("codeblock-customizer-show-line-numbers");
  }

  document.body.classList.remove("codeblock-customizer-show-langnames","codeblock-customizer-show-langnames-always");
  if (settings.header.alwaysDisplayCodeblockLang && settings.header.displayCodeBlockLanguage) {
    document.body.classList.add("codeblock-customizer-show-langnames-always");
  } else if (settings.header.displayCodeBlockLanguage) {
    document.body.classList.add("codeblock-customizer-show-langnames");
  }

  document.body.classList.remove("codeblock-customizer-show-langicons","codeblock-customizer-show-langicons-always");
  if (settings.header.alwaysDisplayCodeblockIcon && settings.header.displayCodeBlockIcon) {
    document.body.classList.add("codeblock-customizer-show-langicons-always");
  } else if (settings.header.displayCodeBlockIcon) {
    document.body.classList.add("codeblock-customizer-show-langicons");
  }

  if (settings.gutter.enableHighlight) {
    document.body.classList.add('codeblock-customizer-gutter-highlight');
  } else {
    document.body.classList.remove('codeblock-customizer-gutter-highlight');
  }
  
  if (settings.gutter.highlightActiveLineNr)
		document.body.classList.add('codeblock-customizer-gutter-active-line');
	else
		document.body.classList.remove('codeblock-customizer-gutter-active-line');

  if (settings.header.collapseIconPosition === "hide") {
      document.body.classList.add('codeblock-customizer-collapseIconNone');
      document.body.classList.remove('codeblock-customizer-collapseIconMiddle');
      document.body.classList.remove('codeblock-customizer-collapseIconRight');
  } else if (settings.header.collapseIconPosition === "middle") {
    document.body.classList.remove('codeblock-customizer-collapseIconNone');
    document.body.classList.remove('codeblock-customizer-collapseIconRight');
    document.body.classList.add('codeblock-customizer-collapseIconMiddle');
  } else if (settings.header.collapseIconPosition === "right") {
    document.body.classList.remove('codeblock-customizer-collapseIconNone');
    document.body.classList.remove('codeblock-customizer-collapseIconMiddle');
    document.body.classList.add('codeblock-customizer-collapseIconRight');
  }

  if (settings.codeblock.enableDeleteCodeButton)
    document.body.classList.add('codeblock-customizer-show-delete-code-button');
	else
		document.body.classList.remove('codeblock-customizer-show-delete-code-button');

  if (settings.inlineCode.enableInlineCodeStyling){
    document.body.classList.add('codeblock-customizer-style-inline-code');
  } else{
    document.body.classList.remove('codeblock-customizer-style-inline-code');
  }

  if (settings.codeblock.codeBlockBorderStylingPosition === "disable") {
    document.body.classList.remove('codeblock-customizer-style-codeblock-border-left');
    document.body.classList.remove('codeblock-customizer-style-codeblock-border-right');
  } else if (settings.codeblock.codeBlockBorderStylingPosition === "left") {
    document.body.classList.remove('codeblock-customizer-style-codeblock-border-right');
    document.body.classList.add('codeblock-customizer-style-codeblock-border-left');
  } else if (settings.codeblock.codeBlockBorderStylingPosition === "right") {
    document.body.classList.remove('codeblock-customizer-style-codeblock-border-left');
    document.body.classList.add('codeblock-customizer-style-codeblock-border-right');
  }

  if (settings.semiFold.enableSemiFold) {
    document.body.classList.add('codeblock-customizer-use-semifold');
  } else{
    document.body.classList.remove('codeblock-customizer-use-semifold');
  }

  if (settings.semiFold.showAdditionalUncollapseButon) {
    document.body.classList.add('codeblock-customizer-show-uncollapse-code-button');
  } else{
    document.body.classList.remove('codeblock-customizer-show-uncollapse-code-button');
  }

}// updateSettingStyles

function formatStyles(colors: ThemeColors, alternateColors: Record<string, string>, forceCurrentColorUse: boolean) {
  return `
    body.codeblock-customizer.theme-light {
      ${Object.keys(stylesDict).reduce((variables, key) => {
        const cssVariable = `--codeblock-customizer-${stylesDict[key]}`;
        let cssValue = accessSetting(key, forceCurrentColorUse ? colors[getCurrentMode()] : colors.light);

        if (cssValue.toString().startsWith("--"))
          cssValue = "var(" + cssValue + ")";

        if (cssValue != null) {
          return variables + `${cssVariable}: ${cssValue};`;
        } else {
          return variables;
        }
      },addAltHighlightColors(alternateColors, true))}
    } 
    body.codeblock-customizer.theme-dark {
      ${Object.keys(stylesDict).reduce((variables, key) => {
        const cssVariable = `--codeblock-customizer-${stylesDict[key]}`;
        let cssValue = accessSetting(key, forceCurrentColorUse ? colors[getCurrentMode()] : colors.dark);

        if (cssValue.toString().startsWith("--"))
          cssValue = "var(" + cssValue + ")";

        if (cssValue != null) {
          return variables + `${cssVariable}: ${cssValue};`;
        } else {
          return variables;
        }
      },addAltHighlightColors(alternateColors, false))}
    }
  `;
}// formatStyles

export function getColorOfCssVariable(cssVariable: string) {
  const body = document.body;
  const computedStyle = getComputedStyle(body);
  const colorValue = computedStyle.getPropertyValue(cssVariable).trim();
  
  if (colorValue.startsWith("rgb"))
    return rgbOrRgbaToHex(colorValue);
  if (colorValue.startsWith("hsl"))
    return hslOrHslaToHex(colorValue);
  if (colorValue.startsWith("#"))
    return colorValue;
  else 
    return "";
}// getColorOfCssVariable

function rgbOrRgbaToHex(color: string): string {
  const matchRGBA = color.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d*\.?\d+)\s*\)$/);
  const matchRGB = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);

  if (matchRGBA) {
    const red = Number(matchRGBA[1]);
    const green = Number(matchRGBA[2]);
    const blue = Number(matchRGBA[3]);
    const alpha = parseFloat(matchRGBA[4]); // Convert alpha to float

    if (isNaN(alpha) || alpha < 0 || alpha > 1) {
      throw new Error('Invalid alpha value in rgba format.');
    }

    const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, '0');
    return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}${alphaHex}`;
  } else if (matchRGB) {
    const red = Number(matchRGB[1]);
    const green = Number(matchRGB[2]);
    const blue = Number(matchRGB[3]);

    return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;
  } else {
    //throw new Error('Invalid color format. Use "rgba(r, g, b, a)" or "rgb(r, g, b)".');
    return "";
  }
}// rgbOrRgbaToHex

function hslOrHslaToHex(hslColor: string): string {
  const matchHSLA = hslColor.match(/^hsla?\((\d+),\s*(\d+)%,\s*(\d+)%,?\s*(\d*\.?\d+)?\)$/i);

  if (!matchHSLA) {
    //throw new Error('Invalid HSL or HSLA color format. Use "hsl(h, s%, l%)" or "hsla(h, s%, l%, a)".');
    return "";
  }

  const h = Number(matchHSLA[1]);
  const s = Number(matchHSLA[2]);
  const l = Number(matchHSLA[3]);
  const a = matchHSLA[4] !== undefined ? Number(matchHSLA[4]) : 1;

  // Convert HSLA to HSL (remove alpha component)
  const hsl = `hsl(${h}, ${s}%, ${l}%)`;

  // Convert HSL to hex
  const hexColor = hslToHex(hsl, a);

  // Append the alpha value to the hex string if it's not fully opaque
  if (a < 1) {
    const alphaHex = Math.round(a * 255).toString(16).padStart(2, '0');
    return `${hexColor}${alphaHex}`;
  }

  return hexColor;
}//hslOrHslaToHex

function hslToHex(hslColor: string, alpha: number): string {
  const matchHSL = hslColor.match(/^hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)$/i);

  if (!matchHSL) {
    //throw new Error('Invalid HSL color format. Use "hsl(h, s%, l%)".');
    return "";
  }

  const h = Number(matchHSL[1]);
  const s = Number(matchHSL[2]);
  const l = Number(matchHSL[3]);

  // Convert the hue to a value between 0 and 360
  const hue = (h % 360 + 360) % 360;

  // Ensure the saturation and lightness values are within the valid range [0, 100]
  const saturation = Math.max(0, Math.min(100, s));
  const lightness = Math.max(0, Math.min(100, l));

  // Convert the saturation and lightness values to the range [0, 1]
  const normalizedSaturation = saturation / 100;
  const normalizedLightness = lightness / 100;

  // Calculate the chroma and intermediate values
  const chroma = (1 - Math.abs(2 * normalizedLightness - 1)) * normalizedSaturation;
  const hPrime = hue / 60;
  const x = chroma * (1 - Math.abs((hPrime % 2) - 1));

  // Calculate RGB values based on the hue value
  let r, g, b;
  if (0 <= hPrime && hPrime < 1) {
    [r, g, b] = [chroma, x, 0];
  } else if (1 <= hPrime && hPrime < 2) {
    [r, g, b] = [x, chroma, 0];
  } else if (2 <= hPrime && hPrime < 3) {
    [r, g, b] = [0, chroma, x];
  } else if (3 <= hPrime && hPrime < 4) {
    [r, g, b] = [0, x, chroma];
  } else if (4 <= hPrime && hPrime < 5) {
    [r, g, b] = [x, 0, chroma];
  } else {
    [r, g, b] = [chroma, 0, x];
  }

  // Calculate m (brightness adjustment)
  const m = normalizedLightness - chroma / 2;

  // Scale the RGB values and convert them to the range [0, 255]
  const red = Math.round((r + m) * 255);
  const green = Math.round((g + m) * 255);
  const blue = Math.round((b + m) * 255);

  // Convert the RGB values to hexadecimal
  const hexColor = `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;

  // Append the alpha value to the hex string if it's not fully opaque
  if (alpha < 1) {
    const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, '0');
    return `${hexColor}${alphaHex}`;
  }

  return hexColor;
}// hslToHex

function addAltHighlightColors(alternateColors: Record<string, string>, lightTheme: boolean) {
  const altHighlightStyles = Object.entries(alternateColors).reduce((altHighlightStyles, [colorName, hexValue]) => {
    return altHighlightStyles + `--codeblock-customizer-highlight-${colorName.replace(/\s+/g, '-').toLowerCase()}-color: ${hexValue};`;
  }, '');

  return altHighlightStyles;
}// addAltHighlightColors

function accessSetting(key: string, settings: Colors) {
  const keys = key.split('.');
  let value: any = settings;
  for (const k of keys) {
    if (value && k in value) {
      value = value[k];
    } else {
      return null;
    }
  }
  return value;
}// accessSetting

export function removeCharFromStart(input: string, charToRemove: string): string {
  let startIndex = 0;
  while (startIndex < input.length && (input[startIndex] === charToRemove || input[startIndex] === ' ')) {
      startIndex++;
  }
  
  return input.slice(startIndex);
}// removeCharFromStart

export function isSourceMode(state: EditorState): boolean {
  if (!state.field(editorLivePreviewField))
    return true;
  return false;
}// isSourceMode