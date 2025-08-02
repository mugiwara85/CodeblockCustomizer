import { Plugin, MarkdownView, WorkspaceLeaf, TAbstractFile, TFile, getLinkpath, Vault, Notice, Editor } from "obsidian";

import { ChangeSet, Extension, StateField } from "@codemirror/state";
import { EditorView, DecorationSet } from "@codemirror/view";

import { DEFAULT_SETTINGS, CodeblockCustomizerSettings, FoldingPersistence } from './Settings';
import { ReadingView, calloutPostProcessor, inlineCodeProcessor } from "./ReadingView";
import { SettingsTab } from "./SettingsTab";
import { loadIcons, BLOBS, updateSettingStyles, mergeBorderColorsToLanguageSpecificColors, loadSyntaxHighlightForCustomLanguages, customLanguageConfig, getFileCacheAndContentLines, indentCodeBlock, unIndentCodeBlock, CBCParameters} from "./Utils";
import { CodeBlockPositions, extensions, FoldCommand, FoldingState, updateValue } from "./EditorExtensions";
import { GroupedCodeBlockRenderChild } from "./GroupedCodeBlockRenderer";
import { fadeOutLineCount } from "./Const";

import * as _ from 'lodash';

// npm i @simonwep/pickr

interface codeBlock {
  codeBlockText: string;
  from: number;
  to: number;
}

interface PermanentFoldData {
  [filePath: string]: Record<number, FoldingState>;
}

type PermanentTabData = Record<string, Record<string, number>>;

export default class CodeBlockCustomizerPlugin extends Plugin {
  settings: CodeblockCustomizerSettings;
  extensions: Extension[];
  theme: string;
  editorExtensions: { extensions: (StateField<DecorationSet> | StateField<CodeBlockPositions[]> | Extension)[];
    foldAll: (view: EditorView) => void;
    unfoldAll: (view: EditorView) => void;
    restoreDefaultFold: (view: EditorView) => void;
    customBracketMatching: Extension;
    selectionMatching: Extension;
  }
  customLanguageConfig: customLanguageConfig | null;
  groupedChildrenMap: Map<MarkdownView, GroupedCodeBlockRenderChild>;
  activeEditorTabs: Map<string, Map<string, number>> = new Map();
  permanentEditorTabs: PermanentTabData = {};
  activeReadingViewTabs: Map<string, Map<string, number>> = new Map();
  permanentReadingViewTabs: PermanentTabData = {};
  activeEditorFolds: Map<string, Map<number, FoldingState>> = new Map();
  permanentEditorFolds: PermanentFoldData = {};
  activeReadingViewFolds: Map<string, Map<number, FoldingState>> = new Map();
  permanentReadingViewFolds: PermanentFoldData = {};
  debounceTimer: NodeJS.Timeout | null = null;
  foldCommandTrigger: FoldCommand = FoldCommand.Default;
  rerenderQueue: Map<number, { content: string; count: number }> = new Map();
  rerenderDebounceTimers: Map<number, NodeJS.Timeout> = new Map();
  modifiedBlocks: Map<string, string> = new Map();

