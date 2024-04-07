import { Plugin, MarkdownView, WorkspaceLeaf, TAbstractFile, TFile, getLinkpath, Vault, Notice } from "obsidian";
import { Extension } from "@codemirror/state";
import * as _ from 'lodash';
import { DEFAULT_SETTINGS, CodeblockCustomizerSettings } from './Settings';
import { codeblockHighlight } from "./CodeBlockHighlight";
import { codeblockHeader, collapseField, foldAll } from "./Header";
import { ReadingView, calloutPostProcessor, convertHTMLCollectionToArray, foldAllReadingView, toggleFoldClasses } from "./ReadingView";
import { SettingsTab } from "./SettingsTab";
import { loadIcons, BLOBS, updateSettingStyles } from "./Utils";

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
  
  async onload() {
    document.body.classList.add('codeblock-customizer');
    await this.loadSettings();
    updateSettingStyles(this.settings, this.app);

    this.extensions = [];
    // npm install eslint@8.39.0 -g
    // eslint main.ts
    
  /* Problems to solve:
    - if a language is excluded then:
      - header needs to unfold before removing it,
  */

  // add fold all command
    this.addCommand({
      id: 'codeblock-customizer-foldall-editor',
      name: 'Fold all codeblocks',
      callback: () => {
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (markdownView) {
          // @ts-ignore
          const mode = markdownView.currentMode.type;
          document.body.classList.add('codeblock-customizer-header-collapse-command');
          this.settings.foldAllCommand = true;
          if (mode === "source") {
            // @ts-ignore
            foldAll(markdownView.editor.cm, this.settings, true, false);
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
      name: 'Unfold all codeblocks',
      callback: () => {
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (markdownView) {
          // @ts-ignore
          const mode = markdownView.currentMode.type;
          document.body.classList.add('codeblock-customizer-header-collapse-command');
          this.settings.foldAllCommand = true;
          if (mode === "source") {
            // @ts-ignore
            foldAll(markdownView.editor.cm, this.settings, false, false);
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
      name: 'Restore folding state of all codeblocks to default',
      callback: () => {
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (markdownView) {
          // @ts-ignore
          const mode = markdownView.currentMode.type;
          document.body.classList.remove('codeblock-customizer-header-collapse-command');
          this.settings.foldAllCommand = false;
          if (mode === "source") {
            // @ts-ignore
            foldAll(markdownView.editor.cm, this.settings, true, false);
            // @ts-ignore
            foldAll(markdownView.editor.cm, this.settings, false, true);
            foldAllReadingView(false, this.settings);
            this.restoreDefaultFold();
          } else if (mode === "preview") {
            foldAllReadingView(false, this.settings);
            this.restoreDefaultFold();
          }
        }
      }
    });

    await loadIcons(this);
    
    // @ts-ignore
    codeblockHeader.settings = this.settings;
    // @ts-ignore
    codeblockHeader.plugin = this;
    this.extensions.push(codeblockHeader);
    
    // @ts-ignore
    collapseField.pluginSettings = this.settings;
    this.extensions.push(collapseField);
        
    this.extensions.push(codeblockHighlight(this.settings, this));

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
  }// onunload
  
  async handleFileRename(file: TAbstractFile, oldPath: string) {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    let linkUpdateCount = 0;
    let fileCount = 0;

    for (const mdFile of markdownFiles) {
      let linkUpdate = 0;
      const cache = this.app.metadataCache.getCache(mdFile.path);
      const currentFile = this.app.vault.getAbstractFileByPath(mdFile.path);
      if (!currentFile) {
        console.error(`File not found: ${mdFile.path}`);
        return;
      }

      const fileContent = await this.app.vault.cachedRead(<TFile> currentFile).catch((error) => {
        console.error(`Error reading file: ${error.message}`);
        return '';
      });

      const fileContentLines = fileContent.split(/\n/g);
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
    //this.settings = Object.assign({}, structuredClone(DEFAULT_SETTINGS), await this.loadData());
    const loadedData = await this.loadData();
    this.settings = _.merge({}, DEFAULT_SETTINGS, loadedData);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.app.workspace.updateOptions();
    updateSettingStyles(this.settings, this.app);
  }

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

  renderReadingViewOnStart() {
    this.app.workspace.iterateRootLeaves((currentLeaf: WorkspaceLeaf) => {
      if (currentLeaf.view instanceof MarkdownView) {
        const leafMode = currentLeaf.view.getMode();
        if (leafMode === "preview") {
          currentLeaf.view.previewMode.rerender(true);
        }
      }
    });
  }// renderReadingView
}
