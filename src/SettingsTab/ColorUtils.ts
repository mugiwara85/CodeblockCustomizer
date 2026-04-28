import { Setting, Notice, setIcon } from "obsidian";

import CodeBlockCustomizerPlugin from "../main";
import { ColorTheme, Colors, HighlightStyle } from "../Settings";
import { getColorOfCssVariable, getCurrentMode, updateSettingStyles } from "../Utils";
import { PickerOptions, updateColorContainer, updateLanguageSpecificColorContainer } from "./Common";

import Pickr from "@simonwep/pickr";

export function getColorFromPickrClass(selectedTheme: ColorTheme, currentMode: 'dark' | 'light', pickrClass: string, resolveCSSVar: boolean): Colors | string {
  const properties = pickrClass.split('.');
  let colorValue: Colors | string = selectedTheme.colors[currentMode];

  for (const prop of properties) {
    // @ts-ignore
    colorValue = colorValue?.[prop];
    if (colorValue === undefined) {
      return '#000000'; // return default black
    }
    if (resolveCSSVar && colorValue.toString().startsWith("--")) {
      colorValue = getColorOfCssVariable(colorValue.toString());
    }
    if (!colorValue) {
      break;
    }
  }

  return colorValue || '';
}// getColorFromPickrClass

export function setNestedValue(obj: Record<string, any>, path: string, value: any): void {
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    current = current[key];
    if (current === undefined) {
      console.error("Invalid path provided to setNestedValue:", path);
      return;
    }
  }

  const finalKey = keys[keys.length - 1];
  current[finalKey] = value;
}// setNestedValue

export function setAndSavePickrSetting(className: string, savedColor: string, plugin: CodeBlockCustomizerPlugin): void {
  const currentMode = getCurrentMode();
  const colors = plugin.settings.SelectedTheme.colors[currentMode];

  setNestedValue(colors, className, savedColor);

  plugin.saveSettings();
}// setAndSavePickrSetting

export function addPickerControlsToSetting(setting: Setting, options: PickerOptions, pickerInstances: Pickr[], plugin: CodeBlockCustomizerPlugin): Pickr {
  const pickr = Pickr.create({
    el: setting.controlEl.createDiv({ cls: 'picker' }),
    container: options.containerEl.parentNode as HTMLElement,
    theme: 'nano',
    position: 'left-middle',
    lockOpacity: false,
    default: options.initialColor,
    swatches: [],
    components: {
      preview: true,
      hue: true,
      opacity: true,
      interaction: {
        hex: true,
        rgba: true,
        hsla: false,
        input: true,
        cancel: true,
        save: true,
      },
    },
    i18n: options.i18n ?? {},
  })
    .on('show', (color: Pickr.HSVaColor, instance: Pickr) => {
      if (options.shouldShow && !options.shouldShow()) {
        instance.hide();
        return;
      }
      const { result } = (instance.getRoot() as any).interaction;
      requestAnimationFrame(() => requestAnimationFrame(() => result.select()));
    })
    .on('save', (color: Pickr.HSVaColor, instance: Pickr) => {
      if (!color) return;
      instance.hide();
      const savedColor = color.toHEXA().toString();
      instance.addSwatch(savedColor);
      options.onSave(savedColor);
    })
    .on('cancel', (instance: Pickr) => {
      instance.hide();
    });

  pickerInstances.push(pickr);

  const onResetCallback = options.onReset;
  if (onResetCallback) {
    setting.addExtraButton((btn) => {
      btn.setIcon("reset")
        .setTooltip('restore default color')
        .onClick(() => {
          const defaultColor = onResetCallback();
          pickr?.setColor(defaultColor);
          options.onSave(defaultColor);
        });
    });
  }

  const onDeleteCallback = options.onDelete;
  if (onDeleteCallback) {
    setting.addExtraButton((btn) => {
      btn.setIcon("trash")
        .setTooltip("Delete color")
        .onClick(() => {
          onDeleteCallback();
        });
    });
  }

  return pickr;
}// addPickerControlsToSetting

