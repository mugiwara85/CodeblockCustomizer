import { Plugin, MarkdownView, WorkspaceLeaf, TAbstractFile, TFile, getLinkpath, Vault, Notice, Editor } from "obsidian";

import { ChangeSet, Extension, StateField } from "@codemirror/state";
import { EditorView, DecorationSet } from "@codemirror/view";

import { DEFAULT_SETTINGS, CodeblockCustomizerSettings, FoldingPersistence, TabPersistence } from './Settings';
import { DEFAULT_SYNTAX_THEMES } from './SyntaxThemeDefaults';
import { SettingsTab } from "./SettingsTab/SettingsTab";
import { loadIcons, BLOBS, updateSettingStyles, mergeBorderColorsToLanguageSpecificColors, loadSyntaxHighlightForCustomLanguages, customLanguageConfig, getFileCacheAndContentLines, indentCodeBlock, unIndentCodeBlock, registerExecuteCodeSyntaxHighlighting, unregisterExecuteCodeSyntaxHighlighting, refreshCachedMode, parseCustomPrismLanguages, unloadCustomPrismLanguages } from "./Utils";
import { extensions } from "./EditorView/EditorExtensions";
import { CodeBlockPositions } from "./EditorView/CodeBlockPositions";
import { GroupedCodeBlockRenderChild } from "./ReadingView/GroupedCodeBlockRenderer";
import { fadeOutLineCount } from "./Const";
import { CodeBlockRenderer } from "./ReadingView/CodeBlockRenderer";
import { InlineCodeRenderer } from "./ReadingView/InlineCodeRenderer";
import { admonitionPostProcessor, calloutPostProcessor } from "./ReadingView/PostProcessors";
import { CBCParameters } from "./Parsing";
import { StateStore } from "./StateStore";
import { FoldCommand, FoldingState } from "./EditorView/EditorEffects";

import merge from 'lodash/merge'
import difference from 'lodash/difference'

// npm i @simonwep/pickr

interface codeBlock {
  codeBlockText: string;
  from: number;
  to: number;
}

export default class CodeBlockCustomizerPlugin extends Plugin {
  settings: CodeblockCustomizerSettings;
  settingsUpdated = false;
  resetFoldDecorations = false;
  extensions: Extension[];
  theme: string;
  editorExtensions: {
    extensions: (StateField<DecorationSet> | StateField<CodeBlockPositions[]> | Extension)[];
    foldAll: (view: EditorView) => void;
    unfoldAll: (view: EditorView) => void;
    restoreDefaultFold: (view: EditorView) => void;
    customBracketMatching: Extension;
    selectionMatching: Extension;
  }
  customLanguageConfig: customLanguageConfig | null;
  groupedChildrenMap: Map<MarkdownView, GroupedCodeBlockRenderChild>;
  foldStoreEditor: StateStore<number, FoldingState> = new StateStore(false, Number);
  foldStoreReading: StateStore<number, FoldingState> = new StateStore(false, Number);
  tabStoreEditor: StateStore<string, number> = new StateStore(false, String);
  tabStoreReading: StateStore<string, number> = new StateStore(false, String);
  debounceTimer: NodeJS.Timeout | null = null;
  foldCommandTrigger: FoldCommand = FoldCommand.Default;
  rerenderQueue: Map<number, { content: string; count: number }> = new Map();
  rerenderDebounceTimers: Map<number, NodeJS.Timeout> = new Map();
  modifiedBlocks: Map<string, string> = new Map();
  executeCodeObservers: WeakMap<HTMLElement, MutationObserver> = new WeakMap();

