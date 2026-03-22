import { DropdownComponent, Notice, Setting, TextComponent } from "obsidian";

import { getCurrentMode } from "../Utils";
import { SyntaxTheme } from "../Settings";
import { DEFAULT_SYNTAX_THEMES, SYNTAX_TOKEN_GROUPS, SYNTAX_TOKEN_DISPLAY_NAMES } from "../SyntaxThemeDefaults";
import { createDetailsGroup } from "./Common";
import { addPickerControlsToSetting } from "./ColorUtils";
import CodeBlockCustomizerPlugin from "../main";

import Pickr from "@simonwep/pickr";

export class SyntaxThemeSettingsUI {
  syntaxThemesOpen = false;
  syntaxLangOverridesOpen = false;
  coreTokensOpen = true;
  markupTokensOpen = false;
  stylesheetTokensOpen = false;
  diffTokensOpen = false;
  otherTokensOpen = false;

  private tokenEditorContainer: HTMLElement | null = null;
  private globalDropdown: DropdownComponent | null = null;
  private restoreButton: { setDisabled: (disabled: boolean) => void } | null = null;
  private deleteButton: { setDisabled: (disabled: boolean) => void } | null = null;

  constructor(private plugin: CodeBlockCustomizerPlugin, private containerEl: HTMLElement, private pickerInstances: Pickr[], private getSearchQuery: () => string) { }

  public display(parentEl: HTMLElement): void {
    const syntaxDetails = createDetailsGroup(parentEl, 'Syntax Themes', 'syntaxThemesOpen', this, this.getSearchQuery);
    const noteEl = syntaxDetails.createDiv({ cls: 'setting-item-description codeblock-customizer-syntax-theme-note' });
    noteEl.style.marginBottom = '12px';
    noteEl.style.padding = '8px';
    noteEl.style.borderRadius = '4px';
    noteEl.style.color = 'var(--text-error)';
    noteEl.setText('Note: Syntax themes apply to reading mode only. To also apply it for editor mode, enable the "Use PrismJS syntax highlighting in editor mode" setting above.');
    noteEl.toggleClass('codeblock-customizer-setting-hidden', this.plugin.settings.pluginSettings.codeblock.usePrismHighlight);

    this.addSyntaxThemeDropdown(syntaxDetails);
    this.addNewSyntaxThemeSection(syntaxDetails);
    this.addPerLanguageOverride(syntaxDetails);

    this.tokenEditorContainer = syntaxDetails.createDiv();
    this.rebuildTokenEditor();
  }

  private refreshDropdown(): void {
    if (!this.globalDropdown) {
      return;
    }

    this.globalDropdown.selectEl.empty();
    this.globalDropdown.addOption('', '(None)');
    for (const name of Object.keys(this.plugin.settings.SyntaxThemes)) {
      this.globalDropdown.addOption(name, name);
    }
    this.globalDropdown.setValue(this.plugin.settings.pluginSettings.syntaxThemes.globalSyntaxTheme);

    const themeName = this.plugin.settings.SyntaxThemeName;
    if (this.restoreButton) {
      this.restoreButton.setDisabled(!themeName || !(themeName in DEFAULT_SYNTAX_THEMES));
    }
    if (this.deleteButton) {
      this.deleteButton.setDisabled(!themeName || themeName in DEFAULT_SYNTAX_THEMES);
    }
  }// refreshDropdown

  private destroySyntaxPickrs(): void {
    for (let i = this.pickerInstances.length - 1; i >= 0; i--) {
      const pickr = this.pickerInstances[i];
      if (pickr && this.tokenEditorContainer?.contains((pickr.getRoot() as any).button)) {
        pickr.destroy();
        this.pickerInstances.splice(i, 1);
      }
    }
  }// destroySyntaxPickrs

  private rebuildTokenEditor(): void {
    if (!this.tokenEditorContainer) {
      return;
    }

    this.destroySyntaxPickrs();
    this.tokenEditorContainer.empty();
    this.addTokenColorPickers(this.tokenEditorContainer);
  }// rebuildTokenEditor

