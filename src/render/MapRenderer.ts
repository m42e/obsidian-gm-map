import { MapStateStore } from "../state/MapStateStore";
import { FogLayer } from "../fog/FogLayer";
import { TokenLayer } from "../tokens/TokenLayer";
import { MarkerLayer } from "../markers/MarkerLayer";
import { PingLayer } from "../pings/PingLayer";
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
  private readonly pings = new PingLayer();
  private readonly ctx: CanvasRenderingContext2D;
  private rafHandle: number | null = null;

  selectedTokenId: string | null = null;
  selectedMarkerId: string | null = null;
  labelSize = 12;
  gridColor = "#000000";
  gridLineWidth = 1.5;

  /** Image-space rect representing the player's visible area. Drawn in DM mode only. */
  playerViewRect: { x: number; y: number; w: number; h: number } | null = null;

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
      this.fog.renderGridOverlay(
        ctx,
        viewport,
        this.store.state.fog,
        this.gridColor,
        this.gridLineWidth
      );
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
    this.tokens.render(ctx, viewport, visibleTokens, this.selectedTokenId, this.labelSize, this.mode === "dm");

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

    // Player viewport indicator: shows the player's visible area in the DM view.
    if (this.mode === "dm" && this.playerViewRect) {
      const { x, y, w, h } = this.playerViewRect;
      const tl = viewport.toScreen({ x, y });
      const br = viewport.toScreen({ x: x + w, y: y + h });
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "rgba(80, 180, 255, 0.06)";
      ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.strokeStyle = "rgba(80, 180, 255, 0.9)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.restore();
    }

    // Attention pings (shown on both views, on top of everything). While any
    // ping is still animating, keep rendering to drive the animation.
    const pingsActive = this.pings.render(ctx, viewport, this.store.pings, Date.now());
    if (pingsActive) this.requestRender();
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
