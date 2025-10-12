import { MarkdownRenderChild, MarkdownView } from "obsidian";

import { getLanguageIcon, createCodeblockIcon, createCodeblockLang, getDisplayLanguageName, CBCParameters, getLanguageSpecificColorClass, getDefaultParameters, getCurrentMode, createContainer, createFileName, createCodeblockCollapse, getBorderColorByLanguage, getPropertyFromLanguageSpecificColors, isSpecificHeader, determineDefaultFoldState } from "./Utils";
import { createButtons, toggleFold } from "./ReadingViewUtils";
import { fadeOutLineCount } from "./Const";
import CodeBlockCustomizerPlugin from "./main";
import { FoldingState } from "./EditorExtensions";
import { FoldingScope, TabPersistence } from "./Settings";

export class GroupedCodeBlockRenderChild extends MarkdownRenderChild {
  private view: MarkdownView;
  private clickListeners: Array<() => void> = [];
  private childMap: Map<MarkdownView, GroupedCodeBlockRenderChild>;
  private observer: MutationObserver | null = null;
  private debouncedProcess: () => void;
  private plugin: CodeBlockCustomizerPlugin;
  private hoverListeners: Array<() => void> = [];
  private activeExecuteCodeObserver: MutationObserver | null = null;
  
  constructor(containerEl: HTMLElement, view: MarkdownView, childMap: Map<MarkdownView, GroupedCodeBlockRenderChild>, plugin: CodeBlockCustomizerPlugin) {
    super(containerEl);
    this.view = view;
    this.childMap = childMap;
    this.plugin = plugin;
    this.debouncedProcess = debounce(() => this.processGroupedCodeBlocks(), 50, false);
  }

  async onload() {
    this.processGroupedCodeBlocks();
    this.setupMutationObserver(['class', 'groupname']);  
  }// onload

  onunload() {
    this.childMap.delete(this.view);
    this.cleanupListeners();
    this.disconnectObserver();
    if (this.activeExecuteCodeObserver) {
      this.activeExecuteCodeObserver.disconnect();
      this.activeExecuteCodeObserver = null;
    }
  }// onunload

  public processGroupedCodeBlocks() {
    this.cleanup();

    const allCodeBlockContainers: NodeListOf<HTMLPreElement> = this.containerEl.querySelectorAll('.el-pre.codeblock-customizer-pre-parent');
    if (allCodeBlockContainers.length === 0) {
      this.reconnectObserver();
      return;
    }

    const consecutiveGroups = this.getConsecutiveGroups(allCodeBlockContainers);
    const processedGroupNames = new Set<string>();

    consecutiveGroups.forEach((group) => {
      const isGroupedBlock = group[0].classList.contains('codeblock-customizer-grouped');
      const groupName = group[0].getAttribute('groupname');

      if (isGroupedBlock && group.length > 1 && groupName && !processedGroupNames.has(groupName)) {
        processedGroupNames.add(groupName);
        this.processGroup(group, groupName);
      } else {
        group.forEach(blockElement => {
          blockElement.style.display = ''; // is this needed?
        });
      }
    });

    this.reconnectObserver();
  }// processGroupedCodeBlocks

  private cleanup() { 
    this.disconnectObserver();

    this.containerEl.querySelectorAll('.codeblock-customizer-header-group-container').forEach(header => header.remove());
    this.containerEl.querySelectorAll('.markdown-rendered .codeblock-customizer-header-group-tabs').forEach(tabs => tabs.remove());
    
    if (this.activeExecuteCodeObserver) {
      this.activeExecuteCodeObserver.disconnect();
      this.activeExecuteCodeObserver = null;
    }

    this.cleanupListeners();
  }// cleanup

