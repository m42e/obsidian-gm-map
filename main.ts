import { Notice, Plugin, TFile } from "obsidian";
import {
  DEFAULT_SETTINGS,
  GmMapSettings,
  MapConfig,
  VIEW_TYPE_DM,
  VIEW_TYPE_PLAYER,
} from "./src/types";
import { GmMapSettingTab } from "./src/settings";
import { StatePersistence } from "./src/state/persistence";
import { MapStateStore, StoreRegistry } from "./src/state/MapStateStore";
import { StatblockIntegration } from "./src/integration/statblocks";
import { MapServer } from "./src/server/MapServer";
import { resolveImageVaultPath } from "./src/util/imagePath";
import { DmMapView } from "./src/views/DmMapView";
import { PlayerMapView } from "./src/views/PlayerMapView";
import { GmMapCodeBlock } from "./src/codeblock/GmMapCodeBlock";
import { sigFrom, writeMapToNote } from "./src/codeblock/mapBlock";

export default class GmMapPlugin extends Plugin {
  settings!: GmMapSettings;
  persistence!: StatePersistence;
  registry!: StoreRegistry;
  statblocks!: StatblockIntegration;
  server!: MapServer;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.persistence = new StatePersistence(this);
    this.registry = new StoreRegistry(this.persistence);
    this.statblocks = new StatblockIntegration(this.app);
    this.server = new MapServer(this.app, () => this.settings);
    if (this.settings.serverEnabled) {
      this.server.start(this.settings.serverPort);
    }

    this.registerView(
      VIEW_TYPE_DM,
      (leaf) => new DmMapView(leaf, this)
    );
    this.registerView(
      VIEW_TYPE_PLAYER,
      (leaf) => new PlayerMapView(leaf, this)
    );

    const codeBlock = new GmMapCodeBlock(this);
    this.registerMarkdownCodeBlockProcessor("gm-map", codeBlock.process);

    this.addSettingTab(new GmMapSettingTab(this.app, this));
  }

  onunload(): void {
    this.server?.dispose();
    this.registry?.flushAll();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<GmMapSettings>);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Write the current tokens, markers and grid back into the note's code block. */
  async saveMapToNote(config: MapConfig, store: MapStateStore): Promise<void> {
    if (!config.notePath) {
      new Notice("GM Map: this map has no source note to save to.");
      return;
    }
    const ok = await writeMapToNote(this.app, config, store.state);
    if (ok) {
      store.setSourceSig(
        sigFrom(store.state.tokens, store.state.markers, store.state.spells)
      );
      new Notice("GM Map: saved tokens & markers to the note.");
    } else {
      new Notice("GM Map: could not find the map block in the note.");
    }
  }

  /** Open (or focus) the DM view for a map in a workspace tab. */
  async openDmView(config: MapConfig): Promise<void> {
    const existing = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_DM)
      .find((leaf) => {
        const state = leaf.view.getState() as { config?: MapConfig };
        return state?.config?.id === config.id;
      });
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: VIEW_TYPE_DM,
      active: true,
      state: { config },
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  /**
   * Start (if needed) the iPad map server, publish the given map, and return the
   * reachable base URLs + port for display. Returns null if the map image could
   * not be resolved.
   */
  shareMapToServer(
    config: MapConfig,
    store: MapStateStore
  ): { urls: string[]; port: number } | null {
    if (!this.server.running) {
      this.server.start(this.settings.serverPort);
    }
    const path = resolveImageVaultPath(config.image, config.notePath);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice("GM Map: could not resolve the map image to share.");
      return null;
    }
    void this.server.publish({ config, store, imageFile: file });
    return { urls: this.server.addresses(), port: this.server.port };
  }

  /** Open (or focus) the player view in a pop-out window for the second screen. */
  async openPlayerView(config: MapConfig): Promise<void> {
    const existing = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_PLAYER)
      .find((leaf) => {
        const state = leaf.view.getState() as { config?: MapConfig };
        return state?.config?.id === config.id;
      });
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getLeaf("window");
    await leaf.setViewState({
      type: VIEW_TYPE_PLAYER,
      active: true,
      state: { config },
    });
    await this.app.workspace.revealLeaf(leaf);
  }
}
