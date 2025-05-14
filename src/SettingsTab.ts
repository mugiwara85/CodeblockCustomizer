import { Notice, PluginSettingTab, Setting, DropdownComponent, App, TextComponent, ToggleComponent, ExtraButtonComponent, ColorComponent, setIcon } from "obsidian";
import Pickr from "@simonwep/pickr";

import { addClassesToPrompt, getPromptType, collectAllPromptClasses, defaultPrompts, getColorOfCssVariable, getCurrentMode, getPromptDefinition, promptClassDisplayNames, PromptDefinition, PromptEnvironment, replacePromptTemplate, updateSettingStyles } from "./Utils";
import { DEFAULT_SETTINGS, CodeblockCustomizerSettings, Colors, Theme, DEFAULT_THEMES } from './Settings';
import CodeBlockCustomizerPlugin from "./main";
import { DEFAULT_COLLAPSE_TEXT, DEFAULT_LINE_SEPARATOR, DEFAULT_TEXT_SEPARATOR } from "./Const";

interface ColorOptions {
  [key: string]: string;
}

export class SettingsTab extends PluginSettingTab {
  plugin: CodeBlockCustomizerPlugin;
  pickerInstances: Pickr[];
  headerLangToggles: Setting[];
  headerLangIconToggles: Setting[];
  linkUpdateToggle: Setting[];

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
        }
      });
    });

    new Setting(containerEl)
      .setName('Select settings page')
      .setDesc('Select which settings group you want to modify.')
      .addDropdown((dropdown) => dropdown
        .addOptions({"basic": "Basic", "codeblock": "Codeblock", "languageSpecific": "Language specific colors", "alternateHighlight": "Alternative highlight colors", "header": "Header", "headerLanguage": "Header language", "gutter": "Gutter", "prompts": "Prompts", "inlineCode": "Inline code", "printToPDF": "Print to PDF"})
        .setValue(this.plugin.settings.settingsType)
        .onChange((value) => {
          this.plugin.settings.settingsType = value;
          basicDiv.toggleClass("codeblock-customizer-basic-settingsDiv-hide", this.plugin.settings.settingsType !== "basic");
          codeblockDiv.toggleClass("codeblock-customizer-codeblock-settingsDiv-hide", this.plugin.settings.settingsType !== "codeblock");
          languageSpecificDiv.toggleClass("codeblock-customizer-languageSpecific-settingsDiv-hide", this.plugin.settings.settingsType !== "languageSpecific");
          alternateHighlightDiv.toggleClass("codeblock-customizer-alternative-highlight-settingsDiv-hide", this.plugin.settings.settingsType !== "alternateHighlight");
          headerDiv.toggleClass("codeblock-customizer-header-settingsDiv-hide", this.plugin.settings.settingsType !== "header");
          headerLanguageDiv.toggleClass("codeblock-customizer-header-language-settingsDiv-hide", this.plugin.settings.settingsType !== "headerLanguage");
          gutterDiv.toggleClass("codeblock-customizer-gutter-settingsDiv-hide", this.plugin.settings.settingsType !== "gutter");
          inlineDiv.toggleClass("codeblock-customizer-inlineCode-settingsDiv-hide", this.plugin.settings.settingsType !== "inlineCode");
          printToPDFDiv.toggleClass("codeblock-customizer-printToPDF-settingsDiv-hide", this.plugin.settings.settingsType !== "printToPDF");
          promptsDIV.toggleClass("codeblock-customizer-prompts-settingsDiv-hide", this.plugin.settings.settingsType !== "prompts");
          (async () => {await this.plugin.saveSettings()})();
        })
      );
      
      this.createReadMeLink(containerEl);

      containerEl.createEl("hr");

      const basicDiv = containerEl.createDiv({ cls: "codeblock-customizer-basic-settingsDiv-hide" });
      basicDiv.toggleClass("codeblock-customizer-basic-settingsDiv-hide", this.plugin.settings.settingsType !== "basic");
      basicDiv.createEl('h3', {text: 'Basic settings'});

      new Setting(basicDiv)
        .setName('Enable plugin in source mode')
        .setDesc('By default the plugin is disabled in source mode. You can enable it in source mode as well using this toggle.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.SelectedTheme.settings.common.enableInSourceMode)
          .onChange(async (value) => {
            this.plugin.settings.SelectedTheme.settings.common.enableInSourceMode = value;
            await this.plugin.saveSettings();
            updateSettingStyles(this.plugin.settings, this.app);
          })
        );
  
      new Setting(basicDiv)
        .setName('Enable editor active line highlight')
        .setDesc('If enabled, you can set the color for the active line (including codeblocks).')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.SelectedTheme.settings.enableEditorActiveLineHighlight)
          .onChange(async (value) => {
            this.plugin.settings.SelectedTheme.settings.enableEditorActiveLineHighlight = value;
            await this.plugin.saveSettings();
            updateSettingStyles(this.plugin.settings, this.app);
            this.display();
          })
        );
      
      if (this.plugin.settings.SelectedTheme.settings.enableEditorActiveLineHighlight) {
        this.createPickrSetting(basicDiv, 'Editor active line color', 
        'To set this color, enable the option "Enable editor active line highlighting" first.', "editorActiveLineColor");		
      }

      new Setting(basicDiv)
        .setName('Exclude languages')
        .setDesc('Define languages, separated by a comma, to which the plugin should not apply. You can use a wildcard (*) either at the beginning, or at the end. For example: ad-* will exclude codeblocks where the language starts with ad- e.g.: ad-info, ad-error etc.')
        .addText(text => text
          .setPlaceholder('e.g. dataview, python etc.')
          .setValue(this.plugin.settings.ExcludeLangs)
          .onChange(async (value) => {
            this.plugin.settings.ExcludeLangs = value;
            await this.plugin.saveSettings();
          })
        );

      new Setting(basicDiv)
        .setName('Restore default themes')
        .setDesc('Restore all settings of all the default themes to their original state.')
        .addButton(async (button) => {
          button.setButtonText("Restore");
          button.onClick(async () => {
            this.restoreThemes(this.plugin.settings.ThemeName, true);
            await this.plugin.saveSettings();
            new Notice("Default themes restored to their original state!");
          });
        });

    const codeblockDiv = containerEl.createDiv({ cls: "codeblock-customizer-codeblock-settingsDiv-hide" });
    codeblockDiv.toggleClass("codeblock-customizer-codeblock-settingsDiv-hide", this.plugin.settings.settingsType !== "codeblock");
    codeblockDiv.createEl('h3', {text: 'Codeblock settings'});
    
    new Setting(codeblockDiv)
      .setName('Enable line numbers')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.enableLineNumbers)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.codeblock.enableLineNumbers = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(codeblockDiv)
      .setName('Enable codeblock active line highlight')
      .setDesc('If enabled, you can set the color for the active line inside codeblocks only.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.enableActiveLineHighlight)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.codeblock.enableActiveLineHighlight = value;          
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
          this.display();
        })
      );
        
    if (this.plugin.settings.SelectedTheme.settings.codeblock.enableActiveLineHighlight) {
      this.createPickrSetting(codeblockDiv, 'Codeblock active line color', 
        'To set this color, enable the option "Enable codeblock active line highlight" first.', "codeblock.activeLineColor");
    }
    
    this.createPickrSetting(codeblockDiv, 'Background color', '', "codeblock.backgroundColor");
    this.createPickrSetting(codeblockDiv, 'Highlight color (used by the "hl" parameter)', '', "codeblock.highlightColor");

    new Setting(codeblockDiv)
      .setName('Show indentation lines in reading view')
      .setDesc('If enabled, indentation lines will be shown in reading view.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.showIndentationLines)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.codeblock.showIndentationLines = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
        })
      );

    new Setting(codeblockDiv)
      .setName('Enable links usage')
      .setDesc('If enabled, you can use links in the header, and code blocks as well. In code blocks, you must comment them to work! Examples: [[Document1]], [[Document1|DisplayText]], [[Document1#Paragraph|DisplayText]], [[Document1#^<BlockId>|DisplayText]], [DisplayText](Link), http://example.com etc.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.enableLinks)
        .onChange(async (value) => {
          this.linkUpdateToggle.forEach(item => {
            item.setDisabled(!value);
          });
          this.plugin.settings.SelectedTheme.settings.codeblock.enableLinks = value;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (this.plugin.settings.SelectedTheme.settings.codeblock.enableLinks) {
      const enableLinkUpdate = new Setting(codeblockDiv)
        .setName('Enable automatically updating links on file rename')
        .setDesc('To enable this setting, enable links usage option first! If enabled, code block links will be automatically updated, when a file is renamed. Please read the README for more information!')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.enableLinkUpdate)
          .onChange(async (value) => {
            this.plugin.settings.SelectedTheme.settings.codeblock.enableLinkUpdate = value;
            await this.plugin.saveSettings();
          })
        );
      this.linkUpdateToggle.push(enableLinkUpdate);
    }
  
    if (!this.plugin.settings.SelectedTheme.settings.codeblock.enableLinks){
      this.linkUpdateToggle.forEach(item => {
        item.setDisabled(true);
      });
    }

    new Setting(codeblockDiv)
      .setName('Enable bracket highlight for matching brackets')
      .setDesc('If you click next to a bracket, and if the corresponding opening/closing bracket has been found both of them will be highlighted.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.enableBracketHighlight)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.codeblock.enableBracketHighlight = value;
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

    if (this.plugin.settings.SelectedTheme.settings.codeblock.enableBracketHighlight) {
      this.createPickrSetting(codeblockDiv, 'Bracket highlight color for matching brackets', '', "codeblock.bracketHighlightColorMatch");
      this.createPickrSetting(codeblockDiv, 'Background color for matching brackets', '', "codeblock.bracketHighlightBackgroundColorMatch");

      new Setting(codeblockDiv)
        .setName('Enable bracket highlight for non matching brackets')
        .setDesc('If you click next to a bracket, and it doesn\'t have a corresponding pair, or the pair does not match the opening/closing bracket (e.g: print("hello"] ), they will be highlighted.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.highlightNonMatchingBrackets)
          .onChange(async (value) => {
            this.plugin.settings.SelectedTheme.settings.codeblock.highlightNonMatchingBrackets = value;
            await this.plugin.saveSettings();
            updateSettingStyles(this.plugin.settings, this.app);
            this.display();
          })
        );

      if (this.plugin.settings.SelectedTheme.settings.codeblock.highlightNonMatchingBrackets) {
        this.createPickrSetting(codeblockDiv, 'Bracket highlight color for non matching brackets', '', "codeblock.bracketHighlightColorNoMatch");
        this.createPickrSetting(codeblockDiv, 'Background color for non matching brackets', '', "codeblock.bracketHighlightBackgroundColorNoMatch");
      }
    }

    new Setting(codeblockDiv)
      .setName('Inverse fold behavior')
      .setDesc('If enabled, all code blocks are folded by default when opening a document. To disable this behavior for a specific code block, use the "unfold" parameter.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.inverseFold)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.codeblock.inverseFold = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(codeblockDiv)
      .setName('Enable selection matching')
      .setDesc('If enabled, all occurrences of the selected text will be highlighted for easy identification.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.enableSelectionMatching)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.codeblock.enableSelectionMatching = value;
          if (value){
            this.plugin.extensions.push(this.plugin.editorExtensions.selectionMatching);
          }
          else{
            this.plugin.extensions.remove(this.plugin.editorExtensions.selectionMatching);
          }
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (this.plugin.settings.SelectedTheme.settings.codeblock.enableSelectionMatching) {
      this.createPickrSetting(codeblockDiv, 'Selection match highlight color', '', "codeblock.selectionMatchHighlightColor");
    }

    new Setting(codeblockDiv)
      .setName('Unwrap code')
      .setDesc('If enabled, the code will be unwrapped in reading view.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.unwrapcode)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.codeblock.unwrapcode = value;
          await this.plugin.saveSettings();
        })
      );

    codeblockDiv.createEl('h4', {text: 'Extra buttons'});

    new Setting(codeblockDiv)
      .setName('Show \'Delete Code\' button (only editing view)')
      .setDesc('If enabled, an additional button will be displayed on every codeblock. If clicked, the content of that codeblock is deleted. Be careful!')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.buttons.enableDeleteCodeButton)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.codeblock.buttons.enableDeleteCodeButton = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
        })
      );

    new Setting(codeblockDiv)
      .setName('Show \'Select Code\' button (only editing view)')
      .setDesc('If enabled, an additional button will be displayed on every codeblock. If clicked, the content of that codeblock is selected (including the first and last lines of the code blocks which begin with three backticks).')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.buttons.enableSelectCodeButton)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.codeblock.buttons.enableSelectCodeButton = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
        })
      );

    new Setting(codeblockDiv)
      .setName('Show \'Wrap Code\' button (only reading view)')
      .setDesc('If enabled, an additional button will be displayed on every codeblock. If clicked, the content of that codeblock is wrapped/unwrapped.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.buttons.enableWrapCodeButton)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.codeblock.buttons.enableWrapCodeButton = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
        })
      );

    new Setting(codeblockDiv)
      .setName('Always show buttons (only editing view)')
      .setDesc('If enabled, all enabled buttons will always be displayed, even when you click inside the code block. Otherwise, they will only be shown when the cursor is outside the code block.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.buttons.alwaysShowButtons)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.codeblock.buttons.alwaysShowButtons = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
        })
      );

    new Setting(codeblockDiv)
      .setName('Always show \'Copy Code\' button for collapsed code blocks')
      .setDesc('If enabled, in editing mode the \'Copy Code\' button will always be visible on collapsed code blocks in the header. In reading mode the \'Copy Code\' button will always be visible on collapsed and uncollapsed code blocks as well. Otherwise, it will only appear when hovering over the header (in editing mode) or the code block (in reading mode).')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.buttons.alwaysShowCopyCodeButton)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.codeblock.buttons.alwaysShowCopyCodeButton = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
        })
      );
    codeblockDiv.createEl('h4', {text: 'Text highlight settings'});

    new Setting(codeblockDiv)
    .setName('Line separator')
    .setDesc('Override the default line separator (|) globally for text highlighting. You can also specify it for specific code blocks using the "lsep" parameter. The separator can only be one character long!')
    .addText(text => text
      .setPlaceholder(DEFAULT_LINE_SEPARATOR)
      .setValue(this.plugin.settings.SelectedTheme.settings.textHighlight.lineSeparator)
      .onChange(async (value) => {
        this.plugin.settings.SelectedTheme.settings.textHighlight.lineSeparator = value.charAt(0);
        await this.plugin.saveSettings();
      })
    );

    new Setting(codeblockDiv)
    .setName('Text separator')
    .setDesc('Override the default text separator (:) globally for text highlighting. You can also specify it for specific code blocks using the "tsep" parameter. The separator can only be one character long!')
    .addText(text => text
      .setPlaceholder(DEFAULT_TEXT_SEPARATOR)
      .setValue(this.plugin.settings.SelectedTheme.settings.textHighlight.textSeparator)
      .onChange(async (value) => {
        this.plugin.settings.SelectedTheme.settings.textHighlight.textSeparator = value.charAt(0);
        await this.plugin.saveSettings();
      })
    );

    codeblockDiv.createEl('h4', {text: 'Semi-fold settings'});

    let enableSemiFoldToggle: ToggleComponent;
    let semiFoldLinesDropDown: DropdownComponent;
    let semiFoldShowButton: ToggleComponent;

    const updateDependentSettings = () => {
      const value = enableSemiFoldToggle.getValue();
      semiFoldLinesDropDown.setDisabled(!value);
      semiFoldShowButton.setDisabled(!value);
    };
    
    new Setting(codeblockDiv)
      .setName('Enable semi-fold')
      .setDesc('If enabled folding will use semi-fold method. This means, that the first X lines will be visible only. Select the number of visisble lines. You can also enable an additional uncollapse button. Please refer to the README for more information.')
      .addToggle(toggle => enableSemiFoldToggle = toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.semiFold.enableSemiFold)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.semiFold.enableSemiFold = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
          updateDependentSettings();
        })
      )
      .addDropdown((dropdown) => { semiFoldLinesDropDown = dropdown
        dropdown.selectEl.empty();
        dropdown.addOptions(Object.fromEntries([...Array(50)].map((_, index) => [`${index + 1}`, `${index + 1}`])))
        dropdown.setValue(this.plugin.settings.SelectedTheme.settings.semiFold.visibleLines.toString())
        dropdown.onChange(async (value) => {
          const number = parseInt(value);
          this.plugin.settings.SelectedTheme.settings.semiFold.visibleLines = number;
          await this.plugin.saveSettings();
        })
      })
      .addToggle(toggle => semiFoldShowButton = toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.semiFold.showAdditionalUncollapseButon)
        .setTooltip('Show additional uncollapse button')
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.semiFold.showAdditionalUncollapseButon = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
        })
      );
    updateDependentSettings();

    const languageSpecificDiv = containerEl.createDiv({ cls: "codeblock-customizer-languageSpecific-settingsDiv-hide" });
    languageSpecificDiv.toggleClass("codeblock-customizer-languageSpecific-settingsDiv-hide", this.plugin.settings.settingsType !== "languageSpecific");
    languageSpecificDiv.createEl('h3', {text: 'Codeblock language specific colors', cls: 'codeblock-customizer-lang-specific-color'});

    let languageSpecificColorDisplayText: TextComponent;
    new Setting(languageSpecificDiv)
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

    new Setting(languageSpecificDiv)
      .setName('Code block border styling position')
      .setDesc('Select on which side the border should be displayed.')
      .addDropdown((dropdown) => dropdown
        .addOptions({"disable": "Disable", "left": "Left", "right": "Right"})
        .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.codeBlockBorderStylingPosition)
        .onChange((value) => {
          this.plugin.settings.SelectedTheme.settings.codeblock.codeBlockBorderStylingPosition = value;
          (async () => {await this.plugin.saveSettings()})();
          updateSettingStyles(this.plugin.settings, this.app);
        })
      );
    const languageSpecificContainer = languageSpecificDiv.createDiv({ cls: "codeblock-customizer-languageSpecificColorContainer" });

    // Update the color container on page load
    this.updateLanguageSpecificColorContainer(languageSpecificContainer);

    const alternateHighlightDiv = containerEl.createDiv({ cls: "codeblock-customizer-alternative-highlight-settingsDiv-hide" });
    alternateHighlightDiv.toggleClass("codeblock-customizer-alternative-highlight-settingsDiv-hide", this.plugin.settings.settingsType !== "alternateHighlight");
    alternateHighlightDiv.createEl('h3', {text: 'Alternative highlight colors', cls: 'codeblock-customizer-alternative-highlight-color'});

    // Add the color input and button
    let alternateColorDisplayText: TextComponent;
    new Setting(alternateHighlightDiv)
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
            }
          }
        });
      });
      
    const colorContainer = alternateHighlightDiv.createDiv({ cls: "codeblock-customizer-alternateHLcolorContainer" });

    // Update the color container on page load
    this.updateColorContainer(colorContainer);
    
    const headerDiv = containerEl.createDiv({ cls: "codeblock-customizer-header-settingsDiv-hide" });
    headerDiv.toggleClass("codeblock-customizer-header-settingsDiv-hide", this.plugin.settings.settingsType !== "header");
    headerDiv.createEl('h3', {text: 'Header settings'});
    
    this.createPickrSetting(headerDiv, 'Header color', '', "header.backgroundColor");
    this.createPickrSetting(headerDiv, 'Header text color', '', "header.textColor");
    
    new Setting(headerDiv)
      .setName('Header bold text')
      .setDesc('If enabled, the header text will be set to bold.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.header.boldText)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.header.boldText = value;
          await this.plugin.saveSettings();
      })
    );
    
    new Setting(headerDiv)
      .setName('Header italic text')
      .setDesc('If enabled, the header text will be set to italic.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.header.italicText)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.header.italicText = value;
          await this.plugin.saveSettings();
      })
    );
    
    this.createPickrSetting(headerDiv, 'Header line color', '', "header.lineColor");
    
    new Setting(headerDiv)
      .setName('Disable folding for code blocks without fold or unfold specified')
      .setDesc('If enabled, code blocks without "fold" or "unfold" specified will not collapse when clicking the header.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.header.disableFoldUnlessSpecified)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.header.disableFoldUnlessSpecified = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings, this.app);
        })
      );

    new Setting(headerDiv)
      .setName('Collapse icon position')
      .setDesc('If enabled a collapse icon will be displayed in the header. Select the position of the collapse icon.')
      .addDropdown((dropdown) => dropdown
        .addOptions({"hide": "Hide", "middle": "Middle", "right": "Right"})
        .setValue(this.plugin.settings.SelectedTheme.settings.header.collapseIconPosition)
        .onChange((value) => {
          this.plugin.settings.SelectedTheme.settings.header.collapseIconPosition = value;
          (async () => {await this.plugin.saveSettings()})();
          updateSettingStyles(this.plugin.settings, this.app);
        })
      );

    new Setting(headerDiv)
    .setName('Collapsed code text')
    .setDesc('Overwrite the default "Collapsed Code" text in the header, when the file parameter is not defined.')
    .addText(text => text
      .setPlaceholder(DEFAULT_COLLAPSE_TEXT)
      .setValue(this.plugin.settings.SelectedTheme.settings.header.collapsedCodeText)
      .onChange(async (value) => {
        this.plugin.settings.SelectedTheme.settings.header.collapsedCodeText = value;
        await this.plugin.saveSettings();
      })
    );

    const headerLanguageDiv = containerEl.createDiv({ cls: "codeblock-customizer-header-language-settingsDiv-hide" });
    headerLanguageDiv.toggleClass("codeblock-customizer-header-language-settingsDiv-hide", this.plugin.settings.settingsType !== "headerLanguage");
    headerLanguageDiv.createEl('h3', {text: 'Header language settings'});
        
    new Setting(headerLanguageDiv)
      .setName('Display codeblock language (if language is defined)')
      .setDesc('If enabled, the codeblock language will be displayed in the header. If disabled, all below settings are disabled as well!')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.header.displayCodeBlockLanguage)
        .onChange(async (value) => {
          this.headerLangToggles.forEach(item => {
            item.setDisabled(!value);
          });
          this.plugin.settings.SelectedTheme.settings.header.displayCodeBlockLanguage = value;
          await this.plugin.saveSettings();
          this.display();
      })
    );

    if (this.plugin.settings.SelectedTheme.settings.header.displayCodeBlockLanguage) {
      this.createPickrSetting(headerLanguageDiv, 'Codeblock language text color', 'To set this color, enable the option "Display codeblock language" first.', "header.codeBlockLangTextColor");    
      this.createPickrSetting(headerLanguageDiv, 'Codeblock language background color', 'To set this color, enable the option "Display codeblock language" first.', "header.codeBlockLangBackgroundColor");    
      
      const boldToggle = new Setting(headerLanguageDiv)
        .setName('Bold text')
        .setDesc('If enabled, the codeblock language text will be set to bold.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.SelectedTheme.settings.header.codeblockLangBoldText)
          .onChange(async (value) => {
            this.plugin.settings.SelectedTheme.settings.header.codeblockLangBoldText = value;
            await this.plugin.saveSettings();
        })
      );
      this.headerLangToggles.push(boldToggle);
      
      const italicToggle = new Setting(headerLanguageDiv)
        .setName('Italic text')
        .setDesc('If enabled, the codeblock language text will be set to italic.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.SelectedTheme.settings.header.codeblockLangItalicText)
          .onChange(async (value) => {
            this.plugin.settings.SelectedTheme.settings.header.codeblockLangItalicText = value;
            await this.plugin.saveSettings();
        })
      );
      this.headerLangToggles.push(italicToggle);
      
      const alwaysDisplayToggle = new Setting(headerLanguageDiv)
        .setName('Always display codeblock language')
        .setDesc('If enabled, the codeblock language will always be displayed (if a language is defined), even if the file parameter is not specified.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.SelectedTheme.settings.header.alwaysDisplayCodeblockLang)
          .onChange(async (value) => {
            this.plugin.settings.SelectedTheme.settings.header.alwaysDisplayCodeblockLang = value;
            await this.plugin.saveSettings();
        })
      );
      this.headerLangToggles.push(alwaysDisplayToggle);
      
      if (!this.plugin.settings.SelectedTheme.settings.header.displayCodeBlockLanguage){
        this.headerLangToggles.forEach(item => {
          item.setDisabled(true);
        });
      }
    }
    headerLanguageDiv.createEl('h5', {text: 'Header language icon settings'});
    
    new Setting(headerLanguageDiv)
      .setName('Display codeblock language icon (if available)')
      .setDesc('If enabled, the codeblock language icon will be displayed in the header. If disabled, all below settings are disabled as well!')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.header.displayCodeBlockIcon)
        .onChange(async (value) => {
          this.headerLangIconToggles.forEach(item => {
            item.setDisabled(!value);
          });
          this.plugin.settings.SelectedTheme.settings.header.displayCodeBlockIcon = value;
          await this.plugin.saveSettings();
          this.display();
      })
    );
    
    if (this.plugin.settings.SelectedTheme.settings.header.displayCodeBlockIcon) {
      const alwaysDisplayIconToggle = new Setting(headerLanguageDiv)
        .setName('Always display codeblock language icon (if available)')
        .setDesc('If enabled, the codeblock language icon will always be displayed (if a language is defined and it has an icon), even if the file parameter is not specified.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.SelectedTheme.settings.header.alwaysDisplayCodeblockIcon)
          .onChange(async (value) => {
            this.plugin.settings.SelectedTheme.settings.header.alwaysDisplayCodeblockIcon = value;
            await this.plugin.saveSettings();
        })
      );
      this.headerLangIconToggles.push(alwaysDisplayIconToggle);
      
      if (!this.plugin.settings.SelectedTheme.settings.header.displayCodeBlockIcon){
        this.headerLangIconToggles.forEach(item => {
          item.setDisabled(true);
        });
      }
    }
    const gutterDiv = containerEl.createDiv({ cls: "codeblock-customizer-gutter-settingsDiv-hide" });
    gutterDiv.toggleClass("codeblock-customizer-gutter-settingsDiv-hide", this.plugin.settings.settingsType !== "gutter");
    gutterDiv.createEl('h3', {text: 'Gutter settings'});
    
    new Setting(gutterDiv)
      .setName('Highlight gutter')
      .setDesc('If enabled, highlighted lines will also highlight the gutter (line number), not just the line.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.gutter.enableHighlight)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.gutter.enableHighlight = value;
          await this.plugin.saveSettings();
      })
    );
    
    this.createPickrSetting(gutterDiv, 'Gutter text color', '', "gutter.textColor");
    this.createPickrSetting(gutterDiv, 'Gutter background color', '', "gutter.backgroundColor");
    
    new Setting(gutterDiv)
      .setName('Highlight active line number')
      .setDesc('If enabled, the active line number will be highlighted with a separate color.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.gutter.highlightActiveLineNr)
        .onChange((value) => {
          this.plugin.settings.SelectedTheme.settings.gutter.highlightActiveLineNr = value;
          (async () => {await this.plugin.saveSettings()})();
          updateSettingStyles(this.plugin.settings, this.app);
          this.display();
        })
      );

    if (this.plugin.settings.SelectedTheme.settings.gutter.highlightActiveLineNr) {
      this.createPickrSetting(gutterDiv, 'Active line number color', 'To set this color enable the option "Hihglight active line number" first.', "gutter.activeLineNrColor");
    }
    
    const inlineDiv = containerEl.createDiv({ cls: "codeblock-customizer-inlineCode-settingsDiv-hide" });
    inlineDiv.toggleClass("codeblock-customizer-inlineCode-settingsDiv-hide", this.plugin.settings.settingsType !== "inlineCode");
    inlineDiv.createEl('h3', {text: 'Inline code settings'});

    new Setting(inlineDiv)
    .setName('Enable inline code styling')
    .setDesc('If enabled, the background color, and the text color of inline code can be styled.')
    .addToggle(toggle => toggle
      .setValue(this.plugin.settings.SelectedTheme.settings.inlineCode.enableInlineCodeStyling)
      .onChange(async (value) => {
        this.plugin.settings.SelectedTheme.settings.inlineCode.enableInlineCodeStyling = value;
        await this.plugin.saveSettings();
        this.display();
      })
    );

    if (this.plugin.settings.SelectedTheme.settings.inlineCode.enableInlineCodeStyling) {
      this.createPickrSetting(inlineDiv, 'Inline code background color', 'To set this color enable the option "Enable inline code styling" first.', "inlineCode.backgroundColor");
      this.createPickrSetting(inlineDiv, 'Inline code text color', 'To set this color enable the option "Enable inline code styling" first.', "inlineCode.textColor");
    }

    const printToPDFDiv = containerEl.createDiv({ cls: "codeblock-customizer-printToPDF-settingsDiv-hide" });
    printToPDFDiv.toggleClass("codeblock-customizer-printToPDF-settingsDiv-hide", this.plugin.settings.settingsType !== "printToPDF");
    printToPDFDiv.createEl('h3', {text: 'Print to PDF settings '});

    new Setting(printToPDFDiv)
    .setName('Enable print to PDF')
    .setDesc('If enabled, the styling is applied to documents when printed to PDF. By default PDF printing uses light theme colors.')
    .addToggle(toggle => toggle
      .setValue(this.plugin.settings.SelectedTheme.settings.printing.enablePrintToPDFStyling)
      .onChange(async (value) => {
        this.plugin.settings.SelectedTheme.settings.printing.enablePrintToPDFStyling = value;
        await this.plugin.saveSettings();
        this.display();
      })
    );

    if (this.plugin.settings.SelectedTheme.settings.printing.enablePrintToPDFStyling) {
      new Setting(printToPDFDiv)
      .setName('Force current color mode use')
      .setDesc('If enabled, PDF printing will use the dark theme colors when a dark theme is selected, and light theme colors when a light theme is selected.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.printing.forceCurrentColorUse)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.printing.forceCurrentColorUse = value;
          await this.plugin.saveSettings();
        })
      );

      new Setting(printToPDFDiv)
      .setName('Expand all code blocks during printing')
      .setDesc('If enabled, all collapsed code blocks specified by the "fold" parameter will be expanded when printing. This results in the printed document containing expanded code blocks where "fold" was used.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.printing.uncollapseDuringPrint)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.printing.uncollapseDuringPrint = value;
          await this.plugin.saveSettings();
        })
      );
    }

    const promptsDIV = containerEl.createDiv({ cls: "codeblock-customizer-prompts-settingsDiv-hide" });
    promptsDIV.toggleClass("codeblock-customizer-prompts-settingsDiv-hide", this.plugin.settings.settingsType !== "prompts");
    promptsDIV.createEl('h3', {text: 'Prompt settings '});

    let selectedPromptId = Object.keys(defaultPrompts)[0]; // default to first prompt

    let promptDropdown: DropdownComponent;
    let promptRestoreButton: ExtraButtonComponent;
    let promptDeleteButton: ExtraButtonComponent;
    new Setting(promptsDIV)
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
          if (!(selectedPromptId in this.plugin.settings.SelectedTheme.settings.prompts.customPrompts)) {
            new Notice('Prompt not found.');
            return;
          }
          delete this.plugin.settings.SelectedTheme.settings.prompts.customPrompts[selectedPromptId];
          delete this.plugin.settings.SelectedTheme.colors.light.prompts.promptColors?.[selectedPromptId];
          delete this.plugin.settings.SelectedTheme.colors.dark.prompts.promptColors?.[selectedPromptId];
          delete this.plugin.settings.SelectedTheme.colors.light.prompts.editedPromptColors?.[selectedPromptId];
          delete this.plugin.settings.SelectedTheme.colors.dark.prompts.editedPromptColors?.[selectedPromptId];
          delete this.plugin.settings.SelectedTheme.colors.light.prompts.editedRootPromptColors?.[selectedPromptId];
          delete this.plugin.settings.SelectedTheme.colors.dark.prompts.editedRootPromptColors?.[selectedPromptId];

          new Notice(`Prompt "${selectedPromptId}" deleted successfully!`);
          selectedPromptId = Object.keys(defaultPrompts)[0];
          this.refreshPromptDropdown(promptDropdown, selectedPromptId);
          this.createPromptSettings(promptEditorContainer, selectedPromptId);
          await this.plugin.saveSettings();
        });// onClick
        button.setDisabled(selectedPromptId in defaultPrompts)
      })// addExtraButton

    let promptName: TextComponent;
    this.plugin.settings.newPromptName = "";
    new Setting(promptsDIV)
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
          
          this.plugin.settings.SelectedTheme.settings.prompts.customPrompts[this.plugin.settings.newPromptName] = {
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
          promptDropdown.addOption(newPromptId, `[Custom] ${newPromptId}`);
          promptDropdown.setValue(selectedPromptId);
          const exists = newPromptId in this.plugin.settings.SelectedTheme.settings.prompts.customPrompts;
          if (exists)
            new Notice(`Prompt "${this.plugin.settings.newPromptName}" updated successfully!`);
          else
            new Notice(`Prompt "${this.plugin.settings.newPromptName}" saved successfully!`);
          this.plugin.settings.newPromptName = "";
          promptName.setValue("");
          await this.plugin.saveSettings();
          this.createPromptSettings(promptEditorContainer, selectedPromptId);
      });
    });

    const promptEditorContainer = promptsDIV.createDiv({cls: 'codeblock-customizer-prompt-editor-container'});
    this.createPromptSettings(promptEditorContainer, selectedPromptId);
   
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
  
    delete this.plugin.settings.SelectedTheme.settings.prompts.editedDefaults?.[promptId];
  
    this.display();
  }
  // restorePromptColor
  
  createPromptSettings (promptEditorContainer: HTMLElement, selectedPromptId: string) {
    const wasSettingsOpen = promptEditorContainer.querySelector('details')?.open ?? false;
    const wasColorsOpen = (promptEditorContainer.querySelector('.codeblock-customizer-prompt-colors-settings-group') as HTMLDetailsElement)?.open ?? false;

    promptEditorContainer.empty();
  
    const { def: currentPromptData } = getPromptDefinition(selectedPromptId, this.plugin.settings);

    // prompt preview
    const previewWrapper = promptEditorContainer.createDiv({ cls: 'codeblock-customizer-prompt-preview-wrapper' });
    previewWrapper.createDiv({text: 'Prompt preview'});
    const previewEl = previewWrapper.createDiv({ cls: 'codeblock-customizer-prompt-preview' });
  
    const promptSettingsDetails = promptEditorContainer.createEl('details', { cls: 'codeblock-customizer-prompt-settings-group' });
    //promptSettingsDetails.setAttribute('open', ''); // to make it open by default
    if (wasSettingsOpen) 
      promptSettingsDetails.open = true;

    promptSettingsDetails.createEl('summary', { text: 'Prompt Settings' });
    promptSettingsDetails.appendChild(document.createElement("br"));

    const updatePreview = () => {
      const { def: promptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
      this.updatePromptPreview(previewEl, selectedPromptId, promptData, isCustom);
    };
    
    updatePreview();
  
    // read only
    new Setting(promptSettingsDetails)
    .setName("Prompt Name (for codeblock language)")
    .setClass("codeblock-customizer-prompt-name")
    .setDesc(`This what you have to define in the code block e.g.: prompt:${selectedPromptId}`)
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
      .setName("Highlight Groups")
      .setDesc("Define the groups which are returned by the regex.\nYou can use user, host, path, db and branch as keys.\nThe values are the classes which will be used to style the prompt.")
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
  
    new Setting(promptSettingsDetails)
      .setName("Is Windows Shell")
      .setDesc("Only enable for Windows prompts, otherwise this should remain false.")
      .addToggle(toggle => toggle
        .setValue(currentPromptData.isWindowsShell)
        .onChange(async (value) => {
          const { def: currentPromptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
          currentPromptData.isWindowsShell = value;
          await this.savePromptData(isCustom, selectedPromptId, currentPromptData);
        }));

    new Setting(promptSettingsDetails)
      .setName("Supports root styling")
      .setDesc("Only enable for prompts, when you want to set different colors for the root prompt (linux prompts only).")
      .addToggle(toggle => toggle
        .setValue(currentPromptData.supportsRootStyling ?? false)
        .onChange(async (value) => {
          const { def: currentPromptData, isCustom } = getPromptDefinition(selectedPromptId, this.plugin.settings);
          currentPromptData.supportsRootStyling = value;
          await this.savePromptData(isCustom, selectedPromptId, currentPromptData);
          this.createPromptColorSettings(promptColorSettingsContainer, selectedPromptId, previewEl); // refresh color settings to immediately reflect the root color switch
        }));

    const colorsSettingsDetails = promptEditorContainer.createEl('details', {cls: 'codeblock-customizer-prompt-colors-settings-group'});
    
    if (wasColorsOpen) 
      colorsSettingsDetails.open = true;

    colorsSettingsDetails.createEl('summary', { text: 'Prompt Colors' });
    
    const promptColorSettingsContainer = colorsSettingsDetails.createDiv();
    
    this.createPromptColorSettings(promptColorSettingsContainer, selectedPromptId, previewEl);
  } // createPromptSettings

  createPromptColorSettings(promptColorSettingsContainer: HTMLElement, selectedPromptId: string, previewEl: HTMLElement, showRootColor = false) {
    promptColorSettingsContainer.empty();
    promptColorSettingsContainer.appendChild(document.createElement("br"));

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
            this.createPromptColorSettings(promptColorSettingsContainer, selectedPromptId, previewEl, editingRootColors);
            this.updatePromptPreview(previewEl, selectedPromptId, currentPromptData, isCustom, editingRootColors);
          })
      );
    }

    for (const part of allGroups) {
      const partClass = part.startsWith("prompt-") ? part : `prompt-${part}`;
      const label = promptClassDisplayNames[partClass] ?? `${partClass} (returned by RegEx)`;
      const resolvedColors = this.getResolvedPromptColors(selectedPromptId, editingRootColors); // normal/root colors
      const fallbackColors = this.getResolvedPromptColors(selectedPromptId, false); // normal colors
      const currentColor = resolvedColors[partClass] ?? fallbackColors[partClass] ?? "#777777";
      const isDefaultPrompt = selectedPromptId in defaultPrompts;  

      new Setting(promptColorSettingsContainer)
        .setName(label)
        .then(setting => {
          const colorPicker = new ColorComponent(setting.controlEl)
            .setValue(currentColor)
            .onChange(async (value) => {
              this.setPromptColorDiff(selectedPromptId, partClass, value, editingRootColors);
              await this.plugin.saveSettings();
            });

          if (isDefaultPrompt) { // no restore color button for custom prompts
            const resetButton = setting.controlEl.createDiv({cls: 'clickable-icon extra-setting-button'});
            setIcon(resetButton, "reset");
            resetButton.addEventListener('click', async () => {
              const defaultColor = this.getDefaultPromptColor(selectedPromptId, partClass, editingRootColors);
              colorPicker.setValue(defaultColor);
              this.setPromptColorDiff(selectedPromptId, partClass, defaultColor, editingRootColors);
              await this.plugin.saveSettings();
            });
          }
        });
    }
  }// createPromptColorSettings

  getDefaultPromptColor(promptId: string, partClass: string, editingRootColors: boolean): string {
    const baseThemeName = this.plugin.settings.SelectedTheme.baseTheme ?? 'Obsidian';
    const defaultTheme = this.plugin.settings.Themes[baseThemeName];
    const mode = getCurrentMode();
  
    if (!defaultTheme) 
      return "#777777";
  
    if (editingRootColors) {
      return defaultTheme.colors[mode].prompts.rootPromptColors?.[promptId]?.[partClass]
          ?? defaultTheme.colors[mode].prompts.promptColors?.[promptId]?.[partClass]
          ?? "#777777";
    }
  
    return defaultTheme.colors[mode].prompts.promptColors?.[promptId]?.[partClass] ?? "#777777";
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
      this.plugin.settings.SelectedTheme.settings.prompts.customPrompts[selectedPromptId] = clone;
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
  
      this.plugin.settings.SelectedTheme.settings.prompts.editedDefaults[selectedPromptId] = diff;
    }
    await this.plugin.saveSettings();
  }

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
  }

  setPromptColorDiff(promptId: string, className: string, color: string, editingRoot: boolean) {
    const baseThemeName = this.plugin.settings.SelectedTheme.baseTheme ?? 'Obsidian';
    const mode = getCurrentMode();
    const baseColors = this.plugin.settings.Themes[baseThemeName].colors[mode].prompts;
    const defaultColor = editingRoot
      ? baseColors.rootPromptColors?.[promptId]?.[className]
      : baseColors.promptColors?.[promptId]?.[className];
    
    const diffObj = editingRoot
      ? this.plugin.settings.SelectedTheme.colors[getCurrentMode()].prompts.editedRootPromptColors
      : this.plugin.settings.SelectedTheme.colors[getCurrentMode()].prompts.editedPromptColors;
  
    if (color === defaultColor) {
      delete diffObj?.[promptId]?.[className];
      if (Object.keys(diffObj?.[promptId] ?? {}).length === 0)
        delete diffObj?.[promptId];
    } else {
      if (!diffObj[promptId]) diffObj[promptId] = {};
      diffObj[promptId][className] = color;
    }
  }
  
  
  restoreThemes(themeName: string, cloneAll: boolean) {
    if (cloneAll){
      Object.entries(DEFAULT_THEMES).forEach(([name, theme]: [string, Theme]) => {
        this.plugin.settings.Themes[name] = structuredClone(theme)
      });
    } else {
      Object.entries(DEFAULT_THEMES).forEach(([name, theme]: [string, Theme]) => {
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

    // default prompts
    for (const [key, prompt] of Object.entries(defaultPrompts)) {
      promptDropdown.addOption(key, `[Default] ${prompt.name}`);
    }

    // custom prompts
    for (const [key, prompt] of Object.entries(this.plugin.settings.SelectedTheme.settings.prompts.customPrompts)) {
      promptDropdown.addOption(key, `[Custom] ${prompt.name}`);
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
    
  createPickrSetting(containerEl: HTMLElement, name: string, description: string, pickrClass: string): Setting {
    let pickr: Pickr | undefined;
    let desc = "";
    if (description != '')
      desc = description;
        
    const mySetting =  new Setting(containerEl)
      // @ts-ignore
      .setName(name)
      .setDesc(desc)
      .then((setting) => {
        pickr = Pickr.create({
          el: setting.controlEl.createDiv({cls: "picker"}),
          container: containerEl.parentNode as HTMLElement,
          appClass: pickrClass,
          theme: 'nano',
          position: "left-middle",
          lockOpacity: false, // If true, the user won't be able to adjust any opacity.
          default: this.getColorFromPickrClass(this.plugin.settings.SelectedTheme, getCurrentMode(), pickrClass, true).toString(), // Default color
          swatches: [], // Optional color swatches
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
          }
        })
        .on('show', (color: Pickr.HSVaColor, instance: Pickr) => { // Pickr got opened
            if ((!this.plugin.settings.SelectedTheme.settings.codeblock.enableActiveLineHighlight && pickrClass === 'codeblock.activeLineColor') ||
                (!this.plugin.settings.SelectedTheme.settings.enableEditorActiveLineHighlight && pickrClass === 'editorActiveLineColor') ||
                (!this.plugin.settings.SelectedTheme.settings.header.displayCodeBlockLanguage && pickrClass === 'header.codeBlockLangTextColor') ||
                (!this.plugin.settings.SelectedTheme.settings.header.displayCodeBlockLanguage && pickrClass === 'header.codeBlockLangBackgroundColor') ||
                (!this.plugin.settings.SelectedTheme.settings.gutter.highlightActiveLineNr && pickrClass === 'gutter.activeLineNrColor') ||
                (!this.plugin.settings.SelectedTheme.settings.inlineCode.enableInlineCodeStyling && pickrClass === 'inlineCode.backgroundColor') ||
                (!this.plugin.settings.SelectedTheme.settings.inlineCode.enableInlineCodeStyling && pickrClass === 'inlineCode.textColor')){
              pickr?.hide();
            }
            const {result} = (pickr?.getRoot() as any).interaction;
            requestAnimationFrame(() =>
              requestAnimationFrame(() => result.select())
            );
        })
        .on('save', (color: Pickr.HSVaColor, instance: Pickr) => {
            if (!color) 
              return;
            instance.hide();
            const savedColor = color.toHEXA().toString();
            instance.addSwatch(savedColor);
            this.setAndSavePickrSetting(pickrClass, savedColor);
            // if the active line color changed update it
            if (pickrClass === 'editorActiveLineColor' || pickrClass === 'codeblock.activeLineColor'){
              updateSettingStyles(this.plugin.settings, this.app);
            }
        })
        .on('cancel', (instance: Pickr) => {
            instance.hide();
        })
      })
      .addExtraButton((btn) => {
        btn.setIcon("reset")
          .onClick(() => {
            if (pickr) {
              const defaultColor = this.getColorFromPickrClass(this.plugin.settings.Themes[this.plugin.settings.ThemeName], getCurrentMode(), pickrClass, true);
              pickr.setColor(defaultColor.toString());
              //(async () => {await this.plugin.saveSettings()})();
            }
          })
        .setTooltip('restore default color');
      });

    // @ts-ignore
    this.pickerInstances.push(pickr);

    return mySetting;
  }// createPickrSetting
  
  getColorFromPickrClass(selectedTheme: Theme, currentMode: 'dark' | 'light', pickrClass: string, resolveCSSVar: boolean): Colors | string {
    const properties = pickrClass.split('.');
    let colorValue: Colors | string = selectedTheme.colors[currentMode];

    for (const prop of properties) {
      // @ts-ignore
      colorValue = colorValue[prop];
      if (resolveCSSVar && colorValue.toString().startsWith("--")) {
        colorValue = getColorOfCssVariable(colorValue.toString());
      }
      if (!colorValue) {
        break;
      }
    }

    return colorValue || '';
  }// getColorFromPickrClass

  createAlternatePickr(containerEl: HTMLElement, colorContainer: HTMLElement, name: string, Color: string, type: string, colorKey = "", languageName = ""): Setting {
    let alternatePickr: Pickr;
    const desc = (type === "normal") ? "To higlight lines with this color use the \"" + name + "\" parameter. e.g: " + name + ":2,4-6" : "";

    const mySetting = new Setting(containerEl)
      // @ts-ignore
      .setName(name)
      .setDesc(desc)
      .then((setting) => {
        alternatePickr = Pickr.create({
          el: setting.controlEl.createDiv({cls: "picker"}),
          container: containerEl.parentNode as HTMLElement,
          theme: 'nano',
          position: "left-middle",
          lockOpacity: false, // If true, the user won't be able to adjust any opacity.
          default: Color, // Default color
          swatches: [], // Optional color swatches
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
          i18n: {
            'btn:toggle': 'select color for light theme'
          }
        })
        .on('show', (color: Pickr.HSVaColor, instance: Pickr) => { // Pickr got opened
            const {result} = (alternatePickr.getRoot() as any).interaction;
            requestAnimationFrame(() =>
              requestAnimationFrame(() => result.select())
            );
        })
        .on('save', (color: Pickr.HSVaColor, instance: Pickr) => {
            if (!color) 
              return;
            instance.hide();
            const savedColor = color.toHEXA().toString();
            instance.addSwatch(savedColor);
            if (type === "normal") {
              this.plugin.settings.SelectedTheme.colors[getCurrentMode()].codeblock.alternateHighlightColors[name] = savedColor;
            }
            else if (type === "langSpecific") {
              this.plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors[languageName][colorKey] = savedColor;
            }
            (async () => {await this.plugin.saveSettings()})();
        })
        .on('cancel', (instance: Pickr) => {
            instance.hide();
        })
      })
      .addExtraButton((deleteButton) => {
        deleteButton
          .setIcon("trash")
          .setTooltip("Delete color")
          .onClick(async () => {
            if (type === "normal") {
              delete this.plugin.settings.SelectedTheme.colors.light.codeblock.alternateHighlightColors[name];
              delete this.plugin.settings.SelectedTheme.colors.dark.codeblock.alternateHighlightColors[name];
              this.updateColorContainer(colorContainer); // Update the color container after deleting a color
            } else if (type === "langSpecific") {
              delete this.plugin.settings.SelectedTheme.colors.light.languageSpecificColors[languageName][colorKey];
              delete this.plugin.settings.SelectedTheme.colors.dark.languageSpecificColors[languageName][colorKey];
              this.updateLanguageSpecificColorContainer(colorContainer, languageName);
            }
            await this.plugin.saveSettings();
            new Notice(`Removed color "${name}".`);
          });
      });

    return mySetting;
  }// createAlternatePickr

  setAndSavePickrSetting(className: string, savedColor: string): void {
    const currentMode = getCurrentMode();
    if (className === 'codeblock.activeLineColor') {
      this.plugin.settings.SelectedTheme.colors[currentMode].codeblock.activeLineColor = savedColor;
    } else if (className === 'editorActiveLineColor') {
      this.plugin.settings.SelectedTheme.colors[currentMode].editorActiveLineColor = savedColor;
    } else if (className === 'codeblock.backgroundColor') {
      this.plugin.settings.SelectedTheme.colors[currentMode].codeblock.backgroundColor = savedColor;
    } else if (className === 'codeblock.highlightColor') {
      this.plugin.settings.SelectedTheme.colors[currentMode].codeblock.highlightColor = savedColor;
    } else if (className === 'codeblock.bracketHighlightColorMatch') {
      this.plugin.settings.SelectedTheme.colors[currentMode].codeblock.bracketHighlightColorMatch = savedColor;
    } else if (className === 'codeblock.bracketHighlightColorNoMatch') {
      this.plugin.settings.SelectedTheme.colors[currentMode].codeblock.bracketHighlightColorNoMatch = savedColor;
    } else if (className === 'codeblock.bracketHighlightBackgroundColorMatch') {
      this.plugin.settings.SelectedTheme.colors[currentMode].codeblock.bracketHighlightBackgroundColorMatch = savedColor;
    } else if (className === 'codeblock.bracketHighlightBackgroundColorNoMatch') {
      this.plugin.settings.SelectedTheme.colors[currentMode].codeblock.bracketHighlightBackgroundColorNoMatch = savedColor;
    } else if (className === 'codeblock.selectionMatchHighlightColor') {
      this.plugin.settings.SelectedTheme.colors[currentMode].codeblock.selectionMatchHighlightColor = savedColor;
    } else if (className === 'header.backgroundColor') {
      this.plugin.settings.SelectedTheme.colors[currentMode].header.backgroundColor = savedColor;
    } else if (className === 'header.textColor') {
      this.plugin.settings.SelectedTheme.colors[currentMode].header.textColor = savedColor;
    } else if (className === 'header.lineColor') {
      this.plugin.settings.SelectedTheme.colors[currentMode].header.lineColor = savedColor;
    } else if (className === 'gutter.textColor') {
      this.plugin.settings.SelectedTheme.colors[currentMode].gutter.textColor = savedColor;
    } else if (className === 'gutter.backgroundColor') {
      this.plugin.settings.SelectedTheme.colors[currentMode].gutter.backgroundColor = savedColor;
    } else if (className === 'header.codeBlockLangTextColor') {
      this.plugin.settings.SelectedTheme.colors[currentMode].header.codeBlockLangTextColor = savedColor;
    } else if (className === 'header.codeBlockLangBackgroundColor') {
      this.plugin.settings.SelectedTheme.colors[currentMode].header.codeBlockLangBackgroundColor = savedColor;
    } else if (className === 'gutter.activeLineNrColor') {
      this.plugin.settings.SelectedTheme.colors[currentMode].gutter.activeLineNrColor = savedColor;
    } else if (className === 'inlineCode.backgroundColor') {
      this.plugin.settings.SelectedTheme.colors[currentMode].inlineCode.backgroundColor = savedColor;
    } else if (className === 'inlineCode.textColor') {
      this.plugin.settings.SelectedTheme.colors[currentMode].inlineCode.textColor = savedColor;
    }
    this.plugin.saveSettings();
  }// setAndSavePickrSetting
  
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
    a.innerHTML = `<img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=ThePirateKing&button_colour=e3e7ef&font_colour=262626&font_family=Inter&outline_colour=262626&coffee_colour=ff0000" height="42px">`;
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