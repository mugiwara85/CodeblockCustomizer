import { Plugin, MarkdownView, WorkspaceLeaf, TAbstractFile, TFile, getLinkpath, Vault, Notice, Editor } from "obsidian";
import { Extension, StateField } from "@codemirror/state";
import { EditorView, DecorationSet } from "@codemirror/view";
import * as _ from 'lodash';
import { DEFAULT_SETTINGS, CodeblockCustomizerSettings } from './Settings';
import { ReadingView, calloutPostProcessor, convertHTMLCollectionToArray, foldAllReadingView, toggleFoldClasses } from "./ReadingView";
import { SettingsTab } from "./SettingsTab";
import { loadIcons, BLOBS, updateSettingStyles, mergeBorderColorsToLanguageSpecificColors, loadSyntaxHighlightForCustomLanguages, customLanguageConfig, getFileCacheAndContentLines, indentCodeBlock, unIndentCodeBlock} from "./Utils";
import { CodeBlockPositions, extensions, updateValue } from "./EditorExtensions";
// npm i @simonwep/pickr

interface codeBlock {
  codeBlockText: string;
  from: number;
  to: number;
}

export default class CodeBlockCustomizerPlugin extends Plugin {
  settings: CodeblockCustomizerSettings;
  extensions: Extension[];
  theme: string;
  editorExtensions: { extensions: (StateField<DecorationSet> | StateField<CodeBlockPositions[]> | Extension)[];
    foldAll: (view: EditorView, settings: CodeblockCustomizerSettings, fold: boolean, defaultState: boolean) => void;
    customBracketMatching: Extension;
    selectionMatching: Extension;
  }
  customLanguageConfig: customLanguageConfig | null;
  
  async onload() {
    document.body.classList.add('codeblock-customizer');
    await this.loadSettings();
    updateSettingStyles(this.settings, this.app);

    this.extensions = [];
    this.customLanguageConfig = null;
    // npm install eslint@8.39.0 -g
    // eslint main.ts
    
  /* Problems to solve:
    - if a language is excluded then:
      - header needs to unfold before removing it,
  */

  // add fold all command
    this.addCommand({
      id: 'codeblock-customizer-foldall-editor',
      name: 'Fold all code blocks',
      callback: () => {
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (markdownView) {
          // @ts-ignore
          const mode = markdownView.currentMode.type;
          document.body.classList.add('codeblock-customizer-header-collapse-command');
          this.settings.foldAllCommand = true;
          if (mode === "source") {
            // @ts-ignore
            this.editorExtensions.foldAll(markdownView.editor.cm, this.settings, true, false);
            foldAllReadingView(true, this.settings);
          } else if (mode === "preview") {
            foldAllReadingView(true, this.settings);
          }
        }
      }
    });

    // add unfold all command
    this.addCommand({
      id: 'codeblock-customizer-unfoldall-editor',
      name: 'Unfold all code blocks',
      callback: () => {
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (markdownView) {
          // @ts-ignore
          const mode = markdownView.currentMode.type;
          document.body.classList.add('codeblock-customizer-header-collapse-command');
          this.settings.foldAllCommand = true;
          if (mode === "source") {
            // @ts-ignore
            this.editorExtensions.foldAll(markdownView.editor.cm, this.settings, false, false);
            foldAllReadingView(false, this.settings);
          } else if (mode === "preview") {
            foldAllReadingView(false, this.settings);
          }
        }
      }
    });

    // restore default state
    this.addCommand({
      id: 'codeblock-customizer-restore-fold-editor',
      name: 'Restore folding state of all code blocks to default',
      callback: () => {
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (markdownView) {
          // @ts-ignore
          const mode = markdownView.currentMode.type;
          document.body.classList.remove('codeblock-customizer-header-collapse-command');
          this.settings.foldAllCommand = false;
          if (mode === "source") {
            // @ts-ignore
            this.editorExtensions.foldAll(markdownView.editor.cm, this.settings, true, false);
            // @ts-ignore
            this.editorExtensions.foldAll(markdownView.editor.cm, this.settings, false, true);
            foldAllReadingView(false, this.settings);
            this.restoreDefaultFold();
          } else if (mode === "preview") {
            foldAllReadingView(false, this.settings);
            this.restoreDefaultFold();
          }
        }
      }
    });

    // indent code block
    this.addCommand({
      id: 'codeblock-customizer-indent-codeblock',
      name: 'Indent code block by one level',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        indentCodeBlock(editor, view);
      }
    });

