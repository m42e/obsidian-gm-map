import { WorkspaceLeaf } from "obsidian";
import { BaseMapView } from "./BaseMapView";
import { RenderMode } from "../render/MapRenderer";
import { VIEW_TYPE_PLAYER } from "../types";
import { StoreEvent } from "../state/MapStateStore";
import type GmMapPlugin from "../../main";

/**
 * The player-facing map view. Intended to be moved into a pop-out window on a
 * second screen. Read-only: shows the base image, fog (fully opaque), and
 * player-visible tokens. Never renders DM-only markers.
 *
 * The scale is fixed so that 1 grid cell = 1 physical inch on screen, based on
 * the "Player screen DPI" plugin setting. The DM controls panning via the
 * "Pan player view" tool in the DM view.
 */
export class PlayerMapView extends BaseMapView {
  readonly mode: RenderMode = "player";

  constructor(leaf: WorkspaceLeaf, plugin: GmMapPlugin) {
    super(leaf, plugin);
  }

  getViewType(): string {
    return VIEW_TYPE_PLAYER;
  }

  getDisplayText(): string {
    return this.config ? `Player map: ${this.config.id}` : "Player map";
  }

  protected allowZoom(): boolean {
    return false;
  }

  async onOpen(): Promise<void> {
    await super.onOpen();
    this.containerEl.ownerDocument.body.addClass("gm-map-player-popout");
  }

  async onClose(): Promise<void> {
    this.containerEl.ownerDocument.body.removeClass("gm-map-player-popout");
    await super.onClose();
  }

  protected buildChrome(root: HTMLElement): void {
    root.createDiv({ cls: "gm-map-player-dragbar" });
  }

  protected onMapReady(): void {
    this.applyPhysicalScale();
  }

  protected handleStoreEvent(event: StoreEvent): void {
    if (event === "pan") {
      this.applyPhysicalScale();
    }
  }

  private applyPhysicalScale(): void {
    if (!this.renderer || !this.store) return;
    const dpi = this.plugin.settings.playerScreenDpi;
    const cellSizePx = this.store.state.fog.cellSize;
    const pan = this.store.state.playerPan ?? { x: 0, y: 0 };
    this.renderer.viewport.setFixed(dpi, cellSizePx, pan.x, pan.y);
  }
}