  private processGroup(group: HTMLPreElement[], groupName: string) {
    const firstBlock = group[0];

    this.hideGroupedCodeBlocks(group);

    const parameters = this.getParametersFromElement(firstBlock);
    const sourcePath = firstBlock.getAttribute('sourcepath') || '';
    const lineCount = firstBlock.querySelectorAll('code > div').length;
    const header = this.createHeader(parameters, groupName, lineCount)
    const frag = document.createDocumentFragment();
  
    let languageIconElement: HTMLElement;
    if (parameters.displayLanguage) {
      const Icon = getLanguageIcon(parameters.displayLanguage);
      languageIconElement = Icon ? createCodeblockIcon(parameters.displayLanguage) : createCodeblockIcon("NoIcon");
    } else {
      languageIconElement = createCodeblockIcon("NoIcon");
    }
    header.appendChild(languageIconElement);

    let collapseIconElement: HTMLElement | null = null;
    const fileNameContainer = createFileName(parameters.headerDisplayText, this.plugin.settings.pluginSettings.codeblock.enableLinks, sourcePath, this.plugin);
    const groupButtonsContainer = createDiv({ cls: `codeblock-customizer-button-container` });

    const updateGroupHeader = (currentBlock: HTMLPreElement) => {
      const currentParameters = this.getParametersFromElement(currentBlock);
      this.updateHeaderLanguageClasses(header, currentParameters.language);
      this.updateHeaderLanguageSpecificClasses(header, currentParameters.language);
      languageIconElement = this.updateHeaderLanguageIcon(header, languageIconElement, currentParameters.displayLanguage);
      this.updateHeaderButtons(groupButtonsContainer, currentParameters, currentBlock);
      collapseIconElement = this.updateHeaderCollapseIcon(collapseIconElement, header, currentBlock, currentParameters, lineCount);
      this.updateHeaderFileName(fileNameContainer, currentParameters.headerDisplayText);
    };

    const documentPath = this.view.file?.path || 'unknown_document';
    const tabsContainer = this.addTabs(frag, group, updateGroupHeader, groupName, documentPath );

    frag.appendChild(fileNameContainer);
    frag.appendChild(groupButtonsContainer);
    header.appendChild(frag);
    
    const currentlyActiveBlock = group[this.getStoredTabIndex(groupName, documentPath)];
    if (currentlyActiveBlock) {
      updateGroupHeader(currentlyActiveBlock);
    } else {
      updateGroupHeader(firstBlock); // Fallback to first block if no active block found
    }

    this.addHeaderClickHandler(header, tabsContainer, group);

    if (firstBlock && firstBlock.parentElement) {
      firstBlock.parentElement.prepend(header);
      this.addHeaderHoverEffect(header, group, groupButtonsContainer);
    }
  }// processGroup

  private updateHeaderLanguageClasses(container: HTMLElement, language: string) {
    this.removeLanguageClasses(container);
    container.classList.add(`codeblock-customizer-language-` + (language.length > 0 ? language.toLowerCase() : "nolang"));

    const borderColor = getBorderColorByLanguage(language, getPropertyFromLanguageSpecificColors("codeblock.borderColor", this.plugin.settings));
    if (borderColor.length > 0) {
      container.classList.add(`hasLangBorderColor`);
    } else {
      container.classList.remove(`hasLangBorderColor`);
    }
  }// updateHeaderLanguageClasses

  private updateHeaderLanguageSpecificClasses(container: HTMLElement, language: string) {
    this.removeLanguageSpecificClasses(container);
    const codeblockLanguageSpecificClass = getLanguageSpecificColorClass(language, this.plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors);
    if (codeblockLanguageSpecificClass) {
      container.classList.add(codeblockLanguageSpecificClass);
    }
  }// updateHeaderLanguageSpecificClasses

  private updateHeaderLanguageIcon(container: HTMLElement, iconElement: HTMLElement, displayLanguage: string): HTMLElement {
    if (iconElement && iconElement.parentNode) {
      iconElement.parentNode.removeChild(iconElement);
    }

    let newIconElement: HTMLElement;
    if (displayLanguage) {
      const Icon = getLanguageIcon(displayLanguage);
      newIconElement = Icon ? createCodeblockIcon(displayLanguage) : createCodeblockIcon("NoIcon");
    } else {
      newIconElement = createCodeblockIcon("NoIcon");
    }

    container.prepend(newIconElement);
    return newIconElement;
  }// updateHeaderLanguageIcon

