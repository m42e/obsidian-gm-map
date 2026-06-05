import { FogData } from "../types";
import { Point, Viewport } from "../render/Viewport";

/**
 * Manages the fog-of-war mask and its rendering.
 *
 * Two independent reveal sources are combined:
 *  - a boolean grid (toggled cell-by-cell), persisted compactly in state.
 *  - a freeform "brush" layer, persisted as a PNG data URL.
 *
 * Internally both are composited (white = revealed) into a mask canvas, which
 * is then used to punch holes out of a solid fog rectangle when drawing.
 */
export class FogLayer {
  private brushCanvas: HTMLCanvasElement;
  private brushCtx: CanvasRenderingContext2D;
  private maskCanvas: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D;
  private fogCanvas: HTMLCanvasElement;
  private fogCtx: CanvasRenderingContext2D;
  private maskDirty = true;

  constructor(
    private imageWidth: number,
    private imageHeight: number
  ) {
    this.brushCanvas = this.makeCanvas();
    this.brushCtx = ctx(this.brushCanvas);
    this.maskCanvas = this.makeCanvas();
    this.maskCtx = ctx(this.maskCanvas);
    this.fogCanvas = this.makeCanvas();
    this.fogCtx = ctx(this.fogCanvas);
  }

  private makeCanvas(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = Math.max(1, this.imageWidth);
    c.height = Math.max(1, this.imageHeight);
    return c;
  }

  /** Load a previously saved brush mask (PNG data URL) into the brush layer. */
  async loadBrush(dataUrl: string | null): Promise<void> {
    this.brushCtx.clearRect(0, 0, this.brushCanvas.width, this.brushCanvas.height);
    if (dataUrl) {
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          this.brushCtx.drawImage(img, 0, 0);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = dataUrl;
      });
    }
    this.maskDirty = true;
  }

  /** Paint a freeform circle onto the brush layer. */
  paintBrush(p: Point, radius: number, reveal: boolean): void {
    this.brushCtx.save();
    if (reveal) {
      this.brushCtx.globalCompositeOperation = "source-over";
      this.brushCtx.fillStyle = "#ffffff";
    } else {
      this.brushCtx.globalCompositeOperation = "destination-out";
      this.brushCtx.fillStyle = "#ffffff";
    }
    this.brushCtx.beginPath();
    this.brushCtx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    this.brushCtx.fill();
    this.brushCtx.restore();
    this.maskDirty = true;
  }

  /** Export the current brush layer as a PNG data URL (or null if empty). */
  exportBrush(): string | null {
    // Detect whether anything has been painted to avoid storing blank masks.
    const { width, height } = this.brushCanvas;
    const data = this.brushCtx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return this.brushCanvas.toDataURL("image/png");
    }
    return null;
  }

  markDirty(): void {
    this.maskDirty = true;
  }

  private rebuildMask(fog: FogData): void {
    const ctxm = this.maskCtx;
    ctxm.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    // Grid-revealed cells as white rectangles.
    ctxm.fillStyle = "#ffffff";
    const { cols, rows, cellSize, originX, originY, revealed } = fog;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (revealed[row * cols + col]) {
          ctxm.fillRect(
            originX + col * cellSize,
            originY + row * cellSize,
            cellSize,
            cellSize
          );
        }
      }
    }
    // Freeform brush layer on top.
    ctxm.drawImage(this.brushCanvas, 0, 0);
    this.maskDirty = false;
  }

  /**
   * Render fog onto the destination context using the given viewport.
   * @param opacity 1 for the player view (fully opaque), <1 for the DM view.
   */
  render(
    dest: CanvasRenderingContext2D,
    viewport: Viewport,
    fog: FogData,
    opacity: number
  ): void {
    if (this.maskDirty) this.rebuildMask(fog);

    // Build the fog: solid black with revealed areas punched out.
    const fctx = this.fogCtx;
    fctx.globalCompositeOperation = "source-over";
    fctx.fillStyle = "#000000";
    fctx.fillRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
    fctx.globalCompositeOperation = "destination-out";
    fctx.drawImage(this.maskCanvas, 0, 0);
    fctx.globalCompositeOperation = "source-over";

    // Draw onto destination at the viewport transform.
    dest.save();
    dest.globalAlpha = opacity;
    dest.setTransform(
      viewport.scale,
      0,
      0,
      viewport.scale,
      viewport.offsetX,
      viewport.offsetY
    );
    dest.imageSmoothingEnabled = false;
    dest.drawImage(this.fogCanvas, 0, 0);
    dest.setTransform(1, 0, 0, 1, 0, 0);
    dest.restore();
  }

  /** Optional grid overlay for the DM view to aid cell painting. */
  renderGridOverlay(
    dest: CanvasRenderingContext2D,
    viewport: Viewport,
    fog: FogData
  ): void {
    dest.save();
    dest.setTransform(
      viewport.scale,
      0,
      0,
      viewport.scale,
      viewport.offsetX,
      viewport.offsetY
    );
    // Clip to the image so partial edge cells don't draw past the map.
    dest.beginPath();
    dest.rect(0, 0, this.imageWidth, this.imageHeight);
    dest.clip();

    const { cols, rows, cellSize, originX, originY } = fog;
    dest.beginPath();
    for (let c = 0; c <= cols; c++) {
      const x = originX + c * cellSize;
      dest.moveTo(x, 0);
      dest.lineTo(x, this.imageHeight);
    }
    for (let r = 0; r <= rows; r++) {
      const y = originY + r * cellSize;
      dest.moveTo(0, y);
      dest.lineTo(this.imageWidth, y);
    }
    // Draw twice (dark then light) so the grid stays visible on both bright
    // and dark maps, including the non-dimmed player view.
    dest.lineWidth = 1.5 / viewport.scale;
    dest.strokeStyle = "rgba(0,0,0,0.35)";
    dest.stroke();
    dest.lineWidth = 0.75 / viewport.scale;
    dest.strokeStyle = "rgba(255,255,255,0.35)";
    dest.stroke();
    dest.setTransform(1, 0, 0, 1, 0, 0);
    dest.restore();
  }
}

function ctx(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = c.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("GM Map: 2D canvas context unavailable");
  return context;
}
