import { setIcon, MarkdownRenderer } from "obsidian";

import CodeBlockCustomizerPlugin from "./main";

export const ANNOTATION_TYPE_ICONS: Record<string, string> = {
  note: 'info',
  warn: 'alert-triangle',
  error: 'alert-octagon',
  todo: 'check-square',
  question: 'help-circle',
  see: 'link',
};

export const ANNOTATION_TYPE_DISPLAY_TEXT: Record<string, string> = {
  note: 'Note',
  warn: 'Warning',
  error: 'Error',
  todo: 'Todo',
  question: 'Question',
  see: 'See Also',
};

export class TooltipManager {
  private tooltip: HTMLElement | null = null;
  private hideTimer: number | null = null;

  private readonly HIDE_DELAY = 100;
  private readonly ANIMATION_DURATION = 150;

  constructor(private iconEl: HTMLElement, private content: string, private type: string, private plugin: CodeBlockCustomizerPlugin, private sourcePath: string, private title?: string) {
    this.iconEl.addEventListener('mouseenter', this.show);
    this.iconEl.addEventListener('mouseleave', this.scheduleHide);
  }

  private handleHover = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const link = target.closest('a.internal-link');
    
    if (link) {
      this.plugin.app.workspace.trigger('hover-link', {
        event: e,
        source: 'codeblock-customizer',
        hoverParent: this.tooltip,
        targetEl: link,
        linktext: link.getAttribute('href'),
        sourcePath: this.sourcePath,
      });
    }
  };// handleHover

  private show = () => {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    if (this.tooltip){
      return;
    }

    this.tooltip = createDiv({ cls: `codeblock-customizer-annotation-tooltip codeblock-customizer-tooltip-${this.type}` });

    const headerContainer = this.tooltip.createDiv({ cls: 'codeblock-customizer-popup-header' });
    const popupIconEl = headerContainer.createSpan({ cls: `codeblock-customizer-popup-icon codeblock-customizer-annotation-icon-${this.type}` });
    setIcon(popupIconEl, ANNOTATION_TYPE_ICONS[this.type] || 'info');
    const headerText = this.title || ANNOTATION_TYPE_DISPLAY_TEXT[this.type] || (this.type.charAt(0).toUpperCase() + this.type.slice(1));
    headerContainer.createSpan({ cls: `codeblock-customizer-popup-type-text codeblock-customizer-annotation-title-${this.type}`, text: headerText });

    const textContentEl = this.tooltip.createDiv({ cls: 'codeblock-customizer-popup-content' });
    MarkdownRenderer.render(this.plugin.app, this.content, textContentEl, this.sourcePath, this.plugin);
    document.body.appendChild(this.tooltip);

    const iconRect = this.iconEl.getBoundingClientRect();
    this.tooltip.style.position = 'fixed';
    this.tooltip.style.left = `${iconRect.right + 8}px`;
    this.tooltip.style.top = `${iconRect.top + (iconRect.height / 2) - (this.tooltip.offsetHeight / 2)}px`;

    this.tooltip.addEventListener('click', this.handleLinkClick);
    this.tooltip.addEventListener('mouseenter', this.cancelHide);
    this.tooltip.addEventListener('mouseleave', this.scheduleHide);
    this.tooltip.addEventListener('mouseover', this.handleHover);

    requestAnimationFrame(() => this.tooltip?.classList.add('is-visible'));
  };// show

  private hide = () => {
    if (this.tooltip) {
      this.tooltip.removeEventListener('mouseover', this.handleHover);
      this.tooltip.classList.remove('is-visible');
      setTimeout(() => {
        this.tooltip?.remove();
        this.tooltip = null;
      }, this.ANIMATION_DURATION);
    }
  };// hide

  private scheduleHide = () => {
    this.hideTimer = window.setTimeout(this.hide, this.HIDE_DELAY);
  };// scheduleHide

  private cancelHide = () => {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  };// cancelHide

  private handleLinkClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const link = target.closest('.internal-link');
    if (link) {
      e.preventDefault();
      const href = link.getAttribute('href');
      if (href) {
        this.plugin.app.workspace.openLinkText(href, this.sourcePath);
      }
    }
  };// handleLinkClick
}// TooltipManager