  async onload() {
    document.body.classList.add('codeblock-customizer');
    await this.loadSettings();
    await this.loadAllPermanentData();
    updateSettingStyles(this.settings, this.app);

    this.extensions = [];
    this.customLanguageConfig = null;
    // npm install eslint@8.39.0 -g
    
    this.groupedChildrenMap = new Map<MarkdownView, GroupedCodeBlockRenderChild>();

    this.addCommands();
    
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
    
    this.registerPostProcessors();

    this.registerEvents(settingsTab);
    
    // process existing open preview views when the plugin loads
    this.app.workspace.onLayoutReady(() => {
      this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
        if (leaf.view instanceof MarkdownView && leaf.view.getMode() === 'preview') {
          this.registerGroupedRenderChildForView(leaf.view);
        }
      });
      this.renderReadingViewOnStart();
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

    const foldSettings = this.settings.SelectedTheme.settings.codeblock.folding;
    const semiFoldSettings = this.settings.SelectedTheme.settings.semiFold;

    if (!foldSettings.rememberFoldState) 
      return;

    let defaultState: FoldingState = FoldingState.Unfolded;
    const foldByDefault = parameters.fold || (foldSettings.inverseFold && !parameters.unfold);
    
    if (foldByDefault) {
      const canSemiFold = semiFoldSettings.enableSemiFold && (lineCount >= semiFoldSettings.visibleLines + fadeOutLineCount);
      defaultState = canSemiFold ? FoldingState.SemiFolded : FoldingState.FullyFolded;
    }

    const shouldDelete = (newState === defaultState);
    const isPermanent = foldSettings.persistence === FoldingPersistence.Permanent;
    const store = isPermanent ? (viewType === 'editor' ? this.permanentEditorFolds : this.permanentReadingViewFolds) : (viewType === 'editor' ? this.activeEditorFolds : this.activeReadingViewFolds);

    if (isPermanent) {
      // save to file file
      const permanentStore = store as PermanentFoldData;
      if (!permanentStore[filePath] && !shouldDelete) {
        permanentStore[filePath] = {};
      }

      if (permanentStore[filePath]) {
        const fileRecord = permanentStore[filePath];
        if (shouldDelete) {
          delete fileRecord[key];
        } else {
          fileRecord[key] = newState;
        }
        
        if (Object.keys(fileRecord).length === 0) {
          delete permanentStore[filePath];
        }
        this.requestSavePermanentData();
      }
    } else {
      // save to session
      const sessionStore = store as Map<string, Map<number, FoldingState>>;
      if (!sessionStore.has(filePath) && !shouldDelete) {
        sessionStore.set(filePath, new Map());
      }

      const fileMap = sessionStore.get(filePath);
      if (fileMap) {
        if (shouldDelete) {
          fileMap.delete(key);
        } else {
          fileMap.set(key, newState);
        }
      }
    }
  }// setFoldState

  remapFolds(filePath: string, changes: ChangeSet): void {
    const foldSettings = this.settings.SelectedTheme.settings.codeblock.folding;
    if (!foldSettings.rememberFoldState) 
      return;

    const remapRecord = (record: Record<number, FoldingState>): Record<number, FoldingState> => {
      const newRecord: Record<number, FoldingState> = {};
      for (const oldPosStr in record) {
        const newPos = changes.mapPos(Number(oldPosStr));
        newRecord[newPos] = record[oldPosStr];
      }
      return newRecord;
    };
    
    const remapMap = (map: Map<number, FoldingState>): Map<number, FoldingState> => {
      const newMap = new Map<number, FoldingState>();
      for (const [oldPos, state] of map.entries()) {
        const newPos = changes.mapPos(oldPos);
        newMap.set(newPos, state);
      }
      return newMap;
    };

    if (this.activeEditorFolds.has(filePath)) {
      const editorFolds = this.activeEditorFolds.get(filePath);
      if (editorFolds) {
        this.activeEditorFolds.set(filePath, remapMap(editorFolds));
      }
    }

    if (this.activeReadingViewFolds.has(filePath)) {
      const readingFolds = this.activeReadingViewFolds.get(filePath);
      if (readingFolds) {
        this.activeReadingViewFolds.set(filePath, remapMap(readingFolds));
      }
    }

    if (foldSettings.persistence === FoldingPersistence.Permanent) {
      if (this.permanentEditorFolds[filePath]) 
        this.permanentEditorFolds[filePath] = remapRecord(this.permanentEditorFolds[filePath]);
      
      if (this.permanentReadingViewFolds[filePath]) {
        const newlyRemappedRecord = remapRecord(this.permanentReadingViewFolds[filePath]);

        this.permanentReadingViewFolds[filePath] = newlyRemappedRecord;
      }
      
      this.requestSavePermanentData();
    }
  }// remapFolds
  
