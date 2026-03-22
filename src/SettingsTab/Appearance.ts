import { Notice, Setting, TextComponent } from "obsidian";

import { createDetailsGroup, SettingsPage, SettingsPageData, updateLanguageSpecificColorContainer } from "./Common";
import { getCurrentMode } from "src/Utils";
import { createPickrSetting } from "./ColorUtils";
import { CollapseIconStyle, HiddenLinesStyle, InlineCodeModifierKeys, LineNumberSeparatorStyle } from "src/Settings";
import { DEFAULT_COLLAPSE_TEXT } from "src/Const";
import { ANNOTATION_TYPE_ICONS } from "src/TooltipManager";
import { SyntaxThemeSettingsUI } from "./SyntaxThemes";
import CodeBlockCustomizerPlugin from "src/main";

import Pickr from "@simonwep/pickr";

export class AppearanceSettings {
  debounceTimer: NodeJS.Timeout | null = null;
  syntaxThemeSettings: SyntaxThemeSettingsUI;

  constructor(private plugin: CodeBlockCustomizerPlugin, private containerEl: HTMLElement, private pickerInstances: Pickr[], private getSearchQuery: () => string) {
    this.syntaxThemeSettings = new SyntaxThemeSettingsUI(plugin, containerEl, pickerInstances, getSearchQuery);
  }

