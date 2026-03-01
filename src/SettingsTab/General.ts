import { Notice, Setting } from "obsidian";

import CodeBlockCustomizerPlugin from "src/main";
import { createDetailsGroup, SettingsPage, SettingsPageData } from "./Common";
import { ColorTheme, DEFAULT_THEMES } from "src/Settings";

export class GeneralSettings {
  printToPDFDetailsOpen: boolean = false;
  debounceTimer: NodeJS.Timeout | null = null;

  constructor(private plugin: CodeBlockCustomizerPlugin, private containerEl: HTMLElement, private getSearchQuery: () => string, private refreshSettings: () => void) { }

  public display(): void {
    const sectionData = SettingsPageData[SettingsPage.General];
    const generalDiv = this.containerEl.createDiv({ cls: `${sectionData.hideClass} ${sectionData.class} cb-settings-section` });
    generalDiv.toggleClass(sectionData.hideClass, this.plugin.settings.settingsType !== SettingsPage.General);
    generalDiv.createEl('h3', { text: sectionData.displayName });

    new Setting(generalDiv)
      .setName('Enable plugin in source mode')
      .setDesc('By default the plugin is disabled in source mode. You can enable it in source mode as well using this toggle.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.common.enableInSourceMode)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.common.enableInSourceMode = value;
          await this.plugin.saveSettings(true);
        })
      );

    new Setting(generalDiv)
      .setName('Exclude languages')
      .setDesc('Define languages, separated by a comma, to which the plugin should not apply. You can use a wildcard (*) either at the beginning, or at the end. For example: ad-* will exclude codeblocks where the language starts with ad- e.g.: ad-info, ad-error etc.')
      .addText(text => text
        .setPlaceholder('e.g. dataview, python etc.')
        .setValue(this.plugin.settings.ExcludeLangs)
        .onChange(async (value) => {
          this.plugin.settings.ExcludeLangs = value;
          if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
          }
          this.debounceTimer = setTimeout(async () => {
            await this.plugin.saveSettings(true);
            this.plugin.renderReadingViews();
          }, 750);
        })
      );

    new Setting(generalDiv)
      .setName('Restore default themes')
      .setDesc('Restore all default themes to their original settings.')
      .addButton(async (button) => {
        button.setButtonText("Restore");
        button.onClick(async () => {
          this.restoreThemes(this.plugin.settings.ThemeName, true);
          await this.plugin.saveSettings();
          this.refreshSettings();
          new Notice("Default themes restored to their original state!");
        });
      });

    // print to PDF
    const printToPDFDetails = createDetailsGroup(generalDiv, 'Print to PDF Settings', 'printToPDFDetailsOpen', this, this.getSearchQuery);

    new Setting(printToPDFDetails)
      .setName('Enable print to PDF')
      .setDesc('If enabled, the styling is applied to documents when printed to PDF. By default PDF printing uses light theme colors.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.printing.enablePrintToPDFStyling)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.printing.enablePrintToPDFStyling = value;
          await this.plugin.saveSettings();
          forceCurrentColorUse.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
          avoidPageBreaks.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
          uncollapseDuringPrint.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
        })
      );

    const forceCurrentColorUse = new Setting(printToPDFDetails)
      .setName('Force current color mode use')
      .setDesc('If enabled, PDF printing will use the dark theme colors when a dark theme is selected, and light theme colors when a light theme is selected.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.printing.forceCurrentColorUse)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.printing.forceCurrentColorUse = value;
          await this.plugin.saveSettings();
        })
      );
    forceCurrentColorUse.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.printing.enablePrintToPDFStyling);

    const avoidPageBreaks = new Setting(printToPDFDetails)
      .setName('Avoid page breaks in code blocks')
      .setDesc('If enabled, the plugin will try to prevent code blocks from being split across multiple pages when printing.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.printing.avoidPageBreaks)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.printing.avoidPageBreaks = value;
          await this.plugin.saveSettings();
        })
      );
    avoidPageBreaks.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.printing.enablePrintToPDFStyling);

    const uncollapseDuringPrint = new Setting(printToPDFDetails)
      .setName('Expand all code blocks during printing')
      .setDesc('If enabled, all collapsed code blocks specified by the "fold" parameter will be expanded when printing. This results in the printed document containing expanded code blocks where "fold" was used.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.printing.uncollapseDuringPrint)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.printing.uncollapseDuringPrint = value;
          await this.plugin.saveSettings();
        })
      );
    uncollapseDuringPrint.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.printing.enablePrintToPDFStyling);

    new Setting(printToPDFDetails)
      .setName('Print annotations as raw comments')
      .setDesc('If enabled, annotations will be printed as visible code comments instead of rendered icons.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.printing.printAnnotationsAsComments)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.printing.printAnnotationsAsComments = value;
          await this.plugin.saveSettings();
        })
      );

    //return generalDiv;
  }// display

  restoreThemes(themeName: string, cloneAll: boolean) {
    if (cloneAll) {
      Object.entries(DEFAULT_THEMES).forEach(([name, theme]: [string, ColorTheme]) => {
        this.plugin.settings.Themes[name] = structuredClone(theme)
      });
    } else {
      Object.entries(DEFAULT_THEMES).forEach(([name, theme]: [string, ColorTheme]) => {
        if (name === themeName)
          this.plugin.settings.Themes[name] = structuredClone(theme)
      });
    }

    if (themeName in DEFAULT_THEMES)
      this.plugin.settings.SelectedTheme = structuredClone(this.plugin.settings.Themes[themeName]);
  }// restoreThemes
}// GeneralSettings
