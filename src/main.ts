import { Plugin, MarkdownView, WorkspaceLeaf, TAbstractFile, TFile, getLinkpath, Vault, Notice, Editor, debounce } from "obsidian";

import { ChangeSet, Extension, StateField } from "@codemirror/state";
import { EditorView, DecorationSet } from "@codemirror/view";

import { DEFAULT_SETTINGS, CodeblockCustomizerSettings, FoldingPersistence, TabPersistence, ColorTheme, PluginSettings, HighlightStyle } from './Settings';
import { DEFAULT_SYNTAX_THEMES } from './SyntaxThemeDefaults';
import { SettingsTab } from "./SettingsTab/SettingsTab";
import { loadIcons, BLOBS, updateSettingStyles, clearSettingStyles, getTargetDocuments, mergeBorderColorsToLanguageSpecificColors, loadSyntaxHighlightForCustomLanguages, customLanguageConfig, getFileCacheAndContentLines, indentCodeBlock, unIndentCodeBlock, registerExecuteCodeSyntaxHighlighting, unregisterExecuteCodeSyntaxHighlighting, getExecuteCodeLanguages, refreshCachedMode, parseCustomPrismLanguages, unloadCustomPrismLanguages, isSpecificHeader, determineDefaultFoldState, getVisibleLineCount } from "./Utils";
import { extensions } from "./EditorView/EditorExtensions";
import { CodeBlockPositions } from "./EditorView/CodeBlockPositions";
import { GroupedCodeBlockRenderChild } from "./ReadingView/GroupedCodeBlockRenderer";
import { fadeOutLineCount } from "./Const";
import { CodeBlockRenderer } from "./ReadingView/CodeBlockRenderer";
import { InlineCodeRenderer } from "./ReadingView/InlineCodeRenderer";
import { admonitionPostProcessor } from "./ReadingView/PostProcessors";
import { CBCParameters } from "./Parsing";
import { StateStore } from "./StateStore";
import { getRenamedLinkText, replaceLinesIfUnchanged } from "./CodeBlockLinks";
import { FoldCommand, FoldingState } from "./EditorView/EditorEffects";

import { merge, difference } from 'es-toolkit/compat';

interface codeBlock {
  codeBlockText: string;
  from: number;
  to: number;
}

interface LegacyTheme {
  baseTheme?: string;
  settings?: PluginSettings;
  colors?: Record<'light' | 'dark', {
    codeblock?: {
      highlightColor?: string | HighlightStyle;
      alternateHighlightColors?: Record<string, string | HighlightStyle>;
    };
  }>;
}

interface LoadedPluginData extends Partial<Omit<CodeblockCustomizerSettings, 'SelectedTheme' | 'Themes'>> {
  SelectedTheme?: ColorTheme & LegacyTheme;
  Themes?: Record<string, ColorTheme & LegacyTheme>;
}

interface PreviewSection {
  start?: { line: number };
  end?: { line: number };
  el?: HTMLElement;
  rendered: boolean;
  html: string;
}

interface PreviewRenderer {
  sections?: PreviewSection[];
  queueRender: () => void;
}

export default class CodeBlockCustomizerPlugin extends Plugin {
  settings!: CodeblockCustomizerSettings;
  settingsUpdated = false;
  resetFoldDecorations = false;
  extensions: Extension[] = [];
  editorExtensions!: {
    extensions: (StateField<DecorationSet> | StateField<CodeBlockPositions[]> | Extension)[];
    foldAll: (view: EditorView) => void;
    unfoldAll: (view: EditorView) => void;
    restoreDefaultFold: (view: EditorView) => void;
    customBracketMatching: Extension;
    selectionMatching: Extension;
  }
  customLanguageConfig: customLanguageConfig | null = null;
  groupedChildrenMap = new Map<MarkdownView, GroupedCodeBlockRenderChild>();
  foldStoreEditor: StateStore<number, FoldingState> = new StateStore(false, Number);
  foldStoreReading: StateStore<number, FoldingState> = new StateStore(false, Number);
  tabStoreEditor: StateStore<string, number> = new StateStore(false, String);
  tabStoreReading: StateStore<string, number> = new StateStore(false, String);
  debounceTimer: number | null = null;
  foldCommandTrigger: { command: FoldCommand; path: string } | null = null;
  rerenderQueue: Map<string, { content: string; count: number }> = new Map();
  modifiedBlocks: Map<string, string> = new Map();
  private renameQueue: Promise<void> = Promise.resolve();
  executeCodeObservers: WeakMap<HTMLElement, MutationObserver> = new WeakMap();
  executeCodeLanguages: string[] = [];
  renderReadingViewsDebounced = debounce(() => this.renderReadingViews(), 750, true);

