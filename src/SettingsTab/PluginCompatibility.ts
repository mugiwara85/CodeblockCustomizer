import { Setting } from "obsidian";

import CodeBlockCustomizerPlugin from "src/main";
import { createDetailsGroup, SettingsPage, SettingsPageData } from "./Common";
import { updateSettingClasses } from "src/Utils";
import { ExecuteCodeSeparatorStyle } from "src/Settings";

export class PluginCompatibilitySettings {
  admonitionDetailsOpen: boolean = false;
  executeCodeDetailsOpen: boolean = false;

  constructor(private plugin: CodeBlockCustomizerPlugin, private containerEl: HTMLElement, private getSearchQuery: () => string) { }

  public display(): void {
    const sectionData = SettingsPageData[SettingsPage.Plugins];
    const pluginsDiv = this.containerEl.createDiv({ cls: `${sectionData.hideClass} ${sectionData.class} cb-settings-section` });
    pluginsDiv.toggleClass(sectionData.hideClass, this.plugin.settings.settingsType !== SettingsPage.Plugins);
    pluginsDiv.createEl('h3', { text: sectionData.displayName });

    // settings for admonitions plugin
    const admonitionDetailsDetails = createDetailsGroup(pluginsDiv, 'Admonition Settings', 'admonitionDetailsOpen', this, this.getSearchQuery);

    new Setting(admonitionDetailsDetails)
      .setName('Enable Admonition support')
      .setDesc('Enable styling for code blocks inside Admonition blocks.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.plugins.admonitions.enabled)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.plugins.admonitions.enabled = value;
          detailSetting.settingEl.classList.toggle('codeblock-customizer-setting-hidden', !value);
          const isTimerVisible = value && this.plugin.settings.pluginSettings.plugins.admonitions.enableTimeOut;
          timerSetting.settingEl.classList.toggle('codeblock-customizer-setting-hidden', !isTimerVisible);
          await this.plugin.saveSettings();
          this.plugin.renderReadingViews();
        })
      );

    const detailSetting = new Setting(admonitionDetailsDetails)
      .setName('Use timer for admonition processing')
      .setDesc('Adds a small, configurable delay before styling code blocks inside admonitions. This can resolve rendering issues in complex notes.')
      .addToggle(toggle => {
      toggle
        .setValue(this.plugin.settings.pluginSettings.plugins.admonitions.enableTimeOut)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.plugins.admonitions.enableTimeOut = value;
          timerSetting.settingEl.classList.toggle('codeblock-customizer-setting-hidden', !value);
          await this.plugin.saveSettings();
        });
      });

    detailSetting.settingEl.classList.toggle('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.plugins.admonitions.enabled);

    const timerSetting = new Setting(admonitionDetailsDetails)
      .setName('Admonition processing delay (ms)')
      .setDesc('The delay in milliseconds to wait before processing.')
      .addText(text => text
        .setValue(this.plugin.settings.pluginSettings.plugins.admonitions.timeOut.toString())
        .onChange(async (value) => {
          const numberValue = parseInt(value);
          if (!isNaN(numberValue)) {
            this.plugin.settings.pluginSettings.plugins.admonitions.timeOut = numberValue;
            await this.plugin.saveSettings();
          }
        })
      );

    timerSetting.settingEl.classList.toggle('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.plugins.admonitions.enableTimeOut);

    // settings for execute code plugin
    const executeCodeDetails = createDetailsGroup(pluginsDiv, 'Execute Code Settings', 'executeCodeDetailsOpen', this, this.getSearchQuery);

    new Setting(executeCodeDetails)
      .setName('Enable Execute Code plugin support')
      .setDesc('When disabled, this plugin completely ignores the Execute Code plugin, and does not apply any styling at all to run-* code blocks. Switch documents after changing this option, to refresh the view.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.plugins.executeCode.enabled)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.plugins.executeCode.enabled = value;
          styleOutputSetting.settingEl.classList.toggle('codeblock-customizer-setting-hidden', !value);
          executeCodeSeparatorStyleSetting.settingEl.classList.toggle('codeblock-customizer-setting-hidden', !value);
          await this.plugin.saveSettings();
          this.plugin.renderReadingViews();
        })
      );

    const executeCodeSeparatorStyleSetting = new Setting(executeCodeDetails)
      .setName('Line number jump separator style')
      .setDesc('Select the style of the separator line shown when line number jumps are used.')
      .addDropdown(dropdown => dropdown
        .addOption(ExecuteCodeSeparatorStyle.Zigzag, 'Zigzag')
        .addOption(ExecuteCodeSeparatorStyle.Dashed, 'Dashed')
        .addOption(ExecuteCodeSeparatorStyle.DoubleLine, 'Double Line')
        .setValue(this.plugin.settings.pluginSettings.plugins.executeCode.executeCodeSeparatorStyle)
        .onChange(async (value: ExecuteCodeSeparatorStyle) => {
          this.plugin.settings.pluginSettings.plugins.executeCode.executeCodeSeparatorStyle = value;
          await this.plugin.saveSettings();
        })
      );

    executeCodeSeparatorStyleSetting.settingEl.classList.toggle('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.plugins.executeCode.enabled);

    const styleOutputSetting = new Setting(executeCodeDetails)
      .setName('Style Execute Code output')
      .setDesc('When enabled, the plugin will add line numbers, highlighting, and other styles to the code output. Disable this to see the raw, default output.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.plugins.executeCode.styleOutput)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.plugins.executeCode.styleOutput = value;
          await this.plugin.saveSettings();
          updateSettingClasses(this.plugin.settings.pluginSettings);
          this.plugin.renderReadingViews();
        })
      );

    styleOutputSetting.settingEl.classList.toggle('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.plugins.executeCode.enabled);

    //return pluginsDiv;
  }// public
}// PluginCompatibilitySettings
