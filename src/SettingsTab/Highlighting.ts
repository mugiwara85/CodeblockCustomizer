import { Notice, Setting, TextComponent } from "obsidian";

import CodeBlockCustomizerPlugin from "src/main";
import { createDetailsGroup, getRandomColor, SettingsPage, SettingsPageData, updateColorContainer } from "./Common";
import { getCurrentMode, updateSettingStyles } from "src/Utils";
import { createPickrSetting } from "./ColorUtils";
import { DEFAULT_LINE_SEPARATOR, DEFAULT_TEXT_SEPARATOR } from "src/Const";

import Pickr from "@simonwep/pickr";

export class HighlightingSettings {
  alternateHighlightDetailsOpen: boolean = false;

  constructor(private plugin: CodeBlockCustomizerPlugin, private containerEl: HTMLElement, private pickerInstances: Pickr[], private getSearchQuery: () => string) { }

  public display(): void {
    const sectionData = SettingsPageData[SettingsPage.Highlighting];
    const highlightingDiv = this.containerEl.createDiv({ cls: `${sectionData.hideClass} ${sectionData.class} cb-settings-section` });
    highlightingDiv.toggleClass(sectionData.hideClass, this.plugin.settings.settingsType !== SettingsPage.Highlighting);
    highlightingDiv.createEl('h3', { text: sectionData.displayName });

    new Setting(highlightingDiv)
      .setName('Enable codeblock active line highlight')
      .setDesc('If enabled, you can set the color for the active line inside codeblocks only.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.enableActiveLineHighlight)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.enableActiveLineHighlight = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.plugin.app);
          activeLineSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
        })
      );

      const activeLineSetting = createPickrSetting(highlightingDiv, 'Codeblock active line color', '', "codeblock.activeLineColor", this.pickerInstances, this.plugin);
    activeLineSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.codeblock.enableActiveLineHighlight);

    createPickrSetting(highlightingDiv, 'Highlight color (used by the "hl" parameter)', 'Sets the default color for highlighting lines using the `hl` parameter (e.g., `hl:5`).', "codeblock.highlightColor", this.pickerInstances, this.plugin);

    // bracket highlight
    const bracketDetails = createDetailsGroup(highlightingDiv, 'Bracket Highlight & Selection Matching', 'bracketDetailsOpen', this, this.getSearchQuery);

    new Setting(bracketDetails)
      .setName('Enable bracket highlight for matching brackets')
      .setDesc('Highlights a bracket and its matching pair when you click next to one.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.enableBracketHighlight)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.enableBracketHighlight = value;
          if (value) {
            this.plugin.extensions.push(this.plugin.editorExtensions.customBracketMatching);
          }
          else {
            this.plugin.extensions.remove(this.plugin.editorExtensions.customBracketMatching);
          }
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.plugin.app);

          bracketHighlightColorMatch.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
          bracketHighlightBackgroundColorMatch.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
          highlightNonMatchingBrackets.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);

          const subValue = this.plugin.settings.pluginSettings.codeblock.highlightNonMatchingBrackets;
          bracketHighlightColorNoMatch.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value || !subValue);
          bracketHighlightBackgroundColorNoMatch.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value || !subValue);
        })
      );

    const bracketHighlightColorMatch = createPickrSetting(bracketDetails, 'Bracket highlight color for matching brackets', '', "codeblock.bracketHighlightColorMatch", this.pickerInstances, this.plugin);
    bracketHighlightColorMatch.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.codeblock.enableBracketHighlight);

    const bracketHighlightBackgroundColorMatch = createPickrSetting(bracketDetails, 'Background color for matching brackets', '', "codeblock.bracketHighlightBackgroundColorMatch", this.pickerInstances, this.plugin);
    bracketHighlightBackgroundColorMatch.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.codeblock.enableBracketHighlight);

    const highlightNonMatchingBrackets = new Setting(bracketDetails)
      .setName('Enable bracket highlight for non matching brackets')
      .setDesc('If you click next to a bracket, and it doesn\'t have a corresponding pair, or the pair does not match the opening/closing bracket (e.g: `print("hello"]` ), they will be highlighted.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.highlightNonMatchingBrackets)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.highlightNonMatchingBrackets = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.plugin.app);

          bracketHighlightColorNoMatch.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
          bracketHighlightBackgroundColorNoMatch.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
        })
      );
    highlightNonMatchingBrackets.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.codeblock.enableBracketHighlight);

    const bracketHighlightColorNoMatch = createPickrSetting(bracketDetails, 'Bracket highlight color for non matching brackets', '', "codeblock.bracketHighlightColorNoMatch", this.pickerInstances, this.plugin);
    bracketHighlightColorNoMatch.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.codeblock.enableBracketHighlight || !this.plugin.settings.pluginSettings.codeblock.highlightNonMatchingBrackets);

    const bracketHighlightBackgroundColorNoMatch = createPickrSetting(bracketDetails, 'Background color for non matching brackets', '', "codeblock.bracketHighlightBackgroundColorNoMatch", this.pickerInstances, this.plugin);
    bracketHighlightBackgroundColorNoMatch.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.codeblock.enableBracketHighlight || !this.plugin.settings.pluginSettings.codeblock.highlightNonMatchingBrackets);

    // selection matching
    new Setting(bracketDetails)
      .setName('Enable selection matching')
      .setDesc('If enabled, all occurrences of the selected text will be highlighted for easy identification.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.enableSelectionMatching)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.enableSelectionMatching = value;
          if (value) {
            this.plugin.extensions.push(this.plugin.editorExtensions.selectionMatching);
          }
          else {
            this.plugin.extensions.remove(this.plugin.editorExtensions.selectionMatching);
          }
          await this.plugin.saveSettings();
          selectionMatchHighlightSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
        })
      );

    const selectionMatchHighlightSetting = createPickrSetting(bracketDetails, 'Selection match highlight color', '', "codeblock.selectionMatchHighlightColor", this.pickerInstances, this.plugin);
    selectionMatchHighlightSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.codeblock.enableSelectionMatching);

    // text highlight
    const textHighlightDetails = createDetailsGroup(highlightingDiv, 'Text Highlight', 'textHighlightDetailsOpen', this, this.getSearchQuery);

    new Setting(textHighlightDetails)
      .setName('Line separator')
      .setDesc('Override the default line separator `|` globally for text highlighting. You can also specify it for specific code blocks using the `lsep` parameter. The separator can only be one character long!')
      .addText(text => text
        .setPlaceholder(DEFAULT_LINE_SEPARATOR)
        .setValue(this.plugin.settings.pluginSettings.textHighlight.lineSeparator)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.textHighlight.lineSeparator = value.charAt(0);
          await this.plugin.saveSettings();
        })
      );

    new Setting(textHighlightDetails)
      .setName('Text separator')
      .setDesc('Override the default text separator `:` globally for text highlighting. You can also specify it for specific code blocks using the `tsep` parameter. The separator can only be one character long!')
      .addText(text => text
        .setPlaceholder(DEFAULT_TEXT_SEPARATOR)
        .setValue(this.plugin.settings.pluginSettings.textHighlight.textSeparator)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.textHighlight.textSeparator = value.charAt(0);
          await this.plugin.saveSettings();
        })
      );

    // alternative highlight colors
    const altColorsDetails = createDetailsGroup(highlightingDiv, 'Alternative Highlight Colors', 'alternateHighlightDetailsOpen', this, this.getSearchQuery);

    let alternateColorDisplayText: TextComponent;
    new Setting(altColorsDetails)
      .setName("Add alternative highlight color")
      .setDesc('Define a name, by which you will reference the color. You can set the color itself after adding it to the list.')
      .addText(value => {
        alternateColorDisplayText = value
        alternateColorDisplayText = value;
        alternateColorDisplayText.setPlaceholder('e.g. error, warn')
        alternateColorDisplayText.onChange(async (alternateHLColorName) => {
          this.plugin.settings.alternateHighlightColorName = alternateHLColorName;
        });
      })
      .addButton(async (button) => {
        button.setButtonText("Add");
        button.onClick(async () => {
          const colorNameRegex = /^[^\d][\w\d]*$/;
          if (this.plugin.settings.alternateHighlightColorName.trim() === "") {
            new Notice("Please enter a color name.");
          } else if (!colorNameRegex.test(this.plugin.settings.alternateHighlightColorName)) { // check if the input matches the regex
            new Notice(`"${this.plugin.settings.alternateHighlightColorName}" is not a valid color name.`);
          } else if (this.plugin.settings.alternateHighlightColorName.trim().toLowerCase() === 'hl') {
            new Notice("You cannot override the default hl parameter.");
          } else if (this.plugin.settings.alternateHighlightColorName.trim().toLowerCase() === 'fold') {
            new Notice("You cannot override the fold parameter.");
          } else {
            if (this.plugin.settings.alternateHighlightColorName.toLowerCase() in this.plugin.settings.SelectedTheme.colors[getCurrentMode()].codeblock.alternateHighlightColors) {
              new Notice(`A color with the name "${this.plugin.settings.alternateHighlightColorName}" already exists.`);
            } else {
              const newColor = getRandomColor();
              this.plugin.settings.SelectedTheme.colors.light.codeblock.alternateHighlightColors[this.plugin.settings.alternateHighlightColorName] = newColor;
              this.plugin.settings.SelectedTheme.colors.dark.codeblock.alternateHighlightColors[this.plugin.settings.alternateHighlightColorName] = newColor;
              await this.plugin.saveSettings();
              new Notice(`Added color "${this.plugin.settings.alternateHighlightColorName}".`);
              alternateColorDisplayText.setValue("");
              this.plugin.settings.alternateHighlightColorName = "";
              updateColorContainer(colorContainer, this.pickerInstances, this.plugin); // Update the color container after adding a color
              this.plugin.renderReadingViews();
            }
          }
        });
      });

    const colorContainer = altColorsDetails.createDiv({ cls: "codeblock-customizer-alternateHLcolorContainer" });

    // Update the color container on page load
    updateColorContainer(colorContainer, this.pickerInstances, this.plugin);

    //return highlightingDiv;
  }// display
}// HighlightingSettings