  private addSyntaxThemeDropdown(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Global syntax theme')
      .setDesc('Select a syntax theme to apply to all code blocks.')
      .addDropdown((dropdownObj) => {
        dropdownObj.addOption('', '(None)');
        for (const name of Object.keys(this.plugin.settings.SyntaxThemes)) {
          dropdownObj.addOption(name, name);
        }
        dropdownObj.setValue(this.plugin.settings.pluginSettings.syntaxThemes.globalSyntaxTheme);
        dropdownObj.onChange(async (value) => {
          this.plugin.settings.pluginSettings.syntaxThemes.globalSyntaxTheme = value;
          this.plugin.settings.SyntaxThemeName = value;
          await this.plugin.saveSettings();
          this.rebuildTokenEditor();
        });
        this.globalDropdown = dropdownObj;
      })
      .addExtraButton(button => {
        button.setTooltip("Update syntax theme with current token colors");
        button.setIcon('save');
        button.onClick(async () => {
          const themeName = this.plugin.settings.SyntaxThemeName;
          if (!themeName) {
            new Notice('Select a syntax theme first.');
            return;
          }
          if (!this.plugin.settings.SyntaxThemes[themeName]) {
            new Notice('Syntax theme not found.');
            return;
          }
          new Notice(`Syntax theme "${themeName}" updated.`);
          await this.plugin.saveSettings();
        });
      })
      .addExtraButton(button => {
        button.setTooltip("Restore default syntax theme");
        button.setIcon('reset');
        button.onClick(async () => {
          const themeName = this.plugin.settings.SyntaxThemeName;
          if (themeName && themeName in DEFAULT_SYNTAX_THEMES) {
            this.plugin.settings.SyntaxThemes[themeName] = structuredClone(DEFAULT_SYNTAX_THEMES[themeName]);
            new Notice(`Syntax theme "${themeName}" restored to defaults.`);
            await this.plugin.saveSettings();
            this.rebuildTokenEditor();
          }
        });
        button.setDisabled(!this.plugin.settings.SyntaxThemeName || !(this.plugin.settings.SyntaxThemeName in DEFAULT_SYNTAX_THEMES));
        this.restoreButton = button;
      })
      .addExtraButton(button => {
        button.setTooltip("Delete syntax theme");
        button.setIcon('trash');
        button.onClick(async () => {
          const themeName = this.plugin.settings.SyntaxThemeName;
          if (!themeName) {
            new Notice('Select a syntax theme first.');
          } else if (themeName in DEFAULT_SYNTAX_THEMES) {
            new Notice('You cannot delete built-in syntax themes.');
          } else {
            delete this.plugin.settings.SyntaxThemes[themeName];

            if (this.plugin.settings.pluginSettings.syntaxThemes.globalSyntaxTheme === themeName) {
              this.plugin.settings.pluginSettings.syntaxThemes.globalSyntaxTheme = '';
            }

            for (const [lang, name] of Object.entries(this.plugin.settings.pluginSettings.syntaxThemes.languageSpecificSyntaxThemes)) {
              if (name === themeName) {
                delete this.plugin.settings.pluginSettings.syntaxThemes.languageSpecificSyntaxThemes[lang];
              }
            }

            this.plugin.settings.SyntaxThemeName = '';
            new Notice(`Syntax theme "${themeName}" deleted.`);
            await this.plugin.saveSettings();
            this.refreshDropdown();
            this.rebuildTokenEditor();
          }
        });
        button.setDisabled(!this.plugin.settings.SyntaxThemeName || this.plugin.settings.SyntaxThemeName in DEFAULT_SYNTAX_THEMES);
        this.deleteButton = button;
      });
  }// addSyntaxThemeDropdown

