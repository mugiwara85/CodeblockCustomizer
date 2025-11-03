import { Notice, PluginSettingTab, Setting, DropdownComponent, App, TextComponent, ToggleComponent, ExtraButtonComponent } from "obsidian";

import {  getColorOfCssVariable, getCurrentMode, updateSettingClasses, updateSettingStyles } from "./Utils";
import { DEFAULT_SETTINGS, CodeblockCustomizerSettings, Colors, DEFAULT_THEMES, FoldingScope, FoldingPersistence, InlineCodeModifierKeys, TabPersistence, ButtonModifierKeys, ColorTheme } from './Settings';
import CodeBlockCustomizerPlugin from "./main";
import { DEFAULT_COLLAPSE_TEXT, DEFAULT_LINE_SEPARATOR, DEFAULT_TEXT_SEPARATOR } from "./Const";
import { ANNOTATION_TYPE_ICONS } from "./TooltipManager";
import { DEFAULT_PROMPT_COLOR, defaultPrompts, promptClassDisplayNames, PromptDefinition, PromptEnvironment } from "./PromptManager";
import { addClassesToPrompt, collectAllPromptClasses, getPromptDefinition, getPromptType, replacePromptTemplate } from "./PromptUtils";

import Pickr from "@simonwep/pickr";

interface ColorOptions {
  [key: string]: string;
}

interface PickerOptions {
  containerEl: HTMLElement;
  initialColor: string;
  onSave: (savedColor: string) => void;
  onReset?: () => string;
  onDelete?: () => void;
  shouldShow?: () => boolean;
  i18n?: Record<string, any>;
}

export class SettingsTab extends PluginSettingTab {
  plugin: CodeBlockCustomizerPlugin;
  debounceTimer: NodeJS.Timeout | null = null;
  pickerInstances: Pickr[];
  headerLangToggles: Setting[];
  headerLangIconToggles: Setting[];
  linkUpdateToggle: Setting[];
  promptPickers: Map<string, Pickr> = new Map();
  annotationDetailsOpen = false;
  altColorsDetailsOpen = false;
  codeBlockDetailsOpen = false;
  langSpecificDetailsOpen = false;
  bracketDetailsOpen = false;
  textHighlightDetailsOpen = false;
  headerDetailsOpen = false;
  inlineCodeDetailsOpen = false;
  groupedCodeBlocksDetailsOpen = false;
  foldDetailsOpen = false;
  buttonsDetailsOpen = false;
  printToPDFDetailsOpen = false;
  promptSettingsDetailsOpen = false;
  promptColorsDetailsOpen = false;
  admonitionDetailsOpen = false;
  executeCodeDetailsOpen = false;

