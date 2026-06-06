import {
  FogData,
  MapConfig,
  MapState,
  Marker,
  STATE_VERSION,
  Token,
} from "../types";
import { sigFrom } from "../codeblock/mapBlock";
import { StatePersistence } from "./persistence";

export type StoreEvent = "fog" | "tokens" | "markers" | "grid" | "pan" | "all";
type Listener = (event: StoreEvent) => void;

/** Geometry for a grid with a given cell size and (x, y) offset. */
export interface GridGeometry {
  cellSize: number;
  offsetX: number;
  offsetY: number;
  originX: number;
  originY: number;
  cols: number;
  rows: number;
}

/**
 * Compute dense grid geometry covering the image. The grid is conceptually an
 * infinite lattice with lines at `offset + k*cellSize`; we normalize the offset
 * into (-cellSize, 0] so cell (0,0) always sits at or before the top-left of the
 * image, and size enough cols/rows to cover the whole image.
 */
export function computeGrid(
  width: number,
  height: number,
  cellSize: number,
  offsetX: number,
  offsetY: number
): GridGeometry {
  const cell = Math.max(1, cellSize);
  const originX = offsetX - cell * Math.ceil(offsetX / cell);
  const originY = offsetY - cell * Math.ceil(offsetY / cell);
  const cols = Math.max(1, Math.ceil((width - originX) / cell));
  const rows = Math.max(1, Math.ceil((height - originY) / cell));
  return { cellSize: cell, offsetX, offsetY, originX, originY, cols, rows };
}

function createEmptyFog(config: MapConfig): FogData {
  const geom = computeGrid(
    config.width ?? 0,
    config.height ?? 0,
    config.grid,
    0,
    0
  );
  return {
    ...geom,
    revealed: new Array<boolean>(geom.cols * geom.rows).fill(false),
    brush: null,
  };
}

/**
 * In-memory reactive store for a single map's dynamic state. Because the DM
 * view and the player pop-out window share the same Obsidian/JS process, both
 * subscribe to the same store instance and stay in sync live.
 *
 * Saves are debounced to avoid disk thrashing while painting fog.
 */
export class MapStateStore {
  state: MapState;
  private listeners = new Set<Listener>();
  private saveTimer: number | null = null;
  private readonly saveDelay = 600;

  constructor(
    public config: MapConfig,
    private persistence: StatePersistence,
    initial: MapState | null
  ) {
    if (initial) {
      this.state = this.reconcile(initial, config);
    } else {
      this.state = {
        id: config.id,
        fog: createEmptyFog(config),
        tokens: (config.tokens ?? []).map((t) => ({ ...t })),
        markers: (config.markers ?? []).map((m) => ({ ...m })),
        gridOverlay: config.gridOverlay ?? false,
        showTokens: true,
        sourceSig: sigFrom(config.tokens ?? [], config.markers ?? []),
        version: STATE_VERSION,
      };
    }
  }