  private addNewSyntaxThemeSection(containerEl: HTMLElement): void {
    let text: TextComponent;
    this.plugin.settings.newSyntaxThemeName = "";

    new Setting(containerEl)
      .setName('Create syntax theme')
      .setDesc('Create a new syntax theme. The currently viewed syntax theme\'s colors will be copied as a starting point.')
      .addText(input => {
        text = input;
        text.setPlaceholder('Name for your syntax theme')
          .setValue(this.plugin.settings.newSyntaxThemeName)
          .onChange((value) => {
            this.plugin.settings.newSyntaxThemeName = value;
          });
      })
      .addExtraButton(button => {
        button.setTooltip("Save syntax theme");
        button.setIcon('plus');
        button.onClick(async () => {
          const name = this.plugin.settings.newSyntaxThemeName.trim();
          if (!name) {
            new Notice('Set a name for your syntax theme!');
            return;
          }

          if (name in DEFAULT_SYNTAX_THEMES) {
            new Notice("You can't overwrite built-in syntax themes.");
            return;
          }

          const currentThemeName = this.plugin.settings.SyntaxThemeName;
          let baseTheme: SyntaxTheme;
          if (currentThemeName && this.plugin.settings.SyntaxThemes[currentThemeName]) {
            baseTheme = structuredClone(this.plugin.settings.SyntaxThemes[currentThemeName]);
          } else {
            baseTheme = { colors: { dark: {}, light: {} } };
          }

          if (name in this.plugin.settings.SyntaxThemes) {
            this.plugin.settings.SyntaxThemes[name] = baseTheme;
            new Notice(`Syntax theme "${name}" updated.`);
          } else {
            this.plugin.settings.SyntaxThemes[name] = baseTheme;
            new Notice(`Syntax theme "${name}" saved.`);
          }

          this.plugin.settings.SyntaxThemeName = name;
          this.plugin.settings.pluginSettings.syntaxThemes.globalSyntaxTheme = name;
          this.plugin.settings.newSyntaxThemeName = "";
          text.setValue("");
          await this.plugin.saveSettings();
          this.refreshDropdown();
          this.rebuildTokenEditor();
        });
      });
  }// addNewSyntaxThemeSection

  private addPerLanguageOverride(containerEl: HTMLElement): void {
    const langDetails = createDetailsGroup(containerEl, 'Per-Language Overrides', 'syntaxLangOverridesOpen', this, this.getSearchQuery);
    const langDesc = langDetails.createDiv({ cls: 'setting-item-description' });
    langDesc.style.marginBottom = '8px';
    langDesc.setText('Assign a different syntax theme for specific languages. These override the global syntax theme.');

    let langInput: TextComponent;
    new Setting(langDetails)
      .setName('Add language override')
      .setDesc('Enter a language name to assign a specific syntax theme.')
      .addText(input => {
        langInput = input;
        input.setPlaceholder('e.g. python');
      })
      .addExtraButton(button => {
        button.setIcon('plus');
        button.setTooltip('Add language override');
        button.onClick(async () => {
          const lang = langInput.getValue().trim().toLowerCase();
          if (!lang) {
            new Notice('Enter a language name.');
            return;
          }

          if (lang in this.plugin.settings.pluginSettings.syntaxThemes.languageSpecificSyntaxThemes) {
            new Notice(`Language "${lang}" already has a syntax theme assigned. Remove it first to change.`);
            return;
          }

          const firstTheme = Object.keys(this.plugin.settings.SyntaxThemes)[0] || '';
          this.plugin.settings.pluginSettings.syntaxThemes.languageSpecificSyntaxThemes[lang] = firstTheme;
          await this.plugin.saveSettings();
          langInput.setValue('');
          this.addLanguageSyntaxAssociator(assignmentsContainer);
        });
      });

    const assignmentsContainer = langDetails.createDiv();
    this.addLanguageSyntaxAssociator(assignmentsContainer);
  }// addPerLanguageOverride

