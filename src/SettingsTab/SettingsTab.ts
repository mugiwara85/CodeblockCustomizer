import { Notice, PluginSettingTab, Setting, DropdownComponent, App, TextComponent, ExtraButtonComponent } from "obsidian";

import { updateSettingStyles } from "../Utils";
import { DEFAULT_SETTINGS, CodeblockCustomizerSettings, DEFAULT_THEMES } from '../Settings';
import CodeBlockCustomizerPlugin from "../main";
import { GeneralSettings } from "./General";
import { AppearanceSettings } from "./Appearance";
import { HighlightingSettings } from "./Highlighting";
import { BehaviorSettings } from "./Behavior";
import { PromptSettings } from "./Prompt";
import { SettingsPage, SettingsPageData } from "./Common";
import { PluginCompatibilitySettings } from "./PluginCompatibility";

import Pickr from "@simonwep/pickr";

export class SettingsTab extends PluginSettingTab {
  plugin: CodeBlockCustomizerPlugin;
  pickerInstances: Pickr[];
  searchQuery: string = "";
  generalSettings: GeneralSettings;
  appearanceSettings: AppearanceSettings;
  highlightingSettings: HighlightingSettings;
  behaviorSettings: BehaviorSettings;
  promptSettings: PromptSettings;
  compatibilitySettings: PluginCompatibilitySettings;

  constructor(app: App, plugin: CodeBlockCustomizerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.pickerInstances = [];
    this.generalSettings = new GeneralSettings(this.plugin, this.containerEl, () => this.searchQuery, () => this.display());
    this.appearanceSettings = new AppearanceSettings(this.plugin, this.containerEl, this.pickerInstances, () => this.searchQuery);
    this.highlightingSettings = new HighlightingSettings(this.plugin, this.containerEl, this.pickerInstances, () => this.searchQuery);
    this.behaviorSettings = new BehaviorSettings(this.plugin, this.containerEl, this.pickerInstances, () => this.searchQuery);
    this.promptSettings = new PromptSettings(this.plugin, this.containerEl, this.pickerInstances, () => this.searchQuery);
    this.compatibilitySettings = new PluginCompatibilitySettings(this.plugin, this.containerEl, () => this.searchQuery);
  }

