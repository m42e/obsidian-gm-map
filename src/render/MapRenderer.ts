import { MapStateStore } from "../state/MapStateStore";
import { FogLayer } from "../fog/FogLayer";
import { TokenLayer } from "../tokens/TokenLayer";
import { MarkerLayer } from "../markers/MarkerLayer";
import { SpellLayer } from "../spells/SpellLayer";
import { PingLayer } from "../pings/PingLayer";
import { Viewport } from "./Viewport";

export type RenderMode = "dm" | "player";

/**
 * Orchestrates the layered canvas rendering shared by the DM and player views.
 * Draw order: base image -> fog -> grid -> spell templates -> tokens ->
 * (DM only) markers.
 */
export class MapRenderer {
  readonly viewport: Viewport;
  readonly fog: FogLayer;
  private readonly tokens = new TokenLayer();
  private readonly markers = new MarkerLayer();
  private readonly spells = new SpellLayer();
  private readonly pings = new PingLayer();
  private readonly ctx: CanvasRenderingContext2D;
  private rafHandle: number | null = null;
  /** Interval driving the ping pulse. Uses a timer rather than rAF so the DM
   *  map keeps animating while the player's pop-out window holds focus and the
   *  DM window is backgrounded (browsers pause rAF for unfocused/occluded
   *  windows but still fire timers). */
  private pingTimer: number | null = null;

  selectedTokenId: string | null = null;
  selectedMarkerId: string | null = null;
  selectedSpellId: string | null = null;
  labelSize = 12;
  gridColor = "#000000";
  gridLineWidth = 1.5;
  /** Feet represented by one grid cell, used to scale spell templates. */
  feetPerCell = 5;

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

  /** The window that owns this renderer's canvas (the pop-out for the player
   *  view, the main window for the DM view). Timers and rAF must come from it,
   *  otherwise they are throttled with the wrong window's focus state. */
  private get win(): Window {
    return this.canvas.ownerDocument.defaultView ?? window;
  }

  /** Schedule a render on the next animation frame (coalesces bursts). */
  requestRender(): void {
    if (this.rafHandle !== null) return;
    this.rafHandle = this.win.requestAnimationFrame(() => {
      this.rafHandle = null;
      this.draw();
    });
  }

  /**
   * Begin (or keep) the ping animation and draw one frame immediately. Pumped
   * by a timer instead of requestAnimationFrame so a ping dropped from the
   * player pop-out still animates on the DM map while the DM window is in the
   * background (rAF is paused for unfocused/occluded windows; timers are not).
   */
  pingAdded(): void {
    if (this.pingTimer === null) {
      this.pingTimer = this.win.setInterval(() => this.draw(), 1000 / 30);
    }
    this.draw();
  }

  private stopPingAnimation(): void {
    if (this.pingTimer !== null) {
      this.win.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
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

    // Spell area templates. The DM sees them all; players only see the ones the
    // DM marked visible. Drawn under tokens so tokens stay legible on top.
    const spells =
      this.mode === "player"
        ? this.store.state.spells.filter((s) => s.visible)
        : this.store.state.spells;
    this.spells.render(
      ctx,
      viewport,
      spells,
      this.selectedSpellId,
      this.pxPerFoot(),
      this.mode === "dm",
      this.labelSize
    );

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

    // Attention pings (shown on both views, on top of everything). The pulse
    // is pumped by pingAdded()'s timer; stop it once every ping has expired.
    const pingsActive = this.pings.render(ctx, viewport, this.store.pings, Date.now());
    if (!pingsActive) this.stopPingAnimation();
  }

  hitTestToken(imgPoint: { x: number; y: number }) {
    return this.tokens.hitTest(this.store.state.tokens, imgPoint);
  }

  hitTestMarker(imgPoint: { x: number; y: number }) {
    return this.markers.hitTest(this.store.state.markers, imgPoint, this.viewport);
  }

  /** Image pixels per foot, derived from the grid scale. */
  pxPerFoot(): number {
    return this.store.state.fog.cellSize / Math.max(1, this.feetPerCell);
  }

  hitTestSpell(imgPoint: { x: number; y: number }) {
    return this.spells.hitTest(this.store.state.spells, imgPoint, this.pxPerFoot());
  }

  /** Image-space point of a spell's rotation handle (null for circles). */
  spellHandlePoint(spell: import("../types").Spell) {
    return this.spells.handlePoint(spell, this.pxPerFoot());
  }

  /** Screen-space radius within which the rotation handle is grabbable. */
  get spellHandleHitRadius(): number {
    return this.spells.handleHitRadius;
  }

  destroy(): void {
    if (this.rafHandle !== null) this.win.cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
    this.stopPingAnimation();
  }
}