  remapTabs(filePath: string, changes: ChangeSet): void {
    const remapRecord = (record: Record<string, number>): Record<string, number> => {
      const newRecord: Record<string, number> = {};
      for (const groupName in record) {
        const oldPos = record[groupName];
        const newPos = changes.mapPos(oldPos);
        newRecord[groupName] = newPos;
      }
      return newRecord;
    };

    if (this.permanentEditorTabs[filePath]) {
      this.permanentEditorTabs[filePath] = remapRecord(this.permanentEditorTabs[filePath]);
    }
    if (this.permanentReadingViewTabs[filePath]) {
      this.permanentReadingViewTabs[filePath] = remapRecord(this.permanentReadingViewTabs[filePath]);
    }
  }// remapTabs

  syncFoldStatesOnViewChange(filePath: string, sourceView: 'editor' | 'reading') {
    const foldSettings = this.settings.SelectedTheme.settings.codeblock.folding;
    if (!foldSettings.rememberFoldState) {
      return;
    }

    const isPermanent = foldSettings.persistence === FoldingPersistence.Permanent;
    const sourceStore = isPermanent ? (sourceView === 'editor' ? this.permanentEditorFolds : this.permanentReadingViewFolds) : (sourceView === 'editor' ? this.activeEditorFolds : this.activeReadingViewFolds);
    const destStore = isPermanent ? (sourceView === 'editor' ? this.permanentReadingViewFolds : this.permanentEditorFolds) : (sourceView === 'editor' ? this.activeReadingViewFolds : this.activeEditorFolds);

    if (isPermanent) {
      // file
      const sourceData = (sourceStore as PermanentFoldData)[filePath];
      if (sourceData) {
        (destStore as PermanentFoldData)[filePath] = { ...sourceData };
      } else {
        delete (destStore as PermanentFoldData)[filePath];
      }
    } else { 
      // session
      const sourceData = (sourceStore as Map<string, Map<number, FoldingState>>).get(filePath);
      if (sourceData) {
        (destStore as Map<string, Map<number, FoldingState>>).set(filePath, new Map(sourceData));
      } else {
        (destStore as Map<string, Map<number, FoldingState>>).delete(filePath);
      }
    }
    
    if (isPermanent) {
      this.requestSavePermanentData();
    }
  }// syncFoldStatesOnViewChange
  
  async clearAllFoldData(): Promise<void> {
    this.activeEditorFolds.clear();
    this.activeReadingViewFolds.clear();

    this.permanentEditorFolds = {};
    this.permanentReadingViewFolds = {};
    
    await this.savePermanentData();
    
    this.app.workspace.updateOptions();
    this.renderReadingViews();
  }// clearAllFoldData

  async clearAllTabData(): Promise<void> {
    this.activeEditorTabs.clear();
    this.activeReadingViewTabs.clear();

    this.permanentEditorTabs = {};
    this.permanentReadingViewTabs = {};

    await this.savePermanentData();

    this.app.workspace.updateOptions();

    new Notice("Stored tab positions cleared!");
  }// clearAllTabData

  async loadAllPermanentData() {
    this.permanentEditorFolds = await this.loadPermanentDataFile<PermanentFoldData>('permanent-editor-folds.json');
    this.permanentReadingViewFolds = await this.loadPermanentDataFile<PermanentFoldData>('permanent-reading-folds.json');
    this.permanentEditorTabs = await this.loadPermanentDataFile<PermanentTabData>('permanent-editor-tabs.json');
    this.permanentReadingViewTabs = await this.loadPermanentDataFile<PermanentTabData>('permanent-reading-tabs.json');
  }// loadAllPermanentData

