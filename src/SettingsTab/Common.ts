import { Notice, Setting } from "obsidian";

import { createAlternatePickr, getColorFromPickrClass } from "./ColorUtils";
import { getCurrentMode } from "src/Utils";
import CodeBlockCustomizerPlugin from "src/main";

import Pickr from "@simonwep/pickr";

export interface ColorOptions {
  [key: string]: string;
}

export interface PickerOptions {
  containerEl: HTMLElement;
  initialColor: string;
  onSave: (savedColor: string) => void;
  onReset?: () => string;
  onDelete?: () => void;
  shouldShow?: () => boolean;
  i18n?: Record<string, any>;
}

export const SettingsPage = {
  General: "general",
  Appearance: "appearance",
  Highlighting: "highlighting",
  Behavior: "behavior",
  Prompts: "prompts",
  Plugins: "plugins",
} as const;

export type SettingsPage = (typeof SettingsPage)[keyof typeof SettingsPage];

export interface SettingsPageInfo {
  displayName: string;
  class: string;
  hideClass: string;
}

export const SettingsPageData: Record<SettingsPage, SettingsPageInfo> = {
  [SettingsPage.General]: {
    displayName: "⚙️ General",
    class: "codeblock-customizer-general-settingsDiv",
    hideClass: "codeblock-customizer-general-settingsDiv-hide"
  },
  [SettingsPage.Appearance]: {
    displayName: "🎨 Appearance & Styling",
    class: "codeblock-customizer-appearance-settingsDiv",
    hideClass: "codeblock-customizer-appearance-settingsDiv-hide"
  },
  [SettingsPage.Highlighting]: {
    displayName: "🖌️ Highlighting",
    class: "codeblock-customizer-highlighting-settingsDiv",
    hideClass: "codeblock-customizer-highlighting-settingsDiv-hide"
  },
  [SettingsPage.Behavior]: {
    displayName: "👆 Behavior & Interaction",
    class: "codeblock-customizer-behavior-settingsDiv",
    hideClass: "codeblock-customizer-behavior-settingsDiv-hide"
  },
  [SettingsPage.Prompts]: {
    displayName: "⌨️ Prompts",
    class: "codeblock-customizer-prompts-settingsDiv",
    hideClass: "codeblock-customizer-prompts-settingsDiv-hide"
  },
  [SettingsPage.Plugins]: {
    displayName: "🧩 Plugin Compatibility",
    class: "codeblock-customizer-plugin-compatibility-settingsDiv",
    hideClass: "codeblock-customizer-plugin-compatibility-settingsDiv-hide"
  },
};

export const COLOR_OPTIONS: ColorOptions = {
  "codeblock.activeLineColor": "Code block active line color",
  "codeblock.backgroundColor": "Code block background color",
  "codeblock.borderColor": "Code block border color",
  "codeblock.textColor": "Code block text color",
  "codeblock.bracketHighlightColorMatch": "Matching bracket color",
  "codeblock.bracketHighlightColorNoMatch": "Non-matching bracket color",
  "codeblock.bracketHighlightBackgroundColorMatch": "Matching bracket background color",
  "codeblock.bracketHighlightBackgroundColorNoMatch": "Non-matching bracket background color",
  "codeblock.selectionMatchHighlightColor": "Selection match highlight color",
  "header.backgroundColor": "Header background color",
  "header.textColor": "Header text color",
  "header.lineColor": "Header line color",
  "header.codeBlockLangTextColor": "Header language text color",
  "header.codeBlockLangBackgroundColor": "Header language background color",
  "gutter.textColor": "Gutter text color",
  "gutter.backgroundColor": "Gutter background color",
  "gutter.activeLineNrColor": "Gutter active line number color"
};

export function createDetailsGroup(container: HTMLElement, title: string, key: string, settings: any, getCurrentSearch: () => string, ...extraClasses: string[]): HTMLElement {
  const details = container.createEl('details');

  details.addClasses(['settings-group', ...extraClasses]);
  details.dataset.settingsKey = key as string;

  if (settings[key]) {
    details.open = true;
  }
  details.createEl('summary', { text: title });
  details.addEventListener('toggle', () => {
    if (getCurrentSearch()) {
      return;
    }
    settings[key] = details.open;
  });
  return details;
}// createDetailsGroup

export function getRandomColor() {
  const letters = "0123456789ABCDEF";
  let color = "#";
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}// getRandomColor

export function updateColorContainer(colorContainer: HTMLElement, pickerInstances: Pickr[], plugin: CodeBlockCustomizerPlugin) {
  colorContainer.empty();

  Object.entries(plugin.settings.SelectedTheme.colors[getCurrentMode()].codeblock.alternateHighlightColors).forEach(([colorName, style]) => {
    createAlternatePickr(colorContainer, colorContainer, colorName, style, "normal", pickerInstances, plugin);
  });
}// updateColorContainer