  display(): void {
    this.pickerInstances.forEach(p => { if (p) p.destroy(); });
    this.pickerInstances.length = 0;

    const { containerEl } = this;
    containerEl.empty();
    containerEl.classList.add(`codeblock-customizer-settingspage`);
    containerEl.createEl('h3', { text: 'Codeblock Customizer Settings' });

    this.createFirstRowElements(containerEl);

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
          (async () => { await this.plugin.saveSettings() })();
        });// onChange
        dropdown = dropdownObj;
      })// addDropdown
      .addExtraButton(button => {
        button.setTooltip("Update theme");
        button.setIcon('save');
        button.onClick(() => {
          this.plugin.settings.Themes[this.plugin.settings.ThemeName] = structuredClone(this.plugin.settings.SelectedTheme);
          new Notice(`Theme "${this.plugin.settings.ThemeName}" updated successfully!`);
          (async () => { await this.plugin.saveSettings() })();
        });
      })// addExtraButton
      .addExtraButton(button => {
        button.setTooltip("Restore default theme to its original state");
        button.setIcon('reset');
        button.onClick(() => {
          this.generalSettings.restoreThemes(this.plugin.settings.ThemeName, false);
          this.display();
          (async () => { await this.plugin.saveSettings() })();
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
            (async () => { await this.plugin.saveSettings() })();
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
            (async () => { await this.plugin.saveSettings() })();
            this.display();
          }
        });
      });

    new Setting(containerEl)
      .setName('Select settings page')
      .setDesc('Select which settings group you want to modify.')
      .addDropdown((dropdown) => dropdown
        .addOptions(Object.values(SettingsPage).reduce((acc, section) => {
          acc[section] = SettingsPageData[section].displayName;
          return acc;
        }, {} as Record<string, string>))
        .setValue(this.plugin.settings.settingsType)
        .onChange((value) => {
          this.plugin.settings.settingsType = value;
          this.searchQuery = "";
          this.searchSettings("");
          (async () => { await this.plugin.saveSettings() })();
        })
      );

    containerEl.createEl("hr");
    containerEl.createDiv({ cls: "codeblock-customizer-no-results", text: "No matching settings found." });

    this.generalSettings.display();
    this.appearanceSettings.display();
    this.highlightingSettings.display();
    this.behaviorSettings.display();
    this.promptSettings.display();
    this.compatibilitySettings.display();
  }// display

  createFirstRowElements(containerEl: HTMLElement): void {
    const firstRow = containerEl.createDiv({ cls: "cbc-settings-firstrow-container" });
    const searchDiv = firstRow.createDiv({ cls: "cbc-settings-firstrow-search" });
    const buttonsDiv = firstRow.createDiv({ cls: "cbc-settings-firstrow-buttons" });
    
    // search bar
    new Setting(searchDiv)
      .addSearch((search) => {
        search.setPlaceholder("Search settings...");
        search.setValue(this.searchQuery);
        search.onChange((value) => {
          this.searchQuery = value;
          this.searchSettings(value);
        });
      });

    // readme link
    const readmeLink = buttonsDiv.createEl("a", {
      text: "README",
      href: "https://github.com/mugiwara85/CodeblockCustomizer",
      cls: "codeblock-customizer-readme-link"
    });
    readmeLink.title = "For more information, please read the README!";

    // donate button
    buttonsDiv.appendChild(
      this.createDonateButton("https://www.buymeacoffee.com/ThePirateKing")
    );
    buttonsDiv.title = "If you like this plugin, and would like to help support continued development, use this button!";
  }// createAttributesHeader

  searchSettings(query: string) {
    const searchText = query.toLowerCase();
    const settingsCategories = this.containerEl.querySelectorAll(".cb-settings-section");

    if (!searchText) {
      this.display();
      return;
    }

    const hideOnSearchElements = this.containerEl.querySelectorAll(".cbc-hide-on-search"); // for now only for hiding prompt preview
    hideOnSearchElements.forEach(el => (el as HTMLElement).style.display = "none");

    let anyCategoryVisible = false;
    settingsCategories.forEach(div => {
      Object.values(SettingsPage).forEach(section => {
        (div as HTMLElement).classList.remove(SettingsPageData[section].hideClass);
      });
      (div as HTMLElement).style.display = "";

      // make header clickable
      const header = div.querySelector("h3");
      if (header) {
        header.style.cursor = "pointer";
        header.title = "Click to open this settings page";
        header.onclick = () => {
          let targetType: SettingsPage = SettingsPage.General;
          for (const section of Object.values(SettingsPage)) {
            if (div.classList.contains(SettingsPageData[section].class)) {
              targetType = section;
              break;
            }
          }

          this.plugin.settings.settingsType = targetType;
          this.searchQuery = "";
          this.searchSettings("");

          const dropdown = this.containerEl.querySelector('.dropdown') as HTMLSelectElement;
          if (dropdown) {
            dropdown.value = targetType;
          }

          (async () => { await this.plugin.saveSettings() })();
          this.display();
        };
      }

      let hasVisibleItems = false;

      const changeVisibility = (setting: Element, matches: boolean) => {
        const settingEl = setting as HTMLElement;
        const isHidden = settingEl.classList.contains('codeblock-customizer-setting-hidden');
        const isRevealed = settingEl.classList.contains('codeblock-customizer-setting-revealed');
        const isElementHidden = isHidden || isRevealed;

        if (matches) {
          settingEl.style.display = "";
          // if the setting was hidden, show it as disabled
          if (isElementHidden) {
            if (isHidden) {
              settingEl.classList.remove('codeblock-customizer-setting-hidden');
              settingEl.classList.add('codeblock-customizer-setting-revealed');
            }

            settingEl.classList.add('is-disabled');
            // disable all interactive settings elements
            settingEl.querySelectorAll('input, select, button, textarea').forEach(input => {
              input.setAttribute('disabled', 'true');
            });
          } else {
            // ensure setting elements are not disabled if they weren't originally hidden
            settingEl.classList.remove('is-disabled');
            settingEl.querySelectorAll('input, select, button, textarea').forEach(input => {
              input.removeAttribute('disabled');
            });
          }
        } else {
          settingEl.style.display = "none";
        }
      };// changeVisibility

      // top level search (not in details)
      const directSettings = Array.from(div.children).filter(child => child.classList.contains("setting-item"));
      directSettings.forEach(setting => {
        const name = setting.querySelector(".setting-item-name")?.textContent?.toLowerCase() || "";
        const desc = setting.querySelector(".setting-item-description")?.textContent?.toLowerCase() || "";

        // check dropdown options
        let optionsMatch = false;
        const dropdown = setting.querySelector("select");
        if (dropdown) {
          const options = Array.from(dropdown.options).map(opt => opt.text.toLowerCase());
          optionsMatch = options.some(optText => optText.includes(searchText));
        }

        const matches = name.includes(searchText) || desc.includes(searchText) || optionsMatch;
        changeVisibility(setting, matches);
        if (matches) {
          hasVisibleItems = true;
        }
      });

      // search details
      const detailsSections = div.querySelectorAll("details");
      detailsSections.forEach(details => {
        let detailsHasMatch = false;

        const summaryText = details.querySelector("summary")?.textContent?.toLowerCase() || "";
        const summaryMatches = summaryText.includes(searchText);

        const items = details.querySelectorAll(".setting-item");
        items.forEach(setting => {
          const name = setting.querySelector(".setting-item-name")?.textContent?.toLowerCase() || "";
          const desc = setting.querySelector(".setting-item-description")?.textContent?.toLowerCase() || "";

          // check dropdown options
          let optionsMatch = false;
          const dropdown = setting.querySelector("select");
          if (dropdown) {
            const options = Array.from(dropdown.options).map(opt => opt.text.toLowerCase());
            optionsMatch = options.some(optText => optText.includes(searchText));
          }

          const matches = name.includes(searchText) || desc.includes(searchText) || optionsMatch || summaryMatches;
          changeVisibility(setting, matches);
          if (matches) {
            detailsHasMatch = true;
          }
        });

        if (detailsHasMatch) {
          (details as HTMLElement).style.display = "";
          (details as HTMLDetailsElement).open = true;
          hasVisibleItems = true;
        } else {
          (details as HTMLElement).style.display = "none";
        }
      });

      // hide category if nothing visible
      if (!hasVisibleItems) {
        (div as HTMLElement).style.display = "none";
      } else {
        anyCategoryVisible = true;
      }
    });

    const noResultsDiv = this.containerEl.querySelector(".codeblock-customizer-no-results");
    if (noResultsDiv) {
      if (!anyCategoryVisible) {
        (noResultsDiv as HTMLElement).classList.add("show");
      } else {
        (noResultsDiv as HTMLElement).classList.remove("show");
      }
    }
  }// searchSettings

  refreshDropdown(dropdown: DropdownComponent, settings: CodeblockCustomizerSettings) {
    dropdown.selectEl.empty();
    Object.keys(settings.Themes).forEach((name: string) => {
      dropdown.addOption(name, name);
    })
    dropdown.setValue(settings.ThemeName);
  }// refreshDropdown

  applyTheme() {
    updateSettingStyles(this.plugin.settings, this.app);
    this.plugin.saveSettings();
  }// applyTheme

  hide(): void {
    this.searchQuery = "";
    this.pickerInstances.forEach(p => {
      if (p) {
        p.destroy();
      }
    });

    this.pickerInstances.length = 0;
    super.hide();
  }// hide

  createDonateButton = (link: string): HTMLElement => {
    const a = createEl("a");
    a.setAttribute("href", link);
    a.addClass("buymeacoffee-ThePirateKing-img");
    a.innerHTML = `<img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=🥤&slug=ThePirateKing&button_colour=5F7FFF&font_colour=ffffff&font_family=Inter&outline_colour=000000&coffee_colour=FFDD00" height="40px" />`;
    return a;
  };// createDonateButton
}// SettingsTab