  requestSavePermanentData(): void {
    if (this.debounceTimer) 
      clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.savePermanentData(), 3000);
  }// requestSavePermanentData
  
  private async savePermanentData(): Promise<void> {
    await this.writePermanentDataFile<PermanentFoldData>('permanent-editor-folds.json', this.permanentEditorFolds);
    await this.writePermanentDataFile<PermanentFoldData>('permanent-reading-folds.json', this.permanentReadingViewFolds);
    await this.writePermanentDataFile<PermanentTabData>('permanent-editor-tabs.json', this.permanentEditorTabs);
    await this.writePermanentDataFile<PermanentTabData>('permanent-reading-tabs.json', this.permanentReadingViewTabs);
  }// savePermanentData
  
  async loadPermanentDataFile<T>(fileName: string): Promise<T> {
    try {
      const path = `${this.app.vault.configDir}/plugins/${this.manifest.id}/${fileName}`;
      const data = await this.app.vault.adapter.read(path);
      return JSON.parse(data) as T;
    } catch (e) {
      return {} as T;
    }
  }// loadPermanentDataFile

  private async writePermanentDataFile<T>(fileName: string, data: T): Promise<void> {
    try {
      const path = `${this.app.vault.configDir}/plugins/${this.manifest.id}/${fileName}`;
      await this.app.vault.adapter.write(path, JSON.stringify(data, null, 2)); // 2 for pretty printing
    } catch (e) {
      console.error(`Codeblock Customizer: Error saving ${fileName}:`, e);
    }
  }// writePermanentDataFile

  loadPermanentEditorFolds(filePath: string): Map<number, FoldingState> {
    const foldsRecord = this.permanentEditorFolds[filePath];
    return foldsRecord ? new Map(Object.entries(foldsRecord).map(([k, v]) => [Number(k), v as FoldingState])) : new Map();
  }// loadPermanentEditorFolds

  loadPermanentReadingViewFolds(filePath: string): Map<number, FoldingState> {
    const foldsRecord = this.permanentReadingViewFolds[filePath];
    return foldsRecord ? new Map(Object.entries(foldsRecord).map(([k, v]) => [Number(k), v as FoldingState])) : new Map();
  }// loadPermanentReadingViewFolds

  loadPermanentEditorTabs(filePath: string): Map<string, number> {
    const tabsRecord = this.permanentEditorTabs[filePath];
    return tabsRecord ? new Map(Object.entries(tabsRecord)) : new Map();
  }// loadPermanentEditorTabs
  
  loadPermanentReadingViewTabs(filePath: string): Map<string, number> {
    const tabsRecord = this.permanentReadingViewTabs[filePath];
    return tabsRecord ? new Map(Object.entries(tabsRecord)) : new Map();
  }// loadPermanentReadingViewTabs

  handleCssChange(settingsTab: SettingsTab) {
    this.updateTheme(settingsTab);
  }// handleCssChange
    
  updateTheme(settingsTab: SettingsTab) {
    settingsTab.applyTheme();
    this.saveSettings();
  }// updateTheme
  
  async onunload() {
    console.log("unloading CodeBlock Customizer plugin");

    // remove GroupedCodeBlockRenderChild
    this.groupedChildrenMap.forEach((child, view) => {
      view.removeChild(child); // onunload()
    });
    this.groupedChildrenMap.clear();

    // unload icons
    for (const url of Object.values(BLOBS)) {
      URL.revokeObjectURL(url)
    }

    // unload syntax highlight
    loadSyntaxHighlightForCustomLanguages(this, true);

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
      //console.log("Existing GroupedCodeBlockRenderChild found for this view. Re-processing.");
      // if the view already has the child, just tell it to re-process its content
      child.processGroupedCodeBlocks(); // Make sure this method is public in GroupedCodeBlockRenderChild
    } else {
      // create a new child if one doesn't exist for this view
      const renderChild = new GroupedCodeBlockRenderChild(markdownView.containerEl, markdownView, this.groupedChildrenMap, this);
      markdownView.addChild(renderChild);
      this.groupedChildrenMap.set(markdownView, renderChild);
      //console.log("Registered NEW GroupedCodeBlockRenderChild for view:", markdownView);
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

    userThemeNames.forEach(themeName => {
      const userTheme = this.settings.Themes[themeName];
      const baseThemeName = userTheme.baseTheme;

      if (baseThemeName) {
        // copy new settings from corresponding Theme to user themes which do have a baseTheme (created after this change)
        const baseTheme = this.settings.Themes[baseThemeName];
        if (baseTheme) {
          userTheme.settings = _.merge({}, baseTheme.settings, userTheme.settings);
          userTheme.colors = _.merge({}, baseTheme.colors, userTheme.colors);
        }
      } else {
        // copy new settings from Obsidian Theme to user themes which do not have a baseTheme (created before this change)
        const defaultObsidianSettings = this.settings.Themes["Obsidian"];
        userTheme.settings = _.merge({}, defaultObsidianSettings.settings, userTheme.settings);
        userTheme.colors = _.merge({}, defaultObsidianSettings.colors, userTheme.colors);
      }
    });
    
    // merge master theme with SelectedTheme
    const masterTheme = this.settings.Themes[this.settings.ThemeName];
    const workingCopyTheme = loadedData?.SelectedTheme;
    if (masterTheme) {
      this.settings.SelectedTheme = _.merge({}, masterTheme, workingCopyTheme);
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

    if (this.settings.SelectedTheme.settings.codeblock.folding.persistence === FoldingPersistence.Permanent) {
      this.requestSavePermanentData();
    }
  }// saveSettings

  renderReadingViews(): void {
    this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
      if (leaf.view instanceof MarkdownView && leaf.view.getMode() === "preview") {
        // @ts-ignore
        leaf.view.previewMode.rerender(true);
      }
    });
  }// renderReadingViews

  addCommands() {
    // add fold all command
    this.addCommand({
      id: 'codeblock-customizer-foldall-editor',
      name: 'Fold all code blocks',
      callback: () => {
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (markdownView) {
          markdownView.containerEl.classList.add('codeblock-customizer-header-collapse-command');
          const mode = markdownView.getMode();
          if (mode === 'source') {
            // @ts-ignore
            this.editorExtensions.foldAll(markdownView.editor.cm);
          } else if (mode === "preview") {
            this.foldCommandTrigger = FoldCommand.FoldAll;
            this.renderReadingViews();
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
          markdownView.containerEl.classList.add('codeblock-customizer-header-collapse-command');
          const mode = markdownView.getMode(); 
          if (mode === "source") {
            // @ts-ignore
            this.editorExtensions.unfoldAll(markdownView.editor.cm);
          } else if (mode === "preview") {
            this.foldCommandTrigger = FoldCommand.UnfoldAll;
            this.renderReadingViews();
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
          markdownView.containerEl.classList.remove('codeblock-customizer-header-collapse-command');
          const mode = markdownView.getMode();
          if (mode === "source") {
            // @ts-ignore
            this.editorExtensions.restoreDefaultFold(markdownView.editor.cm);
          } else if (mode === "preview") {
            this.foldCommandTrigger = FoldCommand.Default;
            this.renderReadingViews();
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
  }// addCommands

  registerPostProcessors(){
    // reading mode
    this.registerMarkdownPostProcessor(async (el, ctx) => {
      await ReadingView(el, ctx, this)
    });

    // inline code
    this.registerMarkdownPostProcessor((element, context) => {
      inlineCodeProcessor(element, context, this);
    });

    // callouts
    this.registerMarkdownPostProcessor(async (el, ctx) => {
      await calloutPostProcessor(el, ctx, this)
    });
  }// registerPostProcessors

  registerEvents(settingsTab: SettingsTab) {
    this.registerEvent(this.app.workspace.on('css-change', this.handleCssChange.bind(this, settingsTab), this));
    
    this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (this.settings.SelectedTheme.settings.codeblock.enableLinks && this.settings.SelectedTheme.settings.codeblock.enableLinkUpdate) {
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
            this.syncFoldStatesOnViewChange(markdownView.file.path, 'editor');
            
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
          } else if (currentMode === 'source') {
            this.syncFoldStatesOnViewChange(markdownView.file.path, 'reading');
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
        if (section.lineStart <= lineStart && section.lineEnd >= lineStart) {
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
