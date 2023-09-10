import { Plugin, MarkdownView } from "obsidian";
import { Extension } from "@codemirror/state";
import * as _ from 'lodash';
import { DEFAULT_SETTINGS, CodeblockCustomizerSettings } from './Settings';
import { codeblockHighlight } from "./CodeBlockHighlight";
import { codeblockHeader, collapseField, foldAll } from "./Header";
import { ReadingView, calloutPostProcessor, convertHTMLCollectionToArray, foldAllReadingView, toggleFoldClasses } from "./ReadingView";
import { SettingsTab } from "./SettingsTab";
import { loadIcons, BLOBS, updateSettingStyles } from "./Utils";

// npm i @simonwep/pickr

export default class CodeBlockCustomizerPlugin extends Plugin {
  settings: CodeblockCustomizerSettings;
  extensions: Extension[];
  theme: string;
  
  async onload() {
    document.body.classList.add('codeblock-customizer');
    
    await this.loadSettings();
    this.extensions = [];
    // npm install eslint@8.39.0
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

    loadIcons();
    
    // @ts-ignore
    codeblockHeader.settings = this.settings;
    this.extensions.push(codeblockHeader);
    
    // @ts-ignore
    collapseField.pluginSettings = this.settings;
    this.extensions.push(collapseField);
        
    this.extensions.push(codeblockHighlight(this.settings));

    this.registerEditorExtension(this.extensions);

    const settingsTab = new SettingsTab(this.app, this);
    this.addSettingTab(settingsTab);
    if (this.settings.ThemeName == "") {
      this.updateTheme(settingsTab);
    } else {
      updateSettingStyles(this.settings);
    }
    
    this.registerEvent(this.app.workspace.on('css-change', this.handleCssChange.bind(this, settingsTab), this));

    // reading mode
    this.registerMarkdownPostProcessor(async (el, ctx) => {
      await ReadingView(el, ctx, this)
    });
    
    this.registerMarkdownPostProcessor(async (el, ctx) => {
      await calloutPostProcessor(el, ctx, this)
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
  
  async loadSettings() {
    //this.settings = Object.assign({}, structuredClone(DEFAULT_SETTINGS), await this.loadData());
    const loadedData = await this.loadData();
    this.settings = _.merge({}, DEFAULT_SETTINGS, loadedData);
  }

  async saveSettings() {
    updateSettingStyles(this.settings);
    await this.saveData(this.settings);
    this.app.workspace.updateOptions();
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
}