  private addLanguageSyntaxAssociator(container: HTMLElement): void {
    container.empty();
    const assignments = this.plugin.settings.pluginSettings.syntaxThemes.languageSpecificSyntaxThemes;

    for (const [lang, themeName] of Object.entries(assignments)) {
      new Setting(container)
        .setName(lang)
        .addDropdown(dropdown => {
          dropdown.addOption('', '(None)');
          for (const name of Object.keys(this.plugin.settings.SyntaxThemes)) {
            dropdown.addOption(name, name);
          }
          dropdown.setValue(themeName);
          dropdown.onChange(async (value) => {
            this.plugin.settings.pluginSettings.syntaxThemes.languageSpecificSyntaxThemes[lang] = value;
            await this.plugin.saveSettings();
          });
        })
        .addExtraButton(button => {
          button.setIcon('trash');
          button.setTooltip(`Remove override for ${lang}`);
          button.onClick(async () => {
            delete this.plugin.settings.pluginSettings.syntaxThemes.languageSpecificSyntaxThemes[lang];
            await this.plugin.saveSettings();
            this.addLanguageSyntaxAssociator(container);
          });
        });
    }
  }// addLanguageSyntaxAssociator

  private addTokenColorPickers(containerEl: HTMLElement): void {
    const themeName = this.plugin.settings.SyntaxThemeName;
    if (!themeName || !this.plugin.settings.SyntaxThemes[themeName]) {
      return;
    }

    const theme = this.plugin.settings.SyntaxThemes[themeName];
    const currentMode = getCurrentMode();
    const tokenColors = theme.colors[currentMode];

    const editorHeader = containerEl.createDiv({ cls: 'setting-item-description' });
    editorHeader.style.marginTop = '12px';
    editorHeader.style.marginBottom = '4px';
    editorHeader.style.fontWeight = 'bold';
    editorHeader.setText(`Editing: ${themeName}`);

    const groupKeys: Record<string, string> = {
      'Core': 'coreTokensOpen',
      'Markup': 'markupTokensOpen',
      'Stylesheet': 'stylesheetTokensOpen',
      'Diff': 'diffTokensOpen',
      'Other': 'otherTokensOpen',
    };

    for (const [groupName, tokens] of Object.entries(SYNTAX_TOKEN_GROUPS)) {
      const groupKey = groupKeys[groupName];
      const groupDetails = createDetailsGroup(containerEl, `${groupName} Tokens`, groupKey, this, this.getSearchQuery);

      for (const token of tokens) {
        const displayName = SYNTAX_TOKEN_DISPLAY_NAMES[token] || token;
        const currentColor = tokenColors[token];

        const setting = new Setting(groupDetails)
          .setName(displayName);

        if (currentColor) {
          // token has a color defined => show pickr
          addPickerControlsToSetting(setting, {
            containerEl: groupDetails,
            initialColor: currentColor,
            onSave: (savedColor: string) => {
              theme.colors[currentMode][token] = savedColor;
              this.plugin.saveSettings();
            },
            onReset: () => {
              if (themeName in DEFAULT_SYNTAX_THEMES) {
                const defaultColor = DEFAULT_SYNTAX_THEMES[themeName].colors[currentMode][token];
                return defaultColor || '#888888';
              }
              return '#888888';
            },
            onDelete: () => {
              delete theme.colors.light[token];
              delete theme.colors.dark[token];
              this.plugin.saveSettings();
              this.rebuildTokenEditor();
            },
          }, this.pickerInstances, this.plugin);
        } else {
          // token not defined => just show an "Add" button
          setting.addExtraButton(button => {
            button.setIcon('plus');
            button.setTooltip(`Add color for ${displayName}`);
            button.onClick(async () => {
              const defaultColor = '#888888';
              theme.colors[currentMode][token] = defaultColor;
              await this.plugin.saveSettings();
              this.rebuildTokenEditor();
            });
          });
        }
      }
    }
  }// addTokenColorPickers
}// SyntaxThemeSettingsUI
