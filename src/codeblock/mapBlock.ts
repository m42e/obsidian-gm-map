import { App, TFile, parseYaml, stringifyYaml } from "obsidian";
import { MapConfig, MapState, Marker, Token } from "../types";

/** Raw shape of a ```gm-map code block before normalization. */
export interface RawMapBlock {
  id?: string;
  image?: string;
  width?: number;
  height?: number;
  grid?: number;
  fogOpacity?: number;
  gridOffsetX?: number;
  gridOffsetY?: number;
  gridOverlay?: boolean;
  tokens?: unknown;
  markers?: unknown;
}

interface NormalizeDefaults {
  grid: number;
  tokenColor: string;
  markerColor: string;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Normalize the raw `tokens` array into well-formed Token objects. */
export function normalizeTokens(
  raw: unknown,
  defaults: NormalizeDefaults
): Token[] {
  if (!Array.isArray(raw)) return [];
  const tokens: Token[] = [];
  raw.forEach((entry, i) => {
    if (!entry || typeof entry !== "object") return;
    const r = entry as Record<string, unknown>;
    const x = asNumber(r.x);
    const y = asNumber(r.y);
    if (x === null || y === null) return;
    const radius = asNumber(r.radius);
    tokens.push({
      id:
        typeof r.id === "string" && r.id.trim()
          ? r.id.trim()
          : `md-token-${i}`,
      x,
      y,
      radius: radius && radius > 0 ? radius : Math.max(12, defaults.grid / 2),
      label: typeof r.label === "string" ? r.label : "",
      color: typeof r.color === "string" ? r.color : defaults.tokenColor,
      creature:
        typeof r.creature === "string" && r.creature.trim()
          ? r.creature.trim()
          : undefined,
      visible: r.visible === false ? false : true,
    });
  });
  return tokens;
}

/** Normalize the raw `markers` array into well-formed Marker objects. */
export function normalizeMarkers(
  raw: unknown,
  defaults: NormalizeDefaults
): Marker[] {
  if (!Array.isArray(raw)) return [];
  const markers: Marker[] = [];
  raw.forEach((entry, i) => {
    if (!entry || typeof entry !== "object") return;
    const r = entry as Record<string, unknown>;
    const x = asNumber(r.x);
    const y = asNumber(r.y);
    if (x === null || y === null) return;
    markers.push({
      id:
        typeof r.id === "string" && r.id.trim()
          ? r.id.trim()
          : `md-marker-${i}`,
      x,
      y,
      label: typeof r.label === "string" ? r.label : "",
      color: typeof r.color === "string" ? r.color : defaults.markerColor,
      note:
        typeof r.note === "string" && r.note.trim() ? r.note : undefined,
    });
  });
  return markers;
}

/**
 * Stable signature of the declarative tokens/markers. Used to detect when the
 * code block was edited so the markdown can re-seed the working state.
 */
export function sigFrom(tokens: Token[], markers: Marker[]): string {
  return JSON.stringify({
    t: tokens.map((t) => [
      t.id,
      Math.round(t.x),
      Math.round(t.y),
      Math.round(t.radius),
      t.label,
      t.color,
      t.creature ?? null,
      t.visible,
    ]),
    m: markers.map((m) => [
      m.id,
      Math.round(m.x),
      Math.round(m.y),
      m.label,
      m.color,
      m.note ?? null,
    ]),
  });
}

/** Build the YAML body (without fences) for a gm-map block from current state. */
export function buildMapYaml(config: MapConfig, state: MapState): string {
  const obj: Record<string, unknown> = {
    id: config.id,
    image: config.image,
    grid: state.fog.cellSize,
    fogOpacity: config.fogOpacity,
  };
  if (Math.round(state.fog.offsetX) !== 0) {
    obj.gridOffsetX = Math.round(state.fog.offsetX);
  }
  if (Math.round(state.fog.offsetY) !== 0) {
    obj.gridOffsetY = Math.round(state.fog.offsetY);
  }
  if (state.gridOverlay) obj.gridOverlay = true;

  obj.tokens = state.tokens.map((t) => {
    const o: Record<string, unknown> = {
      id: t.id,
      x: Math.round(t.x),
      y: Math.round(t.y),
      radius: Math.round(t.radius),
      color: t.color,
    };
    if (t.label) o.label = t.label;
    if (t.creature) o.creature = t.creature;
    if (!t.visible) o.visible = false;
    return o;
  });

  obj.markers = state.markers.map((m) => {
    const o: Record<string, unknown> = {
      id: m.id,
      x: Math.round(m.x),
      y: Math.round(m.y),
      color: m.color,
    };
    if (m.label) o.label = m.label;
    if (m.note) o.note = m.note;
    return o;
  });

  return stringifyYaml(obj).trimEnd();
}

const BLOCK_RE = /(^|\n)([ \t]*)```gm-map[ \t]*\n([\s\S]*?)\n[ \t]*```/g;

/**
 * Replace the body of the gm-map block matching `id`/`image` in `data`.
 * Returns the new document text, or null if no matching block was found.
 */
function replaceBlock(
  data: string,
  config: MapConfig,
  newYaml: string
): string | null {
  let found = false;
  const result = data.replace(
    BLOCK_RE,
    (match, lead: string, indent: string, body: string) => {
      if (found) return match;
      let parsed: RawMapBlock | null = null;
      try {
        parsed = (parseYaml(body) as RawMapBlock) ?? null;
      } catch {
        return match;
      }
      const blockId = parsed?.id?.trim() || parsed?.image;
      if (blockId !== config.id) return match;
      found = true;
      const indented = newYaml
        .split("\n")
        .map((line) => (line ? indent + line : line))
        .join("\n");
      return `${lead}${indent}\`\`\`gm-map\n${indented}\n${indent}\`\`\``;
    }
  );
  return found ? result : null;
}

/**
 * Write the current tokens/markers/grid back into the note's gm-map block.
 * Returns true on success, false if the note or block could not be found.
 */
export async function writeMapToNote(
  app: App,
  config: MapConfig,
  state: MapState
): Promise<boolean> {
  if (!config.notePath) return false;
  const file = app.vault.getAbstractFileByPath(config.notePath);
  if (!(file instanceof TFile)) return false;

  const yaml = buildMapYaml(config, state);
  let didReplace = false;
  await app.vault.process(file, (data) => {
    const next = replaceBlock(data, config, yaml);
    if (next === null) return data;
    didReplace = true;
    return next;
  });
  return didReplace;
}
