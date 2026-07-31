// Shared type definitions for the GM Map plugin.

/** Reveal style for the fog of war. */
export type FogTool = "reveal" | "hide";

/** Active editing tool in the DM view. */
export type DmTool = "pan" | "fog-brush" | "fog-grid" | "token" | "marker" | "spell" | "player-pan";

/**
 * Top-down projection of a D&D 5e spell area of effect.
 * - `circle`: a sphere or cylinder seen from above, defined by a radius.
 * - `cone`: extends from its point of origin; its width at any point equals the
 *   distance from the origin, so the far end is as wide as it is long.
 * - `line`: a straight path of a given length and width.
 * - `cube`: a square whose point of origin lies on one face.
 */
export type SpellShape = "circle" | "cone" | "line" | "cube";

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
  /** Spell templates declared in the code block. */
  spells?: Spell[];
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
  /**
   * Optional vault-relative (or note-relative) path to an image used as the
   * token's body. When set, the image is drawn clipped to the token circle
   * instead of the solid color fill and initial letter.
   */
  image?: string;
  /** Name of a Fantasy Statblocks bestiary creature, if linked. */
  creature?: string;
  /** Whether players can see this token (always true for now; reserved). */
  visible: boolean;
  /**
   * Whether players may move this token from the iPad app. Player-controlled
   * tokens are also always shown to players (they can see their own token even
   * under fog). DM/monster tokens default to false.
   */
  playerControlled?: boolean;
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
 * A D&D spell area-of-effect template placed on the map. Authored in the DM
 * view; players only see it when `visible` is set. Sizes are stored in feet and
 * converted to image pixels via the grid scale (see `feetPerCell`).
 */
export interface Spell {
  id: string;
  /** Area shape; determines how `size`/`width`/`angle` are interpreted. */
  shape: SpellShape;
  /**
   * Point of origin in image pixels. For a circle this is the center; for a
   * cone it is the apex; for a line and a cube it is the center of the near
   * face from which the area extends along `angle`.
   */
  x: number;
  y: number;
  /**
   * Primary dimension in feet: radius (circle), length (cone/line) or side
   * length (cube). A cone's far end is exactly this wide.
   */
  size: number;
  /** Width in feet for a line (ignored by the other shapes). */
  width?: number;
  /**
   * Facing direction in radians for cone/line/cube (0 = pointing right/east).
   * Unused for circles, which are rotationally symmetric.
   */
  angle: number;
  /** Display label drawn at the origin. */
  label: string;
  /** CSS color (translucent fill + solid outline). */
  color: string;
  /** Whether players also see this template (synced to the player view). */
  visible: boolean;
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
  /** Spell area-of-effect templates placed by the DM. */
  spells: Spell[];
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
  /** Default color for new spell area templates. */
  defaultSpellColor: string;
  /** Number of feet represented by one grid cell (D&D standard is 5). */
  feetPerCell: number;
  /** Physical DPI of the player's screen (used to display 1 grid cell = 1 inch). */
  playerScreenDpi: number;
  /** Request real OS fullscreen for the player pop-out window when it opens. */
  playerFullscreen: boolean;
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
  /** Start the iPad map server automatically when the plugin loads. */
  serverEnabled: boolean;
  /** TCP port the iPad map server listens on. */
  serverPort: number;
}

export const DEFAULT_SETTINGS: GmMapSettings = {
  defaultGrid: 70,
  defaultFogOpacity: 0.6,
  defaultBrushSize: 120,
  defaultTokenColor: "#c0392b",
  defaultMarkerColor: "#f1c40f",
  defaultSpellColor: "#e67e22",
  feetPerCell: 5,
  playerScreenDpi: 96,
  playerFullscreen: false,
  defaultLabelSize: 12,
  snapToGrid: true,
  gridColor: "#000000",
  gridLineWidth: 1.5,
  pingColor: "#ff5252",
  serverEnabled: false,
  serverPort: 3010,
};

export const STATE_VERSION = 1;

/** How long a ping pulse animates before disappearing, in milliseconds. */
export const PING_DURATION_MS = 3000;

export const VIEW_TYPE_DM = "gm-map-dm-view";
export const VIEW_TYPE_PLAYER = "gm-map-player-view";
