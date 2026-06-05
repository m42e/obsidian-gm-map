import { App, PluginSettingTab, Setting } from "obsidian";
import type GmMapPlugin from "../main";

export class GmMapSettingTab extends PluginSettingTab {
  plugin: GmMapPlugin;

  constructor(app: App, plugin: GmMapPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Display Settings").setHeading();

    new Setting(containerEl)
      .setName("Default grid size")
      .setDesc("Default grid cell size in image pixels for new maps.")
      .addText((text) =>
        text
          .setPlaceholder("70")
          .setValue(String(this.plugin.settings.defaultGrid))
          .onChange(async (value) => {
            const n = Number(value);
            if (!Number.isNaN(n) && n > 0) {
              this.plugin.settings.defaultGrid = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Default fog opacity (DM view)")
      .setDesc("How dark unrevealed fog appears in the DM view (0–1). The player view is always fully opaque.")
      .addSlider((slider) =>
        slider
          .setLimits(0.1, 1, 0.05)
          .setValue(this.plugin.settings.defaultFogOpacity)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.defaultFogOpacity = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default brush size")
      .setDesc("Default freeform fog brush diameter in image pixels.")
      .addText((text) =>
        text
          .setPlaceholder("120")
          .setValue(String(this.plugin.settings.defaultBrushSize))
          .onChange(async (value) => {
            const n = Number(value);
            if (!Number.isNaN(n) && n > 0) {
              this.plugin.settings.defaultBrushSize = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Default token color")
      .addColorPicker((picker) =>
        picker
          .setValue(this.plugin.settings.defaultTokenColor)
          .onChange(async (value) => {
            this.plugin.settings.defaultTokenColor = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default marker color")
      .addColorPicker((picker) =>
        picker
          .setValue(this.plugin.settings.defaultMarkerColor)
          .onChange(async (value) => {
            this.plugin.settings.defaultMarkerColor = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Player screen DPI")
      .setDesc(
        "Physical pixels per inch of the player's monitor. Used to display each grid square as exactly 1 inch. Common values: 96 (standard), 109 (24\" 1080p), 163 (27\" 4K). Check your monitor specs."
      )
      .addText((text) =>
        text
          .setPlaceholder("96")
          .setValue(String(this.plugin.settings.playerScreenDpi))
          .onChange(async (value) => {
            const n = Number(value);
            if (!Number.isNaN(n) && n > 0) {
              this.plugin.settings.playerScreenDpi = n;
              await this.plugin.saveSettings();
            }
          })
      );
  }
}
