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
    if (this.plugin.settings.playerFullscreen) {
      this.enterFullscreen();
    }
  }

  async onClose(): Promise<void> {
    const doc = this.containerEl.ownerDocument;
    doc.body.removeClass("gm-map-player-popout");
    if (doc.fullscreenElement) {
      void doc.exitFullscreen?.().catch(() => {});
    }
    await super.onClose();
  }

  /**
   * Put the map content into real OS fullscreen so the map itself fills the
   * whole screen (we fullscreen the view's content element, not the window's
   * root, so no Obsidian chrome shows). Some platforms allow this
   * programmatically; others require a user gesture, so we also arm the first
   * interaction in the window as a fallback. We stop trying once it succeeds so
   * the DM can leave fullscreen (Escape) without being forced back in. Toggled
   * by the "Fullscreen player view" setting.
   */
  private enterFullscreen(): void {
    const doc = this.containerEl.ownerDocument;
    const target = this.contentEl;
    let armed = true;
    const attempt = () => {
      if (!armed) return;
      if (doc.fullscreenElement) {
        armed = false;
        return;
      }
      target
        .requestFullscreen?.()
        ?.then(() => {
          armed = false;
        })
        .catch(() => {
          /* Needs a user gesture; the armed listeners below retry on input. */
        });
    };
    attempt();
    doc.addEventListener("pointerdown", attempt, { once: true, capture: true });
    doc.addEventListener("keydown", attempt, { once: true, capture: true });
  }

  protected buildChrome(root: HTMLElement): void {
    root.createDiv({ cls: "gm-map-player-dragbar" });
  }

  protected onMapReady(): void {
    this.applyPhysicalScale();
    // A tap/click anywhere on the player map drops an attention ping that the
    // DM (and other players) see live. The view is otherwise read-only.
    this.registerDomEvent(this.canvas, "pointerdown", (e: PointerEvent) =>
      this.onPointerDown(e)
    );
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.store || !this.renderer) return;
    // Mouse: left button only. Touch/pen: any contact.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const img = this.imagePoint(e);
    this.store.addPing({
      x: img.x,
      y: img.y,
      color: this.plugin.settings.pingColor,
      createdAt: Date.now(),
    });
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
