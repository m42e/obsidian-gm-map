import { Marker } from "../types";
import { Point, Viewport } from "../render/Viewport";

/**
 * Renders and hit-tests DM-only markers. This layer is never instantiated or
 * drawn in the player view, so markers are invisible to players.
 */
export class MarkerLayer {
  private readonly size = 14;

  render(
    ctx: CanvasRenderingContext2D,
    viewport: Viewport,
    markers: Marker[],
    selectedId: string | null,
    labelSize = 12
  ): void {
    for (const marker of markers) {
      const center = viewport.toScreen({ x: marker.x, y: marker.y });
      const s = this.size;

      ctx.save();
      // Diamond shape to visually distinguish markers from circular tokens.
      ctx.translate(center.x, center.y);
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s, 0);
      ctx.lineTo(0, s);
      ctx.lineTo(-s, 0);
      ctx.closePath();
      ctx.fillStyle = marker.color;
      ctx.fill();
      ctx.lineWidth = marker.id === selectedId ? 3 : 1.5;
      ctx.strokeStyle = marker.id === selectedId ? "#ffffff" : "rgba(0,0,0,0.7)";
      ctx.stroke();
      ctx.restore();

      if (marker.label) {
        ctx.save();
        ctx.font = `${labelSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const padX = 4;
        const boxW = ctx.measureText(marker.label).width + padX * 2;
        const boxH = labelSize + 4;
        const boxY = center.y + s + 4;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(center.x - boxW / 2, boxY, boxW, boxH);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(marker.label, center.x, boxY + 2);
        ctx.restore();
      }
    }
  }

  hitTest(markers: Marker[], imgPoint: Point, viewport: Viewport): Marker | null {
    // Hit area is the diamond's bounding circle in screen space.
    const screen = viewport.toScreen(imgPoint);
    for (let i = markers.length - 1; i >= 0; i--) {
      const m = markers[i];
      const c = viewport.toScreen({ x: m.x, y: m.y });
      const dx = screen.x - c.x;
      const dy = screen.y - c.y;
      if (dx * dx + dy * dy <= this.size * this.size) return m;
    }
    return null;
  }
}