  private updateHeaderButtons(buttonsContainer: HTMLElement, parameters: CBCParameters, blockElement: HTMLPreElement) {
    buttonsContainer.empty();

    if (this.activeExecuteCodeObserver) {
      this.activeExecuteCodeObserver.disconnect();
      this.activeExecuteCodeObserver = null;
    }

    const { container: tempButtonsContainer, observer } = createButtons(parameters, undefined, this.plugin, blockElement);
    this.activeExecuteCodeObserver = observer;
    while (tempButtonsContainer.firstChild) {
      buttonsContainer.appendChild(tempButtonsContainer.firstChild);
    }

    const parentContainer = blockElement.parentElement;
    if (parentContainer) {
      const originalClearButton = parentContainer.querySelector('.clear-button');
      if (originalClearButton) {
        const customClearButton = buttonsContainer.querySelector('.codeblock-customizer-execute-code-clear-button');
        if (customClearButton) {
          customClearButton.classList.remove('codeblock-customizer-execute-code-clear-button-hidden');
        }
      }
    }
  }// updateHeaderButtons

  private updateHeaderCollapseIcon(collapseIcon: HTMLElement | null, header: HTMLElement, currentBlock: HTMLPreElement, parameters: CBCParameters, lineCount: number): HTMLElement | null {
    if (collapseIcon && collapseIcon.parentElement === header) {
      header.removeChild(collapseIcon);
    }

    const disableFoldUnlessSpecified = this.plugin.settings.pluginSettings.header.disableFoldUnlessSpecified;
    const specificHeader = isSpecificHeader(parameters, this.plugin.settings, true, lineCount, "reading");
    const { foldByDefault } = determineDefaultFoldState(parameters, this.plugin.settings, lineCount, specificHeader, "reading");
    const isCollapseEnabled = !disableFoldUnlessSpecified || foldByDefault;
    /*const { inverseFold, ignoreShortBlocksOnInverseFold } = this.plugin.settings.pluginSettings.codeblock.folding;
    const { enableSemiFold, visibleLines } = this.plugin.settings.pluginSettings.semiFold;
    const canSemiFold = enableSemiFold && lineCount >= visibleLines + fadeOutLineCount;
    const foldByDefault = parameters.fold || (inverseFold && !parameters.unfold && (!ignoreShortBlocksOnInverseFold || canSemiFold));
    const isCollapseEnabled = !disableFoldUnlessSpecified || foldByDefault;*/
    let newCollapseIcon: HTMLElement | null = null;

    if (isCollapseEnabled) {
      const isFullyCollapsed = currentBlock.classList.contains('codeblock-customizer-codeblock-collapsed');
      const isSemiCollapsed = currentBlock.classList.contains('codeblock-customizer-codeblock-semi-collapsed');

      newCollapseIcon = createCodeblockCollapse(isFullyCollapsed || isSemiCollapsed);
      header.appendChild(newCollapseIcon);
      header.classList.remove("collapsed", "semi-collapsed");

      if (isFullyCollapsed) {
        header.classList.add("collapsed");
      } else if (isSemiCollapsed) {
        header.classList.add("semi-collapsed");
      }
    } else {
      header.classList.add(`noCollapseIcon`); 
      header.classList.remove("collapsed", "semi-collapsed");
    }

    return newCollapseIcon; 
  }// updateHeaderCollapseIcon

  private updateHeaderFileName(fileNameElement: HTMLElement, headerDisplayText: string) {
    fileNameElement.empty();
    fileNameElement.setText(headerDisplayText);
  }// updateHeaderFileName