export function updateLanguageSpecificColorContainer(colorContainer: HTMLElement, pickerInstances: Pickr[], plugin: CodeBlockCustomizerPlugin, language = "") {
  colorContainer.empty();

  const languageColors = plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors;
  const filteredLanguages = language ? (languageColors[language] ? { [language]: languageColors[language] } : {}) : languageColors;

  Object.entries(filteredLanguages).forEach(([languageName, colorObject]) => {
    const languageSettingsDiv = colorContainer.createEl("div", { cls: `codeblock-customizer-languageSpecific-${languageName}-settings` });
    languageSettingsDiv.createEl('h4', { text: `${languageName} specific color settings` });

    createDropdown(languageSettingsDiv, languageName, pickerInstances, plugin, () => {
      updateLanguageSpecificColorContainer(colorContainer, pickerInstances, plugin, language);
    });

    Object.entries(colorObject).forEach(([colorProp, color]) => {
      const propDisplayText = COLOR_OPTIONS[colorProp];
      // this.createAlternatePickr(colorContainer, colorContainer, propDisplayText, color, "langSpecific", colorProp, languageName);
      createAlternatePickr(languageSettingsDiv, languageSettingsDiv, propDisplayText, color, "langSpecific", pickerInstances, plugin, colorProp, languageName);
    });
  });
}// updateLanguageSpecificColorContainer

export function createDropdown(languageSettingsDiv: HTMLElement, languageName: string, pickerInstances: Pickr[], plugin: CodeBlockCustomizerPlugin, refreshView: () => void) {
  const dropdownOptions = Object.entries(COLOR_OPTIONS).reduce((options, [key, value]) => {
    options[key] = value;
    return options;
  }, {} as Record<string, string>);

  new Setting(languageSettingsDiv)
    .setName('Select color to set')
    .setDesc(`Select which color you would like to set for ${plugin.settings.languageSpecificLanguageName} specifically.`)
    .addDropdown((dropdown) => dropdown
      .addOptions(dropdownOptions)
      .setValue(plugin.settings.langSpecificSettingsType)
      .onChange((value) => {
        plugin.settings.langSpecificSettingsType = value;
        (async () => { await plugin.saveSettings() })();
      })
    )
    .addExtraButton(async (button) => {
      button.setIcon("plus");
      button.setTooltip(`Add the selected property to customize it for code block language ${languageName} specifically`);
      button.onClick(async () => {
        const propDisplayText = COLOR_OPTIONS[plugin.settings.langSpecificSettingsType];
        if (propDisplayText) {
          if (plugin.settings.langSpecificSettingsType in plugin.settings.SelectedTheme.colors.light.languageSpecificColors[languageName]) {
            new Notice(`${propDisplayText} is already defined for code block language "${languageName}"`);
          } else {
            if (plugin.settings.langSpecificSettingsType === "codeblock.borderColor") {
              const newColor = getRandomColor();
              plugin.settings.SelectedTheme.colors.light.languageSpecificColors[languageName]['codeblock.borderColor'] = newColor;
              plugin.settings.SelectedTheme.colors.dark.languageSpecificColors[languageName]['codeblock.borderColor'] = newColor;
              createAlternatePickr(languageSettingsDiv, languageSettingsDiv, propDisplayText, newColor, "langSpecific", pickerInstances, plugin, plugin.settings.langSpecificSettingsType, languageName);
            } else {
              const defaultDarkColor = getColorFromPickrClass(plugin.settings.SelectedTheme, "dark", plugin.settings.langSpecificSettingsType, true);
              const defaultLightColor = getColorFromPickrClass(plugin.settings.SelectedTheme, "light", plugin.settings.langSpecificSettingsType, true);
              createAlternatePickr(languageSettingsDiv, languageSettingsDiv, propDisplayText, getCurrentMode() === "dark" ? defaultDarkColor as string : defaultLightColor as string, "langSpecific", pickerInstances, plugin, plugin.settings.langSpecificSettingsType, languageName);
              plugin.settings.SelectedTheme.colors.light.languageSpecificColors[languageName][plugin.settings.langSpecificSettingsType] = defaultLightColor as string;
              plugin.settings.SelectedTheme.colors.dark.languageSpecificColors[languageName][plugin.settings.langSpecificSettingsType] = defaultDarkColor as string;
            }
            (async () => { await plugin.saveSettings() })();
            plugin.renderReadingViews();
            //refreshView();
          }
        } else {
          console.error("Selected color not found.");
        }
      });
    })
    .addExtraButton(async (button) => {
      button.setIcon('trash');
      button.setTooltip(`Delete all language specific colors for code block language ${languageName}`);
      button.onClick(async () => {
        delete plugin.settings.SelectedTheme.colors.light.languageSpecificColors[languageName];
        delete plugin.settings.SelectedTheme.colors.dark.languageSpecificColors[languageName];
        refreshView();
        (async () => { await plugin.saveSettings() })();
      });
    });
}// createDropdown
