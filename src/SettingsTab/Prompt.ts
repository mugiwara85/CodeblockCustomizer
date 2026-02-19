import { DropdownComponent, ExtraButtonComponent, Notice, Setting, TextComponent, ToggleComponent } from "obsidian";

import CodeBlockCustomizerPlugin from "src/main";
import { createDetailsGroup, SettingsPage, SettingsPageData } from "./Common";
import { DEFAULT_PROMPT_COLOR, defaultPrompts, promptClassDisplayNames, PromptDefinition, PromptEnvironment } from "src/PromptManager";
import { addClassesToPrompt, collectAllPromptClasses, getPromptDefinition, getPromptType, replacePromptTemplate } from "src/PromptUtils";
import { getCurrentMode } from "src/Utils";
import { addPickerControlsToSetting } from "./ColorUtils";

import Pickr from "@simonwep/pickr";

export class PromptSettings {
  promptDetailsOpen: { [key: string]: boolean } = {};
  promptSettingsDetailsOpen: boolean = false;
  promptColorsDetailsOpen: boolean = false;
  promptPickers: Map<string, Pickr> = new Map();

  constructor(private plugin: CodeBlockCustomizerPlugin, private containerEl: HTMLElement, private pickerInstances: Pickr[], private getSearchQuery: () => string) { }

  public display(): void {
    const sectionData = SettingsPageData[SettingsPage.Prompts];
    const promptsDiv = this.containerEl.createDiv({ cls: `${sectionData.hideClass} ${sectionData.class} cb-settings-section` });
    promptsDiv.toggleClass(sectionData.hideClass, this.plugin.settings.settingsType !== SettingsPage.Prompts);
    promptsDiv.createEl('h3', { text: sectionData.displayName });

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
          this.createPromptSettings(promptEditorContainer, selectedPromptId, this.pickerInstances);
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
          this.createPromptSettings(promptEditorContainer, selectedPromptId, this.pickerInstances);
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
          this.createPromptSettings(promptEditorContainer, selectedPromptId, this.pickerInstances);
          this.plugin.renderReadingViews();
        });
      });

    const promptEditorContainer = promptsDiv.createDiv({ cls: 'codeblock-customizer-prompt-editor-container' });
    this.createPromptSettings(promptEditorContainer, selectedPromptId, this.pickerInstances);

    //return promptsDiv;
  }// display

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

  createPromptSettings(promptEditorContainer: HTMLElement, selectedPromptId: string, pickerInstances: Pickr[]) {
    promptEditorContainer.empty();

    const { def: currentPromptData } = getPromptDefinition(selectedPromptId, this.plugin.settings);

    // prompt preview
    const previewWrapper = promptEditorContainer.createDiv({ cls: 'codeblock-customizer-prompt-preview-wrapper cbc-hide-on-search' });
    previewWrapper.createDiv({ text: 'Prompt preview' });
    const previewEl = previewWrapper.createDiv({ cls: 'codeblock-customizer-prompt-preview' });

    const promptSettingsDetails = createDetailsGroup(promptEditorContainer, 'Prompt Settings', 'promptSettingsDetailsOpen', this, this.getSearchQuery, 'codeblock-customizer-prompt-settings-group');

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
            this.createPromptColorSettings(promptColorSettingsContainer, selectedPromptId, previewEl, pickerInstances);
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
            this.createPromptColorSettings(promptColorSettingsContainer, selectedPromptId, previewEl, pickerInstances);
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
            autoUseLanguagesSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !isEnabling);
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

    autoUseLanguagesSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !(currentPromptData.autoUsePrompt ?? false));

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
            autoParseLanguagesSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !isEnabling);
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
            autoParseLanguagesSetting.settingEl.addClass('codeblock-customizer-setting-hidden');
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

    autoParseLanguagesSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !(currentPromptData.autoParsePrompt ?? false));

    const colorsSettingsDetails = createDetailsGroup(promptEditorContainer, 'Prompt Colors', 'promptColorsDetailsOpen', this, this.getSearchQuery, 'codeblock-customizer-prompt-colors-settings-group');

    const promptColorSettingsContainer = colorsSettingsDetails.createDiv();

    this.createPromptColorSettings(promptColorSettingsContainer, selectedPromptId, previewEl, this.pickerInstances);
  }// createPromptSettings

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

    const normalPreview = addClassesToPrompt(promptParts, isCustom ? promptData.name : promptText, def, this.plugin.settings);
    normalPreview.classList.add("normal-preview");

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

  createPromptColorSettings(promptColorSettingsContainer: HTMLElement, selectedPromptId: string, previewEl: HTMLElement, pickerInstances: Pickr[], showRootColor = false) {
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

      const pickr = addPickerControlsToSetting(setting, {
        containerEl: promptColorSettingsContainer,
        initialColor: currentColor,
        onSave: (savedColor: string) => {
          this.setPromptColorDiff(selectedPromptId, partClass, savedColor, editingRootColors);
          this.plugin.saveSettings();
        },
        onReset: isDefaultPrompt ? () => {
          return this.getDefaultPromptColor(selectedPromptId, partClass, editingRootColors);
        } : undefined,
      }, pickerInstances, this.plugin);

      this.promptPickers.set(partClass, pickr);
    }
  }// createPromptColorSettings

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
}// PromptSettings