  async onload() {
    for (const doc of getTargetDocuments(this.app)) {
      doc.body?.classList.add('codeblock-customizer');
    }
    await this.loadSettings();
    this.configurePersistence();
    await this.loadAllPermanentData();
    updateSettingStyles(this.settings, this.app);

    this.addCommands();

    await loadIcons(this);
    loadSyntaxHighlightForCustomLanguages(this); // load syntax highlight
    await parseCustomPrismLanguages(this);
    this.executeCodeLanguages = getExecuteCodeLanguages(this.settings.pluginSettings.plugins.executeCode.additionalLanguages);
    registerExecuteCodeSyntaxHighlighting(this.executeCodeLanguages);

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

    console.debug("loading CodeBlock Customizer plugin");
  }// onload

  // lineCount: in editor mode including the fences, in reading mode the content line count (same as determineDefaultFoldState)
  setFoldState(filePath: string, key: number, newState: FoldingState, viewType: 'editor' | 'reading', parameters: CBCParameters, lineCount: number, isMemberOfTabbedGroup: boolean): void {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (markdownView) {
      const isGlobalCommandActive = (markdownView.getMode() === 'source' && markdownView.containerEl.classList.contains('codeblock-customizer-header-collapse-command')) ||
        (markdownView.getMode() === 'preview' && this.getFoldCommand(filePath) !== FoldCommand.Default);

      if (isGlobalCommandActive) {
        return;
      }
    }

    const foldSettings = this.settings.pluginSettings.codeblock.folding;
    const semiFoldSettings = this.settings.pluginSettings.semiFold;

    if (!foldSettings.rememberFoldState)
      return;

    // fix for #179: use the same default fold logic as the renderers
    const specificHeader = isSpecificHeader(parameters, this.settings, isMemberOfTabbedGroup, lineCount, viewType);
    const { foldByDefault } = determineDefaultFoldState(parameters, this.settings, lineCount, specificHeader, viewType);

    let defaultState: FoldingState = FoldingState.Unfolded;
    if (foldByDefault) {
      const contentLineCount = viewType === 'editor' ? lineCount - 2 : lineCount;
      const canSemiFold = semiFoldSettings.enableSemiFold && (getVisibleLineCount(parameters, contentLineCount) >= semiFoldSettings.visibleLines + fadeOutLineCount);
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

    const editorChanged = this.foldStoreEditor.remap(filePath, changes);
    const readingChanged = this.foldStoreReading.remap(filePath, changes);

    if (this.foldStoreEditor.isPermanent && (editorChanged || readingChanged)) {
      this.requestSavePermanentData();
    }
  }// remapFolds

  remapTabs(filePath: string, changes: ChangeSet): void {
    // the editor stores tab positions, reading view stores tab indexes, which an edit doesn't move
    if (this.tabStoreEditor.remapValues(filePath, changes) && this.tabStoreEditor.isPermanent) {
      this.requestSavePermanentData();
    }
  }// remapTabs

  private updateStoredPaths(update: (store: StateStore<string, number> | StateStore<number, FoldingState>) => boolean): void {
    let changed = false;
    for (const store of [this.foldStoreEditor, this.foldStoreReading, this.tabStoreEditor, this.tabStoreReading]) {
      changed = update(store) || changed;
    }

    if (changed) {
      this.requestSavePermanentData();
    }
  }// updateStoredPaths

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
      window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => void this.savePermanentData(), 2000);
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
    } catch {
      return {};
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
    void this.saveSettings();
  }// updateTheme

  onunload() {
    console.debug("unloading CodeBlock Customizer plugin");

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
    unregisterExecuteCodeSyntaxHighlighting(this.executeCodeLanguages);
    clearSettingStyles(this.app);

    if (this.debounceTimer)
      window.clearTimeout(this.debounceTimer);
    this.renderReadingViewsDebounced.cancel();

    void this.savePermanentData();
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
      // skip files that don't contain any code blocks
      if (!this.app.metadataCache.getCache(mdFile.path)?.sections?.some(section => section.type === "code"))
        continue;

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
          const ret = await this.findAllCodeBlockLinks(mdFile, codeBlock, oldPath, file);
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

  async findAllCodeBlockLinks(currentFile: TFile, currentCodeBlock: codeBlock, oldPath: string, newPath: TAbstractFile) {
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
      await this.updateLinksInFiles(this.app.vault, currentFile, currentCodeBlock.from, currentCodeBlock.to, currentCodeBlock.codeBlockText, modifiedCodeBlockText);
    }
    return linkUpdateCount;
  }// findAllCodeBlockLinks

  updateCodeBlockContent(match: RegExpMatchArray, currentFile: TFile, oldPath: string, newPath: TAbstractFile, updatedCodeBlockText: string) {
    const linkText = match[1];
    const linkTextWithoutDisplayName = linkText.split('|')[0].split('#')[0]; // Remove DisplayName
    const linkResolves = !!this.app.metadataCache.getFirstLinkpathDest(getLinkpath(linkTextWithoutDisplayName), currentFile.path);
    const newExtension = newPath instanceof TFile ? '.' + newPath.extension : null; // a folder has no extension
    const newLinkText = getRenamedLinkText(linkText, oldPath, newPath.path, newExtension, linkResolves);
    if (newLinkText === null) {
      return { updatedCodeBlockText, updated: false };
    }

    return { updatedCodeBlockText: updatedCodeBlockText.replace(match[0], () => '[[' + newLinkText + ']]'), updated: true };
  }// updateCodeBlockContent

  async updateLinksInFiles(vault: Vault, file: TFile, startLine: number, endLine: number, originalText: string, newText: string): Promise<void> {
    try {
      await vault.process(file, (currentContent) => {
        const modifiedContent = replaceLinesIfUnchanged(currentContent, startLine, endLine, originalText, newText);
        if (modifiedContent === null) {
          // the file changed since it was read, so these lines may hold something else now
          new Notice(`Code block links in "${file.path}" were not updated, because the file changed in the meantime.`);
          return currentContent;
        }

        return modifiedContent;
      });
    } catch (error) {
      console.error("Error modifying file:", error);
    }
  }// updateLinksInFiles

  async loadSettings() {
    const loadedData = (await this.loadData()) as LoadedPluginData | null;

    if (loadedData && loadedData.SelectedTheme?.settings && !loadedData.pluginSettings) {
      console.debug("Codeblock Customizer: Migrating settings to new structure.");

      // use the old settings from SelectedTheme
      loadedData.pluginSettings = structuredClone(loadedData.SelectedTheme.settings);

      // delete settings object for all old themes
      for (const themeName in loadedData.Themes) {
        if (loadedData.Themes[themeName]?.settings) {
          delete loadedData.Themes[themeName].settings;
        }
      }
      delete loadedData.SelectedTheme.settings;

      console.debug("Codeblock Customizer: Settigns migrated successfully.");
    }

    // merge highlightcolor and alternatehighlightcolors to HighlightStyle
    if (loadedData) {
      for (const theme of [loadedData.SelectedTheme, ...Object.values(loadedData.Themes ?? {})]) {
        for (const mode of ['light', 'dark'] as const) {
          const codeblock = theme?.colors?.[mode]?.codeblock;
          if (!codeblock) {
            continue;
          }

          if (typeof codeblock.highlightColor === 'string') {
            codeblock.highlightColor = { useBackgroundColor: true, backgroundColor: codeblock.highlightColor };
          }
          // the reset button saved an empty colour for the default --text-highlight-bg, which Obsidian 1.14+ no longer sets
          if (codeblock.highlightColor?.backgroundColor === '') {
            codeblock.highlightColor.backgroundColor = '--text-highlight-bg';
          }

          for (const [key, value] of Object.entries(codeblock.alternateHighlightColors ?? {})) {
            if (typeof value === 'string' && codeblock.alternateHighlightColors) {
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
    window.requestAnimationFrame(() => {
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
        this.renderReadingView(leaf.view);
      }
    });
  }// renderReadingViews

  private renderReadingView(view: MarkdownView): void {
    const preview = view.previewMode;
    if (!preview || !preview.getScroll || !preview.applyScroll) {
      return;
    }

    const scrollState = preview.getScroll();

    preview.rerender(true);

    window.setTimeout(() => {
      preview.applyScroll(scrollState);
    }, 100);
  }// renderReadingView

  getRerenderKey(path: string, line: number): string {
    return `${path}|${line}`;
  }// getRerenderKey

  getFoldCommand(path: string): FoldCommand {
    return this.foldCommandTrigger?.path === path ? this.foldCommandTrigger.command : FoldCommand.Default;
  }// getFoldCommand

  private executeFoldCommand(func: (view: EditorView) => void, foldCommand: FoldCommand, action: 'add' | 'remove'): void {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView) {
      return;
    }

    markdownView.containerEl.classList[action]('codeblock-customizer-header-collapse-command');
    const mode = markdownView.getMode();
    if (mode === 'source') {
      func((markdownView.editor as Editor & { cm: EditorView }).cm);
    } else if (mode === 'preview') {
      const path = markdownView.file?.path;
      this.foldCommandTrigger = path ? { command: foldCommand, path } : null;
      this.renderReadingView(markdownView);
    }
  }// executeFoldCommand

  addCommands() {
    // add fold all command
    this.addCommand({
      id: 'foldall-editor',
      name: 'Fold all code blocks',
      callback: () => this.executeFoldCommand(this.editorExtensions.foldAll, FoldCommand.FoldAll, 'add')
    });

    // add unfold all command
    this.addCommand({
      id: 'unfoldall-editor',
      name: 'Unfold all code blocks',
      callback: () => this.executeFoldCommand(this.editorExtensions.unfoldAll, FoldCommand.UnfoldAll, 'add')
    });

    // restore default state
    this.addCommand({
      id: 'restore-fold-editor',
      name: 'Restore folding state of all code blocks to default',
      callback: () => this.executeFoldCommand(this.editorExtensions.restoreDefaultFold, FoldCommand.Default, 'remove')
    });

    // indent code block
    this.addCommand({
      id: 'indent-codeblock',
      name: 'Indent code block by one level',
      editorCallback: async (editor: Editor) => {
        await indentCodeBlock(editor);
      }
    });

    // unindent code block
    this.addCommand({
      id: 'unindent-codeblock',
      name: 'Unindent code block by one level',
      editorCallback: async (editor: Editor) => {
        await unIndentCodeBlock(editor);
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

    // admonitions
    this.registerMarkdownPostProcessor(async (el, ctx) => {
      await admonitionPostProcessor(el, ctx, this)
    });
  }// registerPostProcessors

  registerEvents(settingsTab: SettingsTab) {
    this.registerEvent(this.app.workspace.on('css-change', () => this.handleCssChange(settingsTab), this));

    this.registerEvent(this.app.workspace.on('window-open', (_workspaceWindow, win) => {
      win.document.body?.classList.add('codeblock-customizer');
      updateSettingStyles(this.settings, this.app);
    }));

    this.registerEvent(this.app.vault.on('delete', (file: TAbstractFile) => {
      this.updateStoredPaths(store => store.deletePath(file.path));
    }, this));

    this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      this.updateStoredPaths(store => store.renamePath(oldPath, file.path));

      if (this.settings.pluginSettings.codeblock.enableLinks && this.settings.pluginSettings.codeblock.enableLinkUpdate) {
        // until Obsidian doesn't adds code block links to metadatacache
        this.renameQueue = this.renameQueue
          .then(() => this.handleFileRename(file, oldPath))
          .catch(error => console.error("Error updating code block links:", error));
      }
    }, this));

    // process new active leaves (e.g. note switches)
    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
      if (leaf && leaf.view instanceof MarkdownView && leaf.view.getMode() === 'preview') {
        this.registerGroupedRenderChildForView(leaf.view);
      }

      // check if there is a pending save operation scheduled by the timer and save it
      if (this.debounceTimer) {
        window.clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
        void this.savePermanentData();
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

    this.registerEvent(this.app.workspace.on('file-open', () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) {
        return;
      }
      view.containerEl.classList.remove('codeblock-customizer-header-collapse-command');
      this.foldCommandTrigger = null;
    }));
  }// registerEvents

  rerenderCodeblock(file: TFile, lineStart: number, newParametersLine?: string) {
    const targets: { renderer: PreviewRenderer; section: PreviewSection }[] = [];

    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view as MarkdownView;
      if (view.file?.path !== file.path || view.getMode() !== 'preview') {
        continue;
      }

      const renderer = (view.previewMode as unknown as { renderer?: PreviewRenderer }).renderer;
      if (!renderer?.sections) {
        continue;
      }

      let sectionToRerender: PreviewSection | undefined;
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
        this.rerenderQueue.set(this.getRerenderKey(file.path, lineStart), { content: newParametersLine, count: targets.length });
      }

      for (const target of targets) {
        target.section.rendered = false;
        target.section.html = '';
        target.renderer.queueRender();
      }
    }
  }// rerenderCodeblock
}
