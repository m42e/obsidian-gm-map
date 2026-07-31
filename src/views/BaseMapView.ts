import { ItemView, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type GmMapPlugin from "../../main";
import { MapConfig } from "../types";
import { MapStateStore, StoreEvent } from "../state/MapStateStore";
import { MapRenderer, RenderMode } from "../render/MapRenderer";
import { Point } from "../render/Viewport";
import { resolveImageVaultPath } from "../util/imagePath";

/**
 * Shared functionality for the DM and player map views: image loading, canvas
 * sizing, store subscription, and pan/zoom. Subclasses add mode-specific UI and
 * interaction.
 */
export abstract class BaseMapView extends ItemView {
  protected plugin: GmMapPlugin;
  protected config: MapConfig | null = null;
  protected store: MapStateStore | null = null;
  protected renderer: MapRenderer | null = null;
  protected canvas!: HTMLCanvasElement;
  protected canvasWrap!: HTMLDivElement;
  protected image: HTMLImageElement | null = null;
  protected unsubscribe: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private detachWindowResize: (() => void) | null = null;

  /** The brush mask currently loaded into the renderer's fog layer. */
  protected loadedBrush: string | null = null;
  /** When true, skip reloading the brush on fog events (this view is editing it). */
  protected suppressBrushReload = false;

  abstract readonly mode: RenderMode;

  constructor(leaf: WorkspaceLeaf, plugin: GmMapPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getIcon(): string {
    return "map";
  }

  // ---- View state persistence (survives reloads) ----

  getState(): Record<string, unknown> {
    const base = super.getState();
    if (this.config && this.store) {
      return {
        ...base,
        config: {
          ...this.config,
          tokens: this.store.state.tokens,
          markers: this.store.state.markers,
          spells: this.store.state.spells,
        },
      };
    }
    return { ...base, config: this.config };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    const cfg = (state as { config?: MapConfig })?.config;
    if (cfg && cfg.id) {
      await this.loadMap(cfg);
    }
  }

  // ---- Lifecycle ----

  async onClose(): Promise<void> {
    this.teardown();
  }

  protected teardown(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.detachWindowResize?.();
    this.detachWindowResize = null;
    this.renderer?.destroy();
    this.renderer = null;
    this.store?.flush();
  }

  /** (Re)build the view for a given map config. */
  protected async loadMap(config: MapConfig): Promise<void> {
    this.teardown();
    this.config = config;

    const root = this.contentEl;
    root.empty();
    root.addClass("gm-map-view-root");

    const image = await this.resolveImage(config.image, config.notePath);
    if (!image) {
      root.createDiv({
        cls: "gm-map-error",
        text: `GM Map: could not load image "${config.image}".`,
      });
      return;
    }
    this.image = image;

    // Fill in real dimensions if not specified in the code block.
    if (!config.width) config.width = image.naturalWidth;
    if (!config.height) config.height = image.naturalHeight;

    this.store = await this.plugin.registry.get(config);

    this.buildChrome(root);

    this.canvasWrap = root.createDiv({ cls: "gm-map-canvas-wrap" });
    this.canvas = this.canvasWrap.createEl("canvas", { cls: "gm-map-canvas" });

    this.renderer = new MapRenderer(this.canvas, image, this.store, this.mode);
    this.renderer.labelSize = this.plugin.settings.defaultLabelSize;
    this.renderer.gridColor = this.plugin.settings.gridColor;
    this.renderer.gridLineWidth = this.plugin.settings.gridLineWidth;
    this.renderer.feetPerCell = this.plugin.settings.feetPerCell;
    this.renderer.setTokenImageResolver((key) =>
      this.resolveImageUrl(key, config.notePath)
    );
    await this.renderer.init();
    this.loadedBrush = this.store.state.fog.brush;

    this.setupCanvasSize();
    this.renderer.viewport.fit(this.canvas.width, this.canvas.height);

    this.unsubscribe = this.store.subscribe((event: StoreEvent) => {
      if (event === "fog") {
        this.renderer?.fog.markDirty();
        if (!this.suppressBrushReload) void this.reloadBrushIfChanged();
      } else if (event === "grid") {
        // Grid size/offset changed: rebuild the fog mask to match new cells.
        this.renderer?.fog.markDirty();
      }
      this.handleStoreEvent(event);
      if (event === "ping") {
        // Pings animate via a timer so they still show on the DM map while the
        // player's pop-out window has focus; other events use the rAF path.
        this.renderer?.pingAdded();
      } else {
        this.renderer?.requestRender();
      }
    });

    this.attachCommonInteractions();
    this.onMapReady();
    this.renderer.requestRender();
  }

  /** Hook for subclasses to build their toolbar/chrome before the canvas. */
  protected buildChrome(_root: HTMLElement): void {
    // Default: no chrome.
  }

  /** Hook called once the renderer and store are ready. */
  protected onMapReady(): void {
    // Default: nothing.
  }

  /** Hook called for every store event, after common fog/grid handling. */
  protected handleStoreEvent(_event: StoreEvent): void {
    // Default: nothing.
  }

  /** Hook called after any zoom change so subclasses can update UI. */
  protected onZoomChanged(): void {
    // Default: nothing.
  }

  /** Reload the freeform brush mask if it changed externally (e.g. DM edits). */
  protected async reloadBrushIfChanged(): Promise<void> {
    if (!this.store || !this.renderer) return;
    const current = this.store.state.fog.brush;
    if (current === this.loadedBrush) return;
    this.loadedBrush = current;
    await this.renderer.fog.loadBrush(current);
    this.renderer.fog.markDirty();
    this.renderer.requestRender();
  }

  private setupCanvasSize(): void {
    // Resolve the window the canvas actually lives in. The player view is moved
    // into an Electron pop-out window, which has its own document, window and
    // (potentially) device pixel ratio.
    const win = (this.canvasWrap.ownerDocument.defaultView ?? window) as Window &
      typeof globalThis;
    const resize = () => {
      const rect = this.canvasWrap.getBoundingClientRect();
      const dpr = win.devicePixelRatio || 1;
      this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      this.canvas.style.width = `${rect.width}px`;
      this.canvas.style.height = `${rect.height}px`;
      const ctx = this.canvas.getContext("2d");
      ctx?.setTransform(1, 0, 0, 1, 0, 0);
      this.canvas.dispatchEvent(new CustomEvent("gm-map-resized"));
      this.renderer?.requestRender();
    };
    // Construct the observer from the pop-out window. A ResizeObserver created
    // in the main window does not fire for elements in another window, which
    // left the player canvas stretched/blurry after the pop-out was enlarged.
    this.resizeObserver = new win.ResizeObserver(resize);
    this.resizeObserver.observe(this.canvasWrap);
    // Safety net: the pop-out window's own resize event reliably fires when it
    // is enlarged, even if the ResizeObserver is delayed or missed.
    win.addEventListener("resize", resize);
    this.detachWindowResize = () => win.removeEventListener("resize", resize);
    resize();
  }

  /** Physical pixel dimensions of the canvas (0 if not yet initialised). */
  get canvasWidth(): number { return this.canvas?.width ?? 0; }
  get canvasHeight(): number { return this.canvas?.height ?? 0; }

  /** Canvas-space point (accounting for device pixel ratio) from a mouse event. */
  protected eventPoint(e: MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    const win = this.canvas.ownerDocument.defaultView ?? window;
    const dpr = win.devicePixelRatio || 1;
    return {
      x: (e.clientX - rect.left) * dpr,
      y: (e.clientY - rect.top) * dpr,
    };
  }

  protected imagePoint(e: MouseEvent): Point {
    return this.renderer!.viewport.toImage(this.eventPoint(e));
  }

  /** Return false to prevent wheel zoom (e.g. player view with fixed physical scale). */
  protected allowZoom(): boolean {
    return true;
  }

  /** Pan + zoom shared by both views. Subclasses extend with editing tools. */
  private attachCommonInteractions(): void {
    const canvas = this.canvas;

    // Zoom with wheel.
    this.registerDomEvent(canvas, "wheel", (e: WheelEvent) => {
      e.preventDefault();
      if (!this.allowZoom()) return;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      this.renderer?.viewport.zoomAt(this.eventPoint(e), factor);
      this.renderer?.requestRender();
      this.onZoomChanged();
    });
  }

  /** Resolve a vault image path to a loaded HTMLImageElement. */
  private async resolveImage(path: string, notePath?: string): Promise<HTMLImageElement | null> {
    const resolvedPath = resolveImageVaultPath(path, notePath);
    const file = this.app.vault.getAbstractFileByPath(resolvedPath);
    if (!(file instanceof TFile)) return null;
    const url = this.app.vault.getResourcePath(file);
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  /** Resolve a vault image path to a displayable resource URL (sync), or null. */
  private resolveImageUrl(path: string, notePath?: string): string | null {
    const resolvedPath = resolveImageVaultPath(path, notePath);
    const file = this.app.vault.getAbstractFileByPath(resolvedPath);
    return file instanceof TFile ? this.app.vault.getResourcePath(file) : null;
  }
}
