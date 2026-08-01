import { MarkdownRenderChild, Menu, Notice, Plugin, TFile } from "obsidian";
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
  private pictureMenus = new WeakSet<Menu>();

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

    this.registerMarkdownPostProcessor((element, context) => {
      if (!element.querySelector(".internal-embed[src] img")) return;
      context.addChild(new ImageContextMenuChild(element, this, context.sourcePath));
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || !this.server.supportsPicture(file)) return;
        this.addPictureMenuItem(menu, file);
      })
    );

    this.addCommand({
      id: "hide-picture-on-ipad",
      name: "Hide picture on iPad",
      checkCallback: (checking) => {
        const canHide = this.server.presentedPicturePath !== null;
        if (!checking && canHide) this.hidePictureOnServer();
        return canHide;
      },
    });

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

  private showPictureOnServer(file: TFile): void {
    if (!this.server.sharing) {
      new Notice("GM Map: share a map to iPad before showing a picture.");
      return;
    }
    if (!this.server.presentPicture(file)) {
      new Notice("GM Map: this picture format is not supported.");
      return;
    }
    const clients = this.server.connectedClientCount;
    new Notice(
      clients > 0
        ? `GM Map: showing “${file.basename}” on ${clients} iPad client${clients === 1 ? "" : "s"}.`
        : `GM Map: “${file.basename}” is ready; no iPad client is connected yet.`
    );
  }

  private hidePictureOnServer(): void {
    if (this.server.dismissPicture()) {
      new Notice("GM Map: returned iPad clients to the map.");
    }
  }

  private addPictureMenuItem(menu: Menu, file: TFile): void {
    if (this.pictureMenus.has(menu)) return;
    this.pictureMenus.add(menu);
    const isPresented = this.server.presentedPicturePath === file.path;
    menu.addItem((item) =>
      item
        .setTitle(isPresented ? "Hide from iPad" : "Show on iPad")
        .setIcon(isPresented ? "monitor-off" : "monitor-up")
        .onClick(() => {
          if (isPresented) this.hidePictureOnServer();
          else this.showPictureOnServer(file);
        })
    );
  }

  showRenderedImageMenu(event: MouseEvent, linktext: string, sourcePath: string): void {
    const file = this.app.metadataCache.getFirstLinkpathDest(linktext, sourcePath);
    if (!(file instanceof TFile) || !this.server.supportsPicture(file)) return;

    event.preventDefault();
    event.stopPropagation();
    const menu = Menu.forEvent(event);
    this.app.workspace.handleLinkContextMenu(menu, linktext, sourcePath);
    this.addPictureMenuItem(menu, file);
    menu.showAtMouseEvent(event);
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

class ImageContextMenuChild extends MarkdownRenderChild {
  constructor(
    containerEl: HTMLElement,
    private plugin: GmMapPlugin,
    private sourcePath: string
  ) {
    super(containerEl);
  }

  onload(): void {
    this.registerDomEvent(
      this.containerEl,
      "contextmenu",
      (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.tagName !== "IMG") return;
        const embed = target.closest<HTMLElement>(".internal-embed[src]");
        const linktext = embed?.getAttribute("src");
        if (linktext) this.plugin.showRenderedImageMenu(event, linktext, this.sourcePath);
      },
      { capture: true }
    );
  }
}