  private addHeaderClickHandler(headerContainer: HTMLElement, tabsContainer: HTMLElement, group: HTMLPreElement[]) {
    const headerClickHandler = (event: MouseEvent) => {
      if (!tabsContainer.contains(event.target as Node)) {
        const activeBlock = group.find(block => block.style.display !== 'none');
        if (!activeBlock) 
          return;

       this.foldCodeBlcok(activeBlock, headerContainer);
      }
    };
    headerContainer.addEventListener('click', headerClickHandler);
    this.clickListeners.push(() => headerContainer.removeEventListener('click', headerClickHandler));
  }// addHeaderClickHandler

  private addHeaderHoverEffect(headerContainer: HTMLElement, groupedBlocks: HTMLPreElement[], buttonsContainer: HTMLElement) {
    buttonsContainer.classList.add("hidden");

    const mouseEnterHandler = () => {
      buttonsContainer.classList.remove("hidden");
    };

    const mouseLeaveHandler = () => {
      buttonsContainer.classList.add("hidden");
    };

    const elementsToHover = [headerContainer, ...groupedBlocks];

    elementsToHover.forEach(element => {
      element.addEventListener('mouseenter', mouseEnterHandler);
      element.addEventListener('mouseleave', mouseLeaveHandler);
      this.hoverListeners.push(() => {
        element.removeEventListener('mouseenter', mouseEnterHandler);
        element.removeEventListener('mouseleave', mouseLeaveHandler);
      });
    });
  }// addHeaderHoverEffect

  private hideGroupedCodeBlocks(group: HTMLPreElement[]) {
    group.forEach(blockElement => {
      const existingHeader = blockElement.querySelector('.codeblock-customizer-header-container-specific');
      if (existingHeader) {
        existingHeader.remove();
      }
      blockElement.style.display = 'none';
      blockElement.classList.add('displayedInGroup');
    });
  }// hideGroupedCodeBlocks

  private createHeader(params: CBCParameters, groupName: string, lineCount: number): HTMLElement {
    const codeblockLanguageSpecificClass = getLanguageSpecificColorClass(params.language, this.plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors);
    const specificHeader = isSpecificHeader(params, this.plugin.settings, true, lineCount, "reading");
    const container = createContainer(specificHeader, params.language, false, codeblockLanguageSpecificClass, 'codeblock-customizer-header-group-container');
    container.setAttribute("group", groupName);
    return container;
  }// createHeader