  public display(): void {
    const sectionData = SettingsPageData[SettingsPage.Appearance];
    const appearanceDiv = this.containerEl.createDiv({ cls: `${sectionData.hideClass} ${sectionData.class} cb-settings-section` });
    appearanceDiv.toggleClass(sectionData.hideClass, this.plugin.settings.settingsType !== SettingsPage.Appearance);
    appearanceDiv.createEl('h3', { text: sectionData.displayName });

    new Setting(appearanceDiv)
      .setName('Enable editor active line highlight')
      .setDesc('If enabled, you can set the color for the active line (including codeblocks).')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.enableEditorActiveLineHighlight)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.enableEditorActiveLineHighlight = value;
          await this.plugin.saveSettings();
          editorActiveLineSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
        })
      );

    const editorActiveLineSetting = createPickrSetting(appearanceDiv, 'Editor active line color', '', "editorActiveLineColor", this.pickerInstances, this.plugin);
    editorActiveLineSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.enableEditorActiveLineHighlight);

    const prismSetting = new Setting(appearanceDiv)
      .setName('Use PrismJS syntax highlighting in editor mode')
      .setDesc('If enabled, editor mode will use PrismJS for syntax highlighting instead of CodeMirror\'s built-in highlighting. This makes editor mode syntax highlighting match reading mode syntax highlighting.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.usePrismHighlight)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.usePrismHighlight = value;
          await this.plugin.saveSettings();
          const noteEl = appearanceDiv.querySelector('.codeblock-customizer-syntax-theme-note');
          if (noteEl) {
            noteEl.toggleClass('codeblock-customizer-setting-hidden', value);
          }
        })
      );
    const warningEl = prismSetting.descEl.createDiv({ cls: "mod-warning" });
    warningEl.style.color = "var(--text-error)";
    warningEl.style.marginTop = "4px";
    warningEl.style.fontWeight = "bold";
    warningEl.setText("Experimental: This feature is still being tested. Please report any issues you encounter.");

    // syntax themes
    this.syntaxThemeSettings.display(appearanceDiv);

    // code block styling
    const codeBlockDetails = createDetailsGroup(appearanceDiv, 'Code Block Styling', 'codeBlockDetailsOpen', this, this.getSearchQuery);

    new Setting(codeBlockDetails)
      .setName('Enable line numbers')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.enableLineNumbers)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.enableLineNumbers = value;
          await this.plugin.saveSettings();
        })
      );

    createPickrSetting(codeBlockDetails, 'Code block background color', '', "codeblock.backgroundColor", this.pickerInstances, this.plugin);

    new Setting(codeBlockDetails)
      .setName('Show indentation lines in reading view')
      .setDesc('If enabled, indentation lines will be shown in reading view.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.codeblock.showIndentationLines)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.codeblock.showIndentationLines = value;
          await this.plugin.saveSettings();
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

    new Setting(codeBlockDetails)
      .setName('Line number jump separator style')
      .setDesc('Select the style of the separator line shown when line number jumps are used.')
      .addDropdown(dropdown => dropdown
        .addOption(LineNumberSeparatorStyle.Zigzag, 'Zigzag')
        .addOption(LineNumberSeparatorStyle.Dashed, 'Dashed')
        .addOption(LineNumberSeparatorStyle.DoubleLine, 'Double Line')
        .setValue(this.plugin.settings.pluginSettings.codeblock.lineNumberSeparatorStyle)
        .onChange(async (value: LineNumberSeparatorStyle) => {
          this.plugin.settings.pluginSettings.codeblock.lineNumberSeparatorStyle = value;
          await this.plugin.saveSettings();
          //this.plugin.renderReadingViews();
        })
      );

    new Setting(codeBlockDetails)
      .setName('Hidden lines style')
      .setDesc('Select the style of the separator line shown when code lines are hidden.')
      .addDropdown(dropdown => dropdown
        .addOption(HiddenLinesStyle.Zigzag, 'Zigzag')
        .addOption(HiddenLinesStyle.Dashed, 'Dashed')
        .addOption(HiddenLinesStyle.DoubleLine, 'Double Line')
        .setValue(this.plugin.settings.pluginSettings.codeblock.hiddenLinesStyle)
        .onChange(async (value: HiddenLinesStyle) => {
          this.plugin.settings.pluginSettings.codeblock.hiddenLinesStyle = value;
          await this.plugin.saveSettings();
          //this.plugin.renderReadingViews();
        })
      );

    // gutter settings
    codeBlockDetails.createEl('h4', { text: 'Gutter Settings' });

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

    createPickrSetting(codeBlockDetails, 'Gutter text color', '', "gutter.textColor", this.pickerInstances, this.plugin);
    createPickrSetting(codeBlockDetails, 'Gutter background color', '', "gutter.backgroundColor", this.pickerInstances, this.plugin);

    new Setting(codeBlockDetails)
      .setName('Highlight active line number')
      .setDesc('If enabled, the active line number will be highlighted with a separate color.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.gutter.highlightActiveLineNr)
        .onChange((value) => {
          this.plugin.settings.pluginSettings.gutter.highlightActiveLineNr = value;
          (async () => { await this.plugin.saveSettings() })();
          highlightActiveLineNrSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
        })
      );

    const highlightActiveLineNrSetting = createPickrSetting(codeBlockDetails, 'Active line number color', '', "gutter.activeLineNrColor", this.pickerInstances, this.plugin);
    highlightActiveLineNrSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.gutter.highlightActiveLineNr);

    // header settings
    const headerDetails = createDetailsGroup(appearanceDiv, 'Header Settings', 'headerDetailsOpen', this, this.getSearchQuery);

    createPickrSetting(headerDetails, 'Header color', 'Sets the background color of the code block header.', "header.backgroundColor", this.pickerInstances, this.plugin);
    createPickrSetting(headerDetails, 'Header text color', '', "header.textColor", this.pickerInstances, this.plugin);

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

    createPickrSetting(headerDetails, 'Header line color', 'Sets the color of the separator line at the bottom of the header.', "header.lineColor", this.pickerInstances, this.plugin);

    new Setting(headerDetails)
      .setName('Disable folding for code blocks without `fold` or `unfold` specified')
      .setDesc('If enabled, code blocks without `fold` or `unfold` specified will not collapse when clicking the header.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.header.disableFoldUnlessSpecified)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.header.disableFoldUnlessSpecified = value;
          await this.plugin.saveSettings();
          this.plugin.renderReadingViews();
        })
      );

    new Setting(headerDetails)
      .setName('Collapse icon position')
      .setDesc('If enabled a collapse icon will be displayed in the header. Select the position of the collapse icon.')
      .addDropdown((dropdown) => dropdown
        .addOptions({ "hide": "Hide", "middle": "Middle", "right": "Right" })
        .setValue(this.plugin.settings.pluginSettings.header.collapseIconPosition)
        .onChange(async (value: "hide" | "middle" | "right") => {
          this.plugin.settings.pluginSettings.header.collapseIconPosition = value;
          await this.plugin.saveSettings();
          collapseIconStyle.settingEl.toggleClass('codeblock-customizer-setting-hidden', value === 'hide');
        })
      );

    const collapseIconStyle = new Setting(headerDetails)
      .setName('Collapse icon style')
      .setDesc('Select the style of the collapse icon.')
      .addDropdown((dropdown) => dropdown
        .addOptions({
          [CollapseIconStyle.Chevrons]: "Chevrons",
          [CollapseIconStyle.Arrows]: "Arrows",
          [CollapseIconStyle.PlusMinus]: "Plus/Minus",
          [CollapseIconStyle.CirclePlusMinus]: "Circle (+/-)",
          [CollapseIconStyle.SquarePlusMinus]: "Square (+/-)"
        })
        .setValue(this.plugin.settings.pluginSettings.header.collapseIconStyle)
        .onChange(async (value: CollapseIconStyle) => {
          this.plugin.settings.pluginSettings.header.collapseIconStyle = value;
          await this.plugin.saveSettings();
          this.plugin.renderReadingViews();
        })
      );

    collapseIconStyle.settingEl.toggleClass('codeblock-customizer-setting-hidden', this.plugin.settings.pluginSettings.header.collapseIconPosition === 'hide');

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

    headerDetails.createEl('h4', { text: 'Header Language Tag & Header Icon Settings' });

    new Setting(headerDetails)
      .setName('Display codeblock language (if language is defined)')
      .setDesc('If enabled, the codeblock language will be displayed in the header.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.header.displayCodeBlockLanguage)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.header.displayCodeBlockLanguage = value;
          await this.plugin.saveSettings();

          codeBlockLangTextColor.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
          codeBlockLangBackgroundColor.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
          boldToggle.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
          italicToggle.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
          alwaysDisplayToggle.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
        })
      );

    const codeBlockLangTextColor = createPickrSetting(headerDetails, 'Codeblock language text color', '', "header.codeBlockLangTextColor", this.pickerInstances, this.plugin);
    codeBlockLangTextColor.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.header.displayCodeBlockLanguage);

    const codeBlockLangBackgroundColor = createPickrSetting(headerDetails, 'Codeblock language background color', '', "header.codeBlockLangBackgroundColor", this.pickerInstances, this.plugin);
    codeBlockLangBackgroundColor.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.header.displayCodeBlockLanguage);

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
    boldToggle.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.header.displayCodeBlockLanguage);

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
    italicToggle.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.header.displayCodeBlockLanguage);

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
    alwaysDisplayToggle.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.header.displayCodeBlockLanguage);

    new Setting(headerDetails)
      .setName('Display codeblock language icon (if available)')
      .setDesc('If enabled, the codeblock language icon will be displayed in the header.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.header.displayCodeBlockIcon)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.header.displayCodeBlockIcon = value;
          await this.plugin.saveSettings();
          alwaysDisplayIconToggle.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
        })
      );

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
    alwaysDisplayIconToggle.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.header.displayCodeBlockIcon);

    // annotation settings
    const annotationDetails = createDetailsGroup(appearanceDiv, 'Annotation Settings', 'annotationDetailsOpen', this, this.getSearchQuery);

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
      createPickrSetting(annotationDetails, `'${type}' icon color`, '', `annotations.colors.${type}`, this.pickerInstances, this.plugin);
    }

    // language specific colors
    const langSpecificDetails = createDetailsGroup(appearanceDiv, 'Language Specific Color Overrides', 'langSpecificDetailsOpen', this, this.getSearchQuery);

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
              updateLanguageSpecificColorContainer(languageSpecificContainer, this.pickerInstances, this.plugin); // Update the color container after adding a color
            }
          }
        });
      });

    new Setting(langSpecificDetails)
      .setName('Code block border styling position')
      .setDesc('Select on which side the border should be displayed.')
      .addDropdown((dropdown) => dropdown
        .addOptions({ "disable": "Disable", "left": "Left", "right": "Right" })
        .setValue(this.plugin.settings.pluginSettings.codeblock.codeBlockBorderStylingPosition)
        .onChange((value) => {
          this.plugin.settings.pluginSettings.codeblock.codeBlockBorderStylingPosition = value;
          (async () => { await this.plugin.saveSettings() })();
        })
      );
    const languageSpecificContainer = langSpecificDetails.createDiv({ cls: "codeblock-customizer-languageSpecificColorContainer" });

    // Update the color container on page load
    updateLanguageSpecificColorContainer(languageSpecificContainer, this.pickerInstances, this.plugin);

    // inline code settings
    const inlineCodeDetails = createDetailsGroup(appearanceDiv, 'Inline Code Settings', 'inlineCodeDetailsOpen', this, this.getSearchQuery);

    new Setting(inlineCodeDetails)
      .setName('Enable click-to-copy for inline code')
      .setDesc('Allows you to copy inline code by clicking on it while holding a modifier key.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.inlineCode.enableCopyOnClick)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.inlineCode.enableCopyOnClick = value;
          await this.plugin.saveSettings();
          this.plugin.renderReadingViews();
          copyModifierSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
        })
    );

    const copyModifierSetting = new Setting(inlineCodeDetails)
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
    copyModifierSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.inlineCode.enableCopyOnClick);

    new Setting(inlineCodeDetails)
      .setName('Enable inline code syntax highlighting')
      .setDesc('If enabled, syntax highlighting will be added to inline code (if specified).')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.inlineCode.enableSyntaxHighlight)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.inlineCode.enableSyntaxHighlight = value;
          await this.plugin.saveSettings();
          this.plugin.renderReadingViews();
          showIconsSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
        })
      );

    const showIconsSetting = new Setting(inlineCodeDetails)
      .setName('Show icons for syntax highlighted inline code (if available)')
      .setDesc('If enabled, icons will be shown for syntax highlighted inline code.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.inlineCode.showIcons)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.inlineCode.showIcons = value;
          await this.plugin.saveSettings();
        })
      );
    showIconsSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.inlineCode.enableSyntaxHighlight);

    new Setting(inlineCodeDetails)
      .setName('Enable inline code styling')
      .setDesc('If enabled, the background color, and the text color of inline code can be styled.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pluginSettings.inlineCode.enableInlineCodeStyling)
        .onChange(async (value) => {
          this.plugin.settings.pluginSettings.inlineCode.enableInlineCodeStyling = value;
          await this.plugin.saveSettings();
          inlineCodeBackgroundSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
          inlineCodeTextColorSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !value);
        })
      );

    const inlineCodeBackgroundSetting = createPickrSetting(inlineCodeDetails, 'Inline code background color', '', "inlineCode.backgroundColor", this.pickerInstances, this.plugin);
    inlineCodeBackgroundSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.inlineCode.enableInlineCodeStyling);

    const inlineCodeTextColorSetting = createPickrSetting(inlineCodeDetails, 'Inline code text color', '', "inlineCode.textColor", this.pickerInstances, this.plugin);
    inlineCodeTextColorSetting.settingEl.toggleClass('codeblock-customizer-setting-hidden', !this.plugin.settings.pluginSettings.inlineCode.enableInlineCodeStyling);

    //return appearanceDiv;
  }// display
}// AppearanceSettings
