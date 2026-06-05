import { MapStateStore } from "../state/MapStateStore";
import { FogLayer } from "../fog/FogLayer";
import { TokenLayer } from "../tokens/TokenLayer";
import { MarkerLayer } from "../markers/MarkerLayer";
import { Viewport } from "./Viewport";

export type RenderMode = "dm" | "player";

/**
 * Orchestrates the layered canvas rendering shared by the DM and player views.
 * Draw order: base image -> fog -> tokens -> (DM only) grid overlay & markers.
 */
export class MapRenderer {
  readonly viewport: Viewport;
  readonly fog: FogLayer;
  private readonly tokens = new TokenLayer();
  private readonly markers = new MarkerLayer();
  private readonly ctx: CanvasRenderingContext2D;
  private rafHandle: number | null = null;

  selectedTokenId: string | null = null;
  selectedMarkerId: string | null = null;
  labelSize = 12;

  constructor(
    private canvas: HTMLCanvasElement,
    private image: HTMLImageElement,
    private store: MapStateStore,
    public mode: RenderMode
  ) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("GM Map: 2D canvas context unavailable");
    this.ctx = context;
    this.viewport = new Viewport(image.naturalWidth, image.naturalHeight);
    this.fog = new FogLayer(image.naturalWidth, image.naturalHeight);
  }

  async init(): Promise<void> {
    await this.fog.loadBrush(this.store.state.fog.brush);
    this.fog.markDirty();
  }

  /** Schedule a render on the next animation frame (coalesces bursts). */
  requestRender(): void {
    if (this.rafHandle !== null) return;
    this.rafHandle = window.requestAnimationFrame(() => {
      this.rafHandle = null;
      this.draw();
    });
  }

  private draw(): void {
    const { ctx, canvas, viewport } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Base image.
    ctx.save();
    ctx.setTransform(
      viewport.scale,
      0,
      0,
      viewport.scale,
      viewport.offsetX,
      viewport.offsetY
    );
    ctx.drawImage(this.image, 0, 0);
    ctx.restore();

    // Fog: opaque for players, dimmed for the DM so they can see underneath.
    const opacity = this.mode === "player" ? 1 : this.store.config.fogOpacity;
    this.fog.render(ctx, viewport, this.store.state.fog, opacity);

    // Optional grid overlay (shown on both DM and player views when enabled).
    if (this.store.state.gridOverlay) {
      this.fog.renderGridOverlay(ctx, viewport, this.store.state.fog);
    }

    // Tokens: players only see tokens that are both visible and in revealed fog.
    const visibleTokens =
      this.mode === "player"
        ? this.store.state.tokens.filter(
            (t) =>
              t.visible &&
              this.fog.isPointRevealed({ x: t.x, y: t.y }, this.store.state.fog)
          )
        : this.store.state.tokens;
    this.tokens.render(ctx, viewport, visibleTokens, this.selectedTokenId, this.labelSize);

    // Markers (DM only).
    if (this.mode === "dm") {
      this.markers.render(
        ctx,
        viewport,
        this.store.state.markers,
        this.selectedMarkerId,
        this.labelSize
      );
    }
  }

  hitTestToken(imgPoint: { x: number; y: number }) {
    return this.tokens.hitTest(this.store.state.tokens, imgPoint);
  }

  hitTestMarker(imgPoint: { x: number; y: number }) {
    return this.markers.hitTest(this.store.state.markers, imgPoint, this.viewport);
  }

  destroy(): void {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
  }
}