    // unindent code block
    this.addCommand({
      id: 'codeblock-customizer-unindent-codeblock',
      name: 'Unindent code block by one level',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        unIndentCodeBlock(editor, view);
      }
    });

    await loadIcons(this);
    loadSyntaxHighlightForCustomLanguages(this); // load syntax highlight
    
    mergeBorderColorsToLanguageSpecificColors(this, this.settings);

    this.editorExtensions = extensions(this, this.settings);
    this.registerEditorExtension(this.editorExtensions.extensions);

    if (this.settings.SelectedTheme.settings.codeblock.enableBracketHighlight) {
      this.extensions.push(this.editorExtensions.customBracketMatching);
    }
    if (this.settings.SelectedTheme.settings.codeblock.enableSelectionMatching) {
      this.extensions.push(this.editorExtensions.selectionMatching);
    }

    this.registerEditorExtension(this.extensions);
    
    const settingsTab = new SettingsTab(this.app, this);
    this.addSettingTab(settingsTab);
    if (this.settings.ThemeName == "") {
      this.updateTheme(settingsTab);
    } else {
      updateSettingStyles(this.settings, this.app);
    }
    
    this.registerEvent(this.app.workspace.on('css-change', this.handleCssChange.bind(this, settingsTab), this));
    
    this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (this.settings.SelectedTheme.settings.codeblock.enableLinks && this.settings.SelectedTheme.settings.codeblock.enableLinkUpdate) {
        this.handleFileRename(file, oldPath); // until Obsidian doesn't adds code block links to metadatacache
      }
    }, this));

    // reading mode
    this.registerMarkdownPostProcessor(async (el, ctx) => {
      await ReadingView(el, ctx, this)
    });
    
    this.registerMarkdownPostProcessor(async (el, ctx) => {
      await calloutPostProcessor(el, ctx, this)
    });

    this.app.workspace.onLayoutReady(() => {
      this.renderReadingViewOnStart();
    });

    console.log("loading CodeBlock Customizer plugin");
  }// onload

  handleCssChange(settingsTab: SettingsTab) {
      this.updateTheme(settingsTab);
  }// handleCssChange
    
  updateTheme(settingsTab: SettingsTab) {
    settingsTab.applyTheme();
    this.saveSettings();
  }// updateTheme
  
  onunload() {
    console.log("unloading CodeBlock Customizer plugin");
    // unload icons
    for (const url of Object.values(BLOBS)) {
      URL.revokeObjectURL(url)
    }
    loadSyntaxHighlightForCustomLanguages(this, true); // unload syntax highlight
  }// onunload
  
  async handleFileRename(file: TAbstractFile, oldPath: string) {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    let linkUpdateCount = 0;
    let fileCount = 0;

    for (const mdFile of markdownFiles) {
      let linkUpdate = 0;
      const { cache, fileContentLines } = await getFileCacheAndContentLines(this, mdFile.path);
      if (!cache || !fileContentLines)
        continue;

      if (cache?.sections) {
        const codeBlocks: codeBlock[] = [];
        for (const sections of cache.sections) {
          if (sections.type === "code") {
            const codeBlockLines = fileContentLines.slice(sections.position.start.line, sections.position.end.line + 1);
            const codeBlockText = codeBlockLines.join('\n');
            codeBlocks.push({codeBlockText, from: sections.position.start.line, to: sections.position.end.line});
          }
        }
        for (const codeBlock of codeBlocks) {
          const ret = this.findAllCodeBlockLinks(mdFile, codeBlock, oldPath, file);
          linkUpdateCount += ret;
          if (ret > 0) {
            linkUpdate++;
          }
        }
      }
      if (linkUpdate > 0) {
        fileCount++;
      }
    }
    if (linkUpdateCount > 0) {
      new Notice(`Updated ${linkUpdateCount} code block links in ${fileCount} files.`);
    }
  }// handleFileRename

  findAllCodeBlockLinks(currentFile: TFile, currentCodeBlock: codeBlock, oldPath: string, newPath: TAbstractFile) {
    const linkRegex = /\[\[(.*?)\]\]/g;
    const matches: IterableIterator<RegExpMatchArray> = currentCodeBlock.codeBlockText.matchAll(linkRegex);
    let modifiedCodeBlockText = currentCodeBlock.codeBlockText;
    let linkUpdateCount = 0;

    if (!matches) {
      return 0;
    }
    
    for (const match of matches) {
      const { updatedCodeBlockText: updatedText, updated } = this.updateCodeBlockContent(match, currentFile, oldPath, newPath, modifiedCodeBlockText);
      modifiedCodeBlockText = updatedText;
      if (updated) {
        linkUpdateCount++;
      }
    }
    if (modifiedCodeBlockText !== currentCodeBlock.codeBlockText) {
      this.updateLinksInFiles(this.app.vault, currentFile, currentCodeBlock.from, currentCodeBlock.to, modifiedCodeBlockText.split('\n'));
    }
    return linkUpdateCount;
  }// findAllCodeBlockLinks

  updateCodeBlockContent(match: RegExpMatchArray, currentFile: TFile, oldPath: string, newPath: TAbstractFile, updatedCodeBlockText: string) {
    const linkText = match[1];
    const displayNameRef = this.getDisplayNameAndReference(linkText);
    const linkTextWithoutDisplayName = linkText.split('|')[0].split('#')[0]; // Remove DisplayName
    const oldPathWithoutExtension = oldPath.replace(/\.[^.]*$/, ''); // Remove extension
    const oldPathWithoutDir = oldPath.split('/').slice(-1)[0]; // Extract last segment after '/'
    const oldPathWithoutExtensionAndDir = oldPathWithoutDir.replace(/\.[^.]*$/, ''); // Remove extension from last segment
    const linkPath = this.app.metadataCache.getFirstLinkpathDest(getLinkpath(linkTextWithoutDisplayName), currentFile.path);
    // @ts-ignore
    const newExtension = '.' + newPath.extension;
    const displayNameAndRef = displayNameRef.reference + displayNameRef.displayName;
    let updated = false;

    if ((linkTextWithoutDisplayName.contains("/") && linkTextWithoutDisplayName.contains(newExtension)) && linkTextWithoutDisplayName.toLowerCase() === oldPath.toLowerCase()) { // SomeFolder/Untitled 22.md === SomeFolder/Untitled 22.md
      if (!linkPath) {
        //console.log("(+) Update 1 - In " + currentFile.path + " replace " + oldPath + " with " + newPath.path);
        updatedCodeBlockText = updatedCodeBlockText.replace(match[0], '[[' + newPath.path + displayNameAndRef + ']]');
        updated = true;
      }
    } else if ((!linkTextWithoutDisplayName.contains("/") && linkTextWithoutDisplayName.contains(newExtension)) && linkTextWithoutDisplayName.toLowerCase() === oldPathWithoutDir.toLowerCase()) { // Untitled 22.md === Untitled 22.md
      if (!linkPath) {
        //console.log("(+) Update 2 - In " + currentFile.path + " replace " + oldPathWithoutDir + " with " + newPath.path);
        updatedCodeBlockText = updatedCodeBlockText.replace(match[0], '[[' + newPath.path + displayNameAndRef + ']]');
        updated = true;
      }
    } else if ((linkTextWithoutDisplayName.contains("/") && !linkTextWithoutDisplayName.contains(newExtension)) && oldPathWithoutExtension.length > 0 && linkTextWithoutDisplayName.toLowerCase() === oldPathWithoutExtension.toLowerCase()) { // SomeFolder/Untitled 22 === SomeFolder/Untitled 22
      if (!linkPath) {
        //console.log("(+) Update 3 - In " + currentFile.path + " replace " + oldPathWithoutExtension + " with " + newPath.path.replace(/\.[^.]*$/, ''));
        updatedCodeBlockText = updatedCodeBlockText.replace(match[0], '[[' + newPath.path.replace(/\.[^.]*$/, '') + displayNameAndRef + ']]');
        updated = true;
      }
    } else if ((!linkTextWithoutDisplayName.contains("/") && !linkTextWithoutDisplayName.contains(newExtension)) && oldPathWithoutExtensionAndDir.length > 0 && linkTextWithoutDisplayName.toLowerCase() === oldPathWithoutExtensionAndDir.toLowerCase()) { // Untitled 22 === Untitled 22
      if (!linkPath) {
        //console.log("(+) Update 4 - In " + currentFile.path + " replace " + oldPathWithoutExtensionAndDir + " with " + newPath.path.replace(/\.[^.]*$/, ''));
        updatedCodeBlockText = updatedCodeBlockText.replace(match[0], '[[' + newPath.path.replace(/\.[^.]*$/, '') + displayNameAndRef + ']]');
        updated = true;
      }
    }

    return {updatedCodeBlockText, updated};
  }// updateCodeBlockContent

  async updateLinksInFiles(vault: Vault, file: TFile, startLine: number, endLine: number, newContent: string[]): Promise<void> {
    try {
      await vault.process(file, (currentContent) => {
        const lines = currentContent.split("\n");

        for (let i = startLine; i <= endLine; i++) {
          const index = i - startLine;
          lines[i] = newContent[index];
        }

        const modifiedContent = lines.join("\n");

        return modifiedContent;
      });
    } catch (error) {
      console.error("Error modifying file:", error);
      throw error;
    }
  }// updateLinksInFiles

  getDisplayNameAndReference(input: string): { displayName: string, reference: string } {
    const displayNameMarker = "|";
    const referenceMarker = "#";
    
    const displayNameIndex = input.lastIndexOf(displayNameMarker);
    const referenceIndex = input.indexOf(referenceMarker);
    
    const result: { displayName: string, reference: string } = {
      displayName: '',
      reference: ''
    };
    
    if (displayNameIndex !== -1) {
      result.displayName = input.substring(displayNameIndex);
    }
    
    if (referenceIndex !== -1) {
      result.reference = input.substring(referenceIndex, displayNameIndex !== -1 ? displayNameIndex : undefined);
    }
    
    return result;
  }// getDisplayNameAndReference

  async loadSettings() {
    const loadedData = await this.loadData();
    this.settings = _.merge({}, DEFAULT_SETTINGS, loadedData); // copies new settings to default themes and selectedtheme

    const defaultThemeNames = Object.keys(DEFAULT_SETTINGS.Themes);
    const currentThemeNames = Object.keys(this.settings.Themes);

    const userThemeNames = _.difference(currentThemeNames, defaultThemeNames);

    // if the currently selected Theme does not have a basename, then delete the property from SelectedTheme to avoid setting wrong basename when creating a new theme
    //const selectedThemeBaseName = this.settings.SelectedTheme.baseTheme;
    const inUseThemeBaseName = this.settings.Themes[this.settings.ThemeName].baseTheme;
    if (inUseThemeBaseName === undefined) {
      delete this.settings.SelectedTheme.baseTheme;
    }

    userThemeNames.forEach(themeName => {
      const userTheme = this.settings.Themes[themeName];
      const baseThemeName = userTheme.baseTheme;

      if (baseThemeName) {
        // copy new settings from corresponding Theme to user themes which do have a baseTheme (created after this change)
        const baseTheme = this.settings.Themes[baseThemeName];
        if (baseTheme) {
          userTheme.colors = _.merge({}, baseTheme.colors, userTheme.colors);
          userTheme.settings = _.merge({}, baseTheme.settings, userTheme.settings);
        }
      } else {
        // copy new settings from Obsidian Theme to user themes which do not have a baseTheme (created before this change)
        const defaultObsidianSettings = this.settings.Themes["Obsidian"];
        userTheme.colors = _.merge({}, defaultObsidianSettings.colors, userTheme.colors);
        userTheme.settings = _.merge({}, defaultObsidianSettings.settings, userTheme.settings);
      }

      userTheme.colors.light.prompts.promptColors = {};
      userTheme.colors.light.prompts.rootPromptColors = {};
      userTheme.colors.dark.prompts.promptColors = {};
      userTheme.colors.dark.prompts.rootPromptColors = {};
    });

    this.settings.SelectedTheme.colors.light.prompts.promptColors = {};
    this.settings.SelectedTheme.colors.light.prompts.rootPromptColors = {};
    this.settings.SelectedTheme.colors.dark.prompts.promptColors = {};
    this.settings.SelectedTheme.colors.dark.prompts.rootPromptColors = {};

    this.saveSettings();
  }// loadSettings

  async saveSettings() {
    const clonedSettings = structuredClone(this.settings);

    // Strip base colors before saving to avoid bloat and overwrite
    delete clonedSettings.SelectedTheme.colors.light.prompts.promptColors;
    delete clonedSettings.SelectedTheme.colors.dark.prompts.promptColors;
    delete clonedSettings.SelectedTheme.colors.light.prompts.rootPromptColors;
    delete clonedSettings.SelectedTheme.colors.dark.prompts.rootPromptColors;

    await this.saveData(clonedSettings);
    updateValue(true);
    this.app.workspace.updateOptions();
    updateSettingStyles(this.settings, this.app);
  }// saveSettings

  restoreDefaultFold() {
    const preElements = document.querySelectorAll('.codeblock-customizer-pre.codeblock-customizer-codeblock-default-collapse');
    preElements.forEach((preElement) => {
      //preElement?.classList.add('codeblock-customizer-codeblock-collapsed');
      let lines: Element[] = [];
      const codeElements = preElement?.getElementsByTagName("CODE");
      lines = convertHTMLCollectionToArray(codeElements);              
      toggleFoldClasses(preElement as HTMLPreElement, lines.length, true, this.settings.SelectedTheme.settings.semiFold.enableSemiFold, this.settings.SelectedTheme.settings.semiFold.visibleLines);
    });
  }// restoreDefaultFold

  async renderReadingViewOnStart() {
    this.app.workspace.iterateRootLeaves((currentLeaf: WorkspaceLeaf) => {
      if (currentLeaf.view instanceof MarkdownView) {
        const leafMode = currentLeaf.view.getMode();
        if (leafMode === "preview") {
          currentLeaf.view.previewMode.rerender(true);
        }
      }
    });
  }// renderReadingViewOnStart
}
