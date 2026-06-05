/** A point in either screen or image coordinate space. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Maps between image-pixel coordinates and on-screen canvas coordinates,
 * applying pan (offset) and zoom (scale). Each view owns its own viewport so
 * the DM and players can look at different parts of the map.
 */
export class Viewport {
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  readonly minScale = 0.05;
  readonly maxScale = 8;

  constructor(
    public imageWidth: number,
    public imageHeight: number
  ) {}

  /** Convert an image-space point to screen (canvas) space. */
  toScreen(p: Point): Point {
    return {
      x: p.x * this.scale + this.offsetX,
      y: p.y * this.scale + this.offsetY,
    };
  }

  /** Convert a screen (canvas) point to image space. */
  toImage(p: Point): Point {
    return {
      x: (p.x - this.offsetX) / this.scale,
      y: (p.y - this.offsetY) / this.scale,
    };
  }

  pan(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
  }

  /** Zoom toward a screen anchor point so it stays fixed under the cursor. */
  zoomAt(anchor: Point, factor: number): void {
    const next = Math.min(
      this.maxScale,
      Math.max(this.minScale, this.scale * factor)
    );
    const ratio = next / this.scale;
    this.offsetX = anchor.x - (anchor.x - this.offsetX) * ratio;
    this.offsetY = anchor.y - (anchor.y - this.offsetY) * ratio;
    this.scale = next;
  }

  /** Fit and center the whole image inside the given canvas size. */
  fit(viewWidth: number, viewHeight: number): void {
    if (this.imageWidth <= 0 || this.imageHeight <= 0) return;
    const scale = Math.min(
      viewWidth / this.imageWidth,
      viewHeight / this.imageHeight
    );
    this.scale = Math.max(this.minScale, Math.min(this.maxScale, scale));
    this.offsetX = (viewWidth - this.imageWidth * this.scale) / 2;
    this.offsetY = (viewHeight - this.imageHeight * this.scale) / 2;
  }

  /**
   * Set a fixed physical scale so that one grid cell = 1 inch on screen, and
   * position the viewport so image point (panX, panY) is at the canvas origin.
   * dpi: physical pixels per inch of the player's monitor.
   * cellSizePx: grid cell size in image pixels.
   */
  setFixed(dpi: number, cellSizePx: number, panX: number, panY: number): void {
    this.scale = dpi / Math.max(1, cellSizePx);
    this.offsetX = -panX * this.scale;
    this.offsetY = -panY * this.scale;
  }
}
