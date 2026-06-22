import { Ping, PING_DURATION_MS } from "../types";
import { Viewport } from "../render/Viewport";

const RINGS = 3;
const RING_PERIOD_MS = 900;
const MIN_RADIUS = 5;
const MAX_RADIUS = 34;
const FADE_OUT_MS = 600;
const DOT_RADIUS = 4;

/**
 * Renders transient "attention pings" players drop on the map to point the DM
 * somewhere. Each ping is a sonar-like burst of expanding rings drawn at a
 * fixed on-screen size (independent of zoom) but anchored to an image-space
 * point, so it tracks the map location as the view pans/zooms.
 */
export class PingLayer {
  /**
   * Draw all active pings. Returns true while at least one ping is still
   * animating, so the renderer can keep the animation loop running.
   */
  render(
    ctx: CanvasRenderingContext2D,
    viewport: Viewport,
    pings: Ping[],
    now: number
  ): boolean {
    let anyActive = false;
    ctx.save();
    // Pings are a UI cue: draw in screen space at a constant size.
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    for (const ping of pings) {
      const age = now - ping.createdAt;
      if (age < 0 || age >= PING_DURATION_MS) continue;
      anyActive = true;

      const center = viewport.toScreen({ x: ping.x, y: ping.y });
      const fade =
        age > PING_DURATION_MS - FADE_OUT_MS
          ? Math.max(0, (PING_DURATION_MS - age) / FADE_OUT_MS)
          : 1;

      for (let i = 0; i < RINGS; i++) {
        const phase = ((age / RING_PERIOD_MS) + i / RINGS) % 1;
        const radius = MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * phase;
        const alpha = (1 - phase) * fade;
        if (alpha <= 0.01) continue;

        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        // Dark halo first so the ring stays visible on light maps.
        ctx.globalAlpha = alpha * 0.5;
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.stroke();
        // Colored ring on top.
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = ping.color;
        ctx.stroke();
      }

      // Center dot.
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.arc(center.x, center.y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = ping.color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.stroke();
    }

    ctx.restore();
    return anyActive;
  }
}
