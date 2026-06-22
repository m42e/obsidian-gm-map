import { Spell } from "../types";
import { Point, Viewport } from "../render/Viewport";

/** On-screen pixel radius of the rotation handle drawn for directional shapes. */
const HANDLE_RADIUS = 7;

/** Resolved geometry of a spell template in image-pixel space. */
type SpellGeometry =
  | { kind: "circle"; cx: number; cy: number; r: number; handle: null }
  | { kind: "poly"; points: Point[]; handle: Point };

/**
 * Renders and hit-tests D&D spell area-of-effect templates. The shapes follow
 * the 5e rules for how an area extends from its point of origin:
 *
 * - circle (sphere / cylinder): a disc of the given radius around the origin.
 * - cone: a triangle whose width at any distance equals that distance, so the
 *   far end is exactly as wide as the cone is long.
 * - line: a rectangle of the given length and width, extending from the origin.
 * - cube: a square of the given side, with the origin on the near face.
 *
 * Feet are converted to image pixels by the caller via `pxPerFoot`
 * (= grid cell size in pixels / feet per cell).
 */
export class SpellLayer {
  /** Compute the shape outline (and rotation handle) in image-pixel space. */
  static geometry(spell: Spell, pxPerFoot: number): SpellGeometry {
    const size = Math.max(0, spell.size) * pxPerFoot;
    const dx = Math.cos(spell.angle);
    const dy = Math.sin(spell.angle);
    const px = -dy; // unit vector perpendicular to the facing direction
    const py = dx;

    switch (spell.shape) {
      case "circle":
        return { kind: "circle", cx: spell.x, cy: spell.y, r: size, handle: null };

      case "cone": {
        // Width at the far end equals the length (RAW: width == distance).
        const half = size / 2;
        const baseX = spell.x + dx * size;
        const baseY = spell.y + dy * size;
        return {
          kind: "poly",
          points: [
            { x: spell.x, y: spell.y },
            { x: baseX + px * half, y: baseY + py * half },
            { x: baseX - px * half, y: baseY - py * half },
          ],
          handle: { x: baseX, y: baseY },
        };
      }

      case "line": {
        const length = size;
        const half = (Math.max(0, spell.width ?? 5) * pxPerFoot) / 2;
        const endX = spell.x + dx * length;
        const endY = spell.y + dy * length;
        return {
          kind: "poly",
          points: [
            { x: spell.x + px * half, y: spell.y + py * half },
            { x: endX + px * half, y: endY + py * half },
            { x: endX - px * half, y: endY - py * half },
            { x: spell.x - px * half, y: spell.y - py * half },
          ],
          handle: { x: endX, y: endY },
        };
      }

      case "cube":
      default: {
        // Origin sits on the near face; the square extends `size` along `angle`.
        const half = size / 2;
        const farX = spell.x + dx * size;
        const farY = spell.y + dy * size;
        return {
          kind: "poly",
          points: [
            { x: spell.x + px * half, y: spell.y + py * half },
            { x: farX + px * half, y: farY + py * half },
            { x: farX - px * half, y: farY - py * half },
            { x: spell.x - px * half, y: spell.y - py * half },
          ],
          handle: { x: farX, y: farY },
        };
      }
    }
  }

  /** Image-space point of the rotation handle, or null for symmetric shapes. */
  handlePoint(spell: Spell, pxPerFoot: number): Point | null {
    return SpellLayer.geometry(spell, pxPerFoot).handle;
  }

  render(
    ctx: CanvasRenderingContext2D,
    viewport: Viewport,
    spells: Spell[],
    selectedId: string | null,
    pxPerFoot: number,
    dmMode: boolean,
    labelSize = 12
  ): void {
    for (const spell of spells) {
      const geom = SpellLayer.geometry(spell, pxPerFoot);
      const selected = dmMode && spell.id === selectedId;

      ctx.save();
      ctx.beginPath();
      if (geom.kind === "circle") {
        const c = viewport.toScreen({ x: geom.cx, y: geom.cy });
        ctx.arc(c.x, c.y, geom.r * viewport.scale, 0, Math.PI * 2);
      } else {
        geom.points.forEach((p, i) => {
          const s = viewport.toScreen(p);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.closePath();
      }

      ctx.globalAlpha = 0.25;
      ctx.fillStyle = spell.color;
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.lineWidth = selected ? 3 : 2;
      ctx.strokeStyle = spell.color;
      if (selected) {
        // White halo so the selected outline reads over any fill color.
        ctx.save();
        ctx.lineWidth = 5;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.stroke();
        ctx.restore();
      }
      ctx.stroke();
      ctx.restore();

      // Origin marker so the DM can see and grab the point of origin.
      if (dmMode) {
        const o = viewport.toScreen({ x: spell.x, y: spell.y });
        ctx.save();
        ctx.beginPath();
        ctx.arc(o.x, o.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = spell.color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.stroke();
        ctx.restore();
      }

      // Rotation handle for the selected directional shape (DM only).
      if (selected && geom.handle) {
        const h = viewport.toScreen(geom.handle);
        const o = viewport.toScreen({ x: spell.x, y: spell.y });
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(h.x, h.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(h.x, h.y, HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = spell.color;
        ctx.stroke();
        ctx.restore();
      }

      if (spell.label) {
        const o = viewport.toScreen({ x: spell.x, y: spell.y });
        ctx.save();
        ctx.font = `${labelSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const padX = 4;
        const boxW = ctx.measureText(spell.label).width + padX * 2;
        const boxH = labelSize + 4;
        const boxY = o.y - 8 - boxH;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(o.x - boxW / 2, boxY, boxW, boxH);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(spell.label, o.x, boxY + boxH - 2);
        ctx.restore();
      }
    }
  }

  /** Return the topmost spell whose area contains the given image-space point. */
  hitTest(spells: Spell[], imgPoint: Point, pxPerFoot: number): Spell | null {
    for (let i = spells.length - 1; i >= 0; i--) {
      const geom = SpellLayer.geometry(spells[i], pxPerFoot);
      if (geom.kind === "circle") {
        const dx = imgPoint.x - geom.cx;
        const dy = imgPoint.y - geom.cy;
        if (dx * dx + dy * dy <= geom.r * geom.r) return spells[i];
      } else if (pointInPolygon(imgPoint, geom.points)) {
        return spells[i];
      }
    }
    return null;
  }

  /** Pixel radius of the rotation handle hit area (screen space). */
  get handleHitRadius(): number {
    return HANDLE_RADIUS + 8;
  }
}

/** Standard ray-casting point-in-polygon test. */
function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