export function createPickrSetting(containerEl: HTMLElement, name: string, description: string, pickrClass: string, pickerInstances: Pickr[], plugin: CodeBlockCustomizerPlugin): Setting {
  const setting = new Setting(containerEl)
    .setName(name)
    .setDesc(description);

  addPickerControlsToSetting(setting, {
    containerEl: containerEl,
    initialColor: getColorFromPickrClass(plugin.settings.SelectedTheme, getCurrentMode(), pickrClass, true).toString(),
    onSave: (savedColor: string) => {
      setAndSavePickrSetting(pickrClass, savedColor, plugin);
      if (['editorActiveLineColor', 'codeblock.activeLineColor'].includes(pickrClass)) {
        updateSettingStyles(plugin.settings, plugin.app);
      }
    },
    onReset: () => {
      return getColorFromPickrClass(plugin.settings.Themes[plugin.settings.ThemeName], getCurrentMode(), pickrClass, true).toString();
    },
    shouldShow: () => {
      const settings = plugin.settings.pluginSettings;
      if ((!settings.codeblock.enableActiveLineHighlight && pickrClass === 'codeblock.activeLineColor') ||
        (!settings.enableEditorActiveLineHighlight && pickrClass === 'editorActiveLineColor') ||
        (!settings.header.displayCodeBlockLanguage && (pickrClass === 'header.codeBlockLangTextColor' || pickrClass === 'header.codeBlockLangBackgroundColor')) ||
        (!settings.gutter.highlightActiveLineNr && pickrClass === 'gutter.activeLineNrColor') ||
        (!settings.inlineCode.enableInlineCodeStyling && (pickrClass === 'inlineCode.backgroundColor' || pickrClass === 'inlineCode.textColor'))) {
        return false;
      }
      return true;
    }
  }, pickerInstances, plugin);

  return setting;
}// createPickrSetting

export function createHighlightStyleControls(containerEl: HTMLElement, pickerInstances: Pickr[], plugin: CodeBlockCustomizerPlugin, getStyle: (mode: 'light' | 'dark') => HighlightStyle, onChanged: () => void, onResetBackground?: () => string): void {
  const style = getStyle(getCurrentMode());

  new Setting(containerEl)
    .setName('Use background color')
    .addToggle(toggle => toggle
      .setValue(style.useBackgroundColor)
      .onChange((value) => {
        getStyle('light').useBackgroundColor = value;
        getStyle('dark').useBackgroundColor = value;
        bgPickrSetting.settingEl.classList.toggle('codeblock-customizer-setting-hidden', !value);
        plugin.saveSettings();
        onChanged();
      })
    );

  const bgPickrSetting = new Setting(containerEl).setName('Background color');
  bgPickrSetting.settingEl.classList.toggle('codeblock-customizer-setting-hidden', !style.useBackgroundColor);
  addPickerControlsToSetting(bgPickrSetting, {
    containerEl,
    initialColor: style.backgroundColor,
    onSave: (color: string) => {
      getStyle(getCurrentMode()).backgroundColor = color;
      plugin.saveSettings();
      onChanged();
    },
    onReset: onResetBackground,
    i18n: { 'btn:toggle': 'select background color' }
  }, pickerInstances, plugin);

  new Setting(containerEl)
    .setName('Use text color')
    .addToggle(toggle => toggle
      .setValue(style.useTextColor ?? false)
      .onChange((value) => {
        getStyle('light').useTextColor = value;
        getStyle('dark').useTextColor = value;
        if (value && !getStyle('light').textColor) {
          getStyle('light').textColor = '#000000';
          getStyle('dark').textColor = '#000000';
        }
        textColorPickrSetting.settingEl.classList.toggle('codeblock-customizer-setting-hidden', !value);
        plugin.saveSettings();
        onChanged();
      })
    );

  const textColorPickrSetting = new Setting(containerEl).setName('Text color');
  textColorPickrSetting.settingEl.classList.toggle('codeblock-customizer-setting-hidden', !(style.useTextColor ?? false));
  addPickerControlsToSetting(textColorPickrSetting, {
    containerEl,
    initialColor: style.textColor || '#000000',
    onSave: (color: string) => {
      getStyle(getCurrentMode()).textColor = color;
      plugin.saveSettings();
      onChanged();
    },
    i18n: { 'btn:toggle': 'select text color' }
  }, pickerInstances, plugin);

  new Setting(containerEl)
    .setName('Font family')
    .setDesc('Leave blank to inherit.')
    .addText(text => text
      .setPlaceholder('e.g. monospace')
      .setValue(style.fontFamily ?? '')
      .onChange((value) => {
        getStyle('light').fontFamily = value;
        getStyle('dark').fontFamily = value;
        plugin.saveSettings();
        onChanged();
      })
    );

  new Setting(containerEl)
    .setName('Bold')
    .addToggle(toggle => toggle
      .setValue(style.bold ?? false)
      .onChange((value) => {
        getStyle('light').bold = value;
        getStyle('dark').bold = value;
        plugin.saveSettings();
        onChanged();
      })
    );

  new Setting(containerEl)
    .setName('Italic')
    .addToggle(toggle => toggle
      .setValue(style.italic ?? false)
      .onChange((value) => {
        getStyle('light').italic = value;
        getStyle('dark').italic = value;
        plugin.saveSettings();
        onChanged();
      })
    );

  new Setting(containerEl)
    .setName('Underline')
    .addToggle(toggle => toggle
      .setValue(style.underline ?? false)
      .onChange((value) => {
        getStyle('light').underline = value;
        getStyle('dark').underline = value;
        plugin.saveSettings();
        onChanged();
      })
    );

  new Setting(containerEl)
    .setName('Strikethrough')
    .addToggle(toggle => toggle
      .setValue(style.strikethrough ?? false)
      .onChange((value) => {
        getStyle('light').strikethrough = value;
        getStyle('dark').strikethrough = value;
        plugin.saveSettings();
        onChanged();
      })
    );
}// createHighlightStyleControls