  async onload() {
    document.body.classList.add('codeblock-customizer');
    await this.loadSettings();
    this.configurePersistence();
    await this.loadAllPermanentData();
    updateSettingStyles(this.settings, this.app);

    this.extensions = [];
    this.customLanguageConfig = null;
    // npm install eslint@8.39.0 -g

    this.groupedChildrenMap = new Map<MarkdownView, GroupedCodeBlockRenderChild>();

    this.addCommands();

    await loadIcons(this);
    loadSyntaxHighlightForCustomLanguages(this); // load syntax highlight
    await parseCustomPrismLanguages(this);
    registerExecuteCodeSyntaxHighlighting();

    mergeBorderColorsToLanguageSpecificColors(this, this.settings);

    this.editorExtensions = extensions(this, this.settings);
    this.registerEditorExtension(this.editorExtensions.extensions);

    if (this.settings.pluginSettings.codeblock.enableBracketHighlight) {
      this.extensions.push(this.editorExtensions.customBracketMatching);
    }
    if (this.settings.pluginSettings.codeblock.enableSelectionMatching) {
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

    this.registerPostProcessors();

    this.registerEvents(settingsTab);

    // process existing open preview views when the plugin loads
    this.app.workspace.onLayoutReady(() => {
      this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
        if (leaf.view instanceof MarkdownView && leaf.view.getMode() === 'preview') {
          this.registerGroupedRenderChildForView(leaf.view);
        }
      });
    });

