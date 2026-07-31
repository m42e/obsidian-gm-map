import { FogData, Ping, Spell, Token } from "../types";
import { MapStateStore } from "../state/MapStateStore";
import {
  GM_MAP_IMAGE_PREFIX,
  NetFog,
  NetPing,
  NetSnapshot,
  NetSpell,
  NetToken,
} from "./protocol";

/** Predicate that returns true when an image-space point is revealed by fog. */
export type RevealTest = (p: { x: number; y: number }) => boolean;

/** HTTP path that serves a token's picture for the given map. */
export function tokenImagePath(mapId: string, tokenId: string): string {
  return `${GM_MAP_IMAGE_PREFIX}${encodeURIComponent(mapId)}/token/${encodeURIComponent(
    tokenId
  )}/image`;
}

export function toNetToken(t: Token, mapId: string): NetToken {
  return {
    id: t.id,
    x: t.x,
    y: t.y,
    radius: t.radius,
    label: t.label,
    color: t.color,
    imagePath: t.image ? tokenImagePath(mapId, t.id) : undefined,
    playerControlled: t.playerControlled === true,
  };
}

export function toNetSpell(s: Spell): NetSpell {
  return {
    id: s.id,
    shape: s.shape,
    x: s.x,
    y: s.y,
    size: s.size,
    width: s.width,
    angle: s.angle,
    label: s.label,
    color: s.color,
  };
}

export function toNetFog(fog: FogData): NetFog {
  return {
    cols: fog.cols,
    rows: fog.rows,
    cellSize: fog.cellSize,
    originX: fog.originX,
    originY: fog.originY,
    revealed: fog.revealed,
    brush: fog.brush,
  };
}

export function toNetPing(ping: Ping): NetPing {
  return { x: ping.x, y: ping.y, color: ping.color, createdAt: ping.createdAt };
}

/**
 * Build the player-safe list of tokens: every player-controlled token (so a
 * player always sees their own token), plus DM tokens that are both marked
 * visible and currently in revealed fog. Hidden tokens never reach the wire.
 */
export function buildTokens(store: MapStateStore, isRevealed: RevealTest): NetToken[] {
  return store.state.tokens
    .filter((t) => t.playerControlled === true || (t.visible && isRevealed({ x: t.x, y: t.y })))
    .map((t) => toNetToken(t, store.state.id));
}

/** Spells the DM has explicitly revealed to players. */
export function buildSpells(store: MapStateStore): NetSpell[] {
  return store.state.spells.filter((s) => s.visible).map(toNetSpell);
}

/** Assemble a complete player-safe snapshot of the dynamic state. */
export function buildSnapshot(store: MapStateStore, isRevealed: RevealTest): NetSnapshot {
  return {
    tokens: buildTokens(store, isRevealed),
    spells: buildSpells(store),
    fog: toNetFog(store.state.fog),
    gridOverlay: store.state.gridOverlay,
    pan: store.state.playerPan,
  };
}