export function createAlternatePickr(containerEl: HTMLElement, colorContainer: HTMLElement, name: string, style: HighlightStyle | string, type: string, pickerInstances: Pickr[], plugin: CodeBlockCustomizerPlugin, colorKey = "", languageName = ""): Setting | undefined {
  if (type === "normal") {
    const entry = containerEl.createDiv({ cls: 'settings-group codeblock-customizer-alt-highlight-entry' });
    const header = entry.createDiv({ cls: 'codeblock-customizer-alt-highlight-header' });

    const info = header.createDiv({ cls: 'codeblock-customizer-alt-highlight-info' });
    info.createDiv({ text: name, cls: 'codeblock-customizer-alt-highlight-name' });
    info.createDiv({ text: `To highlight lines with this color use the "${name}" parameter. e.g: ${name}:2,4-6`, cls: 'codeblock-customizer-alt-highlight-desc' });

    const trashBtn = header.createEl('button', { cls: 'clickable-icon extra-setting-button' });
    setIcon(trashBtn, 'trash');
    trashBtn.setAttribute('aria-label', 'Delete color');
    trashBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      delete plugin.settings.SelectedTheme.colors.light.codeblock.alternateHighlightColors[name];
      delete plugin.settings.SelectedTheme.colors.dark.codeblock.alternateHighlightColors[name];
      updateColorContainer(colorContainer, pickerInstances, plugin);
      plugin.saveSettings();
      new Notice(`Removed color "${name}".`);
    });

    const content = entry.createDiv({ cls: 'codeblock-customizer-setting-hidden codeblock-customizer-alt-highlight-content' });
    header.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) {
        return;
      }

      const isOpen = entry.hasClass('is-open');
      entry.toggleClass('is-open', !isOpen);
      content.toggleClass('codeblock-customizer-setting-hidden', isOpen);
    });

    createHighlightStyleControls(content, pickerInstances, plugin, (mode) => plugin.settings.SelectedTheme.colors[mode].codeblock.alternateHighlightColors[name], () => updateSettingStyles(plugin.settings, plugin.app));

    return undefined;
  }

  const setting = new Setting(containerEl).setName(name);
  const initialColor = typeof style === 'string' ? style : style.backgroundColor;
  addPickerControlsToSetting(setting, {
    containerEl: containerEl,
    initialColor,
    onSave: (savedColor: string) => {
      plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors[languageName][colorKey] = savedColor;
      plugin.saveSettings();
    },
    onDelete: () => {
      delete plugin.settings.SelectedTheme.colors.light.languageSpecificColors[languageName][colorKey];
      delete plugin.settings.SelectedTheme.colors.dark.languageSpecificColors[languageName][colorKey];
      updateLanguageSpecificColorContainer(colorContainer, pickerInstances, plugin, languageName);
      plugin.saveSettings();
      new Notice(`Removed color "${name}".`);
    },
    i18n: { 'btn:toggle': 'select color for light theme' }
  }, pickerInstances, plugin);

  return setting;
}// createAlternatePickr