  static COLOR_OPTIONS: ColorOptions = {
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

  constructor(app: App, plugin: CodeBlockCustomizerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.pickerInstances = [];
    this.headerLangToggles = [];
    this.headerLangIconToggles = [];
    this.linkUpdateToggle = [];
  }

  display(): void {
    const {containerEl} = this;
    containerEl.empty();
    containerEl.classList.add(`codeblock-customizer-settingspage`);
    containerEl.createEl('h3', {text: 'Codeblock Customizer Settings'});
    
    let dropdown: DropdownComponent;
    let restoreButton: ExtraButtonComponent;
    new Setting(containerEl)
      .setName("Theme")
      .setDesc("Select which theme to use")
      .addDropdown((dropdownObj) => {
        this.refreshDropdown(dropdownObj, this.plugin.settings);
        dropdownObj.onChange(value => {
          this.plugin.settings.ThemeName = value;
          this.plugin.settings.SelectedTheme = structuredClone(this.plugin.settings.Themes[this.plugin.settings.ThemeName]);
          this.display();
          (async () => {await this.plugin.saveSettings()})();
        });// onChange
        dropdown = dropdownObj;
      })// addDropdown
      .addExtraButton(button => {
        button.setTooltip("Update theme");
        button.setIcon('save');
        button.onClick(() => {
          this.plugin.settings.Themes[this.plugin.settings.ThemeName] = structuredClone(this.plugin.settings.SelectedTheme);
          new Notice(`Theme "${this.plugin.settings.ThemeName}" updated successfully!`);
          (async () => {await this.plugin.saveSettings()})();
        });
      })// addExtraButton
      .addExtraButton(button => {
        button.setTooltip("Restore default theme to its original state");
        button.setIcon('reset');
        button.onClick(() => {
          this.restoreThemes(this.plugin.settings.ThemeName, false);
          (async () => {await this.plugin.saveSettings()})();
          new Notice(`Theme "${this.plugin.settings.ThemeName}" restored to its original state!`);
        });
        button.setDisabled(!(this.plugin.settings.ThemeName in DEFAULT_THEMES))
        restoreButton = button;
      })// addExtraButton
      .addExtraButton(button => {
        button.setTooltip("Delete theme");
        button.setIcon('trash');
        button.onClick(() => {
          if (this.plugin.settings.ThemeName.trim().length === 0) {
            new Notice('Select a theme first to delete');
          } else if (this.plugin.settings.ThemeName in DEFAULT_SETTINGS.Themes) {
            new Notice('You cannot delete the default themes');
          } else {
            delete this.plugin.settings.Themes[this.plugin.settings.ThemeName]
            new Notice(`Theme "${this.plugin.settings.ThemeName}" deleted successfully!`);
            this.plugin.settings.ThemeName = "Obsidian";
            this.plugin.settings.SelectedTheme = structuredClone(this.plugin.settings.Themes[this.plugin.settings.ThemeName]);
            this.refreshDropdown(dropdown, this.plugin.settings);
            this.display();
            (async () => {await this.plugin.saveSettings()})();
          }
        });// onClick
        button.setDisabled(this.plugin.settings.ThemeName in DEFAULT_THEMES);
      })// addExtraButton

    let text: TextComponent;
    this.plugin.settings.newThemeName = "";
    new Setting(containerEl)
      .setName('Create your theme')
      .setDesc('Create your theme with the current colors and settings')
      .addText(input => {
        text = input;
        text.setPlaceholder('Name for your theme')
          .setValue(this.plugin.settings.newThemeName)
          .onChange(async (value) => {
            this.plugin.settings.newThemeName = value;
          });
      })
      .addExtraButton(button => {
        button.setTooltip("Save theme");
        button.setIcon('plus');
        button.onClick(() => {
        if (this.plugin.settings.newThemeName.trim().length === 0)
          new Notice('Set a name for your theme!');
        else if (this.plugin.settings.newThemeName in DEFAULT_SETTINGS.Themes) {
          new Notice('You can\'t overwrite default themes');
        } else {
          if (this.plugin.settings.newThemeName in this.plugin.settings.Themes) {
            this.plugin.settings.Themes[this.plugin.settings.newThemeName] = structuredClone(this.plugin.settings.SelectedTheme);
            new Notice(`Theme "${this.plugin.settings.newThemeName}" updated successfully!`);
          } else {
            this.plugin.settings.Themes[this.plugin.settings.newThemeName] = structuredClone(this.plugin.settings.SelectedTheme);
            new Notice(`Theme "${this.plugin.settings.newThemeName}" saved successfully!`);
          }
          this.plugin.settings.ThemeName = this.plugin.settings.newThemeName;
          this.refreshDropdown(dropdown, this.plugin.settings);
          restoreButton.setDisabled(true);
          this.plugin.settings.newThemeName = "";
          text.setValue("");
          (async () => {await this.plugin.saveSettings()})();
          this.display();
        }
      });
    });

    new Setting(containerEl)
      .setName('Select settings page')
      .setDesc('Select which settings group you want to modify.')
      .addDropdown((dropdown) => dropdown
        .addOptions({
          "general"         : "⚙️ General",
          "appearance"      : "🎨 Appearance & Styling",
          "highlighting"    : "🖌️ Highlighting",
          "behavior"        : "👆 Behavior & Interaction",
          "prompts"         : "⌨️ Prompts",
          "plugins"         : "🧩 Plugin Compatibility"
        })
        .setValue(this.plugin.settings.settingsType)
        .onChange((value) => {
          this.plugin.settings.settingsType = value;
          generalDiv.toggleClass("codeblock-customizer-general-settingsDiv-hide", this.plugin.settings.settingsType !== "general");
          appearanceDiv.toggleClass("codeblock-customizer-appearance-settingsDiv-hide", this.plugin.settings.settingsType !== "appearance");
          highlightingDiv.toggleClass("codeblock-customizer-highlighting-settingsDiv-hide", this.plugin.settings.settingsType !== "highlighting");
          behaviorDiv.toggleClass("codeblock-customizer-behavior-settingsDiv-hide", this.plugin.settings.settingsType !== "behavior");
          promptsDiv.toggleClass("codeblock-customizer-prompts-settingsDiv-hide", this.plugin.settings.settingsType !== "prompts");
          pluginsDiv.toggleClass("codeblock-customizer-plugin-compatibility-settingsDiv-hide", this.plugin.settings.settingsType !== "plugins");
          (async () => {await this.plugin.saveSettings()})();
        })
      );
      
    this.createReadMeLink(containerEl);

    containerEl.createEl("hr");

    const generalDiv = this.createGeneralSettings(containerEl);
    const appearanceDiv = this.createAppearanceSettings(containerEl);
    const highlightingDiv = this.createHighlightingSettings(containerEl);
    const behaviorDiv = this.createBehaviorSettings(containerEl);
    const promptsDiv = this.createPromptSettingsPage(containerEl);
    const pluginsDiv = this.createPluginCompatibilitySettingsPage(containerEl);

    // donation
    const cDonationDiv = containerEl.createDiv({ cls: "codeblock-customizer-Donation", });    
    const credit = createEl("p");
    const donateText = createEl("p");
    donateText.appendText("If you like this plugin, and would like to help support continued development, use the button below!");
    
    credit.setAttribute("style", "color: var(--text-muted)");
    cDonationDiv.appendChild(donateText);
    cDonationDiv.appendChild(credit);

    cDonationDiv.appendChild(
      this.createDonateButton("https://www.buymeacoffee.com/ThePirateKing")
    ); 
  }// display

  private createDetailsGroup(container: HTMLElement, title: string, key: keyof SettingsTab, ...extraClasses: string[]): HTMLElement {
    const details = container.createEl('details');
    
    details.addClasses(['settings-group', ...extraClasses]);

    if (this[key]) {
      details.open = true;
    }
    details.createEl('summary', { text: title });
    details.addEventListener('toggle', () => {
      (this[key] as boolean) = details.open;
    });
    return details;
  }// createDetailsGroup

  createGeneralSettings(containerEl: HTMLElement) {
    const generalDiv = containerEl.createDiv({ cls: "codeblock-customizer-general-settingsDiv-hide" });
    generalDiv.toggleClass("codeblock-customizer-general-settingsDiv-hide", this.plugin.settings.settingsType !== "general");
    generalDiv.createEl('h3', {text: '⚙️ General Settings'});

    new Setting(generalDiv)
      .setName('Enable plugin in source mode')
      .setDesc('By default the plugin is disabled in source mode. You can enable it in source mode as well using this toggle.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.common.enableInSourceMode)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.common.enableInSourceMode = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
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
            await this.plugin.saveSettings();
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
          new Notice("Default themes restored to their original state!");
        });
      });

    // print to PDF
    const printToPDFDetails = this.createDetailsGroup(generalDiv, 'Print to PDF Settings', 'printToPDFDetailsOpen');

    new Setting(printToPDFDetails)
    .setName('Enable print to PDF')
    .setDesc('If enabled, the styling is applied to documents when printed to PDF. By default PDF printing uses light theme colors.')
    .addToggle(toggle => toggle
      .setValue(this.plugin.settings.pluginSettings.printing.enablePrintToPDFStyling)
      .onChange(async (value) => {
        this.plugin.settings.pluginSettings.printing.enablePrintToPDFStyling = value;
        await this.plugin.saveSettings();
        this.display();
      })
    );

    if (this.plugin.settings.pluginSettings.printing.enablePrintToPDFStyling) {
      new Setting(printToPDFDetails)
      .setName('Force current color mode use')
      .setDesc('If enabled, PDF printing will use the dark theme colors when a dark theme is selected, and light theme colors when a light theme is selected.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.printing.forceCurrentColorUse)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.printing.forceCurrentColorUse = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(printToPDFDetails)
      .setName('Avoid page breaks in code blocks')
      .setDesc('If enabled, the plugin will try to prevent code blocks from being split across multiple pages when printing.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.printing.avoidPageBreaks)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.printing.avoidPageBreaks = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(printToPDFDetails)
      .setName('Expand all code blocks during printing')
      .setDesc('If enabled, all collapsed code blocks specified by the "fold" parameter will be expanded when printing. This results in the printed document containing expanded code blocks where "fold" was used.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.printing.uncollapseDuringPrint)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.printing.uncollapseDuringPrint = value;
          await this.plugin.saveSettings();
        })
      );
    }

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

    return generalDiv;
  }// createGeneralSettings
  
  createAppearanceSettings(containerEl: HTMLElement) {
    const appearanceDiv = containerEl.createDiv({ cls: "codeblock-customizer-appearance-settingsDiv-hide" });
    appearanceDiv.toggleClass("codeblock-customizer-appearance-settingsDiv-hide", this.plugin.settings.settingsType !== "appearance");
    appearanceDiv.createEl('h3', {text: '🎨 Appearance & Styling'});
    
    new Setting(appearanceDiv)
      .setName('Enable editor active line highlight')
      .setDesc('If enabled, you can set the color for the active line (including codeblocks).')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.enableEditorActiveLineHighlight)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.enableEditorActiveLineHighlight = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
          editorActiveLineSetting.settingEl.style.display = value ? '' : 'none';
        })
      );
    
    const editorActiveLineSetting = this.createPickrSetting(appearanceDiv, 'Editor active line color', '', "editorActiveLineColor");
    editorActiveLineSetting.settingEl.style.display = this.plugin.settings.pluginSettings.enableEditorActiveLineHighlight ? '' : 'none';

    // code block styling
    const codeBlockDetails = this.createDetailsGroup(appearanceDiv, 'Code Block Styling', 'codeBlockDetailsOpen');

    new Setting(codeBlockDetails)
      .setName('Enable line numbers')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.enableLineNumbers)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.enableLineNumbers = value;
          await this.plugin.saveSettings();
        })
      );

    this.createPickrSetting(codeBlockDetails, 'Code block background color', '', "codeblock.backgroundColor");

    new Setting(codeBlockDetails)
      .setName('Show indentation lines in reading view')
      .setDesc('If enabled, indentation lines will be shown in reading view.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.showIndentationLines)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.showIndentationLines = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
        })
      );

    new Setting(codeBlockDetails)
      .setName('Unwrap code')
      .setDesc('If enabled, the code will be unwrapped in reading view.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.unwrapcode)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.unwrapcode = value;
          await this.plugin.saveSettings();
        })
      );

    // gutter settings
    codeBlockDetails.createEl('h4', {text: 'Gutter Settings'});
    
    new Setting(codeBlockDetails)
      .setName('Highlight gutter')
      .setDesc('If enabled, highlighted lines will also highlight the gutter (line number), not just the line.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.gutter.enableHighlight)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.gutter.enableHighlight = value;
          await this.plugin.saveSettings();
      })
    );
    
    this.createPickrSetting(codeBlockDetails, 'Gutter text color', '', "gutter.textColor");
    this.createPickrSetting(codeBlockDetails, 'Gutter background color', '', "gutter.backgroundColor");
    
    new Setting(codeBlockDetails)
      .setName('Highlight active line number')
      .setDesc('If enabled, the active line number will be highlighted with a separate color.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.gutter.highlightActiveLineNr)
        .onChange((value) => {
          this.plugin.settings.pluginSettings.gutter.highlightActiveLineNr = value;
          (async () => {await this.plugin.saveSettings()})();
          updateSettingStyles(this.plugin.settings, this.app);
          highlightActiveLineNrSetting.settingEl.style.display = value ? '' : 'none';
        })
      );

    const highlightActiveLineNrSetting = this.createPickrSetting(codeBlockDetails, 'Active line number color', '', "gutter.activeLineNrColor");
    highlightActiveLineNrSetting.settingEl.style.display = this.plugin.settings.pluginSettings.gutter.highlightActiveLineNr ? '' : 'none';

    // header settings
    const headerDetails = this.createDetailsGroup(appearanceDiv, 'Header Settings', 'headerDetailsOpen');
    
    this.createPickrSetting(headerDetails, 'Header color', 'Sets the background color of the code block header.', "header.backgroundColor");
    this.createPickrSetting(headerDetails, 'Header text color', '', "header.textColor");
    
    new Setting(headerDetails)
      .setName('Header bold text')
      .setDesc('If enabled, the header text will be set to bold.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.header.boldText)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.header.boldText = value;
          await this.plugin.saveSettings();
      })
    );
    
    new Setting(headerDetails)
      .setName('Header italic text')
      .setDesc('If enabled, the header text will be set to italic.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.header.italicText)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.header.italicText = value;
          await this.plugin.saveSettings();
      })
    );
    
    this.createPickrSetting(headerDetails, 'Header line color', 'Sets the color of the separator line at the bottom of the header.', "header.lineColor");
    
    new Setting(headerDetails)
      .setName('Disable folding for code blocks without `fold` or `unfold` specified')
      .setDesc('If enabled, code blocks without `fold` or `unfold` specified will not collapse when clicking the header.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.header.disableFoldUnlessSpecified)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.header.disableFoldUnlessSpecified = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
        })
      );

    new Setting(headerDetails)
      .setName('Collapse icon position')
      .setDesc('If enabled a collapse icon will be displayed in the header. Select the position of the collapse icon.')
      .addDropdown((dropdown) => dropdown
        .addOptions({"hide": "Hide", "middle": "Middle", "right": "Right"})
        .setValue(this.plugin.settings.pluginSettings.header.collapseIconPosition)
        .onChange((value) => {
          this.plugin.settings.pluginSettings.header.collapseIconPosition = value;
          (async () => {await this.plugin.saveSettings()})();
          updateSettingStyles(this.plugin.settings, this.app);
        })
      );

    new Setting(headerDetails)
    .setName('Collapsed code text')
    .setDesc('Overwrite the default "Collapsed Code" text in the header, when the file parameter is not defined.')
    .addText(text => text
      .setPlaceholder(DEFAULT_COLLAPSE_TEXT)
      .setValue(this.plugin.settings.pluginSettings.header.collapsedCodeText)
      .onChange(async (value) => {
        this.plugin.settings.pluginSettings.header.collapsedCodeText = value;
        await this.plugin.saveSettings();
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
          }
          this.debounceTimer = setTimeout(async () => {
            await this.plugin.saveSettings();
            this.plugin.renderReadingViews();
          }, 750);
      })
    );

    headerDetails.createEl('h4', {text: 'Header Language Tag & Header Icon Settings'});

    new Setting(headerDetails)
      .setName('Display codeblock language (if language is defined)')
      .setDesc('If enabled, the codeblock language will be displayed in the header.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.header.displayCodeBlockLanguage)
        .onChange(async (value) => {
          this.headerLangToggles.forEach(item => {
            item.setDisabled(!value);
          });
          this.plugin.settings.pluginSettings.header.displayCodeBlockLanguage = value;
          await this.plugin.saveSettings();
          this.display();
      })
    );

    if (this.plugin.settings.pluginSettings.header.displayCodeBlockLanguage) {
      this.createPickrSetting(headerDetails, 'Codeblock language text color', '', "header.codeBlockLangTextColor");    
      this.createPickrSetting(headerDetails, 'Codeblock language background color', '', "header.codeBlockLangBackgroundColor");    
      
      const boldToggle = new Setting(headerDetails)
        .setName('Bold text')
        .setDesc('If enabled, the codeblock language text will be set to bold.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.pluginSettings.header.codeblockLangBoldText)
          .onChange(async (value) => {
            this.plugin.settings.pluginSettings.header.codeblockLangBoldText = value;
            await this.plugin.saveSettings();
        })
      );
      this.headerLangToggles.push(boldToggle);
      
      const italicToggle = new Setting(headerDetails)
        .setName('Italic text')
        .setDesc('If enabled, the codeblock language text will be set to italic.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.pluginSettings.header.codeblockLangItalicText)
          .onChange(async (value) => {
            this.plugin.settings.pluginSettings.header.codeblockLangItalicText = value;
            await this.plugin.saveSettings();
        })
      );
      this.headerLangToggles.push(italicToggle);
      
      const alwaysDisplayToggle = new Setting(headerDetails)
        .setName('Always display codeblock language')
        .setDesc('If enabled, the codeblock language will always be displayed (if a language is defined), even if the `file` parameter is not specified.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.pluginSettings.header.alwaysDisplayCodeblockLang)
          .onChange(async (value) => {
            this.plugin.settings.pluginSettings.header.alwaysDisplayCodeblockLang = value;
            await this.plugin.saveSettings();
        })
      );
      this.headerLangToggles.push(alwaysDisplayToggle);
      
      if (!this.plugin.settings.pluginSettings.header.displayCodeBlockLanguage){
        this.headerLangToggles.forEach(item => {
          item.setDisabled(true);
        });
      }
    }
    
    new Setting(headerDetails)
      .setName('Display codeblock language icon (if available)')
      .setDesc('If enabled, the codeblock language icon will be displayed in the header.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.header.displayCodeBlockIcon)
        .onChange(async (value) => {
          this.headerLangIconToggles.forEach(item => {
            item.setDisabled(!value);
          });
          this.plugin.settings.pluginSettings.header.displayCodeBlockIcon = value;
          await this.plugin.saveSettings();
          this.display();
      })
    );
    
    if (this.plugin.settings.pluginSettings.header.displayCodeBlockIcon) {
      const alwaysDisplayIconToggle = new Setting(headerDetails)
        .setName('Always display codeblock language icon (if available)')
        .setDesc('If enabled, the codeblock language icon will always be displayed (if a language is defined and it has an icon), even if the `file` parameter is not specified.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.pluginSettings.header.alwaysDisplayCodeblockIcon)
          .onChange(async (value) => {
            this.plugin.settings.pluginSettings.header.alwaysDisplayCodeblockIcon = value;
            await this.plugin.saveSettings();
        })
      );
      this.headerLangIconToggles.push(alwaysDisplayIconToggle);
      
      if (!this.plugin.settings.pluginSettings.header.displayCodeBlockIcon){
        this.headerLangIconToggles.forEach(item => {
          item.setDisabled(true);
        });
      }
    }

    // annotation settings
    const annotationDetails = this.createDetailsGroup(appearanceDiv, 'Annotation Settings', 'annotationDetailsOpen');

    new Setting(annotationDetails)
      .setName('Convert all comments to annotations')
      .setDesc('If enabled, every comment in a code block will be styled as a `note` annotation, even without the `[!note]` syntax. ')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.annotations.convertAllComments)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.annotations.convertAllComments = value;
          await this.plugin.saveSettings();
          this.plugin.renderReadingViews(); 
        })
      );

    new Setting(annotationDetails)
      .setName('Exclude annotations from copying')
      .setDesc('Enable to exclude annotation comments (e.g., // [!note] ...) when using the copy code button. Regular comments will always be copied.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.annotations.excludeAnnotationsFromCopy)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.annotations.excludeAnnotationsFromCopy = value;
          await this.plugin.saveSettings();
        })
      );

    for (const type of Object.keys(ANNOTATION_TYPE_ICONS)) {
      this.createPickrSetting(annotationDetails, `'${type}' icon color`, '', `annotations.colors.${type}`);
    }

    // language specific colors
    const langSpecificDetails = this.createDetailsGroup(appearanceDiv, 'Language Specific Color Overrides', 'langSpecificDetailsOpen');

    let languageSpecificColorDisplayText: TextComponent;
    new Setting(langSpecificDetails)
      .setName("Add languages to set colors")
      .setDesc('Add a language, to set the colors for this specific language. If you want to set colors for code blocks without a language, add "nolang" as a language.')
      .addText(value => { 
        languageSpecificColorDisplayText = value
        languageSpecificColorDisplayText.setPlaceholder('e.g. cpp, csharp')
        languageSpecificColorDisplayText.onChange(async (languageSpecific) => {
          this.plugin.settings.languageSpecificLanguageName = languageSpecific;
        });
      })
      .addButton(async (button) => {
        button.setButtonText("Add");
        button.onClick(async () => {
          const colorNameRegex = /^[^\d][\w\d]*$/;
          if (this.plugin.settings.languageSpecificLanguageName.trim() === "") {
            new Notice("Please enter a language name.");
          } else if (!colorNameRegex.test(this.plugin.settings.languageSpecificLanguageName)) { // check if the input matches the regex
            new Notice(`"${this.plugin.settings.languageSpecificLanguageName}" is not a valid language name.`);
          } else {
            if (this.plugin.settings.languageSpecificLanguageName.toLowerCase() in this.plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors) {
              new Notice(`A language with the name "${this.plugin.settings.languageSpecificLanguageName}" already exists.`);
            } else {
              this.plugin.settings.SelectedTheme.colors.light.languageSpecificColors[this.plugin.settings.languageSpecificLanguageName] = {};
              this.plugin.settings.SelectedTheme.colors.dark.languageSpecificColors[this.plugin.settings.languageSpecificLanguageName] = {};
              new Notice(`Added language "${this.plugin.settings.languageSpecificLanguageName}".`);
              languageSpecificColorDisplayText.setValue("");
              this.plugin.settings.languageSpecificLanguageName = "";
              await this.plugin.saveSettings();
              this.updateLanguageSpecificColorContainer(languageSpecificContainer); // Update the color container after adding a color
            }
          }
        });
      });

    new Setting(langSpecificDetails)
      .setName('Code block border styling position')
      .setDesc('Select on which side the border should be displayed.')
      .addDropdown((dropdown) => dropdown
        .addOptions({"disable": "Disable", "left": "Left", "right": "Right"})
        .setValue(this.plugin.settings.pluginSettings.codeblock.codeBlockBorderStylingPosition)
        .onChange((value) => {
          this.plugin.settings.pluginSettings.codeblock.codeBlockBorderStylingPosition = value;
          (async () => {await this.plugin.saveSettings()})();
          updateSettingStyles(this.plugin.settings, this.app);
        })
      );
    const languageSpecificContainer = langSpecificDetails.createDiv({ cls: "codeblock-customizer-languageSpecificColorContainer" });

    // Update the color container on page load
    this.updateLanguageSpecificColorContainer(languageSpecificContainer);

    // inline code settings
    const inlineCodeDetails = this.createDetailsGroup(appearanceDiv, 'Inline Code Settings', 'inlineCodeDetailsOpen');

    new Setting(inlineCodeDetails)
      .setName('Enable click-to-copy for inline code')
      .setDesc('Allows you to copy inline code by clicking on it while holding a modifier key.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.inlineCode.enableCopyOnClick)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.inlineCode.enableCopyOnClick = value;
          await this.plugin.saveSettings();
          this.display();
          this.plugin.renderReadingViews();
        })
      );
    
    if (this.plugin.settings.pluginSettings.inlineCode.enableCopyOnClick) {
      new Setting(inlineCodeDetails)
        .setName('Modifier key for copy')
        .setDesc('Select the key to hold while clicking to copy.')
        .addDropdown(dropdown => dropdown
          .addOption(InlineCodeModifierKeys.CTRL, 'Ctrl')
          .addOption(InlineCodeModifierKeys.ALT, 'Alt')
          .setValue(this.plugin.settings.pluginSettings.inlineCode.copyModifierKey)
          .onChange(async (value: InlineCodeModifierKeys) => {
            this.plugin.settings.pluginSettings.inlineCode.copyModifierKey = value;
            await this.plugin.saveSettings();
          })
        );
    }

    new Setting(inlineCodeDetails)
      .setName('Enable inline code syntax highlighting')
      .setDesc('If enabled, syntax highlighting will be added to inline code (if specified).')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.inlineCode.enableSyntaxHighlight)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.inlineCode.enableSyntaxHighlight = value;
          await this.plugin.saveSettings();
          this.plugin.renderReadingViews();
          this.display();
        })
      );

    if (this.plugin.settings.pluginSettings.inlineCode.enableSyntaxHighlight) {
      new Setting(inlineCodeDetails)
        .setName('Show icons for syntax highlighted inline code (if available)')
        .setDesc('If enabled, icons will be shown for syntax highlighted inline code.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.pluginSettings.inlineCode.showIcons)
          .onChange(async (value) => {
            this.plugin.settings.pluginSettings.inlineCode.showIcons = value;
            await this.plugin.saveSettings();
          })
        );
    }

    new Setting(inlineCodeDetails)
      .setName('Enable inline code styling')
      .setDesc('If enabled, the background color, and the text color of inline code can be styled.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.inlineCode.enableInlineCodeStyling)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.inlineCode.enableInlineCodeStyling = value;
          await this.plugin.saveSettings();
          inlineCodeBackgroundSetting.settingEl.style.display = value ? '' : 'none';
          inlineCodeTextColorSetting.settingEl.style.display = value ? '' : 'none';
        })
      );

    const inlineCodeBackgroundSetting = this.createPickrSetting(inlineCodeDetails, 'Inline code background color', '', "inlineCode.backgroundColor");
    inlineCodeBackgroundSetting.settingEl.style.display = this.plugin.settings.pluginSettings.inlineCode.enableInlineCodeStyling ? '' : 'none';
    const inlineCodeTextColorSetting = this.createPickrSetting(inlineCodeDetails, 'Inline code text color', '', "inlineCode.textColor");
    inlineCodeTextColorSetting.settingEl.style.display = this.plugin.settings.pluginSettings.inlineCode.enableInlineCodeStyling ? '' : 'none';

    return appearanceDiv;
  }// createAppearanceSettings

  createHighlightingSettings(containerEl: HTMLElement) {
    const highlightingDiv = containerEl.createDiv({ cls: "codeblock-customizer-highlighting-settingsDiv-hide" });
    highlightingDiv.toggleClass("codeblock-customizer-highlighting-settingsDiv-hide", this.plugin.settings.settingsType !== "highlighting");
    highlightingDiv.createEl('h3', {text: '🖌️ Highlighting Settings'});

    new Setting(highlightingDiv)
      .setName('Enable codeblock active line highlight')
      .setDesc('If enabled, you can set the color for the active line inside codeblocks only.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.enableActiveLineHighlight)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.enableActiveLineHighlight = value;          
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
          activeLineSetting.settingEl.style.display = value ? '' : 'none';
        })
      );
        
    const activeLineSetting = this.createPickrSetting(highlightingDiv, 'Codeblock active line color', '', "codeblock.activeLineColor");
    activeLineSetting.settingEl.style.display = this.plugin.settings.pluginSettings.codeblock.enableActiveLineHighlight ? '' : 'none';
    
    this.createPickrSetting(highlightingDiv, 'Highlight color (used by the "hl" parameter)', 'Sets the default color for highlighting lines using the `hl` parameter (e.g., `hl:5`).', "codeblock.highlightColor");

    // bracket highlight
    const bracketDetails = this.createDetailsGroup(highlightingDiv, 'Bracket Highlight & Selection Matching', 'bracketDetailsOpen');

    new Setting(bracketDetails)
      .setName('Enable bracket highlight for matching brackets')
      .setDesc('Highlights a bracket and its matching pair when you click next to one.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.enableBracketHighlight)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.enableBracketHighlight = value;
          if (value){
            this.plugin.extensions.push(this.plugin.editorExtensions.customBracketMatching);
          }
          else{
            this.plugin.extensions.remove(this.plugin.editorExtensions.customBracketMatching);
          }
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
          this.display();
        })
      );

    if (this.plugin.settings.pluginSettings.codeblock.enableBracketHighlight) {
      this.createPickrSetting(bracketDetails, 'Bracket highlight color for matching brackets', '', "codeblock.bracketHighlightColorMatch");
      this.createPickrSetting(bracketDetails, 'Background color for matching brackets', '', "codeblock.bracketHighlightBackgroundColorMatch");

      new Setting(bracketDetails)
        .setName('Enable bracket highlight for non matching brackets')
        .setDesc('If you click next to a bracket, and it doesn\'t have a corresponding pair, or the pair does not match the opening/closing bracket (e.g: `print("hello"]` ), they will be highlighted.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.pluginSettings.codeblock.highlightNonMatchingBrackets)
          .onChange(async (value) => {
            this.plugin.settings.pluginSettings.codeblock.highlightNonMatchingBrackets = value;
            await this.plugin.saveSettings();
            updateSettingStyles(this.plugin.settings, this.app);
            bracketHighlightMatchSetting.settingEl.style.display = value ? '' : 'none';
            bracketBackgroundNonMatchSetting.settingEl.style.display = value ? '' : 'none';
          })
        );

      const bracketHighlightMatchSetting = this.createPickrSetting(bracketDetails, 'Bracket highlight color for non matching brackets', '', "codeblock.bracketHighlightColorNoMatch");
      bracketHighlightMatchSetting.settingEl.style.display = this.plugin.settings.pluginSettings.codeblock.highlightNonMatchingBrackets ? '' : 'none';
      const bracketBackgroundNonMatchSetting = this.createPickrSetting(bracketDetails, 'Background color for non matching brackets', '', "codeblock.bracketHighlightBackgroundColorNoMatch");
      bracketBackgroundNonMatchSetting.settingEl.style.display = this.plugin.settings.pluginSettings.codeblock.highlightNonMatchingBrackets ? '' : 'none';
    }

    // selection matching
    new Setting(bracketDetails)
      .setName('Enable selection matching')
      .setDesc('If enabled, all occurrences of the selected text will be highlighted for easy identification.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.enableSelectionMatching)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.enableSelectionMatching = value;
          if (value){
            this.plugin.extensions.push(this.plugin.editorExtensions.selectionMatching);
          }
          else{
            this.plugin.extensions.remove(this.plugin.editorExtensions.selectionMatching);
          }
          await this.plugin.saveSettings();
          selectionMatchHighlightSetting.settingEl.style.display = value ? '' : 'none';
        })
      );

    const selectionMatchHighlightSetting = this.createPickrSetting(bracketDetails, 'Selection match highlight color', '', "codeblock.selectionMatchHighlightColor");
    selectionMatchHighlightSetting.settingEl.style.display = this.plugin.settings.pluginSettings.codeblock.enableSelectionMatching ? '' : 'none';

    // text highlight
    const textHighlightDetails = this.createDetailsGroup(highlightingDiv, 'Text Highlight', 'textHighlightDetailsOpen');

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
    const altColorsDetails = this.createDetailsGroup(highlightingDiv, 'Alternative Highlight Colors', 'altColorsDetailsOpen');

    let alternateColorDisplayText: TextComponent;
    new Setting(altColorsDetails)
      .setName("Add alternative highlight color")
      .setDesc('Define a name, by which you will reference the color. You can set the color itself after adding it to the list.')
      .addText(value => { alternateColorDisplayText = value
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
              const newColor = this.getRandomColor();
              this.plugin.settings.SelectedTheme.colors.light.codeblock.alternateHighlightColors[this.plugin.settings.alternateHighlightColorName] = newColor;
              this.plugin.settings.SelectedTheme.colors.dark.codeblock.alternateHighlightColors[this.plugin.settings.alternateHighlightColorName] = newColor;
              await this.plugin.saveSettings();
              new Notice(`Added color "${this.plugin.settings.alternateHighlightColorName}".`);
              alternateColorDisplayText.setValue("");
              this.plugin.settings.alternateHighlightColorName = "";
              this.updateColorContainer(colorContainer); // Update the color container after adding a color
              this.plugin.renderReadingViews();
            }
          }
        });
      });
      
    const colorContainer = altColorsDetails.createDiv({ cls: "codeblock-customizer-alternateHLcolorContainer" });

    // Update the color container on page load
    this.updateColorContainer(colorContainer);
    
    return highlightingDiv;
  }// createHighlightingSettings

  createBehaviorSettings(containerEl: HTMLElement) {
    const behaviorDiv = containerEl.createDiv({ cls: "codeblock-customizer-behavior-settingsDiv-hide" });
    behaviorDiv.toggleClass("codeblock-customizer-behavior-settingsDiv-hide", this.plugin.settings.settingsType !== "behavior");
    behaviorDiv.createEl('h3', {text: '👆 Behavior & Interaction'});

    new Setting(behaviorDiv)
      .setName('Enable links usage')
      .setDesc('If enabled, you can use links in the header, and code blocks as well. For links to work inside code blocks, they must be part of a comment. Examples: [[Document1]], [[Document1|DisplayText]], [[Document1#Paragraph|DisplayText]], [[Document1#^<BlockId>|DisplayText]], [DisplayText](Link), http://example.com etc.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.enableLinks)
        .onChange(async (value) => {
          this.linkUpdateToggle.forEach(item => {
            item.setDisabled(!value);
          });
          this.plugin.settings.pluginSettings.codeblock.enableLinks = value;
          await this.plugin.saveSettings();
          this.display();
          this.plugin.renderReadingViews();
        })
      );

    if (this.plugin.settings.pluginSettings.codeblock.enableLinks) {
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
      this.linkUpdateToggle.push(enableLinkUpdate);
    }
  
    if (!this.plugin.settings.pluginSettings.codeblock.enableLinks){
      this.linkUpdateToggle.forEach(item => {
        item.setDisabled(true);
      });
    }

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
    const groupedCodeBlocksDetails = this.createDetailsGroup(behaviorDiv, 'Grouped Code Block Settings', 'groupedCodeBlocksDetailsOpen');

    new Setting(groupedCodeBlocksDetails)
      .setName('Save active tab state')
      .setDesc('If enabled, the active tab for each group will be remembered based on the options below.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.groupedCodeBlocks.rememberTabState)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.groupedCodeBlocks.rememberTabState = value;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (this.plugin.settings.pluginSettings.groupedCodeBlocks.rememberTabState) {
      new Setting(groupedCodeBlocksDetails)
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
              this.display();
            });
        });

      if (this.plugin.settings.pluginSettings.groupedCodeBlocks.persistence === TabPersistence.Permanent) {
        new Setting(groupedCodeBlocksDetails)
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
      }
    }

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

    this.createPickrSetting(groupedCodeBlocksDetails, 'Active tab background color', 'Background color of the currently active tab.', "groupedCodeBlocks.activeTabBackgroundColor");
    this.createPickrSetting(groupedCodeBlocksDetails, 'Active tab text color', 'Text color of the currently active tab.', "groupedCodeBlocks.activeTabTextColor");
    this.createPickrSetting(groupedCodeBlocksDetails, 'Header line color', 'Sets the color of the separator line at the bottom of the header for grouped code blocks.', "groupedCodeBlocks.headerLineColor");
    this.createPickrSetting(groupedCodeBlocksDetails, 'Tab hover background color', 'Background color when the mouse hovers over a tab.', "groupedCodeBlocks.hoverTabBackgroundColor");
    this.createPickrSetting(groupedCodeBlocksDetails, 'Tab hover text color', 'Text color when the mouse hovers over a tab.', "groupedCodeBlocks.hoverTabTextColor");
    
    // folding
    const foldDetails = this.createDetailsGroup(behaviorDiv, 'Folding Settings', 'foldDetailsOpen');

    const updateFoldingSettingsVisibility = () => {
      const semiFoldEnabled = this.plugin.settings.pluginSettings.semiFold.enableSemiFold;
      const inverseFoldEnabled = this.plugin.settings.pluginSettings.codeblock.folding.inverseFold;

      if (semiFoldLinesDropDown) 
        semiFoldLinesDropDown.setDisabled(!semiFoldEnabled);
      if (semiFoldShowButton) 
        semiFoldShowButton.setDisabled(!semiFoldEnabled);
      if (autoFoldSetting) 
        autoFoldSetting.settingEl.style.display = semiFoldEnabled ? '' : 'none';

      if (ignoreShortBlocksSetting) {
        const showIgnoreShortBlocks = semiFoldEnabled && inverseFoldEnabled;
        ignoreShortBlocksSetting.settingEl.style.display = showIgnoreShortBlocks ? '' : 'none';
      }
    };

    new Setting(foldDetails)
      .setName('Inverse fold behavior')
      .setDesc('If enabled, all code blocks are folded by default when opening a document. To disable this behavior for a specific code block, use the "unfold" parameter.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.folding.inverseFold)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.folding.inverseFold = value;
          await this.plugin.saveSettings();
          updateFoldingSettingsVisibility();
          this.plugin.renderReadingViews();
        })
      );

    const ignoreShortBlocksSetting = new Setting(foldDetails)
      .setName('Only apply inverse fold to semi-foldable blocks')
      .setDesc('When `Inverse fold` and `Enable semi-fold` are both enabled, this prevents short code blocks (that cannot be semi-folded) from being fully folded by default.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.folding.ignoreShortBlocksOnInverseFold)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.folding.ignoreShortBlocksOnInverseFold = value;
          await this.plugin.saveSettings();
          this.plugin.renderReadingViews();
        })
      );

    let semiFoldLinesDropDown: DropdownComponent;
    let semiFoldShowButton: ToggleComponent;
    
    new Setting(foldDetails)
      .setName('Enable semi-fold')
      .setDesc('If enabled folding will use semi-fold method. This means, that the first X lines will be visible only. Select the number of visisble lines. You can also enable an additional uncollapse button. Please refer to the README for more information.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.semiFold.enableSemiFold)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.semiFold.enableSemiFold = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
          updateFoldingSettingsVisibility();
        })
      )
      .addDropdown((dropdown) => { semiFoldLinesDropDown = dropdown
        dropdown.selectEl.empty();
        dropdown.addOptions(Object.fromEntries([...Array(50)].map((_, index) => [`${index + 1}`, `${index + 1}`])))
        dropdown.setValue(this.plugin.settings.pluginSettings.semiFold.visibleLines.toString())
        dropdown.onChange(async (value) => {
          const number = parseInt(value);
          this.plugin.settings.pluginSettings.semiFold.visibleLines = number;
          await this.plugin.saveSettings();
        })
      })
      .addToggle(toggle => semiFoldShowButton = toggle
        .setValue(this.plugin.settings.pluginSettings.semiFold.showAdditionalUncollapseButon)
        .setTooltip('Show additional uncollapse button')
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.semiFold.showAdditionalUncollapseButon = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
        })
      );

    let longCodeblockLinesInput: TextComponent;
    const autoFoldSetting = new Setting(foldDetails)
      .setName('Auto semi-fold long code blocks')
      .setDesc('If enabled, code blocks longer than a specified number of lines will be semi-folded when a note is opened.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.semiFold.autoFoldLongCodeblocks)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.semiFold.autoFoldLongCodeblocks = value;
          longCodeblockLinesInput.setDisabled(!value);
          longCodeblockLinesInput.inputEl.classList.toggle('is-disabled', !value);
          await this.plugin.saveSettings();
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
          this.display();
        })
      );

    if (this.plugin.settings.pluginSettings.codeblock.folding.rememberFoldState) {
      new Setting(foldDetails)
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

      new Setting(foldDetails)
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
                  this.plugin.activeEditorFolds.clear();
                  this.app.workspace.updateOptions();
                  new Notice("Cleared session fold data.");
                }
              }

              this.plugin.settings.pluginSettings.codeblock.folding.persistence = value;
              await this.plugin.saveSettings();
              this.display();
            });
        });

      if (this.plugin.settings.pluginSettings.codeblock.folding.persistence === FoldingPersistence.Permanent) {
        new Setting(foldDetails)
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
      }
    }

    // extra buttons
    const buttonsDetails = this.createDetailsGroup(behaviorDiv, 'Extra Button Settings', 'buttonsDetailsOpen');

    new Setting(buttonsDetails)
      .setName('Modifier key for fence actions')
      .setDesc('Hold this key while clicking copy, select, or delete to include the fence lines in the action.')
      .addDropdown(dropdown => dropdown
        .addOption(ButtonModifierKeys.NONE, 'None')
        .addOption(ButtonModifierKeys.CTRL, 'Ctrl')
        .addOption(ButtonModifierKeys.ALT, 'Alt')
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
          updateSettingStyles(this.plugin.settings, this.app);
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
          updateSettingStyles(this.plugin.settings, this.app);
        })
      );

    new Setting(buttonsDetails)
      .setName('Show \'Wrap Code\' button (only reading view)')
      .setDesc('If enabled, an additional button will be displayed on every code block. If clicked, the content of that code block is wrapped/unwrapped.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.buttons.enableWrapCodeButton)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.buttons.enableWrapCodeButton = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
        })
      );

    new Setting(buttonsDetails)
      .setName('Show \'Copy as image\' button')
      .setDesc('If enabled, an additional button will be displayed on every code block. If clicked, a snapshot is created from the code block and inserted on the clipboard.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.buttons.enableSnapshotButton)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.buttons.enableSnapshotButton = value;
          snapshotWidthSetting.settingEl.style.display = value ? '' : 'none';
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
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

    if (!this.plugin.settings.pluginSettings.codeblock.buttons.enableSnapshotButton) {
      snapshotWidthSetting.settingEl.style.display = 'none';
    }

    new Setting(buttonsDetails)
      .setName('Always show buttons (only editing view)')
      .setDesc('If enabled, all enabled buttons will always be displayed, even when you click inside the code block. Otherwise, they will only be shown when the cursor is outside the code block.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.buttons.alwaysShowButtons)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.buttons.alwaysShowButtons = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
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
          updateSettingStyles(this.plugin.settings, this.app);
        })
      );
    
    return behaviorDiv;
  }// createBehaviorSettings

  createPromptSettingsPage(containerEl: HTMLElement) {
    const promptsDiv = containerEl.createDiv({ cls: "codeblock-customizer-prompts-settingsDiv-hide" });
    promptsDiv.toggleClass("codeblock-customizer-prompts-settingsDiv-hide", this.plugin.settings.settingsType !== "prompts");
    promptsDiv.createEl('h3', {text: '⌨️ Prompts Settings '});

    new Setting(promptsDiv)
      .setName('Include prompts when copying')
      .setDesc('If enabled, the prompt text (e.g., "$") will be included with the command when copying.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.prompts.includePromptsInCopy)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.prompts.includePromptsInCopy = value;
          await this.plugin.saveSettings();
        })
      );

    let selectedPromptId = Object.keys(defaultPrompts)[0]; // default to first prompt

    let promptDropdown: DropdownComponent;
    let promptRestoreButton: ExtraButtonComponent;
    let promptDeleteButton: ExtraButtonComponent;
    new Setting(promptsDiv)
      .setName("Select Prompt")
      .setDesc("Choose a prompt to edit or preview.")
      .addDropdown(dropdown => {
        this.refreshPromptDropdown(dropdown, selectedPromptId);
        dropdown.onChange(async (value) => {
          selectedPromptId = value;
          this.createPromptSettings(promptEditorContainer, selectedPromptId);
          promptRestoreButton.setDisabled(!(selectedPromptId in defaultPrompts));
          promptDeleteButton.setDisabled(selectedPromptId in defaultPrompts);
          await this.plugin.saveSettings();
        });
        promptDropdown = dropdown;
      })
      .addExtraButton(button => {
        promptRestoreButton = button;
        button.setTooltip("Restore default prompt to its original state");
        button.setIcon('reset');
        button.onClick(async () => {
          this.restorePromptColor(selectedPromptId);
          await this.plugin.saveSettings();
          new Notice(`All settings and colors of prompt "${selectedPromptId}" restored to its original state!`);
        });
        button.setDisabled(!(selectedPromptId in defaultPrompts))
        //restoreButton = button;
      })// addExtraButton
      .addExtraButton(button => {
        promptDeleteButton = button
        button.setTooltip("Delete prompt");
        button.setIcon('trash');
        button.onClick(async () => {
          if (!selectedPromptId) {
            new Notice('Select a prompt first to delete.');
            return;
          }
          if (selectedPromptId in defaultPrompts) {
            new Notice('You cannot delete default prompts.');
            return;
          }
          if (!(selectedPromptId in this.plugin.settings.pluginSettings.prompts.customPrompts)) {
            new Notice('Prompt not found.');
            return;
          }
          delete this.plugin.settings.pluginSettings.prompts.customPrompts[selectedPromptId];
          delete this.plugin.settings.SelectedTheme.colors.light.prompts.promptColors?.[selectedPromptId];
          delete this.plugin.settings.SelectedTheme.colors.dark.prompts.promptColors?.[selectedPromptId];
          delete this.plugin.settings.SelectedTheme.colors.light.prompts.editedPromptColors?.[selectedPromptId];
          delete this.plugin.settings.SelectedTheme.colors.dark.prompts.editedPromptColors?.[selectedPromptId];
          delete this.plugin.settings.SelectedTheme.colors.light.prompts.editedRootPromptColors?.[selectedPromptId];
          delete this.plugin.settings.SelectedTheme.colors.dark.prompts.editedRootPromptColors?.[selectedPromptId];

          new Notice(`Prompt "${selectedPromptId}" deleted successfully!`);
          selectedPromptId = Object.keys(defaultPrompts)[0];
          promptRestoreButton.setDisabled(!(selectedPromptId in defaultPrompts));
          promptDeleteButton.setDisabled(selectedPromptId in defaultPrompts);
          this.refreshPromptDropdown(promptDropdown, selectedPromptId);
          this.createPromptSettings(promptEditorContainer, selectedPromptId);
          await this.plugin.saveSettings();
          this.plugin.renderReadingViews();
        });// onClick
        button.setDisabled(selectedPromptId in defaultPrompts)
      })// addExtraButton

    let promptName: TextComponent;
    this.plugin.settings.newPromptName = "";
    new Setting(promptsDiv)
      .setName('Create your custom prompt')
      .setDesc('Give your prompt a name and click the button to save it. You can use your prompt using this name e.g. "prompt:myPromptName".')
      .addText(input => {
        promptName = input;
        promptName.setPlaceholder('Name for your prompt')
          .setValue(this.plugin.settings.newPromptName)
          .onChange(async (value) => {
            this.plugin.settings.newPromptName = value;
          });
      })
      .addExtraButton(button => {
        button.setTooltip("Save prompt");
        button.setIcon('plus');
        button.onClick(async () => {
          const newPromptId = this.plugin.settings.newPromptName.trim();
          if (newPromptId.length === 0) {
            new Notice('Set a name for your prompt!');
            return;
          }
          
          if (newPromptId in defaultPrompts) {
            new Notice('You can\'t overwrite default prompts!');
            return;
          }
          
          const exists = newPromptId in this.plugin.settings.pluginSettings.prompts.customPrompts;

          this.plugin.settings.pluginSettings.prompts.customPrompts[this.plugin.settings.newPromptName] = {
            name: this.plugin.settings.newPromptName,
            basePrompt: "{user}@{host}:{path}$",
            defaultUser: "user",
            defaultHost: "localhost",
            defaultDir: "~",
            parsePromptRegex: /^(?<user>[^@]+)@(?<host>[^:]+):(?<path>.+?)$/,
            highlightGroups: {
              user: "user",
              host: "host",
              path: "path",
            },
            supportsRootStyling: false,
            isWindowsShell: false,
          };
          selectedPromptId = newPromptId;
          if (!exists) {
            promptDropdown.addOption(newPromptId, `[Custom] ${newPromptId}`);
          }
          promptDropdown.setValue(selectedPromptId);
          promptRestoreButton.setDisabled(!(selectedPromptId in defaultPrompts));
          promptDeleteButton.setDisabled(selectedPromptId in defaultPrompts);
          if (exists)
            new Notice(`Prompt "${this.plugin.settings.newPromptName}" updated successfully!`);
          else
            new Notice(`Prompt "${this.plugin.settings.newPromptName}" saved successfully!`);
          this.plugin.settings.newPromptName = "";
          promptName.setValue("");
          await this.plugin.saveSettings();
          this.createPromptSettings(promptEditorContainer, selectedPromptId);
          this.plugin.renderReadingViews();
      });
    });

    const promptEditorContainer = promptsDiv.createDiv({cls: 'codeblock-customizer-prompt-editor-container'});
    this.createPromptSettings(promptEditorContainer, selectedPromptId);

    return promptsDiv;
  }// createPromptSettingsPage

  createPluginCompatibilitySettingsPage(containerEl: HTMLElement) {
    const pluginsDiv = containerEl.createDiv({ cls: "codeblock-customizer-plugin-compatibility-settingsDiv-hide" });
    pluginsDiv.toggleClass("codeblock-customizer-plugin-compatibility-settingsDiv-hide", this.plugin.settings.settingsType !== "plugins");
    pluginsDiv.createEl('h3', {text: '🧩 Plugin Compatibility Settings '});

    // settings for admonitions plugin
    const admonitionDetailsDetails = this.createDetailsGroup(pluginsDiv, 'Admonition Settings', 'admonitionDetailsOpen');

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
    const executeCodeDetails = this.createDetailsGroup(pluginsDiv, 'Execute Code Settings', 'executeCodeDetailsOpen');

    new Setting(executeCodeDetails)
      .setName('Enable Execute Code plugin support')
      .setDesc('When disabled, this plugin completely ignores the Execute Code plugin, and does not apply any styling at all to run-* code blocks. Switch documents after changing this option, to refresh the view.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.plugins.executeCode.enabled)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.plugins.executeCode.enabled = value;
          styleOutputSetting.settingEl.classList.toggle('codeblock-customizer-setting-hidden', !value);
          await this.plugin.saveSettings();
          this.plugin.renderReadingViews();
        })
      );

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

    return pluginsDiv;
  }// createPluginCompatibilitySettingsPage

  restorePromptColor(promptId: string) {
    const baseThemeName = this.plugin.settings.SelectedTheme.baseTheme ?? 'Obsidian';
    const baseTheme = this.plugin.settings.Themes[baseThemeName];
  
    if (!baseTheme) {
      console.warn(`Base theme "${baseThemeName}" not found.`);
      return;
    }
  
    const modes: ('light' | 'dark')[] = ['light', 'dark'];
  
    for (const mode of modes) {
      delete this.plugin.settings.SelectedTheme.colors[mode].prompts.editedPromptColors?.[promptId];
      delete this.plugin.settings.SelectedTheme.colors[mode].prompts.editedRootPromptColors?.[promptId];
    }
  
    delete this.plugin.settings.pluginSettings.prompts.editedDefaults?.[promptId];
  
    this.display();
  }// restorePromptColor
  
  createPromptSettings (promptEditorContainer: HTMLElement, selectedPromptId: string) {
    promptEditorContainer.empty();
  
    const { def: currentPromptData } = getPromptDefinition(selectedPromptId, this.plugin.settings);

    // prompt preview
    const previewWrapper = promptEditorContainer.createDiv({ cls: 'codeblock-customizer-prompt-preview-wrapper' });
    previewWrapper.createDiv({text: 'Prompt preview'});
    const previewEl = previewWrapper.createDiv({ cls: 'codeblock-customizer-prompt-preview' });
  
    const promptSettingsDetails = this.createDetailsGroup(promptEditorContainer, 'Prompt Settings', 'promptSettingsDetailsOpen', 'codeblock-customizer-prompt-settings-group');

    const updatePreview = () => {
      const { def: promptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
      this.updatePromptPreview(previewEl, selectedPromptId, promptData, isCustom);
    };
    
    updatePreview();
  
    // read only
    new Setting(promptSettingsDetails)
    .setName("Prompt Name (for codeblock language)")
    .setClass("codeblock-customizer-prompt-name")
    .setDesc(`This is the identifier to use in your code block fence, e.g., prompt:${selectedPromptId}`)
    .addText(text => {
      text.setValue(selectedPromptId);
      text.setDisabled(true);
    });
  
    // editable
    new Setting(promptSettingsDetails)
      .setName("Base Prompt")
      .setDesc("Template for the prompt.")
      .addText(text => text
        .setValue(currentPromptData.basePrompt)
        .onChange(async (value) => {
          const { def: currentPromptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
          currentPromptData.basePrompt = value;
          await this.savePromptData(isCustom, selectedPromptId, currentPromptData);
          updatePreview();
        }));
  
    new Setting(promptSettingsDetails)
      .setName("Default User")
      .addText(text => text
        .setPlaceholder("e.g. root, admin etc.")
        .setValue(currentPromptData.defaultUser ?? "")
        .onChange(async (value) => {
          const { def: currentPromptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
          currentPromptData.defaultUser = value;
          await this.savePromptData(isCustom, selectedPromptId, currentPromptData);
          updatePreview();
        }));
  
    new Setting(promptSettingsDetails)
      .setName("Default Host")
      .addText(text => text
        .setPlaceholder("e.g. localhost")
        .setValue(currentPromptData.defaultHost ?? "")
        .onChange(async (value) => {
          const { def: currentPromptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
          currentPromptData.defaultHost = value;
          await this.savePromptData(isCustom, selectedPromptId, currentPromptData);
          updatePreview();
        }));
  
    new Setting(promptSettingsDetails)
      .setName("Default Directory")
      .addText(text => text
        .setPlaceholder("e.g. /var/www/html")
        .setValue(currentPromptData.defaultDir ?? "")
        .onChange(async (value) => {
          const { def: currentPromptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
          currentPromptData.defaultDir = value;
          await this.savePromptData(isCustom, selectedPromptId, currentPromptData);
          updatePreview();
        }));
  
    new Setting(promptSettingsDetails)
      .setName("Default Database")
      .addText(text => text
        .setPlaceholder("e.g. postgres")
        .setValue(currentPromptData.defaultDb ?? "")
        .onChange(async (value) => {
          const { def: currentPromptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
          currentPromptData.defaultDb = value;
          await this.savePromptData(isCustom, selectedPromptId, currentPromptData);
          updatePreview();
        }));
    
    new Setting(promptSettingsDetails)
      .setName("Default Branch")
      .addText(text => text
        .setPlaceholder("e.g. main, dev etc.")
        .setValue(currentPromptData.defaultBranch ?? "")
        .onChange(async (value) => {
          const { def: currentPromptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
          currentPromptData.defaultBranch = value;
          await this.savePromptData(isCustom, selectedPromptId, currentPromptData);
          updatePreview();
        }));
  
    new Setting(promptSettingsDetails)
      .setName("Default Module")
      .addText(text => text
        .setPlaceholder("e.g. exploit/multi/handler")
        .setValue(currentPromptData.defaultModule ?? "")
        .onChange(async (value) => {
          const { def: currentPromptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
          currentPromptData.defaultModule = value;
          await this.savePromptData(isCustom, selectedPromptId, currentPromptData);
          updatePreview();
        }));

    new Setting(promptSettingsDetails)
      .setName("Highlight Groups")
      .setDesc("Define the named capture groups from your regex that should be styled. For example,\nif your regex includes `(?<user>...)`, you would add a \"user\": \"user\" entry here to apply\nthe `user` style.")
      .setClass("codeblock-customizer-highlightgroups-setting")
      .addTextArea(textarea => {
        textarea.inputEl.rows = 6;
        textarea.inputEl.classList.add('codeblock-customizer-highlightgroups-textarea');
        textarea.setValue(JSON.stringify(currentPromptData.highlightGroups ?? {}, null, 2));
        textarea.onChange(async (value) => {
          try {
            const parsed = JSON.parse(value);
            const { def: currentPromptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
            currentPromptData.highlightGroups = parsed;
            await this.savePromptData(isCustom, selectedPromptId, currentPromptData);
            updatePreview();
          } catch (e) {
            new Notice("⚠️ Invalid JSON, not saved");
          }
        });
      });
  
    new Setting(promptSettingsDetails)
      .setName("Parse Prompt Regex")
      .setDesc("Regex string for parsing the prompt.")
      .addText(text => text
        .setValue(currentPromptData.parsePromptRegex?.source ?? "")
        .onChange(async (value) => {
          try {
            const compiled = new RegExp(value);
            const { def: currentPromptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
            currentPromptData.parsePromptRegexString = value;
            currentPromptData.parsePromptRegex = compiled; // live version for runtime use!
            await this.savePromptData(isCustom, selectedPromptId, currentPromptData);
            new Notice(`Regex saved for prompt "${selectedPromptId}"`);
          } catch (e) {
            new Notice("⚠️ Invalid regex, not saved");
          }
        }).inputEl.classList.add("codeblock-customizer-regex-input"));
  
    let windowsShellToggle: ToggleComponent;
    let rootStylingToggle: ToggleComponent;

    new Setting(promptSettingsDetails)
      .setName("Is Windows Shell")
      .setDesc("Only enable for Windows prompts, otherwise this should remain false.")
      .addToggle(toggle => {
        windowsShellToggle = toggle;
        toggle
          .setValue(currentPromptData.isWindowsShell)
          .onChange(async (value) => {
            const { def: data, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
            data.isWindowsShell = value;
            if (value && rootStylingToggle) {
              data.supportsRootStyling = false;
              rootStylingToggle.setValue(false);
            }
            await this.savePromptData(isCustom, selectedPromptId, data);
            this.createPromptColorSettings(promptColorSettingsContainer, selectedPromptId, previewEl);
          });
      });

    new Setting(promptSettingsDetails)
      .setName("Supports root styling")
      .setDesc("Only enable for prompts, when you want to set different colors for the root prompt (linux prompts only).")
      .addToggle(toggle => {
        rootStylingToggle = toggle;
        toggle
          .setValue(currentPromptData.supportsRootStyling ?? false)
          .onChange(async (value) => {
            const { def: data, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
            data.supportsRootStyling = value;
            if (value && windowsShellToggle) {
              data.isWindowsShell = false;
              windowsShellToggle.setValue(false);
            }
            await this.savePromptData(isCustom, selectedPromptId, data);
            this.createPromptColorSettings(promptColorSettingsContainer, selectedPromptId, previewEl);
          });
      });

    let languagesTextComponent: TextComponent;
    let autoUseToggle: ToggleComponent;
    
    new Setting(promptSettingsDetails)
      .setName("Auto-use Prompt")
      .setDesc("If enabled, this prompt will be used automatically for the specified languages.")
      .addToggle(toggle => {
        autoUseToggle = toggle;
        toggle
          .setValue(currentPromptData.autoUsePrompt ?? false)
          .onChange(async (isEnabling) => {
            autoUseLanguagesSetting.settingEl.style.display = isEnabling ? '' : 'none';
            const { def: updatedPromptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
            updatedPromptData.autoUsePrompt = isEnabling;
            await this.savePromptData(isCustom, selectedPromptId, updatedPromptData);
            const definedLanguages = languagesTextComponent.getValue();
            if (definedLanguages && definedLanguages.trim() !== '') {
              this.plugin.renderReadingViews();
            }
            // if enabling, focus the text input for convenience
            if (isEnabling) {
              languagesTextComponent.inputEl.focus();
            }
          });
      });
    
    const autoUseLanguagesSetting = new Setting(promptSettingsDetails)
      .setName("Languages for Auto-use")
      .setDesc("Comma-separated list of code block languages for which the prompt should be used\n(e.g., bash, python etc.).")
      .addText(text => {
        languagesTextComponent = text;
        text.setValue((currentPromptData.autoUseLanguages ?? []).join(', '));
        text.inputEl.onblur = async () => {
          const isEnabled = autoUseToggle.getValue();
          if (!isEnabled) 
            return;

          const newLangs = languagesTextComponent.getValue().split(',').map(s => s.trim()).filter(Boolean);
          const { def: updatedPromptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);

          if (newLangs.length === 0) {
            const hadLanguages = (updatedPromptData.autoUseLanguages ?? []).length > 0;
            new Notice("⚠️ Auto-use is enabled, but no languages are specified. Disabling feature.");
            updatedPromptData.autoUsePrompt = false;
            updatedPromptData.autoUseLanguages = [];
            await this.savePromptData(isCustom, selectedPromptId, updatedPromptData);
            autoUseToggle.setValue(false);
            if (hadLanguages) {
              this.plugin.renderReadingViews();
            }
            return;
          }

          const allPrompts = { ...defaultPrompts, ...this.plugin.settings.pluginSettings.prompts.customPrompts };
          for (const lang of newLangs) {
            for (const promptId in allPrompts) {
              if (promptId === selectedPromptId) 
                continue;
              const { def: pDef } = getPromptDefinition(promptId, this.plugin.settings);
              if (pDef.autoUsePrompt && pDef.autoUseLanguages?.includes(lang)) {
                new Notice(`⚠️ Can't save. Language '${lang}' is already set for auto-use by prompt '${pDef.name}'.`);
                // revert to last saved value
                const { def: currentDef } = getPromptDefinition(selectedPromptId, this.plugin.settings);
                languagesTextComponent.setValue((currentDef.autoUseLanguages ?? []).join(', '));
                autoUseToggle.setValue(false);
                return; 
              }
            }
          }
          
          //const { def: updatedPromptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
          updatedPromptData.autoUsePrompt = true;
          updatedPromptData.autoUseLanguages = newLangs;
          await this.savePromptData(isCustom, selectedPromptId, updatedPromptData);
          this.plugin.renderReadingViews();
          new Notice("Auto-use settings saved.");
        };
      });

    autoUseLanguagesSetting.settingEl.style.display = (currentPromptData.autoUsePrompt ?? false) ? '' : 'none';

    let parseLanguagesTextComponent: TextComponent;
    let autoParseToggle: ToggleComponent;
    
    new Setting(promptSettingsDetails)
      .setName("Auto-parse Prompt")
      .setDesc("If enabled, this prompt's regex will be used to automatically find and style prompts in code blocks of the specified languages.")
      .addToggle(toggle => {
        autoParseToggle = toggle;
        toggle
          .setValue(currentPromptData.autoParsePrompt ?? false)
          .onChange(async (isEnabling) => {
            autoParseLanguagesSetting.settingEl.style.display = isEnabling ? '' : 'none';
            const { def: updatedPromptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
            updatedPromptData.autoParsePrompt = isEnabling;
            await this.savePromptData(isCustom, selectedPromptId, updatedPromptData);
            const definedLanguages = parseLanguagesTextComponent.getValue();
            if (definedLanguages && definedLanguages.trim() !== '') {
              this.plugin.renderReadingViews();
            }
            if (isEnabling) {
              parseLanguagesTextComponent.inputEl.focus();
            }
          });
      });
    
    const autoParseLanguagesSetting = new Setting(promptSettingsDetails)
      .setName("Languages for Auto-parse")
      .setDesc("Comma-separated list of code block languages for which this prompt's parser should be used\n(e.g., bash, shell).\nWARNING: This could affect performance if you have a lot of code blocks with the specified languages.")
      .addText(text => {
        parseLanguagesTextComponent = text;
        text.setValue((currentPromptData.autoParseLanguages ?? []).join(', '));
        text.inputEl.onblur = async () => {
          if (!autoParseToggle.getValue()) 
            return;

          const newLangs = parseLanguagesTextComponent.getValue().split(',').map(s => s.trim()).filter(Boolean);
          const { def: updatedPromptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);

          if (newLangs.length === 0) {
            const hadLanguages = (updatedPromptData.autoParseLanguages ?? []).length > 0;
            new Notice("⚠️ Auto-parse is enabled, but no languages are specified. Disabling feature.");
            updatedPromptData.autoParsePrompt = false;
            updatedPromptData.autoParseLanguages = [];
            await this.savePromptData(isCustom, selectedPromptId, updatedPromptData);
            autoParseToggle.setValue(false);
            autoParseLanguagesSetting.settingEl.style.display = 'none';
            if (hadLanguages) {
              this.plugin.renderReadingViews();
            }
            return;
          }

          const allPrompts = { ...defaultPrompts, ...this.plugin.settings.pluginSettings.prompts.customPrompts };
          for (const lang of newLangs) {
            if (updatedPromptData.autoUsePrompt && updatedPromptData.autoUseLanguages?.includes(lang)) {
                new Notice(`⚠️ Can't save. Language '${lang}' is already set for 'Auto-use' by this same prompt.`);
                parseLanguagesTextComponent.setValue((updatedPromptData.autoParseLanguages ?? []).join(', '));
                return;
            }
            for (const promptId in allPrompts) {
              if (promptId === selectedPromptId) continue;
              const { def: pDef } = getPromptDefinition(promptId, this.plugin.settings);
              if ((pDef.autoUsePrompt && pDef.autoUseLanguages?.includes(lang)) || (pDef.autoParsePrompt && pDef.autoParseLanguages?.includes(lang))) {
                new Notice(`⚠️ Can't save. Language '${lang}' is already in use by prompt '${pDef.name}'.`);
                parseLanguagesTextComponent.setValue((updatedPromptData.autoParseLanguages ?? []).join(', '));
                return; 
              }
            }
          }
          
          updatedPromptData.autoParsePrompt = true;
          updatedPromptData.autoParseLanguages = newLangs;
          await this.savePromptData(isCustom, selectedPromptId, updatedPromptData);
          this.plugin.renderReadingViews();
          new Notice("Auto-parse settings saved.");
        };
      });

    autoParseLanguagesSetting.settingEl.style.display = (currentPromptData.autoParsePrompt ?? false) ? '' : 'none';

    const colorsSettingsDetails = this.createDetailsGroup(promptEditorContainer, 'Prompt Colors', 'promptColorsDetailsOpen', 'codeblock-customizer-prompt-colors-settings-group');

    const promptColorSettingsContainer = colorsSettingsDetails.createDiv();
    
    this.createPromptColorSettings(promptColorSettingsContainer, selectedPromptId, previewEl);
  }// createPromptSettings

  createPromptColorSettings(promptColorSettingsContainer: HTMLElement, selectedPromptId: string, previewEl: HTMLElement, showRootColor = false) {
    promptColorSettingsContainer.empty();
    promptColorSettingsContainer.appendChild(document.createElement("br"));

    this.promptPickers.clear();

    const allGroups = Array.from(collectAllPromptClasses(this.plugin.settings));
    const { def: currentPromptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
    let editingRootColors = showRootColor ?? false; 
    
    if (currentPromptData.supportsRootStyling) {
      new Setting(promptColorSettingsContainer)
        .setName("Configure Root Colors")
        .setDesc("Enable to edit root-specific colors for this prompt.")
        .addToggle(toggle => toggle
          .setValue(editingRootColors)
          .onChange(value => {
            editingRootColors = value;
            const newColors = this.getResolvedPromptColors(selectedPromptId, editingRootColors);
            const fallbackColors = this.getResolvedPromptColors(selectedPromptId, false);

            for (const [partClass, pickr] of this.promptPickers.entries()) {
              const newColor = newColors[partClass] ?? fallbackColors[partClass] ?? DEFAULT_PROMPT_COLOR;
              pickr.setColor(newColor);
            }
            
            this.updatePromptPreview(previewEl, selectedPromptId, currentPromptData, isCustom, editingRootColors);
          })
      );
    }

    for (const part of allGroups) {
      const partClass = part.startsWith("prompt-") ? part : `prompt-${part}`;
      const displayName = promptClassDisplayNames[partClass];
      let label: string;

      const suffixTargets = [
        "prompt-user", 
        "prompt-host", 
        "prompt-path", 
        "prompt-db", 
        "prompt-branch",
        "prompt-msf",
        "prompt-keyword",
        "prompt-module",
        "prompt-beacon"
      ];
      
      if (displayName) {
        if (suffixTargets.includes(partClass)) {
          label = `${displayName} (returned by RegEx)`;
        } else {
          label = displayName;
        }
      } else {
        label = `${partClass} (returned by RegEx)`;
      }
      const resolvedColors = this.getResolvedPromptColors(selectedPromptId, editingRootColors); // normal/root colors
      const fallbackColors = this.getResolvedPromptColors(selectedPromptId, false); // normal colors
      const currentColor = resolvedColors[partClass] ?? fallbackColors[partClass] ?? DEFAULT_PROMPT_COLOR;
      const isDefaultPrompt = selectedPromptId in defaultPrompts;  

      const setting = new Setting(promptColorSettingsContainer)
        .setName(label)
        .setClass(`detailpage`);

      const pickr = this.addPickerControlsToSetting(setting, {
        containerEl: promptColorSettingsContainer,
        initialColor: currentColor,
        onSave: (savedColor: string) => {
          this.setPromptColorDiff(selectedPromptId, partClass, savedColor, editingRootColors);
          this.plugin.saveSettings();
        },
        onReset: isDefaultPrompt ? () => {
          return this.getDefaultPromptColor(selectedPromptId, partClass, editingRootColors);
        } : undefined,
      });

      this.promptPickers.set(partClass, pickr);
    }
  }// createPromptColorSettings

  getDefaultPromptColor(promptId: string, partClass: string, editingRootColors: boolean): string {
    const baseThemeName = this.plugin.settings.SelectedTheme.baseTheme ?? 'Obsidian';
    const defaultTheme = this.plugin.settings.Themes[baseThemeName];
    const mode = getCurrentMode();
  
    if (!defaultTheme) {
      return DEFAULT_PROMPT_COLOR;
    }
  
    if (editingRootColors) {
      const specificRootColor = defaultTheme.colors[mode].prompts.rootPromptColors?.[promptId]?.[partClass];
      if (specificRootColor) {
        return specificRootColor;
      }
  
      const fallbackNormalColor = defaultTheme.colors[mode].prompts.promptColors?.[promptId]?.[partClass];
      if (fallbackNormalColor) {
        return fallbackNormalColor;
      }
  
      return DEFAULT_PROMPT_COLOR;
    }
  
    const normalColor = defaultTheme.colors[mode].prompts.promptColors?.[promptId]?.[partClass];
    if (normalColor) {
      return normalColor;
    }

    return DEFAULT_PROMPT_COLOR;
  }// getDefaultPromptColor
  
  updatePromptPreview(previewEl: HTMLElement, selectedPromptId: string, promptData: PromptDefinition, isCustom: boolean, editingRootColors = false) {
    previewEl.empty();
    
    const promptEnv: PromptEnvironment = {
      user: promptData.defaultUser ?? "user",
      host: promptData.defaultHost ?? "host",
      dir: promptData.defaultDir ?? "~",
      previousDir: promptData.defaultDir ?? "~",
      db: promptData.defaultDb ?? "postgres",
      branch: promptData.defaultBranch ?? "main",
      homeDir: "~",
      originalHomeDir: "~",
      msfKeyword: promptData.defaultModule ? 'exploit' : undefined,
      msfModule: promptData.defaultModule,
    };
  
    const promptKind = getPromptType(isCustom ? promptData.basePrompt : selectedPromptId);
    const promptText = isCustom ? promptData.basePrompt : selectedPromptId;
    const promptParts = replacePromptTemplate(promptKind, promptText, promptData, promptEnv);
    const { def } = getPromptDefinition(selectedPromptId, this.plugin.settings);

    const normalPreview  = addClassesToPrompt(promptParts, isCustom ? promptData.name : promptText, def, this.plugin.settings);
    normalPreview .classList.add("normal-preview");

    const container = createDiv({ cls: "prompt-preview-container" });
    container.appendChild(normalPreview);

    const rootEnv = { ...promptEnv, user: "root" };
    const rootPromptParts = replacePromptTemplate(promptKind, promptText, promptData, rootEnv);
    const rootPreview = addClassesToPrompt(rootPromptParts, isCustom ? promptData.name : promptText, def, this.plugin.settings, true);
    rootPreview.classList.add("root-preview");

    if (editingRootColors && promptData.supportsRootStyling) {
      rootPreview.classList.add("is-visible");
    }

    container.appendChild(rootPreview);

    previewEl.appendChild(container);
    previewEl.classList.toggle("only-normal", !editingRootColors);
  }// updatePromptPreview
  
  async savePromptData(isCustom: boolean, selectedPromptId: string, promptData: PromptDefinition) {
    if (isCustom) {
      const clone = structuredClone(promptData);
      delete clone.parsePromptRegex; // don't store RegExp instance
      this.plugin.settings.pluginSettings.prompts.customPrompts[selectedPromptId] = clone;
    } else {
      const basePromptDef = defaultPrompts[selectedPromptId];
      const diff: Partial<PromptDefinition> = {};
  
      if (promptData.basePrompt !== basePromptDef.basePrompt) 
        diff.basePrompt = promptData.basePrompt;
      if (promptData.defaultUser !== basePromptDef.defaultUser) 
        diff.defaultUser = promptData.defaultUser;
      if (promptData.defaultHost !== basePromptDef.defaultHost) 
        diff.defaultHost = promptData.defaultHost;
      if (promptData.defaultDir !== basePromptDef.defaultDir) 
        diff.defaultDir = promptData.defaultDir;
      if (promptData.defaultDb !== basePromptDef.defaultDb) 
        diff.defaultDb = promptData.defaultDb;
      if (promptData.defaultBranch !== basePromptDef.defaultBranch) 
        diff.defaultBranch = promptData.defaultBranch;
      if (promptData.defaultModule !== basePromptDef.defaultModule) 
        diff.defaultModule = promptData.defaultModule;
      if (JSON.stringify(promptData.highlightGroups ?? {}) !== JSON.stringify(basePromptDef.highlightGroups ?? {})) 
        diff.highlightGroups = promptData.highlightGroups;
      //if (promptData.parsePromptRegex?.source !== basePromptDef.parsePromptRegex?.source) 
      // diff.parsePromptRegex = promptData.parsePromptRegex;
      if (promptData.parsePromptRegexString !== basePromptDef.parsePromptRegexString) 
        diff.parsePromptRegexString = promptData.parsePromptRegexString;
      if (promptData.isWindowsShell !== basePromptDef.isWindowsShell) 
        diff.isWindowsShell = promptData.isWindowsShell;
      if (promptData.supportsRootStyling !== basePromptDef.supportsRootStyling) 
        diff.supportsRootStyling = promptData.supportsRootStyling;
      if (promptData.autoUsePrompt !== basePromptDef.autoUsePrompt)
        diff.autoUsePrompt = promptData.autoUsePrompt;
      if (JSON.stringify(promptData.autoUseLanguages ?? []) !== JSON.stringify(basePromptDef.autoUseLanguages ?? []))
        diff.autoUseLanguages = promptData.autoUseLanguages;
      if (promptData.autoParsePrompt !== basePromptDef.autoParsePrompt)
        diff.autoParsePrompt = promptData.autoParsePrompt;
      if (JSON.stringify(promptData.autoParseLanguages ?? []) !== JSON.stringify(basePromptDef.autoParseLanguages ?? []))
        diff.autoParseLanguages = promptData.autoParseLanguages;
  
      this.plugin.settings.pluginSettings.prompts.editedDefaults[selectedPromptId] = diff;
    }
    await this.plugin.saveSettings();
  }// savePromptData

  getResolvedPromptColors(promptId: string, editingRoot: boolean): Record<string, string> {
    const mode = getCurrentMode();
    const baseThemeName = this.plugin.settings.SelectedTheme.baseTheme ?? 'Obsidian';
    const base = this.plugin.settings.Themes[baseThemeName]?.colors[mode].prompts;
    const edited = editingRoot
      ? this.plugin.settings.SelectedTheme.colors[getCurrentMode()].prompts.editedRootPromptColors?.[promptId] ?? {}
      : this.plugin.settings.SelectedTheme.colors[getCurrentMode()].prompts.editedPromptColors?.[promptId] ?? {};
    const defaults = editingRoot
      ? base?.rootPromptColors?.[promptId] ?? {}
      : base?.promptColors?.[promptId] ?? {};
    return { ...defaults, ...edited };
  }// getResolvedPromptColors

  setPromptColorDiff(promptId: string, className: string, color: string, editingRoot: boolean) {
    const defaultColor = this.getDefaultPromptColor(promptId, className, editingRoot);
  
    const diff = editingRoot ? this.plugin.settings.SelectedTheme.colors[getCurrentMode()].prompts.editedRootPromptColors : this.plugin.settings.SelectedTheme.colors[getCurrentMode()].prompts.editedPromptColors;
  
    if (color.toLowerCase() === defaultColor.toLowerCase()) {
      delete diff?.[promptId]?.[className];
      if (Object.keys(diff?.[promptId] ?? {}).length === 0) {
        delete diff?.[promptId];
      }
    } else {
      if (!diff[promptId]) 
        diff[promptId] = {};
      diff[promptId][className] = color;
    }
  }// setPromptColorDiff
  
  restoreThemes(themeName: string, cloneAll: boolean) {
    if (cloneAll){
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

    this.display();
  }// restoreThemes

  refreshDropdown(dropdown: DropdownComponent, settings: CodeblockCustomizerSettings) {
    dropdown.selectEl.empty();
    Object.keys(settings.Themes).forEach((name: string) => {
      dropdown.addOption(name, name);
    })
    dropdown.setValue(settings.ThemeName);
	}// refreshDropdown

  refreshPromptDropdown(promptDropdown: DropdownComponent, selectedPromptId: string) {
    //promptDropdown.selectEl.innerHTML = "";
    promptDropdown.selectEl.empty();

    const allPrompts: { key: string; name: string; type: 'Default' | 'Custom' }[] = [];

    // default prompts
    for (const [key, prompt] of Object.entries(defaultPrompts)) {
      allPrompts.push({ key, name: prompt.name, type: 'Default' });
    }

    // custom prompts
    for (const [key, prompt] of Object.entries(this.plugin.settings.pluginSettings.prompts.customPrompts)) {
      allPrompts.push({ key, name: prompt.name, type: 'Custom' });
    }

    allPrompts.sort((a, b) => a.name.localeCompare(b.name));

    for (const prompt of allPrompts) {
      promptDropdown.addOption(prompt.key, `[${prompt.type}] ${prompt.name}`);
    }
    
    promptDropdown.setValue(selectedPromptId);
  }// refreshPromptDropdown

  getRandomColor() {
    const letters = "0123456789ABCDEF";
    let color = "#";
    for (let i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
  }// getRandomColor
     
  applyTheme() {
    updateSettingStyles(this.plugin.settings, this.app);
    this.plugin.saveSettings();
  }// applyTheme

  private addPickerControlsToSetting(setting: Setting, options: PickerOptions): Pickr {
    const pickr = Pickr.create({
      el: setting.controlEl.createDiv({ cls: 'picker' }),
      container: options.containerEl.parentNode as HTMLElement,
      theme: 'nano',
      position: 'left-middle',
      lockOpacity: false,
      default: options.initialColor,
      swatches: [],
      components: {
        preview: true,
        hue: true,
        opacity: true,
        interaction: {
          hex: true,
          rgba: true,
          hsla: false,
          input: true,
          cancel: true,
          save: true,
        },
      },
      i18n: options.i18n ?? {},
    })
    .on('show', (color: Pickr.HSVaColor, instance: Pickr) => {
      if (options.shouldShow && !options.shouldShow()) {
        instance.hide();
        return;
      }
      const { result } = (instance.getRoot() as any).interaction;
      requestAnimationFrame(() => requestAnimationFrame(() => result.select()));
    })
    .on('save', (color: Pickr.HSVaColor, instance: Pickr) => {
      if (!color) return;
      instance.hide();
      const savedColor = color.toHEXA().toString();
      instance.addSwatch(savedColor);
      options.onSave(savedColor);
    })
    .on('cancel', (instance: Pickr) => {
      instance.hide();
    });

    this.pickerInstances.push(pickr);

    const onResetCallback = options.onReset;
    if (onResetCallback) {
      setting.addExtraButton((btn) => {
        btn.setIcon("reset")
          .setTooltip('restore default color')
          .onClick(() => {
            const defaultColor = onResetCallback();
            pickr?.setColor(defaultColor);
            options.onSave(defaultColor); 
          });
      });
    }

    const onDeleteCallback = options.onDelete;
    if (onDeleteCallback) {
      setting.addExtraButton((btn) => {
        btn.setIcon("trash")
          .setTooltip("Delete color")
          .onClick(() => {
            onDeleteCallback();
          });
      });
    }

    return pickr;
  }// addPickerControlsToSetting

  createPickrSetting(containerEl: HTMLElement, name: string, description: string, pickrClass: string): Setting {
    const setting = new Setting(containerEl)
      .setName(name)
      .setDesc(description);

    this.addPickerControlsToSetting(setting, {
      containerEl: containerEl,
      initialColor: this.getColorFromPickrClass(this.plugin.settings.SelectedTheme, getCurrentMode(), pickrClass, true).toString(),
      onSave: (savedColor: string) => {
        this.setAndSavePickrSetting(pickrClass, savedColor);
        if (['editorActiveLineColor', 'codeblock.activeLineColor'].includes(pickrClass)) {
          updateSettingStyles(this.plugin.settings, this.app);
        }
      },
      onReset: () => {
        return this.getColorFromPickrClass(this.plugin.settings.Themes[this.plugin.settings.ThemeName], getCurrentMode(), pickrClass, true).toString();
      },
      shouldShow: () => {
        const settings = this.plugin.settings.pluginSettings;
        if ((!settings.codeblock.enableActiveLineHighlight && pickrClass === 'codeblock.activeLineColor') ||
            (!settings.enableEditorActiveLineHighlight && pickrClass === 'editorActiveLineColor') ||
            (!settings.header.displayCodeBlockLanguage && (pickrClass === 'header.codeBlockLangTextColor' || pickrClass === 'header.codeBlockLangBackgroundColor')) ||
            (!settings.gutter.highlightActiveLineNr && pickrClass === 'gutter.activeLineNrColor') ||
            (!settings.inlineCode.enableInlineCodeStyling && (pickrClass === 'inlineCode.backgroundColor' || pickrClass === 'inlineCode.textColor'))) {
          return false;
        }
        return true;
      }
    });

    return setting;
  }// createPickrSetting

  createAlternatePickr(containerEl: HTMLElement, colorContainer: HTMLElement, name: string, Color: string, type: string, colorKey = "", languageName = ""): Setting {
    const desc = (type === "normal") ? `To highlight lines with this color use the "${name}" parameter. e.g: ${name}:2,4-6` : "";
    const setting = new Setting(containerEl)
      .setName(name)
      .setDesc(desc);

    this.addPickerControlsToSetting(setting, {
      containerEl: containerEl,
      initialColor: Color,
      onSave: (savedColor: string) => {
        if (type === "normal") {
          this.plugin.settings.SelectedTheme.colors[getCurrentMode()].codeblock.alternateHighlightColors[name] = savedColor;
        } else if (type === "langSpecific") {
          this.plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors[languageName][colorKey] = savedColor;
        }
        this.plugin.saveSettings();
      },
      onDelete: () => {
        if (type === "normal") {
          delete this.plugin.settings.SelectedTheme.colors.light.codeblock.alternateHighlightColors[name];
          delete this.plugin.settings.SelectedTheme.colors.dark.codeblock.alternateHighlightColors[name];
          this.updateColorContainer(colorContainer);
        } else if (type === "langSpecific") {
          delete this.plugin.settings.SelectedTheme.colors.light.languageSpecificColors[languageName][colorKey];
          delete this.plugin.settings.SelectedTheme.colors.dark.languageSpecificColors[languageName][colorKey];
          this.updateLanguageSpecificColorContainer(colorContainer, languageName);
        }
        this.plugin.saveSettings();
        new Notice(`Removed color "${name}".`);
      },
      i18n: {
        'btn:toggle': 'select color for light theme'
      }
    });

    return setting;
  }// createAlternatePickr
  
  getColorFromPickrClass(selectedTheme: ColorTheme, currentMode: 'dark' | 'light', pickrClass: string, resolveCSSVar: boolean): Colors | string {
    const properties = pickrClass.split('.');
    let colorValue: Colors | string = selectedTheme.colors[currentMode];

    for (const prop of properties) {
      // @ts-ignore
      colorValue = colorValue?.[prop];
      if (colorValue === undefined) {
        return '#000000'; // return default black
      }
      if (resolveCSSVar && colorValue.toString().startsWith("--")) {
        colorValue = getColorOfCssVariable(colorValue.toString());
      }
      if (!colorValue) {
        break;
      }
    }

    return colorValue || '';
  }// getColorFromPickrClass

  hide(): void {
    this.pickerInstances.forEach(p => {
      if (p) {
        p.destroy();
      }
    });

    this.pickerInstances = [];
  }//hide

  setAndSavePickrSetting(className: string, savedColor: string): void {
    const currentMode = getCurrentMode();
    const colors = this.plugin.settings.SelectedTheme.colors[currentMode];

    this.setNestedValue(colors, className, savedColor);

    this.plugin.saveSettings();
  }// setAndSavePickrSetting
  
  setNestedValue(obj: Record<string, any>, path: string, value: any): void {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      current = current[key];
      if (current === undefined) {
        console.error("Invalid path provided to setNestedValue:", path);
        return;
      }
    }

    const finalKey = keys[keys.length - 1];
    current[finalKey] = value;
  }// setNestedValue

  updateColorContainer(colorContainer: HTMLElement) {
    colorContainer.empty();

    Object.entries(this.plugin.settings.SelectedTheme.colors[getCurrentMode()].codeblock.alternateHighlightColors).forEach(([colorName, hexValue]) => {
      this.createAlternatePickr(colorContainer, colorContainer, colorName, hexValue, "normal");
    });
  }// updateColorContainer

  updateLanguageSpecificColorContainer(colorContainer: HTMLElement, language = "") {
    colorContainer.empty();
    
    const languageColors = this.plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors;
    const filteredLanguages = language ? { [language]: languageColors[language] } : languageColors;
  
    Object.entries(filteredLanguages).forEach(([languageName, colorObject]) => {
      const languageSettingsDiv = colorContainer.createEl("div", { cls: `codeblock-customizer-languageSpecific-${languageName}-settings` });
      languageSettingsDiv.createEl('h4', { text: `${languageName} specific color settings` });
      
      this.createDropdown(languageSettingsDiv, languageName);
      
      Object.entries(colorObject).forEach(([colorProp, color]) => {
        const propDisplayText = SettingsTab.COLOR_OPTIONS[colorProp];
        // this.createAlternatePickr(colorContainer, colorContainer, propDisplayText, color, "langSpecific", colorProp, languageName);
        this.createAlternatePickr(languageSettingsDiv, languageSettingsDiv, propDisplayText, color, "langSpecific", colorProp, languageName);
      });
    });
  }// updateLanguageSpecificColorContainer
  
  createDropdown(languageSettingsDiv: HTMLElement, languageName: string) {
    const dropdownOptions = Object.entries(SettingsTab.COLOR_OPTIONS).reduce((options, [key, value]) => {
      options[key] = value;
      return options;
    }, {} as Record<string, string>);

    new Setting(languageSettingsDiv)
      .setName('Select color to set')
      .setDesc(`Select which color you would like to set for ${this.plugin.settings.languageSpecificLanguageName} specifically.`)
      .addDropdown((dropdown) => dropdown
        .addOptions(dropdownOptions)
        .setValue(this.plugin.settings.langSpecificSettingsType)
        .onChange((value) => {
          this.plugin.settings.langSpecificSettingsType = value;
          (async () => { await this.plugin.saveSettings() })();
        })
      )
      .addExtraButton(async (button) => {
        button.setIcon("plus");
        button.setTooltip(`Add the selected property to customize it for code block language ${languageName} specifically`);
        button.onClick(async () => {
          const propDisplayText = SettingsTab.COLOR_OPTIONS[this.plugin.settings.langSpecificSettingsType];
          if (propDisplayText) {
            if (this.plugin.settings.langSpecificSettingsType in this.plugin.settings.SelectedTheme.colors.light.languageSpecificColors[languageName]) {
              new Notice(`${propDisplayText} is already defined for code block language "${languageName}"`);
            } else {
              if (this.plugin.settings.langSpecificSettingsType === "codeblock.borderColor") {
                const newColor = this.getRandomColor();
                this.plugin.settings.SelectedTheme.colors.light.languageSpecificColors[languageName]['codeblock.borderColor'] = newColor;
                this.plugin.settings.SelectedTheme.colors.dark.languageSpecificColors[languageName]['codeblock.borderColor'] = newColor;
                this.createAlternatePickr(languageSettingsDiv, languageSettingsDiv, propDisplayText, newColor, "langSpecific", this.plugin.settings.langSpecificSettingsType, languageName);
              } else {
                const defaultDarkColor = this.getColorFromPickrClass(this.plugin.settings.SelectedTheme, "dark", this.plugin.settings.langSpecificSettingsType, true);
                const defaultLightColor = this.getColorFromPickrClass(this.plugin.settings.SelectedTheme, "light", this.plugin.settings.langSpecificSettingsType, true);
                this.createAlternatePickr(languageSettingsDiv, languageSettingsDiv, propDisplayText, getCurrentMode() === "dark" ? defaultDarkColor as string : defaultLightColor as string, "langSpecific", this.plugin.settings.langSpecificSettingsType, languageName);
                this.plugin.settings.SelectedTheme.colors.light.languageSpecificColors[languageName][this.plugin.settings.langSpecificSettingsType] = defaultLightColor as string;
                this.plugin.settings.SelectedTheme.colors.dark.languageSpecificColors[languageName][this.plugin.settings.langSpecificSettingsType] = defaultDarkColor as string;
              }
              (async () => { await this.plugin.saveSettings() })();
              this.plugin.renderReadingViews();
              //this.display();
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
          delete this.plugin.settings.SelectedTheme.colors.light.languageSpecificColors[languageName];
          delete this.plugin.settings.SelectedTheme.colors.dark.languageSpecificColors[languageName];
          this.display();
          (async () => { await this.plugin.saveSettings() })();
        });
      });
  }// createDropdown

  createDonateButton = (link: string): HTMLElement => {
    const a = createEl("a");
    a.setAttribute("href", link);
    a.addClass("buymeacoffee-ThePirateKing-img");
    a.innerHTML = `<img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=🥤&slug=ThePirateKing&button_colour=5F7FFF&font_colour=ffffff&font_family=Inter&outline_colour=000000&coffee_colour=FFDD00" height="42px" />`;
    return a;
  };// createDonateButton

  createReadMeLink = (container: HTMLElement) => {
    const divElement = container.createDiv({ cls: "codeblock-customizer-readMe", });

    const spanElement = createSpan();
    spanElement.style.whiteSpace = "pre"; // Preserve whitespace
    
    const textNode = document.createTextNode("For more information, please read the ");
    spanElement.appendChild(textNode);
    
    divElement.appendChild(spanElement);
    
    const linkElement = container.createEl("a");
    linkElement.href = "https://github.com/mugiwara85/CodeblockCustomizer";

    const linkTextNode = document.createTextNode("README");
    linkElement.appendChild(linkTextNode);
    
    divElement.appendChild(linkElement);
    container.appendChild(divElement);
  }// createReadMeLink
}// SettingsTab