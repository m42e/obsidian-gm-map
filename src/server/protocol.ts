/**
 * Wire protocol shared between the plugin's map server and the iPad client.
 *
 * Transport:
 *  - HTTP  GET  /map/<id>/image                  -> raw image bytes of the active map
 *  - HTTP  GET  /map/<id>/token/<tokenId>/image  -> raw image bytes of a token
 *  - WS         /ws                               -> realtime state channel
 *
 * There is no authentication: the server is meant for a trusted local network.
 * Only player-safe data is ever sent (DM-only markers, hidden tokens and
 * invisible spell templates are filtered out server-side, never on the wire).
 */

export const GM_MAP_WS_PATH = "/ws";
export const GM_MAP_IMAGE_PREFIX = "/map/";

/** A token as seen by a player client. No DM-only fields are included. */
export interface NetToken {
  id: string;
  /** Center in image pixels. */
  x: number;
  y: number;
  /** Radius in image pixels. */
  radius: number;
  label: string;
  color: string;
  /**
   * HTTP path (relative to the server root) to fetch this token's picture, when
   * the DM assigned one. Absent for plain colored tokens. Fetch and draw it
   * clipped to the token circle instead of the color + initial.
   */
  imagePath?: string;
  /** Whether this client is allowed to drag the token. */
  playerControlled: boolean;
}

/** A spell area template the DM has revealed to players. */
export interface NetSpell {
  id: string;
  shape: "circle" | "cone" | "line" | "cube";
  /** Origin in image pixels. */
  x: number;
  y: number;
  /** Primary dimension in feet (radius / length / side). */
  size: number;
  /** Width in feet (line only). */
  width?: number;
  /** Facing in radians (0 = east); unused for circles. */
  angle: number;
  label: string;
  color: string;
}

/** Fog-of-war state. The client renders this fully opaque (player view). */
export interface NetFog {
  cols: number;
  rows: number;
  cellSize: number;
  /** Top-left of cell (0,0) in image pixels. */
  originX: number;
  originY: number;
  /** Row-major flat array of revealed grid cells. */
  revealed: boolean[];
  /** Freeform reveal mask as a PNG data URL (white = revealed), or null. */
  brush: string | null;
}

export interface NetPing {
  x: number;
  y: number;
  color: string;
  /** Wall-clock creation time (ms) driving the pulse animation. */
  createdAt: number;
}

/** Static-ish information about the published map. */
export interface NetMapInfo {
  mapId: string;
  imageWidth: number;
  imageHeight: number;
  /** HTTP path (relative to the server root) to fetch the image bytes. */
  imagePath: string;
  /** Feet represented by one grid cell (for the measure ruler). */
  feetPerCell: number;
  /** Grid cell size in image pixels (== fog.cellSize at publish time). */
  cellSize: number;
  /** Grid overlay line color (CSS hex). */
  gridColor: string;
  /** Grid overlay line width in pixels. */
  gridLineWidth: number;
}

/** Full player-safe snapshot of the dynamic map state. */
export interface NetSnapshot {
  tokens: NetToken[];
  spells: NetSpell[];
  fog: NetFog;
  gridOverlay: boolean;
  /** DM "look here" focus point in image pixels, if set. */
  pan?: { x: number; y: number };
}

// ---- Server -> Client ----

export type ServerMessage =
  | { type: "hello"; info: NetMapInfo; snapshot: NetSnapshot }
  | { type: "fog"; fog: NetFog }
  | { type: "tokens"; tokens: NetToken[] }
  | { type: "spells"; spells: NetSpell[] }
  | { type: "grid"; fog: NetFog; gridOverlay: boolean }
  | { type: "pan"; pan: { x: number; y: number } }
  | { type: "ping"; ping: NetPing }
  /** No map is currently being shared; the client should wait for a `hello`. */
  | { type: "idle" };

// ---- Client -> Server ----

export type ClientMessage =
  | { type: "moveToken"; id: string; x: number; y: number }
  | { type: "ping"; x: number; y: number };

/** Parse and validate a client message; returns null if it is malformed. */
export function parseClientMessage(data: string): ClientMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  if (m.type === "moveToken") {
    if (typeof m.id !== "string") return null;
    if (typeof m.x !== "number" || !Number.isFinite(m.x)) return null;
    if (typeof m.y !== "number" || !Number.isFinite(m.y)) return null;
    return { type: "moveToken", id: m.id, x: m.x, y: m.y };
  }
  if (m.type === "ping") {
    if (typeof m.x !== "number" || !Number.isFinite(m.x)) return null;
    if (typeof m.y !== "number" || !Number.isFinite(m.y)) return null;
    return { type: "ping", x: m.x, y: m.y };
  }
  return null;
}
