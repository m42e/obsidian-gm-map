import { Token } from "../types";
import { Point, Viewport } from "../render/Viewport";

/** Renders and hit-tests tokens drawn in image space. */
export class TokenLayer {
  render(
    ctx: CanvasRenderingContext2D,
    viewport: Viewport,
    tokens: Token[],
    selectedId: string | null,
    labelSize = 12,
    dmMode = false,
    getImage?: (token: Token) => HTMLImageElement | null
  ): void {
    for (const token of tokens) {
      const center = viewport.toScreen({ x: token.x, y: token.y });
      const r = token.radius * viewport.scale;
      const hidden = dmMode && !token.visible;
      const image = token.image ? getImage?.(token) ?? null : null;

      ctx.save();
      if (hidden) ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
      if (image) {
        // Draw the picture clipped to the circle, scaled to cover (center crop).
        ctx.save();
        ctx.clip();
        const iw = image.naturalWidth || image.width;
        const ih = image.naturalHeight || image.height;
        const cover = Math.max((2 * r) / iw, (2 * r) / ih);
        const dw = iw * cover;
        const dh = ih * cover;
        ctx.drawImage(image, center.x - dw / 2, center.y - dh / 2, dw, dh);
        ctx.restore();
      } else {
        ctx.fillStyle = token.color;
        ctx.fill();
      }
      ctx.lineWidth = token.id === selectedId ? 3 : 2;
      ctx.strokeStyle = token.id === selectedId ? "#ffffff" : "rgba(0,0,0,0.6)";
      ctx.stroke();

      // Initial letter inside the token (only when there is no picture).
      if (!image) {
        const initial = (token.label || token.creature || "?").trim().charAt(0).toUpperCase();
        ctx.fillStyle = "#ffffff";
        ctx.font = `${Math.max(8, r)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(initial, center.x, center.y);
      }

      // Label below the token.
      if (token.label) {
        ctx.font = `${labelSize}px sans-serif`;
        ctx.textBaseline = "top";
        const text = token.label;
        const padX = 4;
        const metrics = ctx.measureText(text);
        const boxW = metrics.width + padX * 2;
        const boxH = labelSize + 4;
        const boxY = center.y + r + 4;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(center.x - boxW / 2, boxY, boxW, boxH);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, center.x, boxY + 2);
      }

      // Hidden indicator: diagonal slash across the token in DM mode.
      if (hidden) {
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = "#ff4444";
        ctx.lineWidth = Math.max(2, r * 0.12);
        ctx.lineCap = "round";
        const off = r * 0.65;
        ctx.beginPath();
        ctx.moveTo(center.x - off, center.y - off);
        ctx.lineTo(center.x + off, center.y + off);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** Return the topmost token whose body contains the given image-space point. */
  hitTest(tokens: Token[], imgPoint: Point): Token | null {
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      const dx = imgPoint.x - t.x;
      const dy = imgPoint.y - t.y;
      if (dx * dx + dy * dy <= t.radius * t.radius) return t;
    }
    return null;
  }
}
