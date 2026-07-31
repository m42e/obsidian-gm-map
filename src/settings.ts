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

    new Setting(containerEl).setName("Display").setHeading();

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
      .setName("Default spell color")
      .setDesc("Default color for new spell area templates.")
      .addColorPicker((picker) =>
        picker
          .setValue(this.plugin.settings.defaultSpellColor)
          .onChange(async (value) => {
            this.plugin.settings.defaultSpellColor = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Feet per grid cell")
      .setDesc(
        "How many feet one grid square represents. Used to scale spell areas (D&D standard is 5)."
      )
      .addText((text) =>
        text
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.feetPerCell))
          .onChange(async (value) => {
            const n = Number(value);
            if (!Number.isNaN(n) && n > 0) {
              this.plugin.settings.feetPerCell = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Ping color")
      .setDesc("Color of the attention pings players drop by tapping the player map.")
      .addColorPicker((picker) =>
        picker
          .setValue(this.plugin.settings.pingColor)
          .onChange(async (value) => {
            this.plugin.settings.pingColor = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default label size")
      .setDesc("Font size in pixels for token and marker labels.")
      .addText((text) =>
        text
          .setPlaceholder("12")
          .setValue(String(this.plugin.settings.defaultLabelSize))
          .onChange(async (value) => {
            const n = Number(value);
            if (!Number.isNaN(n) && n > 0) {
              this.plugin.settings.defaultLabelSize = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Snap tokens to grid")
      .setDesc(
        "When enabled, placing or dragging a token snaps it to the nearest grid cell center. Large (even-sized) creatures snap to the grid corner instead."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.snapToGrid)
          .onChange(async (value) => {
            this.plugin.settings.snapToGrid = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Grid line color")
      .setDesc("Color of the grid lines overlay.")
      .addColorPicker((picker) =>
        picker
          .setValue(this.plugin.settings.gridColor)
          .onChange(async (value) => {
            this.plugin.settings.gridColor = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Grid line width")
      .setDesc("Width of grid lines in pixels.")
      .addText((text) =>
        text
          .setPlaceholder("1.5")
          .setValue(String(this.plugin.settings.gridLineWidth))
          .onChange(async (value) => {
            const n = Number(value);
            if (!Number.isNaN(n) && n > 0) {
              this.plugin.settings.gridLineWidth = n;
              await this.plugin.saveSettings();
            }
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

    new Setting(containerEl)
      .setName("Fullscreen player view")
      .setDesc(
        "Put the player pop-out window into real OS fullscreen when it opens. If your platform blocks automatic fullscreen, click once inside the player window to enter it; press Esc to leave. Disable this if it causes display issues."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.playerFullscreen)
          .onChange(async (value) => {
            this.plugin.settings.playerFullscreen = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("iPad app (LAN)").setHeading();

    new Setting(containerEl)
      .setName("Enable iPad map server")
      .setDesc(
        "Run a small server so the GM Map iPad app can connect over your local WiFi. You can also start it on demand with the \u201cShare to iPad\u201d button in the DM view. Desktop only."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.serverEnabled)
          .onChange(async (value) => {
            this.plugin.settings.serverEnabled = value;
            await this.plugin.saveSettings();
            if (value) this.plugin.server.start(this.plugin.settings.serverPort);
            else this.plugin.server.dispose();
          })
      );

    new Setting(containerEl)
      .setName("Server port")
      .setDesc("TCP port the iPad map server listens on (default 3010).")
      .addText((text) =>
        text
          .setPlaceholder("3010")
          .setValue(String(this.plugin.settings.serverPort))
          .onChange(async (value) => {
            const n = Number(value);
            if (Number.isInteger(n) && n >= 1024 && n <= 65535) {
              this.plugin.settings.serverPort = n;
              await this.plugin.saveSettings();
              if (this.plugin.server.running) {
                this.plugin.server.start(n);
              }
            }
          })
      );
  }
}
