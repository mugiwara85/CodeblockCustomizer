import { Notice, PluginSettingTab, Setting, DropdownComponent, App, TextComponent, ToggleComponent } from "obsidian";
import Pickr from "@simonwep/pickr";

import { getColorOfCssVariable, getCurrentMode, updateSettingStyles } from "./Utils";
import { DEFAULT_SETTINGS, CodeblockCustomizerSettings, Colors, Theme } from './Settings';
import CodeBlockCustomizerPlugin from "./main";

export class SettingsTab extends PluginSettingTab {
  plugin: CodeBlockCustomizerPlugin;
  pickerInstances: Pickr[];
  headerLangToggles: Setting[];
  headerLangIconToggles: Setting[];

  constructor(app: App, plugin: CodeBlockCustomizerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.pickerInstances = [];
    this.headerLangToggles = [];
    this.headerLangIconToggles = [];
  }

  display(): void {
    const {containerEl} = this;
    containerEl.empty();
    containerEl.createEl('h3', {text: 'Codeblock Customizer Settings'});
    
    let dropdown: DropdownComponent;
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
          if (this.plugin.settings.ThemeName in DEFAULT_SETTINGS.Themes) {
            new Notice('You cannot update the default themes');
          }	else {
            this.plugin.settings.Themes[this.plugin.settings.ThemeName] = structuredClone(this.plugin.settings.SelectedTheme);
            new Notice(`Theme "${this.plugin.settings.ThemeName}" updated successfully!`);
            (async () => {await this.plugin.saveSettings()})();
          }
        });
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
          this.plugin.settings.newThemeName = "";
          text.setValue("");
          (async () => {await this.plugin.saveSettings()})();
        }
      });
    });

    new Setting(containerEl)
      .setName('Enable editor active line highlight')
      .setDesc('If enabled, you can set the color for the active line (including codeblocks).')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.enableEditorActiveLineHighlight)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.enableEditorActiveLineHighlight = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings);
        })
      );
    
    this.createPickrSetting(containerEl, 'Editor active line color', 
    'To set this color, enable the option "Enable editor active line highlighting" first.', "editorActiveLineColor");		
    
    new Setting(containerEl)
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

    containerEl.createEl('h3', {text: 'Codeblock settings'});
    
    new Setting(containerEl)
      .setName('Enable line numbers')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.enableLineNumbers)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.codeblock.enableLineNumbers = value;
          await this.plugin.saveSettings();          
        })
      );

    new Setting(containerEl)
      .setName('Enable codeblock active line highlight')
      .setDesc('If enabled, you can set the color for the active line inside codeblocks only.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.enableActiveLineHighlight)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.codeblock.enableActiveLineHighlight = value;          
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings);
        })
      );
        
    this.createPickrSetting(containerEl, 'Codeblock active line color', 
      'To set this color, enable the option "Enable codeblock active line highlight" first.', "codeblock.activeLineColor");
    
    this.createPickrSetting(containerEl, 'Background color', '', "codeblock.backgroundColor");
    this.createPickrSetting(containerEl, 'Highlight color (used by the "hl" parameter)', '', "codeblock.highlightColor");

    new Setting(containerEl)
      .setName('Show delete code button')
      .setDesc('If enabled an additional button will be displayed on every codeblock. If clicked, the content of that codeblock is deleted. Be careful!')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.enableDeleteCodeButton)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.codeblock.enableDeleteCodeButton = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings);
        })
      );

    containerEl.createEl('h4', {text: 'Semi-fold settings'});

    let enableSemiFoldToggle: ToggleComponent;
    let semiFoldLinesDropDown: DropdownComponent;
    let semiFoldShowButton: ToggleComponent;

    const updateDependentSettings = () => {
      const value = enableSemiFoldToggle.getValue();
      semiFoldLinesDropDown.setDisabled(!value);
      semiFoldShowButton.setDisabled(!value);
    };
    
    new Setting(containerEl)
      .setName('Enable semi-fold')
      .setDesc('If enabled folding will use semi-fold method. This means, that the first X lines will be visible only. Select the number of visisble lines. You can also enable an additional uncollapse button. Please refer to the README for more information.')
      .addToggle(toggle => enableSemiFoldToggle = toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.semiFold.enableSemiFold)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.semiFold.enableSemiFold = value;
          await this.plugin.saveSettings();
          updateSettingStyles(this.plugin.settings);
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
          updateSettingStyles(this.plugin.settings);
        })
      );
    console.log(this.plugin.settings.SelectedTheme.settings.semiFold.visibleLines.toString());
    updateDependentSettings();

    containerEl.createEl('h3', {text: 'Codeblock border settings'});

    new Setting(containerEl)
    .setName('Codeblock border styling position')
    .setDesc('Select on which side the border should be displayed.')
    .addDropdown((dropdown) => dropdown
      .addOptions({"disable": "Disable", "left": "Left", "right": "Right"})
      .setValue(this.plugin.settings.SelectedTheme.settings.codeblock.codeBlockBorderStylingPosition)
      .onChange((value) => {
        this.plugin.settings.SelectedTheme.settings.codeblock.codeBlockBorderStylingPosition = value;
        (async () => {await this.plugin.saveSettings()})();
        updateSettingStyles(this.plugin.settings);
      })
    );

    let languageDisplayText: TextComponent;
    new Setting(containerEl)
      .setName("Add languages to set a border color")
      .setDesc('Add a language, to which you want to set a border color. You can set the color itself after adding it to the list.')
      .addText(value => { languageDisplayText = value
        languageDisplayText = value;
        languageDisplayText.setPlaceholder('e.g. cpp, csharp')
        languageDisplayText.onChange(async (languageBorder) => {
          this.plugin.settings.languageBorderColorName = languageBorder;
        });
      })
      .addButton(async (button) => {
        button.setButtonText("Add");
        button.onClick(async () => {
          const colorNameRegex = /^[^\d][\w\d]*$/;
          if (this.plugin.settings.languageBorderColorName.trim() === "") {
            new Notice("Please enter a language name.");
          } else if (!colorNameRegex.test(this.plugin.settings.languageBorderColorName)) { // check if the input matches the regex
            new Notice(`"${this.plugin.settings.languageBorderColorName}" is not a valid language name.`);
          } else {
            if (this.plugin.settings.languageBorderColorName.toLowerCase() in this.plugin.settings.SelectedTheme.colors[getCurrentMode()].codeblock.languageBorderColors) {
              new Notice(`A language with the name "${this.plugin.settings.languageBorderColorName}" already exists.`);
            } else {
              const newColor = this.getRandomColor();
              this.plugin.settings.SelectedTheme.colors.light.codeblock.languageBorderColors[this.plugin.settings.languageBorderColorName] = newColor;
							this.plugin.settings.SelectedTheme.colors.dark.codeblock.languageBorderColors[this.plugin.settings.languageBorderColorName] = newColor;
              await this.plugin.saveSettings();
              new Notice(`Added color "${this.plugin.settings.languageBorderColorName}".`);
              languageDisplayText.setValue("");
              this.plugin.settings.languageBorderColorName = "";
              this.updateLanguageBorderColorContainer(languageContainer); // Update the color container after adding a color
            }
          }
        });
      });

    const languageContainer = containerEl.createEl("div", { cls: "codeblock-customizer-languageBorderColorContainer" });

    // Update the color container on page load
    this.updateLanguageBorderColorContainer(languageContainer);

    containerEl.createEl('h3', {text: 'Alternative highlight colors'});
    
    // Add the color input and button
    let alternateColorDisplayText: TextComponent;
    new Setting(containerEl)
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
      
    const colorContainer = containerEl.createEl("div", { cls: "codeblock-customizer-alternateHLcolorContainer" });

    // Update the color container on page load
    this.updateColorContainer(colorContainer);
    
    containerEl.createEl('h3', {text: 'Header settings'});
    
    this.createPickrSetting(containerEl, 'Header color', '', "header.backgroundColor");
    this.createPickrSetting(containerEl, 'Header text color', '', "header.textColor");
    
    new Setting(containerEl)
      .setName('Header bold text')
      .setDesc('If enabled, the header text will be set to bold.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.header.boldText)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.header.boldText = value;
          await this.plugin.saveSettings();
      })
    );
    
    new Setting(containerEl)
      .setName('Header italic text')
      .setDesc('If enabled, the header text will be set to italic.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.header.italicText)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.header.italicText = value;
          await this.plugin.saveSettings();
      })
    );
    
    this.createPickrSetting(containerEl, 'Header line color', '', "header.lineColor");
    
    new Setting(containerEl)
    .setName('Collapse icon position')
    .setDesc('If enabled a collapse icon will be displayed in the header. Select the position of the collapse icon.')
    .addDropdown((dropdown) => dropdown
      .addOptions({"hide": "Hide", "middle": "Middle", "right": "Right"})
      .setValue(this.plugin.settings.SelectedTheme.settings.header.collapseIconPosition)
      .onChange((value) => {
        this.plugin.settings.SelectedTheme.settings.header.collapseIconPosition = value;
        (async () => {await this.plugin.saveSettings()})();
        updateSettingStyles(this.plugin.settings);
      })
    );

    new Setting(containerEl)
    .setName('Collapsed code text')
    .setDesc('Overwrite the default "Collapsed Code" text in the header, when the file parameter is not defined.')
    .addText(text => text
      .setPlaceholder('Collapsed Code')
      .setValue(this.plugin.settings.SelectedTheme.settings.header.collapsedCodeText)
      .onChange(async (value) => {
        this.plugin.settings.SelectedTheme.settings.header.collapsedCodeText = value;
        await this.plugin.saveSettings();
      })
    );

    containerEl.createEl('h3', {text: 'Header language settings'});
        
    new Setting(containerEl)
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
      })
    );

    this.createPickrSetting(containerEl, 'Codeblock language text color', 'To set this color, enable the option "Display codeblock language" first.', "header.codeBlockLangTextColor");    
    this.createPickrSetting(containerEl, 'Codeblock language background color', 'To set this color, enable the option "Display codeblock language" first.', "header.codeBlockLangBackgroundColor");    
    
    const boldToggle = new Setting(containerEl)
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
    
    const italicToggle = new Setting(containerEl)
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
    
    const alwaysDisplayToggle = new Setting(containerEl)
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
    
    containerEl.createEl('h5', {text: 'Header language icon settings'});
    
    new Setting(containerEl)
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
      })
    );
    
    const alwaysDisplayIconToggle = new Setting(containerEl)
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
    
    containerEl.createEl('h3', {text: 'Gutter settings'});
    
    new Setting(containerEl)
      .setName('Highlight gutter')
      .setDesc('If enabled, highlighted lines will also highlight the gutter (line number), not just the line.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.gutter.enableHighlight)
        .onChange(async (value) => {
          this.plugin.settings.SelectedTheme.settings.gutter.enableHighlight = value;
          await this.plugin.saveSettings();
      })
    );
    
    this.createPickrSetting(containerEl, 'Gutter text color', '', "gutter.textColor");
    this.createPickrSetting(containerEl, 'Gutter background color', '', "gutter.backgroundColor");
    
    new Setting(containerEl)
      .setName('Highlight active line number')
      .setDesc('If enabled, the active line number will be highlighted with a separate color.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.SelectedTheme.settings.gutter.highlightActiveLineNr)
        .onChange((value) => {
          this.plugin.settings.SelectedTheme.settings.gutter.highlightActiveLineNr = value;
          (async () => {await this.plugin.saveSettings()})();
          updateSettingStyles(this.plugin.settings);
        })
      );
    this.createPickrSetting(containerEl, 'Active line number color', 'To set this color enable the option "Hihglight active line number" first.', "gutter.activeLineNrColor");
    
    containerEl.createEl('h3', {text: 'Inline code settings'});

    new Setting(containerEl)
    .setName('Enable inline code styling')
    .setDesc('If enabled, the background color, and the text color of inline code can be styled.')
    .addToggle(toggle => toggle
      .setValue(this.plugin.settings.SelectedTheme.settings.inlineCode.enableInlineCodeStyling)
      .onChange(async (value) => {
        this.plugin.settings.SelectedTheme.settings.inlineCode.enableInlineCodeStyling = value;
        await this.plugin.saveSettings();
      })
    );
    this.createPickrSetting(containerEl, 'Inline code background color', 'To set this color enable the option "Enable inline code styling" first.', "inlineCode.backgroundColor");
    this.createPickrSetting(containerEl, 'Inline code text color', 'To set this color enable the option "Enable inline code styling" first.', "inlineCode.textColor");

    containerEl.createEl('h3', {text: 'Print to PDF settings '});

    new Setting(containerEl)
    .setName('Enable print to PDF')
    .setDesc('If enabled, the styling is applied to documents when printed to PDF. By default PDF printing uses light theme colors.')
    .addToggle(toggle => toggle
      .setValue(this.plugin.settings.SelectedTheme.settings.printing.enablePrintToPDFStyling)
      .onChange(async (value) => {
        this.plugin.settings.SelectedTheme.settings.printing.enablePrintToPDFStyling = value;
        await this.plugin.saveSettings();
      })
    );

    new Setting(containerEl)
    .setName('Force current color mode use')
    .setDesc('If enabled, PDF printing will use the dark theme colors when a dark theme is selected, and light theme colors when a light theme is selected. ')
    .addToggle(toggle => toggle
      .setValue(this.plugin.settings.SelectedTheme.settings.printing.forceCurrentColorUse)
      .onChange(async (value) => {
        this.plugin.settings.SelectedTheme.settings.printing.forceCurrentColorUse = value;
        await this.plugin.saveSettings();
      })
    );

    // donation
    const cDonationDiv = containerEl.createEl("div", { cls: "codeblock-customizer-Donation", });    
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
  
  refreshDropdown(dropdown: DropdownComponent, settings: CodeblockCustomizerSettings) {
    dropdown.selectEl.empty();
    Object.keys(settings.Themes).forEach((name: string) => {
      dropdown.addOption(name, name);
    })
    dropdown.setValue(settings.ThemeName);
	}// refreshDropdown

  getRandomColor() {
    const letters = "0123456789ABCDEF";
    let color = "#";
    for (let i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
  }// getRandomColor
     
  applyTheme() {
    updateSettingStyles(this.plugin.settings);
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
              updateSettingStyles(this.plugin.settings);
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

  createAlternatePickr(containerEl: HTMLElement, colorContainer: HTMLElement, name: string, Color: string, borderLangColors: boolean): Setting {
    let alternatePickr: Pickr;
    const desc = !borderLangColors ? "To higlight lines with this color use the \"" + name + "\" parameter. e.g: " + name + ":2,4-6" : "";

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
            if (!borderLangColors)
              this.plugin.settings.SelectedTheme.colors[getCurrentMode()].codeblock.alternateHighlightColors[name] = savedColor;
            else 
              this.plugin.settings.SelectedTheme.colors[getCurrentMode()].codeblock.languageBorderColors[name] = savedColor;
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
            if (!borderLangColors) {
              delete this.plugin.settings.SelectedTheme.colors.light.codeblock.alternateHighlightColors[name];
              delete this.plugin.settings.SelectedTheme.colors.dark.codeblock.alternateHighlightColors[name];
              this.updateColorContainer(colorContainer); // Update the color container after deleting a color
            } else {
              delete this.plugin.settings.SelectedTheme.colors.light.codeblock.languageBorderColors[name];
              delete this.plugin.settings.SelectedTheme.colors.dark.codeblock.languageBorderColors[name];
              this.updateLanguageBorderColorContainer(colorContainer);
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
      this.createAlternatePickr(colorContainer, colorContainer, colorName, hexValue, false);
    });
  }// updateColorContainer
    
  updateLanguageBorderColorContainer(colorContainer: HTMLElement) {
    colorContainer.empty();

    Object.entries(this.plugin.settings.SelectedTheme.colors[getCurrentMode()].codeblock.languageBorderColors).forEach(([colorName, hexValue]) => {
      this.createAlternatePickr(colorContainer, colorContainer, colorName, hexValue, true);
    });
  }// updateLanguageBorderColorContainer

  createDonateButton = (link: string): HTMLElement => {
    const a = createEl("a");
    a.setAttribute("href", link);
    a.addClass("buymeacoffee-ThePirateKing-img");
    a.innerHTML = `<img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=ThePirateKing&button_colour=e3e7ef&font_colour=262626&font_family=Inter&outline_colour=262626&coffee_colour=ff0000" height="42px">`;
    return a;
  };// createDonateButton
}// SettingsTab