// Shared type definitions for the GM Map plugin.

/** Reveal style for the fog of war. */
export type FogTool = "reveal" | "hide";

/** Active editing tool in the DM view. */
export type DmTool = "pan" | "fog-brush" | "fog-grid" | "token" | "marker" | "player-pan";

/**
 * Static configuration declared in a ```gm-map code block. Tokens, markers and
 * grid alignment may also be authored here; the DM view's "Save to note" button
 * writes the current working state back into the block. Fog of war stays in a
 * sidecar file (too large/binary for markdown).
 */
export interface MapConfig {
  /** Stable identifier used to persist and look up dynamic state. */
  id: string;
  /** Vault-relative path to the map image. */
  image: string;
  /** Optional explicit pixel width; falls back to natural image width. */
  width?: number;
  /** Optional explicit pixel height; falls back to natural image height. */
  height?: number;
  /** Grid cell size in image pixels. */
  grid: number;
  /** Fog opacity for the DM view (0..1). Player view always uses full opacity. */
  fogOpacity: number;
  /** Initial grid X offset in image pixels (for alignment). */
  gridOffsetX?: number;
  /** Initial grid Y offset in image pixels (for alignment). */
  gridOffsetY?: number;
  /** Whether the grid overlay starts visible. */
  gridOverlay?: boolean;
  /** Tokens declared in the code block. */
  tokens?: Token[];
  /** Markers declared in the code block (DM-only). */
  markers?: Marker[];
  /** Vault path of the note containing the code block (for "Save to note"). */
  notePath?: string;
}

/** A token placed on the map, optionally bound to a bestiary creature. */
export interface Token {
  id: string;
  /** Center position in image pixels. */
  x: number;
  y: number;
  /** Radius in image pixels. */
  radius: number;
  /** Display label drawn under the token. */
  label: string;
  /** CSS color of the token body. */
  color: string;
  /** Name of a Fantasy Statblocks bestiary creature, if linked. */
  creature?: string;
  /** Whether players can see this token (always true for now; reserved). */
  visible: boolean;
}

/** A DM-only marker. Never serialized to or rendered in the player view. */
export interface Marker {
  id: string;
  x: number;
  y: number;
  label: string;
  color: string;
  /** Optional longer note shown on hover/click in the DM view. */
  note?: string;
  /** Vault-relative path of a note to display in the side panel when clicked. */
  linkedNote?: string;
}

/**
 * A transient "attention ping" dropped by a player tapping the player map. It
 * animates briefly on the DM (and player) view and is never persisted.
 */
export interface Ping {
  /** Center position in image pixels. */
  x: number;
  y: number;
  /** CSS color of the ping pulse. */
  color: string;
  /** Wall-clock creation time (Date.now()) driving the animation. */
  createdAt: number;
}

/**
 * Fog of war data.
 * - `cols`/`rows` describe the grid resolution.
 * - `revealed` is a flat row-major boolean array of revealed grid cells.
 * - `brush` is a serialized PNG data URL of the freeform reveal mask, or null.
 * - `offsetX`/`offsetY` shift the grid for visual alignment to the map art.
 * - `originX`/`originY` are the derived top-left of cell (0,0) in image pixels
 *   (offset normalized into the range (-cellSize, 0] so the grid covers the
 *   whole image); they are recomputed whenever size/offset change.
 */
export interface FogData {
  cols: number;
  rows: number;
  cellSize: number;
  offsetX: number;
  offsetY: number;
  originX: number;
  originY: number;
  revealed: boolean[];
  brush: string | null;
}

/** The complete dynamic state persisted per map id. */
export interface MapState {
  id: string;
  fog: FogData;
  tokens: Token[];
  markers: Marker[];
  /** Whether the grid overlay is shown (on both DM and player views). */
  gridOverlay: boolean;
  /** Whether tokens are visible on the map. */
  showTokens: boolean;
  /** Top-left corner of the player view in image-pixel space. Set by the DM. */
  playerPan?: { x: number; y: number };
  /**
   * Signature of the tokens/markers last seen in the code block. When the
   * markdown is edited (signature changes), the markdown re-seeds the working
   * state; otherwise the saved working state wins so live edits persist.
   */
  sourceSig?: string;
  /** Schema version for future migrations. */
  version: number;
}

/** Plugin-wide settings. */
export interface GmMapSettings {
  defaultGrid: number;
  defaultFogOpacity: number;
  defaultBrushSize: number;
  defaultTokenColor: string;
  defaultMarkerColor: string;
  /** Physical DPI of the player's screen (used to display 1 grid cell = 1 inch). */
  playerScreenDpi: number;
  /** Font size in pixels for token and marker labels. */
  defaultLabelSize: number;
  /** Whether to snap tokens to the nearest grid cell center (or corner for even-sized creatures) by default. */
  snapToGrid: boolean;
  /** Grid line color in hex format. */
  gridColor: string;
  /** Grid line width in pixels. */
  gridLineWidth: number;
  /** Color of attention pings dropped by players. */
  pingColor: string;
}

export const DEFAULT_SETTINGS: GmMapSettings = {
  defaultGrid: 70,
  defaultFogOpacity: 0.6,
  defaultBrushSize: 120,
  defaultTokenColor: "#c0392b",
  defaultMarkerColor: "#f1c40f",
  playerScreenDpi: 96,
  defaultLabelSize: 12,
  snapToGrid: true,
  gridColor: "#000000",
  gridLineWidth: 1.5,
  pingColor: "#ff5252",
};

export const STATE_VERSION = 1;

/** How long a ping pulse animates before disappearing, in milliseconds. */
export const PING_DURATION_MS = 3000;

export const VIEW_TYPE_DM = "gm-map-dm-view";
export const VIEW_TYPE_PLAYER = "gm-map-player-view";
