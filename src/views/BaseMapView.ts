import { ItemView, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type GmMapPlugin from "../../main";
import { MapConfig } from "../types";
import { MapStateStore, StoreEvent } from "../state/MapStateStore";
import { MapRenderer, RenderMode } from "../render/MapRenderer";
import { Point } from "../render/Viewport";

/** Resolve a relative image path (e.g. ./assets/img.jpg) against a note's vault path. */
function resolveRelative(notePath: string, relativePath: string): string {
  const parts = notePath.split("/");
  parts.pop(); // remove note filename, keep directory segments
  for (const seg of relativePath.split("/")) {
    if (seg === "." || seg === "") continue;
    else if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

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
      this.renderer?.requestRender();
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
    const resize = () => {
      const rect = this.canvasWrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      this.canvas.style.width = `${rect.width}px`;
      this.canvas.style.height = `${rect.height}px`;
      const ctx = this.canvas.getContext("2d");
      ctx?.setTransform(1, 0, 0, 1, 0, 0);
      this.canvas.dispatchEvent(new CustomEvent("gm-map-resized"));
      this.renderer?.requestRender();
    };
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(this.canvasWrap);
    resize();
  }

  /** Canvas-space point (accounting for device pixel ratio) from a mouse event. */
  protected eventPoint(e: MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
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
    });
  }

  /** Resolve a vault image path to a loaded HTMLImageElement. */
  private async resolveImage(path: string, notePath?: string): Promise<HTMLImageElement | null> {
    const resolvedPath =
      path.startsWith(".") && notePath
        ? resolveRelative(notePath, path)
        : path;
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
}
