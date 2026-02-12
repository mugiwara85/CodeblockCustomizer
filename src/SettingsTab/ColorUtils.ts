import { Setting, Notice } from "obsidian";

import CodeBlockCustomizerPlugin from "../main";
import { ColorTheme, Colors } from "../Settings";
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

export function createAlternatePickr(containerEl: HTMLElement, colorContainer: HTMLElement, name: string, Color: string, type: string, pickerInstances: Pickr[], plugin: CodeBlockCustomizerPlugin, colorKey = "", languageName = ""): Setting {
  const desc = (type === "normal") ? `To highlight lines with this color use the "${name}" parameter. e.g: ${name}:2,4-6` : "";
  const setting = new Setting(containerEl)
    .setName(name)
    .setDesc(desc);

  addPickerControlsToSetting(setting, {
    containerEl: containerEl,
    initialColor: Color,
    onSave: (savedColor: string) => {
      if (type === "normal") {
        plugin.settings.SelectedTheme.colors[getCurrentMode()].codeblock.alternateHighlightColors[name] = savedColor;
      } else if (type === "langSpecific") {
        plugin.settings.SelectedTheme.colors[getCurrentMode()].languageSpecificColors[languageName][colorKey] = savedColor;
      }
      plugin.saveSettings();
    },
    onDelete: () => {
      if (type === "normal") {
        delete plugin.settings.SelectedTheme.colors.light.codeblock.alternateHighlightColors[name];
        delete plugin.settings.SelectedTheme.colors.dark.codeblock.alternateHighlightColors[name];
        updateColorContainer(colorContainer, pickerInstances, plugin);
      } else if (type === "langSpecific") {
        delete plugin.settings.SelectedTheme.colors.light.languageSpecificColors[languageName][colorKey];
        delete plugin.settings.SelectedTheme.colors.dark.languageSpecificColors[languageName][colorKey];
        updateLanguageSpecificColorContainer(colorContainer, pickerInstances, plugin, languageName);
      }
      plugin.saveSettings();
      new Notice(`Removed color "${name}".`);
    },
    i18n: {
      'btn:toggle': 'select color for light theme'
    }
  }, pickerInstances, plugin);

  return setting;
}// createAlternatePickr