    console.log("loading CodeBlock Customizer plugin");
  }// onload

  setFoldState(filePath: string, key: number, newState: FoldingState, viewType: 'editor' | 'reading', parameters: CBCParameters, lineCount: number): void {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (markdownView) {
      const isGlobalCommandActive = (markdownView.getMode() === 'source' && markdownView.containerEl.classList.contains('codeblock-customizer-header-collapse-command')) ||
        (markdownView.getMode() === 'preview' && this.foldCommandTrigger !== FoldCommand.Default);

      if (isGlobalCommandActive) {
        return;
      }
    }

    const foldSettings = this.settings.pluginSettings.codeblock.folding;
    const semiFoldSettings = this.settings.pluginSettings.semiFold;

    if (!foldSettings.rememberFoldState)
      return;

    let defaultState: FoldingState = FoldingState.Unfolded;
    const foldByDefault = parameters.fold || (foldSettings.inverseFold && !parameters.unfold);

    if (foldByDefault) {
      const canSemiFold = semiFoldSettings.enableSemiFold && (lineCount >= semiFoldSettings.visibleLines + fadeOutLineCount);
      defaultState = canSemiFold ? FoldingState.SemiFolded : FoldingState.FullyFolded;
    }

    const shouldDelete = (newState === defaultState);
    const store = viewType === 'editor' ? this.foldStoreEditor : this.foldStoreReading;

    if (shouldDelete) {
      store.delete(filePath, key);
    } else {
      store.set(filePath, key, newState);
    }

    if (store.isPermanent) {
      this.requestSavePermanentData();
    }
  }// setFoldState

  remapFolds(filePath: string, changes: ChangeSet): void {
    const foldSettings = this.settings.pluginSettings.codeblock.folding;
    if (!foldSettings.rememberFoldState)
      return;

    this.foldStoreEditor.remap(filePath, changes);
    this.foldStoreReading.remap(filePath, changes);

    if (this.foldStoreEditor.isPermanent) {
      this.requestSavePermanentData();
    }
  }// remapFolds

  remapTabs(filePath: string, changes: ChangeSet): void {
    this.tabStoreEditor.remapValues(filePath, changes);
    this.tabStoreReading.remapValues(filePath, changes);
  }// remapTabs

  async clearAllFoldData(): Promise<void> {
    this.foldStoreEditor.clear();
    this.foldStoreReading.clear();

    await this.savePermanentData();

    this.app.workspace.updateOptions();
    this.renderReadingViews();
  }// clearAllFoldData

  async clearAllTabData(): Promise<void> {
    this.tabStoreEditor.clear();
    this.tabStoreReading.clear();

    await this.savePermanentData();

    this.app.workspace.updateOptions();

    new Notice("Stored tab positions cleared!");
  }// clearAllTabData

  configurePersistence(): void {
    const foldPermanent = this.settings.pluginSettings.codeblock.folding.persistence === FoldingPersistence.Permanent;
    this.foldStoreEditor.isPermanent = foldPermanent;
    this.foldStoreReading.isPermanent = foldPermanent;

    const tabPermanent = this.settings.pluginSettings.groupedCodeBlocks.persistence === TabPersistence.Permanent;
    this.tabStoreEditor.isPermanent = tabPermanent;
    this.tabStoreReading.isPermanent = tabPermanent;
  }// configurePersistence

  async loadAllPermanentData() {
    this.foldStoreEditor.permanentData = await this.loadPermanentDataFile<FoldingState>('permanent-editor-folds.json');
    this.foldStoreReading.permanentData = await this.loadPermanentDataFile<FoldingState>('permanent-reading-folds.json');
    this.tabStoreEditor.permanentData = await this.loadPermanentDataFile<number>('permanent-editor-tabs.json');
    this.tabStoreReading.permanentData = await this.loadPermanentDataFile<number>('permanent-reading-tabs.json');
  }// loadAllPermanentData

  requestSavePermanentData(): void {
    if (this.debounceTimer)
      clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.savePermanentData(), 2000);
  }// requestSavePermanentData

  private async savePermanentData(): Promise<void> {
    await this.writePermanentDataFile('permanent-editor-folds.json', this.foldStoreEditor.permanentData);
    await this.writePermanentDataFile('permanent-reading-folds.json', this.foldStoreReading.permanentData);
    await this.writePermanentDataFile('permanent-editor-tabs.json', this.tabStoreEditor.permanentData);
    await this.writePermanentDataFile('permanent-reading-tabs.json', this.tabStoreReading.permanentData);
  }// savePermanentData

  async loadPermanentDataFile<V>(fileName: string): Promise<Record<string, Record<string, V>>> {
    try {
      const path = `${this.app.vault.configDir}/plugins/${this.manifest.id}/${fileName}`;
      const data = await this.app.vault.adapter.read(path);
      return JSON.parse(data) as Record<string, Record<string, V>>;
    } catch (e) {
      return {} as Record<string, Record<string, V>>;
    }
  }// loadPermanentDataFile

  private async writePermanentDataFile(fileName: string, data: Record<string, unknown>): Promise<void> {
    try {
      const path = `${this.app.vault.configDir}/plugins/${this.manifest.id}/${fileName}`;
      await this.app.vault.adapter.write(path, JSON.stringify(data, null, 2)); // 2 for pretty printing
    } catch (e) {
      console.error(`Codeblock Customizer: Error saving ${fileName}:`, e);
    }
  }// writePermanentDataFile

  handleCssChange(settingsTab: SettingsTab) {
    refreshCachedMode();
    this.updateTheme(settingsTab);
  }// handleCssChange

  updateTheme(settingsTab: SettingsTab) {
    settingsTab.applyTheme();
    this.saveSettings();
  }// updateTheme

  async onunload() {
    console.log("unloading CodeBlock Customizer plugin");

    // remove GroupedCodeBlockRenderChild
    if (this.groupedChildrenMap) {
      this.groupedChildrenMap.forEach((child, view) => {
        view.removeChild(child); // onunload()
      });
      this.groupedChildrenMap.clear();
    }

    // unload icons
    for (const url of Object.values(BLOBS)) {
      URL.revokeObjectURL(url)
    }

    // unload syntax highlight
    loadSyntaxHighlightForCustomLanguages(this, true);
    unloadCustomPrismLanguages();
    unregisterExecuteCodeSyntaxHighlighting();

    if (this.debounceTimer)
      clearTimeout(this.debounceTimer);

    await this.savePermanentData();
  }// onunload

  registerGroupedRenderChildForView(markdownView: MarkdownView) {
    if (!markdownView || !markdownView.containerEl) {
      return;
    }

    const child = this.groupedChildrenMap.get(markdownView);
    if (child) {
      child.processGroupedCodeBlocks();
    } else {
      const renderChild = new GroupedCodeBlockRenderChild(markdownView.containerEl, markdownView, this.groupedChildrenMap, this);
      markdownView.addChild(renderChild);
      this.groupedChildrenMap.set(markdownView, renderChild);
    }
  }// registerGroupedRenderChildForView

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
            codeBlocks.push({ codeBlockText, from: sections.position.start.line, to: sections.position.end.line });
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

    return { updatedCodeBlockText, updated };
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

    if (loadedData && loadedData.SelectedTheme?.settings && !loadedData.pluginSettings) {
      console.log("Codeblock Customizer: Migrating settings to new structure.");

      // use the old settings from SelectedTheme
      loadedData.pluginSettings = structuredClone(loadedData.SelectedTheme.settings);

      // delete settings object for all old themes
      for (const themeName in loadedData.Themes) {
        if (loadedData.Themes[themeName]?.settings) {
          delete loadedData.Themes[themeName].settings;
        }
      }
      delete loadedData.SelectedTheme.settings;

      console.log("Codeblock Customizer: Settigns migrated successfully.");
    }

    // merge highlightcolor and alternatehighlightcolors to HighlightStyle
    if (loadedData) {
      for (const theme of [loadedData.SelectedTheme, ...Object.values(loadedData.Themes ?? {})]) {
        for (const mode of ['light', 'dark']) {
          const codeblock = theme?.colors?.[mode]?.codeblock;
          if (!codeblock) {
            continue;
          }

          if (typeof codeblock.highlightColor === 'string'){
            codeblock.highlightColor = { useBackgroundColor: true, backgroundColor: codeblock.highlightColor };
          }

          for (const [key, value] of Object.entries(codeblock.alternateHighlightColors ?? {})) {
            if (typeof value === 'string') {
              codeblock.alternateHighlightColors[key] = { useBackgroundColor: true, backgroundColor: value };
            }
          }
        }
      }
    }

    this.settings = merge({}, DEFAULT_SETTINGS, loadedData); // copies new settings to default themes and selectedtheme

    const defaultThemeNames = Object.keys(DEFAULT_SETTINGS.Themes);
    const currentThemeNames = Object.keys(this.settings.Themes);
    const userThemeNames: string[] = difference(currentThemeNames, defaultThemeNames);

    userThemeNames.forEach(themeName => {
      const userTheme = this.settings.Themes[themeName];
      const baseThemeName = userTheme.baseTheme;

      if (baseThemeName) {
        // copy new settings from corresponding Theme to user themes which do have a baseTheme (created after this change)
        const baseTheme = this.settings.Themes[baseThemeName];
        if (baseTheme) {
          userTheme.colors = merge({}, baseTheme.colors, userTheme.colors);
        }
      } else {
        // copy new settings from Obsidian Theme to user themes which do not have a baseTheme (created before this change)
        const defaultObsidianSettings = this.settings.Themes["Obsidian"];
        userTheme.colors = merge({}, defaultObsidianSettings.colors, userTheme.colors);
      }
    });

    // merge master theme with SelectedTheme
    const masterTheme = this.settings.Themes[this.settings.ThemeName];
    const workingCopyTheme = loadedData?.SelectedTheme;
    if (masterTheme) {
      this.settings.SelectedTheme = merge({}, masterTheme, workingCopyTheme);
    }

    // prevent bloating, remove unchnged colors
    userThemeNames.forEach(themeName => {
      const userTheme = this.settings.Themes[themeName];
      userTheme.colors.light.prompts.promptColors = {};
      userTheme.colors.light.prompts.rootPromptColors = {};
      userTheme.colors.dark.prompts.promptColors = {};
      userTheme.colors.dark.prompts.rootPromptColors = {};
    });

    this.settings.SelectedTheme.colors.light.prompts.promptColors = {};
    this.settings.SelectedTheme.colors.light.prompts.rootPromptColors = {};
    this.settings.SelectedTheme.colors.dark.prompts.promptColors = {};
    this.settings.SelectedTheme.colors.dark.prompts.rootPromptColors = {};

    for (const [name, defaultTheme] of Object.entries(DEFAULT_SYNTAX_THEMES)) {
      if (!this.settings.SyntaxThemes[name]) {
        this.settings.SyntaxThemes[name] = structuredClone(defaultTheme);
      }
    }
  }// loadSettings

  async saveSettings(resetFoldDecorations = false) {
    const clonedSettings = structuredClone(this.settings);

    // Strip base colors before saving to avoid bloat and overwrite
    delete clonedSettings.SelectedTheme.colors.light.prompts.promptColors;
    delete clonedSettings.SelectedTheme.colors.dark.prompts.promptColors;
    delete clonedSettings.SelectedTheme.colors.light.prompts.rootPromptColors;
    delete clonedSettings.SelectedTheme.colors.dark.prompts.rootPromptColors;

    for (const themeName in clonedSettings.Themes) {
      const theme = clonedSettings.Themes[themeName];
      if (theme && theme.colors) {
        delete theme.colors.light.prompts.promptColors;
        delete theme.colors.dark.prompts.promptColors;
        delete theme.colors.light.prompts.rootPromptColors;
        delete theme.colors.dark.prompts.rootPromptColors;
      }
    }

    await this.saveData(clonedSettings);
    this.settingsUpdated = true;  // re-render decorations, re-scan codeblocks
    if (resetFoldDecorations) {
      this.resetFoldDecorations = true;  // reset fold decorations to their initial state
    }

    this.app.workspace.updateOptions();
    requestAnimationFrame(() => {
      this.settingsUpdated = false;
      this.resetFoldDecorations = false;
    });
    updateSettingStyles(this.settings, this.app);

    if (this.settings.pluginSettings.codeblock.folding.persistence === FoldingPersistence.Permanent) {
      this.requestSavePermanentData();
    }
  }// saveSettings

  renderReadingViews(): void {
    this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
      if (leaf.view instanceof MarkdownView && leaf.view.getMode() === "preview") {
        const preview = leaf.view.previewMode;
        if (!preview || !preview.getScroll || !preview.applyScroll) {
          return;
        }

        const scrollState = preview.getScroll();

        preview.rerender(true);

        setTimeout(() => {
          preview.applyScroll(scrollState);
        }, 100);
      }
    });
  }// renderReadingViews

  private executeFoldCommand(func: (view: EditorView) => void, foldCommand: FoldCommand, action: 'add' | 'remove'): void {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView) {
      return;
    }

    markdownView.containerEl.classList[action]('codeblock-customizer-header-collapse-command');
    const mode = markdownView.getMode();
    if (mode === 'source') {
      // @ts-ignore
      func(markdownView.editor.cm);
    } else if (mode === 'preview') {
      this.foldCommandTrigger = foldCommand;
      this.renderReadingViews();
    }
  }// executeFoldCommand

  addCommands() {
    // add fold all command
    this.addCommand({
      id: 'codeblock-customizer-foldall-editor',
      name: 'Fold all code blocks',
      callback: () => this.executeFoldCommand(this.editorExtensions.foldAll, FoldCommand.FoldAll, 'add')
    });

    // add unfold all command
    this.addCommand({
      id: 'codeblock-customizer-unfoldall-editor',
      name: 'Unfold all code blocks',
      callback: () => this.executeFoldCommand(this.editorExtensions.unfoldAll, FoldCommand.UnfoldAll, 'add')
    });

    // restore default state
    this.addCommand({
      id: 'codeblock-customizer-restore-fold-editor',
      name: 'Restore folding state of all code blocks to default',
      callback: () => this.executeFoldCommand(this.editorExtensions.restoreDefaultFold, FoldCommand.Default, 'remove')
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
  }// addCommands

  registerPostProcessors() {
    // reading mode
    this.registerMarkdownPostProcessor((el, ctx) => {
      const hasCodeBlock = el.querySelector("pre > code");
      if (hasCodeBlock) {
        ctx.addChild(new CodeBlockRenderer(el, this, ctx));
      }
    });

    // inline code
    this.registerMarkdownPostProcessor((el, ctx) => {
      el.querySelectorAll("code:not(pre > code)").forEach((codeEl) => {
        ctx.addChild(new InlineCodeRenderer(codeEl as HTMLElement, this, ctx));
      });
    });

    // callouts
    this.registerMarkdownPostProcessor(async (el, ctx) => {
      await calloutPostProcessor(el, ctx, this)
    });

    // admonitions
    this.registerMarkdownPostProcessor(async (el, ctx) => {
      await admonitionPostProcessor(el, ctx, this)
    });
  }// registerPostProcessors

  registerEvents(settingsTab: SettingsTab) {
    this.registerEvent(this.app.workspace.on('css-change', this.handleCssChange.bind(this, settingsTab), this));

    this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (this.settings.pluginSettings.codeblock.enableLinks && this.settings.pluginSettings.codeblock.enableLinkUpdate) {
        this.handleFileRename(file, oldPath); // until Obsidian doesn't adds code block links to metadatacache
      }
    }, this));

    // process new active leaves (e.g. note switches)
    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf) => {
      if (leaf && leaf.view instanceof MarkdownView && leaf.view.getMode() === 'preview') {
        this.registerGroupedRenderChildForView(leaf.view);
      }

      // check if there is a pending save operation scheduled by the timer and save it
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
        this.savePermanentData();
      }
    }));

    // process layout-change (editor mode <--> reading mode)
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (markdownView) {
        const currentMode = markdownView.getMode();
        const file = markdownView.file;

        if (markdownView.file) {
          if (currentMode === 'preview') {
            const keysToProcess = Array.from(this.modifiedBlocks.keys());

            for (const key of keysToProcess) {
              const [filePath, lineStartStr] = key.split('|');

              if (filePath === file?.path) {
                const lineStart = parseInt(lineStartStr, 10);
                const newParametersLine = this.modifiedBlocks.get(key);

                if (newParametersLine !== undefined) {
                  this.rerenderCodeblock(file, lineStart, newParametersLine);
                }

                this.modifiedBlocks.delete(key);
              }
            }
          }
        }

        if (currentMode === 'preview') {
          this.registerGroupedRenderChildForView(markdownView);
        }
      }
    }));

    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) {
        return;
      }
      view.containerEl.classList.remove('codeblock-customizer-header-collapse-command');
      if (this.foldCommandTrigger !== FoldCommand.Default) {
        this.foldCommandTrigger = FoldCommand.Default;
      }
    }));
  }// registerEvents

  rerenderCodeblock(file: TFile, lineStart: number, newParametersLine?: string) {
    const targets: { renderer: any; section: any }[] = [];

    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view as MarkdownView;
      if (view.file?.path !== file.path || view.getMode() !== 'preview') {
        continue;
      }

      // @ts-expect-error: undocumented Obsidian API
      const renderer = view.previewMode.renderer;
      if (!renderer?.sections) {
        continue;
      }

      //const sectionToRerender = renderer.sections.find((s: any) => s.lineStart === lineStart);
      let sectionToRerender;
      for (const section of renderer.sections) {
        const sectionStartLine = section?.start?.line;
        const sectionEndLine = section?.end?.line;

        if (sectionStartLine !== undefined && sectionEndLine !== undefined && sectionStartLine <= lineStart && sectionEndLine >= lineStart) {
          if (section.el?.querySelector('pre > code')) {
            sectionToRerender = section;
            break;
          }
        }
      }

      if (!sectionToRerender && lineStart === 0 && renderer.sections.length > 0) {
        const firstSection = renderer.sections[0];
        if (firstSection.el?.querySelector('pre > code')) {
          sectionToRerender = firstSection;
        }
      }
      if (sectionToRerender) {
        targets.push({ renderer, section: sectionToRerender });
      }
    }

    if (targets.length > 0) {
      if (newParametersLine !== undefined) {
        this.rerenderQueue.set(lineStart, { content: newParametersLine, count: targets.length });
      }

      for (const target of targets) {
        target.section.rendered = false;
        target.section.html = '';
        target.renderer.queueRender();
      }
    }
  }// rerenderCodeblock
}
