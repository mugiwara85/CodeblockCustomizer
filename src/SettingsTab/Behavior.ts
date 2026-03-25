import { DropdownComponent, Notice, Platform, Setting, TextComponent, ToggleComponent } from "obsidian";

import CodeBlockCustomizerPlugin from "src/main";
import { createDetailsGroup, SettingsPage, SettingsPageData } from "./Common";
import { ButtonModifierKeys, FoldingPersistence, FoldingScope, SemiFoldEffect, TabPersistence } from "src/Settings";
import { createPickrSetting } from "./ColorUtils";

import Pickr from "@simonwep/pickr";

export class BehaviorSettings {
  groupedCodeBlockDetailsOpen: boolean = false;
  foldingDetailsOpen: boolean = false;
  buttonDetailsOpen: boolean = false;
  promptDetailsOpen: boolean = false;

  constructor(private plugin: CodeBlockCustomizerPlugin, private containerEl: HTMLElement, private pickerInstances: Pickr[], private getSearchQuery: () => string) { }

  public display(): void {
    const sectionData = SettingsPageData[SettingsPage.Behavior];
    const behaviorDiv = this.containerEl.createDiv({ cls: `${sectionData.hideClass} ${sectionData.class} cb-settings-section` });
    behaviorDiv.toggleClass(sectionData.hideClass, this.plugin.settings.settingsType !== SettingsPage.Behavior);
    behaviorDiv.createEl('h3', { text: sectionData.displayName });

    new Setting(behaviorDiv)
      .setName('Enable links usage')
      .setDesc('If enabled, you can use links in the header, and code blocks as well. For links to work inside code blocks, they must be part of a comment. Examples: [[Document1]], [[Document1|DisplayText]], [[Document1#Paragraph|DisplayText]], [[Document1#^<BlockId>|DisplayText]], [DisplayText](Link), http://example.com etc.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.enableLinks)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.enableLinks = value;
          await this.plugin.saveSettings();
          this.plugin.renderReadingViews();
          enableLinkUpdate.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
        })
      );

    const enableLinkUpdate = new Setting(behaviorDiv)
      .setName('Enable automatically updating links on file rename')
      .setDesc('To enable this setting, enable links usage option first! If enabled, code block links will be automatically updated, when a file is renamed. Please read the README for more information!')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.enableLinkUpdate)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.enableLinkUpdate = value;
          await this.plugin.saveSettings();
        })
      );
    enableLinkUpdate.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.codeblock.enableLinks);

    new Setting(behaviorDiv)
      .setName('Hide fence lines')
      .setDesc('If enabled, the opening and closing ``` or ~~~ lines will be hidden, when the cursor is outside the code block. They will reappear, when you click inside, allowing for easy editing.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.hideFenceLines)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.hideFenceLines = value;
          await this.plugin.saveSettings();
        })
      );

    // grouped code blocks
    const groupedCodeBlocksDetails = createDetailsGroup(behaviorDiv, 'Grouped Code Block Settings', 'groupedCodeBlocksDetailsOpen', this, this.getSearchQuery);

    new Setting(groupedCodeBlocksDetails)
      .setName('Save active tab state')
      .setDesc('If enabled, the active tab for each group will be remembered based on the options below.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.groupedCodeBlocks.rememberTabState)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.groupedCodeBlocks.rememberTabState = value;
          await this.plugin.saveSettings();
          tabStatePersistence.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
          if (value && this.plugin.settings.pluginSettings.groupedCodeBlocks.persistence === TabPersistence.Permanent) {
            clearTabCache.settingEl.removeClass('codeblock-customizer-setting-hidden');
          } else {
            clearTabCache.settingEl.addClass('codeblock-customizer-setting-hidden');
          }
        })
      );

    const tabStatePersistence = new Setting(groupedCodeBlocksDetails)
      .setName('Tab state persistence')
      .setDesc('Choose how long the active tab state is remembered.')
      .addDropdown(dropdown => {
        dropdown
          .addOption(TabPersistence.Session, 'Session Only')
          .addOption(TabPersistence.Permanent, 'Permanent')
          .setValue(this.plugin.settings.pluginSettings.groupedCodeBlocks.persistence)
          .onChange(async (value: TabPersistence) => {
            const oldValue = this.plugin.settings.pluginSettings.groupedCodeBlocks.persistence;
            if (oldValue !== value) {
              await this.plugin.clearAllTabData();
            }
            this.plugin.settings.pluginSettings.groupedCodeBlocks.persistence = value;
            await this.plugin.saveSettings();

            clearTabCache.settingEl.toggleClass('codeblock-customizer-setting-hidden', value !== TabPersistence.Permanent);
          });
      });
    tabStatePersistence.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.groupedCodeBlocks.rememberTabState);

    const clearTabCache = new Setting(groupedCodeBlocksDetails)
      .setName('Clear stored tab positions')
      .setDesc('Clear all stored active tab states from disk and the current session.')
      .addButton((button) => {
        button.setButtonText("Clear cache");
        button.onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("Clearing...");
          await this.plugin.clearAllTabData();
          button.setDisabled(false);
          button.setButtonText("Clear cache");
        });
      });
    clearTabCache.settingEl.toggleClass('codeblock-customizer-setting-hidden', !(this.plugin.settings.pluginSettings.groupedCodeBlocks.rememberTabState && this.plugin.settings.pluginSettings.groupedCodeBlocks.persistence === TabPersistence.Permanent));

    new Setting(groupedCodeBlocksDetails)
      .setName('Show tab "Add" and "Remove" buttons (only editing view)')
      .setDesc('If enabled, a "+" button will appear after the last tab to add a new block, and an "x" button will appear on each tab to remove it from the group.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.groupedCodeBlocks.showAddRemoveButtons)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.groupedCodeBlocks.showAddRemoveButtons = value;
          await this.plugin.saveSettings();
        })
      );

    createPickrSetting(groupedCodeBlocksDetails, 'Active tab background color', 'Background color of the currently active tab.', "groupedCodeBlocks.activeTabBackgroundColor", this.pickerInstances, this.plugin);
    createPickrSetting(groupedCodeBlocksDetails, 'Active tab text color', 'Text color of the currently active tab.', "groupedCodeBlocks.activeTabTextColor", this.pickerInstances, this.plugin);
    createPickrSetting(groupedCodeBlocksDetails, 'Header line color', 'Sets the color of the separator line at the bottom of the header for grouped code blocks.', "groupedCodeBlocks.headerLineColor", this.pickerInstances, this.plugin);
    createPickrSetting(groupedCodeBlocksDetails, 'Tab hover background color', 'Background color when the mouse hovers over a tab.', "groupedCodeBlocks.hoverTabBackgroundColor", this.pickerInstances, this.plugin);
    createPickrSetting(groupedCodeBlocksDetails, 'Tab hover text color', 'Text color when the mouse hovers over a tab.', "groupedCodeBlocks.hoverTabTextColor", this.pickerInstances, this.plugin);

    // folding
    const foldDetails = createDetailsGroup(behaviorDiv, 'Folding Settings', 'foldDetailsOpen', this, this.getSearchQuery);

    const updateFoldingSettingsVisibility = () => {
      const semiFoldEnabled = this.plugin.settings.pluginSettings.semiFold.enableSemiFold;
      const inverseFoldEnabled = this.plugin.settings.pluginSettings.codeblock.folding.inverseFold;

      if (semiFoldLines)
        semiFoldLines.setDisabled(!semiFoldEnabled);
      if (semiFoldShowButton)
        semiFoldShowButton.setDisabled(!semiFoldEnabled);
      if (autoFold)
        autoFold.settingEl.toggleClass('codeblock-customizer-setting-hidden', !semiFoldEnabled);

      if (ignoreShortBlocks) {
        const showIgnoreShortBlocks = semiFoldEnabled && inverseFoldEnabled;
        ignoreShortBlocks.settingEl.toggleClass('codeblock-customizer-setting-hidden', !showIgnoreShortBlocks);
      }
    };

    new Setting(foldDetails)
      .setName('Inverse fold behavior')
      .setDesc('If enabled, all code blocks are folded by default when opening a document. To disable this behavior for a specific code block, use the "unfold" parameter.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.folding.inverseFold)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.folding.inverseFold = value;
          await this.plugin.saveSettings(true);
          updateFoldingSettingsVisibility();
          this.plugin.renderReadingViews();
        })
      );

    const ignoreShortBlocks = new Setting(foldDetails)
      .setName('Only apply inverse fold to semi-foldable blocks')
      .setDesc('When `Inverse fold` and `Enable semi-fold` are both enabled, this prevents short code blocks (that cannot be semi-folded) from being fully folded by default.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.folding.ignoreShortBlocksOnInverseFold)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.folding.ignoreShortBlocksOnInverseFold = value;
          await this.plugin.saveSettings(true);
          this.plugin.renderReadingViews();
        })
      );

    let semiFoldLines: DropdownComponent;
    let semiFoldShowButton: ToggleComponent;

    new Setting(foldDetails)
      .setName('Enable semi-fold')
      .setDesc('If enabled folding will use semi-fold method. This means, that the first X lines will be visible only. Select the number of visisble lines. You can also enable an additional uncollapse button. Please refer to the README for more information.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.semiFold.enableSemiFold)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.semiFold.enableSemiFold = value;
          await this.plugin.saveSettings(true);
          updateFoldingSettingsVisibility();
          semiFoldEffect.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
          this.plugin.renderReadingViews();
        })
      )
      .addDropdown((dropdown) => {
        semiFoldLines = dropdown
        dropdown.selectEl.empty();
        dropdown.addOptions(Object.fromEntries([...Array(50)].map((_, index) => [`${index + 1}`, `${index + 1}`])))
        dropdown.setValue(this.plugin.settings.pluginSettings.semiFold.visibleLines.toString())
        dropdown.onChange(async (value) => {
          const number = parseInt(value);
          this.plugin.settings.pluginSettings.semiFold.visibleLines = number;
          await this.plugin.saveSettings(true);
        })
      })
      .addToggle(toggle => semiFoldShowButton = toggle
        .setValue(this.plugin.settings.pluginSettings.semiFold.showAdditionalUncollapseButon)
        .setTooltip('Show additional uncollapse button')
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.semiFold.showAdditionalUncollapseButon = value;
          await this.plugin.saveSettings();
        })
      );

    const semiFoldEffect = new Setting(foldDetails)
      .setName('Semi-fold effect')
      .setDesc('Select the visual effect for semi-folded code blocks.')
      .addDropdown(dropdown => dropdown
        .addOption(SemiFoldEffect.Opacity, 'Opacity only')
        .addOption(SemiFoldEffect.Blur, 'Blur only')
        .addOption(SemiFoldEffect.Both, 'Both')
        .setValue(this.plugin.settings.pluginSettings.semiFold.semifoldEffect)
        .onChange(async (value: SemiFoldEffect) => {
          this.plugin.settings.pluginSettings.semiFold.semifoldEffect = value;
          await this.plugin.saveSettings();
        })
      );
    semiFoldEffect.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.semiFold.enableSemiFold);

    let longCodeblockLinesInput: TextComponent;
    const autoFold = new Setting(foldDetails)
      .setName('Auto semi-fold long code blocks')
      .setDesc('If enabled, code blocks longer than a specified number of lines will be semi-folded when a note is opened.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.semiFold.autoFoldLongCodeblocks)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.semiFold.autoFoldLongCodeblocks = value;
          longCodeblockLinesInput.setDisabled(!value);
          longCodeblockLinesInput.inputEl.classList.toggle('is-disabled', !value);
          await this.plugin.saveSettings(true);
        })
      )
      .addText(text => {
        longCodeblockLinesInput = text;
        const isDisabled = !this.plugin.settings.pluginSettings.semiFold.autoFoldLongCodeblocks;
        text
          .setPlaceholder('30')
          .setValue(this.plugin.settings.pluginSettings.semiFold.longCodeBlockLines.toString())
          .setDisabled(isDisabled)
        text.inputEl.classList.toggle('is-disabled', isDisabled);
        text.onChange(async (value) => {
          const lines = parseInt(value);
          if (!isNaN(lines)) {
            this.plugin.settings.pluginSettings.semiFold.longCodeBlockLines = lines;
            await this.plugin.saveSettings();
          }
        });
      });

    updateFoldingSettingsVisibility();

    new Setting(foldDetails)
      .setName('Save code blocks folded state')
      .setDesc('Toggles the entire feature on or off. When enabled, the folded or unfolded state of code blocks will be saved based on the options below.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.folding.rememberFoldState)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.folding.rememberFoldState = value;
          await this.plugin.saveSettings();
          scope.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
          persistence.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
          if (value && this.plugin.settings.pluginSettings.codeblock.folding.persistence === FoldingPersistence.Permanent) {
            clearFoldCache.settingEl.removeClass('codeblock-customizer-setting-hidden');
          } else {
            clearFoldCache.settingEl.addClass('codeblock-customizer-setting-hidden');
          }
        })
      );

    const scope = new Setting(foldDetails)
      .setName('Scope')
      .setDesc('Choose which code blocks are affected. \'Respect\' only saves the state for blocks where `fold` wasn\'t explicitly set. \'All\' saves the state for all blocks.')
      .addDropdown(dropdown => {
        dropdown
          .addOption(FoldingScope.NoFoldSpecified, 'Respect "fold"')
          .addOption(FoldingScope.All, 'All code blocks')
          .setValue(this.plugin.settings.pluginSettings.codeblock.folding.scope)
          .onChange(async (value: FoldingScope) => {
            this.plugin.settings.pluginSettings.codeblock.folding.scope = value;
            await this.plugin.saveSettings();
          });
      });
    scope.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.codeblock.folding.rememberFoldState);

    const persistence = new Setting(foldDetails)
      .setName('Persistence')
      .setDesc('Choose how long the folding state is remembered. \'Permanent\' saves the state even after you restart Obsidian. \'Session\' remembers the state only until you close the app.')
      .addDropdown(dropdown => {
        dropdown
          .addOption(FoldingPersistence.Session, 'Session Only')
          .addOption(FoldingPersistence.Permanent, 'Permanent')
          .setValue(this.plugin.settings.pluginSettings.codeblock.folding.persistence)
          .onChange(async (value: FoldingPersistence) => {
            const oldValue = this.plugin.settings.pluginSettings.codeblock.folding.persistence;
            if (oldValue !== value) {
              if (oldValue === FoldingPersistence.Permanent) {
                await this.plugin.clearAllFoldData();
                new Notice("Cleared permanent fold data.");
              }
              if (oldValue === FoldingPersistence.Session) {
                this.plugin.foldStoreEditor.clear();
                this.plugin.app.workspace.updateOptions();
                new Notice("Cleared session fold data.");
              }
            }
            this.plugin.settings.pluginSettings.codeblock.folding.persistence = value;
            await this.plugin.saveSettings();
            clearFoldCache.settingEl.toggleClass('codeblock-customizer-setting-hidden', value !== FoldingPersistence.Permanent);
          });
      });
    persistence.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.codeblock.folding.rememberFoldState);

    const clearFoldCache = new Setting(foldDetails)
      .setName('Clear stored folded positions')
      .setDesc('Clear all stored folded code block state from disk and the current session.')
      .addButton((button) => {
        button.setButtonText("Clear cache");
        button.onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("Clearing...");
          await this.plugin.clearAllFoldData();
          new Notice("Fold cache successfully cleared!");
          button.setDisabled(false);
          button.setButtonText("Clear cache");
        });
      });
    clearFoldCache.settingEl.toggleClass('codeblock-customizer-setting-hidden', !(this.plugin.settings.pluginSettings.codeblock.folding.rememberFoldState && this.plugin.settings.pluginSettings.codeblock.folding.persistence === FoldingPersistence.Permanent));

    // extra buttons
    const buttonsDetails = createDetailsGroup(behaviorDiv, 'Extra Button Settings', 'buttonsDetailsOpen', this, this.getSearchQuery);

    new Setting(buttonsDetails)
      .setName('Modifier key for fence actions')
      .setDesc('Hold this key while clicking copy, select, or delete to include the fence lines in the action.')
      .addDropdown(dropdown => dropdown
        .addOption(ButtonModifierKeys.NONE, 'None')
        .addOption(ButtonModifierKeys.CTRL, Platform.isMacOS ? 'Cmd' : 'Ctrl')
        .addOption(ButtonModifierKeys.ALT, Platform.isMacOS ? 'Option' : 'Alt')
        .addOption(ButtonModifierKeys.SHIFT, 'Shift')
        .setValue(this.plugin.settings.pluginSettings.codeblock.buttons.modifierKey)
        .onChange(async (value: ButtonModifierKeys) => {
          this.plugin.settings.pluginSettings.codeblock.buttons.modifierKey = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(buttonsDetails)
      .setName('Show \'Delete Code\' button (only editing view)')
      .setDesc('If enabled, an additional button will be displayed on every code block. If clicked, the content of that code block is deleted. Be careful!')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.buttons.enableDeleteCodeButton)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.buttons.enableDeleteCodeButton = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(buttonsDetails)
      .setName('Show \'Select Code\' button (only editing view)')
      .setDesc('If enabled, an additional button will be displayed on every code block. If clicked, the content of that code block is selected (including the first and last lines of the code blocks which begin with three backticks).')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.buttons.enableSelectCodeButton)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.buttons.enableSelectCodeButton = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(buttonsDetails)
      .setName('Show \'Wrap Code\' button')
      .setDesc('If enabled, an additional button will be displayed on every code block. If clicked, the content of that code block is wrapped/unwrapped.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.buttons.enableWrapCodeButton)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.buttons.enableWrapCodeButton = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(buttonsDetails)
      .setName('Show \'Copy as image\' button')
      .setDesc('If enabled, an additional button will be displayed on every code block. If clicked, a snapshot is created from the code block and inserted on the clipboard.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.buttons.enableSnapshotButton)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.buttons.enableSnapshotButton = value;
          snapshotWidthSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
          await this.plugin.saveSettings();
        })
      );

    const snapshotWidthSetting = new Setting(buttonsDetails)
      .setName('Image max width (pixels)')
      .setDesc('Set a maximum width for the generated image. Leave blank to capture the code block at its current displayed width.')
      .addText(text => text
        .setPlaceholder('800')
        .setValue(this.plugin.settings.pluginSettings.codeblock.buttons.snapshotMaxWidth?.toString() ?? '')
        .onChange(async (value) => {
          const width = parseInt(value);
          this.plugin.settings.pluginSettings.codeblock.buttons.snapshotMaxWidth = isNaN(width) ? undefined : width;
          await this.plugin.saveSettings();
        })
      );

    snapshotWidthSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.codeblock.buttons.enableSnapshotButton);

    new Setting(buttonsDetails)
      .setName('Always show buttons (only editing view)')
      .setDesc('If enabled, all enabled buttons will always be displayed, even when you click inside the code block. Otherwise, they will only be shown when the cursor is outside the code block.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.buttons.alwaysShowButtons)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.buttons.alwaysShowButtons = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(buttonsDetails)
      .setName('Always show \'Copy Code\' button for collapsed code blocks')
      .setDesc('If enabled, in editing mode the \'Copy Code\' button will always be visible on collapsed code blocks in the header. In reading mode the \'Copy Code\' button will always be visible on collapsed and uncollapsed code blocks as well. Otherwise, it will only appear when hovering over the header (in editing mode) or the code block (in reading mode).')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.buttons.alwaysShowCopyCodeButton)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.buttons.alwaysShowCopyCodeButton = value;
          await this.plugin.saveSettings();
        })
      );

    //return behaviorDiv;
  }// display
}// BehaviorSettings