  private setupMutationObserver(attributes: string[]) {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver((mutations) => {
      let process = false;
      for (const mutation of mutations) {
        // child list changes (addition/removal of <pre> or other elements)
        if (mutation.type === 'childList') {
          const isExecuteCodeMutation = (nodes: NodeList) => {
            return Array.from(nodes).some(node => {
              if (node.nodeType !== Node.ELEMENT_NODE) {
                return false;
              }
              const el = node as HTMLElement;
              return el.querySelector('.language-output, .clear-button') || el.matches('.language-output, .clear-button, .load-state-indicator');
            });
          };

          if (isExecuteCodeMutation(mutation.addedNodes) || isExecuteCodeMutation(mutation.removedNodes)) {
            continue;
          }

          const targetEl = mutation.target as HTMLElement;
          if (targetEl.tagName === 'PRE' || targetEl.querySelector('pre.codeblock-customizer-grouped')) {
            process = true;
            break;
          }
        } else if (mutation.type === 'attributes' && mutation.attributeName === 'groupname') {
          // attribute changes, specifically for 'groupname'
          process = true;
          break;
        }
      }

      if (process) {
        this.debouncedProcess();
      }
    });

    this.observer.observe(this.containerEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: attributes,
      attributeOldValue: true
    });
  }// setupMutationObserver

  private disconnectObserver() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }// disconnectObserver

  private reconnectObserver() {
    if (this.observer) {
      this.observer.observe(this.containerEl, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'groupname'], attributeOldValue: true
      });
    }
  }// reconnectObserver

  private cleanupListeners(){
    this.clickListeners.forEach(removeListener => removeListener());
    this.clickListeners = [];
    this.hoverListeners.forEach(removeListener => removeListener());
    this.hoverListeners = [];
  }//cleanupListeners

  private removeLanguageClasses(element: HTMLElement) {
    const regex = /\bcodeblock-customizer-language-[^\s]+\b/g;

    if (element && element.className) {
      element.className = element.className.replace(regex, '').trim();
    }
  }// removeLanguageClasses

  private removeLanguageSpecificClasses(element: HTMLElement) {
    const regex = /\bcodeblock-customizer-languageSpecific-[^\s]+\b/g;

    if (element && element.className) {
      element.className = element.className.replace(regex, '').trim();
    }
  }// removeLanguageSpecificClasses

  private getConsecutiveGroups(allCodeBlockContainers: NodeListOf<HTMLPreElement>): HTMLPreElement[][] {
    const distinctConsecutiveGroups: HTMLPreElement[][] = [];
    let currentConsecutiveGroup: HTMLPreElement[] = [];

    const containerArray = Array.from(allCodeBlockContainers);

    for (let i = 0; i < containerArray.length; i++) {
      const currentContainer = containerArray[i];
      const currentPreElement = currentContainer.querySelector('pre.codeblock-customizer-grouped') as HTMLPreElement | null;

      if (!currentPreElement) {
        if (currentConsecutiveGroup.length > 0) {
          distinctConsecutiveGroups.push(currentConsecutiveGroup);
          currentConsecutiveGroup = [];
        }
        continue;
      }

      const currentGroupName = currentPreElement.getAttribute('groupname');

      if (currentGroupName) {
        if (currentConsecutiveGroup.length === 0) {
          currentConsecutiveGroup.push(currentPreElement);
        } else {
            const lastContainerInGroup = currentConsecutiveGroup[currentConsecutiveGroup.length - 1].closest('.el-pre.codeblock-customizer-pre-parent');
            if (!lastContainerInGroup) {
              if (currentConsecutiveGroup.length > 0) {
                distinctConsecutiveGroups.push(currentConsecutiveGroup);
              }
              currentConsecutiveGroup = [currentPreElement];
              continue;
            }

            let nextNode: ChildNode | null = lastContainerInGroup.nextSibling;
            let foundDirectConsecutiveContainer = false;

            while (nextNode) {
              if (nextNode === currentContainer) {
                foundDirectConsecutiveContainer = true;
                break;
              }

              if (nextNode.nodeType === Node.ELEMENT_NODE) {
                break;
              }

              if (nextNode.nodeType === Node.TEXT_NODE && nextNode.textContent && nextNode.textContent.trim().length > 0) {
                break;
              }

              nextNode = nextNode.nextSibling;
            }

          if (foundDirectConsecutiveContainer && currentGroupName === currentConsecutiveGroup[0].getAttribute('groupname')) {
            currentConsecutiveGroup.push(currentPreElement);
          } else {
            distinctConsecutiveGroups.push(currentConsecutiveGroup);
            currentConsecutiveGroup = [currentPreElement];
          }
        }
      } else {
        if (currentConsecutiveGroup.length > 0) {
          distinctConsecutiveGroups.push(currentConsecutiveGroup);
          currentConsecutiveGroup = [];
        }
      }
    }

    if (currentConsecutiveGroup.length > 0) {
      distinctConsecutiveGroups.push(currentConsecutiveGroup);
    }

    return distinctConsecutiveGroups;
  }// getConsecutiveGroups

  private getStoredTabIndex(groupName: string, documentPath: string): number {
    const tabSettings = this.plugin.settings.pluginSettings.groupedCodeBlocks;
    if (!tabSettings.rememberTabState) {
      return 0;
    }

    let documentState: Map<string, number> | undefined;
    if (tabSettings.persistence === TabPersistence.Permanent) {
      documentState = this.plugin.loadPermanentReadingViewTabs(documentPath);
    } else {
      documentState = this.plugin.activeReadingViewTabs.get(documentPath);
    }
    
    if (documentState) {
      const storedIndex = documentState.get(groupName);
      if (storedIndex !== undefined) {
        return storedIndex;
      }
    }
    return 0; // default to the first tab
  }/// getStoredTabIndex

  private setStoredTabIndex(groupName: string, documentPath: string, index: number) {
    const tabSettings = this.plugin.settings.pluginSettings.groupedCodeBlocks;
    if (!tabSettings.rememberTabState) {
      return;
    }

    if (tabSettings.persistence === TabPersistence.Permanent) {
      if (!this.plugin.permanentReadingViewTabs[documentPath]) {
        this.plugin.permanentReadingViewTabs[documentPath] = {};
      }
      this.plugin.permanentReadingViewTabs[documentPath][groupName] = index;
      this.plugin.requestSavePermanentData();
    } else {
      let documentState = this.plugin.activeReadingViewTabs.get(documentPath);
      if (!documentState) {
        documentState = new Map<string, number>();
        this.plugin.activeReadingViewTabs.set(documentPath, documentState);
      }
      documentState.set(groupName, index);
    }
  }// setStoredTabIndex

  private addTabs(frag: DocumentFragment, groupMembers: HTMLPreElement[], updateGroupHeader: (currentBlock: HTMLPreElement, tabsContainer: HTMLElement) => void, groupName: string, documentPath: string): HTMLElement {
    const tabsContainer = document.createElement('div');
    tabsContainer.classList.add('codeblock-customizer-header-group-tabs');

    let activeTabIndex = this.getStoredTabIndex(groupName, documentPath);
    // Ensure the stored index is within bounds
    if (activeTabIndex >= groupMembers.length) {
      activeTabIndex = 0;
    }

    const activeBlock = groupMembers[activeTabIndex];

    groupMembers.forEach((blockElement, index) => {
      const parameters = this.getParametersFromElement(blockElement);
      const displayLangName = getDisplayLanguageName(parameters.language);
      const tabText = parameters.tab || displayLangName || `Tab ${index + 1}`;

      const tab = createCodeblockLang(parameters.language, `codeblock-customizer-header-group-tab`, tabText);
      tab.setAttribute('data-codeblock-target-index', index.toString());

      if (blockElement === activeBlock) {
        tab.classList.add('active');
        blockElement.style.display = '';
      } else {
        tab.classList.remove('active');
        blockElement.style.display = 'none';
      }
      
      tabsContainer.appendChild(tab);
    });

    this.addTabClickHandler(tabsContainer, groupMembers, updateGroupHeader, groupName, documentPath);

    frag.appendChild(tabsContainer);
    return tabsContainer;
  }// addTabs

  private addTabClickHandler(tabsContainer: HTMLElement, groupMembers: HTMLPreElement[], updateGroupHeader: (currentBlock: HTMLPreElement, tabsContainer: HTMLElement) => void, groupName: string, documentPath: string) {
    const tabClickHandler = (event: MouseEvent) => {
      const clickedTab = (event.target as HTMLElement).closest('.codeblock-customizer-header-group-tab') as HTMLElement | null;
      if (!clickedTab) 
        return;

      const targetIndex = parseInt(clickedTab.getAttribute('data-codeblock-target-index') || '0', 10);
      const blockElement = groupMembers[targetIndex];
      if (!blockElement) 
        return;

      const isActive = clickedTab.classList.contains('active');
      if (isActive) {
        // if the clicked tab is already active, only fold/unfold
        const mainHeader = tabsContainer.parentElement;
        if (mainHeader) {
          this.foldCodeBlcok(blockElement, mainHeader);
        }
      } else {
        // if a different tab is clicked, hide all blocks and show that block
        this.switchTab(clickedTab, blockElement, groupMembers, tabsContainer, updateGroupHeader);
        this.setStoredTabIndex(groupName, documentPath, targetIndex);
      }
    };

    tabsContainer.addEventListener('click', tabClickHandler);
    this.clickListeners.push(() => tabsContainer.removeEventListener('click', tabClickHandler));
  }// addTabClickHandler

  private foldCodeBlcok(activeBlock: HTMLPreElement, header: HTMLElement) {
    const lines = activeBlock.querySelectorAll('code > div');
    const codeblockLineCount = lines.length;
    const semiFoldSettings = this.plugin.settings.pluginSettings.semiFold;
    const foldSettings = this.plugin.settings.pluginSettings.codeblock.folding;
    
    const currentCollapseIcon = header.querySelector('.codeblock-customizer-header-collapse') as HTMLElement | null;
    if (!currentCollapseIcon)
      return;

    const isCollapsed = activeBlock.classList.contains('codeblock-customizer-codeblock-collapsed');
    const isSemiCollapsed = activeBlock.classList.contains('codeblock-customizer-codeblock-semi-collapsed');
    const canSemiFold = semiFoldSettings.enableSemiFold && codeblockLineCount >= semiFoldSettings.visibleLines + fadeOutLineCount;

    let newState: FoldingState;
    if (isCollapsed || isSemiCollapsed) {
      newState = FoldingState.Unfolded;
    } else {
      newState = canSemiFold ? FoldingState.SemiFolded : FoldingState.FullyFolded;
    }

    if (canSemiFold) {
      toggleFold(activeBlock, currentCollapseIcon, 'codeblock-customizer-codeblock-semi-collapsed');
      if (header) {
        header.classList.toggle("semi-collapsed");
      }
    } else {
      toggleFold(activeBlock, currentCollapseIcon, 'codeblock-customizer-codeblock-collapsed');
      if (header) {
        header.classList.toggle("collapsed");
      }
    }

    const sourcePath = activeBlock.getAttribute('sourcepath');
    const charPosStr = activeBlock.dataset.charPos;
    const parameters = this.getParametersFromElement(activeBlock);
    const remember = foldSettings.scope === FoldingScope.All || (foldSettings.scope === FoldingScope.NoFoldSpecified && !parameters.fold && !parameters.unfold);

    if (remember && sourcePath && charPosStr) {
      const charPos = parseInt(charPosStr, 10);
      if (!isNaN(charPos)) {
        this.plugin.setFoldState(sourcePath, charPos, newState, 'reading', parameters, codeblockLineCount);
      }
    }
  }// foldCodeBlcok

  private switchTab(clickedTab: HTMLElement, targetBlock: HTMLPreElement, allGroupBlocks: HTMLPreElement[], tabsContainer: HTMLElement, updateHeaderCallback: (currentBlock: HTMLPreElement, tabsContainer: HTMLElement) => void) {
    allGroupBlocks.forEach(b => b.style.display = 'none');
    targetBlock.style.display = '';

    tabsContainer.querySelectorAll('.codeblock-customizer-header-group-tab').forEach(btn => btn.classList.remove('active'));
    clickedTab.classList.add('active');

    updateHeaderCallback(targetBlock, tabsContainer);
  }// switchTab

  private getParametersFromElement(element: HTMLElement): CBCParameters {
    const paramsJson = element.dataset.parameters;
    if (paramsJson) {
      try {
        return JSON.parse(paramsJson);
      } catch (e) {
        //console.error("Failed to parse parameters from element:", element, e);
        return getDefaultParameters();
      }
    }
    return getDefaultParameters();
  }// getParametersFromElement
}// GroupedCodeBlockRenderChild

function debounce<T extends (...args: any[]) => void>(func: T, wait: number, immediate: boolean) {
  let timeout: NodeJS.Timeout | null;
  let result: ReturnType<T> | undefined;

  return function(this: any, ...args: any[]) {
    const later = function() {
      timeout = null;
      if (!immediate) {
        result = func.apply(this, args);
      }
    };

    const callNow = immediate && !timeout;
    clearTimeout(timeout as NodeJS.Timeout);
    timeout = setTimeout(later, wait);
    if (callNow) {
      result = func.apply(this, args);
    }
    return result;
  } as T;
}// debounce