  /** Ensure a loaded state matches the current image dimensions/grid. */
  private reconcile(state: MapState, config: MapConfig): MapState {
    const fog = state.fog;
    const width = config.width ?? 0;
    const height = config.height ?? 0;
    // Preserve the user's saved grid size/offset; fall back to config default.
    const cellSize = fog?.cellSize && fog.cellSize > 0 ? fog.cellSize : config.grid;
    const offsetX = Number.isFinite(fog?.offsetX)
      ? fog.offsetX
      : config.gridOffsetX ?? 0;
    const offsetY = Number.isFinite(fog?.offsetY)
      ? fog.offsetY
      : config.gridOffsetY ?? 0;
    const geom = computeGrid(width, height, cellSize, offsetX, offsetY);

    const keepRevealed =
      Array.isArray(fog?.revealed) &&
      fog.revealed.length === geom.cols * geom.rows &&
      fog.cellSize === geom.cellSize &&
      fog.originX === geom.originX &&
      fog.originY === geom.originY;

    state.fog = {
      ...geom,
      revealed: keepRevealed
        ? fog.revealed
        : new Array<boolean>(geom.cols * geom.rows).fill(false),
      brush: fog?.brush ?? null,
    };
    state.tokens = Array.isArray(state.tokens) ? state.tokens : [];
    state.markers = Array.isArray(state.markers) ? state.markers : [];
    state.gridOverlay = Boolean(state.gridOverlay);
    return state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: StoreEvent): void {
    for (const l of this.listeners) l(event);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.persistence.save(this.state);
    }, this.saveDelay);
  }

  /** Force an immediate save (e.g. on view close). */
  flush(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    void this.persistence.save(this.state);
  }

  // ---- Fog mutations ----

  setGridCell(col: number, row: number, revealed: boolean): void {
    const { cols, rows } = this.state.fog;
    if (col < 0 || row < 0 || col >= cols || row >= rows) return;
    const idx = row * cols + col;
    if (this.state.fog.revealed[idx] === revealed) return;
    this.state.fog.revealed[idx] = revealed;
    this.emit("fog");
  }

  setBrushMask(dataUrl: string | null): void {
    this.state.fog.brush = dataUrl;
    this.emit("fog");
  }

  resetFog(reveal: boolean): void {
    this.state.fog.revealed.fill(reveal);
    this.state.fog.brush = null;
    this.emit("fog");
  }

  // ---- Grid overlay ----

  setGridOverlay(enabled: boolean): void {
    if (this.state.gridOverlay === enabled) return;
    this.state.gridOverlay = enabled;
    this.emit("grid");
  }

  /**
   * Adjust the grid cell size and/or offset for visual alignment. Recomputes
   * geometry; grid-revealed fog is reset when the lattice changes (the freeform
   * brush mask is kept). Align the grid before revealing with grid cells.
   */
  setGrid(patch: { cellSize?: number; offsetX?: number; offsetY?: number }): void {
    const fog = this.state.fog;
    const cellSize =
      patch.cellSize !== undefined && patch.cellSize > 0
        ? patch.cellSize
        : fog.cellSize;
    const offsetX = patch.offsetX !== undefined ? patch.offsetX : fog.offsetX;
    const offsetY = patch.offsetY !== undefined ? patch.offsetY : fog.offsetY;

    const geom = computeGrid(
      this.config.width ?? 0,
      this.config.height ?? 0,
      cellSize,
      offsetX,
      offsetY
    );
    if (
      geom.cellSize === fog.cellSize &&
      geom.originX === fog.originX &&
      geom.originY === fog.originY &&
      geom.offsetX === fog.offsetX &&
      geom.offsetY === fog.offsetY
    ) {
      return;
    }

    const sameLattice =
      geom.cols * geom.rows === fog.revealed.length &&
      geom.cellSize === fog.cellSize &&
      geom.originX === fog.originX &&
      geom.originY === fog.originY;

    this.state.fog = {
      ...geom,
      revealed: sameLattice
        ? fog.revealed
        : new Array<boolean>(geom.cols * geom.rows).fill(false),
      brush: fog.brush,
    };
    this.emit("grid");
  }

  // ---- Player view pan ----

  setPlayerPan(x: number, y: number): void {
    if (!this.state.playerPan) this.state.playerPan = { x: 0, y: 0 };
    this.state.playerPan.x = x;
    this.state.playerPan.y = y;
    this.emit("pan");
  }

  // ---- Token mutations ----

  addToken(token: Token): void {
    this.state.tokens.push(token);
    this.emit("tokens");
  }

  updateToken(id: string, patch: Partial<Token>): void {
    const t = this.state.tokens.find((t) => t.id === id);
    if (!t) return;
    Object.assign(t, patch);
    this.emit("tokens");
  }

  removeToken(id: string): void {
    const before = this.state.tokens.length;
    this.state.tokens = this.state.tokens.filter((t) => t.id !== id);
    if (this.state.tokens.length !== before) this.emit("tokens");
  }

  // ---- Marker mutations (DM only) ----

  addMarker(marker: Marker): void {
    this.state.markers.push(marker);
    this.emit("markers");
  }

  updateMarker(id: string, patch: Partial<Marker>): void {
    const m = this.state.markers.find((m) => m.id === id);
    if (!m) return;
    Object.assign(m, patch);
    this.emit("markers");
  }

  removeMarker(id: string): void {
    const before = this.state.markers.length;
    this.state.markers = this.state.markers.filter((m) => m.id !== id);
    if (this.state.markers.length !== before) this.emit("markers");
  }

  /**
   * Record the markdown signature for the current tokens/markers (called after
   * saving to the note) so the saved state isn't treated as a markdown edit.
   */
  setSourceSig(sig: string): void {
    this.state.sourceSig = sig;
    this.flush();
  }
}

/**
 * Process-wide registry so the DM view and player window resolve the same
 * store instance for a given map id.
 */
export class StoreRegistry {
  private stores = new Map<string, MapStateStore>();

  constructor(private persistence: StatePersistence) {}

  async get(config: MapConfig): Promise<MapStateStore> {
    const existing = this.stores.get(config.id);
    if (existing) {
      existing.config = config;
      return existing;
    }
    const sidecar = await this.persistence.load(config.id);
    const initial = this.resolveInitial(config, sidecar);
    const store = new MapStateStore(config, this.persistence, initial);
    this.stores.set(config.id, store);
    return store;
  }

  /**
   * Decide the starting state. When the saved working state's signature still
   * matches the code block, it wins (live edits persist). When the markdown was
   * edited (or there is no saved state), the markdown re-seeds tokens/markers
   * and grid, while any saved fog is preserved.
   */
  private resolveInitial(
    config: MapConfig,
    sidecar: MapState | null
  ): MapState | null {
    const sig = sigFrom(config.tokens ?? [], config.markers ?? []);
    if (sidecar && sidecar.sourceSig === sig) {
      return sidecar;
    }
    if (!sidecar) {
      // No saved state: let the store build everything from the config.
      return null;
    }
    // Markdown changed: re-seed declarative parts, keep fog + working grid.
    return {
      id: config.id,
      fog: sidecar.fog,
      tokens: (config.tokens ?? []).map((t) => ({ ...t })),
      markers: (config.markers ?? []).map((m) => ({ ...m })),
      gridOverlay: sidecar.gridOverlay,
      showTokens: sidecar.showTokens ?? true,
      sourceSig: sig,
      version: STATE_VERSION,
    };
  }

  peek(id: string): MapStateStore | undefined {
    return this.stores.get(id);
  }

  flushAll(): void {
    for (const store of this.stores.values()) store.flush();
  }
}
