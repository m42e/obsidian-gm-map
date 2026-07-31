import { App, Notice, TFile } from "obsidian";
import { createServer, IncomingMessage, Server as HttpServer, ServerResponse } from "http";
import { networkInterfaces } from "os";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { GmMapSettings, MapConfig } from "../types";
import { MapStateStore, StoreEvent } from "../state/MapStateStore";
import { FogLayer } from "../fog/FogLayer";
import { Point } from "../render/Viewport";
import { snapTokenPoint } from "../render/grid";
import { resolveImageVaultPath } from "../util/imagePath";
import {
  GM_MAP_IMAGE_PREFIX,
  GM_MAP_WS_PATH,
  NetMapInfo,
  ServerMessage,
  parseClientMessage,
} from "./protocol";
import {
  buildSnapshot,
  buildSpells,
  buildTokens,
  toNetFog,
  toNetPing,
} from "./playerSnapshot";

/** A map currently being shared to iPad clients. */
export interface PublishedMap {
  config: MapConfig;
  store: MapStateStore;
  imageFile: TFile;
}

interface ActiveSession extends PublishedMap {
  fog: FogLayer;
  brushLoaded: string | null;
  unsubscribe: () => void;
}

/**
 * A tiny LAN server that streams a player-safe view of one map to native iPad
 * clients over WebSocket and serves the map image over HTTP. The DM machine is
 * the source of truth; player token moves and pings come back over the socket
 * and are applied through the shared `MapStateStore`, so the DM view updates
 * live. There is no authentication — it is intended for a trusted local
 * network only.
 */
export class MapServer {
  private http: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private active: ActiveSession | null = null;
  port = 3010;

  constructor(private app: App, private settings: () => GmMapSettings) {}

  private log(...args: unknown[]): void {
    console.log("[GM Map server]", ...args);
  }

  private warn(...args: unknown[]): void {
    console.warn("[GM Map server]", ...args);
  }

  get running(): boolean {
    return this.http !== null;
  }

  /** Whether a map is currently being shared. */
  get sharing(): boolean {
    return this.active !== null;
  }

  get activeMapId(): string | null {
    return this.active?.config.id ?? null;
  }

  // ---- Lifecycle ----

  start(port: number): void {
    if (this.http) {
      if (this.port === port) return;
      this.closeServer();
    }
    this.port = port;
    const server = createServer((req, res) => this.onHttpRequest(req, res));
    server.on("error", (err) => {
      this.warn("failed to start:", (err as Error).message);
      new Notice(`GM Map server error: ${(err as Error).message}`);
      this.closeServer();
    });
    server.on("listening", () =>
      this.log(`listening on port ${port} — ${this.addresses().join(", ")}`)
    );
    const wss = new WebSocketServer({ server, path: GM_MAP_WS_PATH });
    wss.on("connection", (socket, req) => this.onConnection(socket, req));
    server.listen(port, "0.0.0.0");
    this.http = server;
    this.wss = wss;
  }

  /** Stop the network server but keep the published map (clients can reconnect). */
  stop(): void {
    this.closeServer();
  }

  /** Fully shut down: stop the server and drop the published map + subscription. */
  dispose(): void {
    this.closeServer();
    this.unpublishInternal();
  }

  private closeServer(): void {
    const wasRunning = this.http !== null;
    for (const c of this.clients) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
    this.http?.close();
    this.http = null;
    if (wasRunning) this.log("stopped");
  }

  // ---- Publishing ----

  /** Share a map (replacing any previously shared one) and greet connected clients. */
  async publish(map: PublishedMap): Promise<void> {
    this.unpublishInternal();
    const w = map.config.width ?? 0;
    const h = map.config.height ?? 0;
    const fog = new FogLayer(w, h);
    await fog.loadBrush(map.store.state.fog.brush);
    fog.markDirty();
    this.active = {
      ...map,
      fog,
      brushLoaded: map.store.state.fog.brush,
      unsubscribe: map.store.subscribe((e) => this.onStoreEvent(e)),
    };
    const tokens = map.store.state.tokens;
    const playerTokens = tokens.filter((t) => t.playerControlled === true).length;
    this.log(
      `sharing "${map.config.id}" (${playerTokens}/${tokens.length} player-movable tokens) to ${this.clients.size} client(s)`
    );
    const hello = this.buildHello();
    if (hello) this.broadcast(hello);
  }

  /** Stop sharing entirely; connected clients fall back to idle. */
  unpublish(): void {
    if (this.active) this.log(`stopped sharing "${this.active.config.id}"`);
    this.unpublishInternal();
    this.broadcast({ type: "idle" });
  }

  private unpublishInternal(): void {
    this.active?.unsubscribe();
    this.active = null;
  }

  /** HTTP base URLs (one per non-internal IPv4 interface) for the QR / display. */
  addresses(): string[] {
    const out: string[] = [];
    const ifaces = networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const ni of ifaces[name] ?? []) {
        if (ni.family === "IPv4" && !ni.internal) {
          out.push(`http://${ni.address}:${this.port}`);
        }
      }
    }
    if (out.length === 0) out.push(`http://127.0.0.1:${this.port}`);
    return out;
  }

  // ---- Fog reveal testing (mirrors the player renderer) ----

  private isRevealed = (p: { x: number; y: number }): boolean => {
    const a = this.active;
    if (!a) return true;
    return a.fog.isPointRevealed(p, a.store.state.fog);
  };

  /** Reload the freeform brush mask if it changed (fog/grid edits). */
  private async refreshFog(): Promise<void> {
    const a = this.active;
    if (!a) return;
    const brush = a.store.state.fog.brush;
    if (brush !== a.brushLoaded) {
      await a.fog.loadBrush(brush);
      a.brushLoaded = brush;
    }
    a.fog.markDirty();
  }

  // ---- Store -> clients ----

  private onStoreEvent(event: StoreEvent): void {
    const a = this.active;
    if (!a || this.clients.size === 0) return;
    switch (event) {
      case "fog":
        void this.refreshFog().then(() => {
          this.broadcast({ type: "fog", fog: toNetFog(a.store.state.fog) });
          this.broadcast({ type: "tokens", tokens: buildTokens(a.store, this.isRevealed) });
        });
        break;
      case "grid":
        void this.refreshFog().then(() => {
          this.broadcast({
            type: "grid",
            fog: toNetFog(a.store.state.fog),
            gridOverlay: a.store.state.gridOverlay,
          });
          this.broadcast({ type: "tokens", tokens: buildTokens(a.store, this.isRevealed) });
        });
        break;
      case "tokens":
        this.broadcast({ type: "tokens", tokens: buildTokens(a.store, this.isRevealed) });
        break;
      case "spells":
        this.broadcast({ type: "spells", spells: buildSpells(a.store) });
        break;
      case "pan": {
        const pan = a.store.state.playerPan;
        if (pan) this.broadcast({ type: "pan", pan });
        break;
      }
      case "ping": {
        const ping = a.store.pings[a.store.pings.length - 1];
        if (ping) this.broadcast({ type: "ping", ping: toNetPing(ping) });
        break;
      }
      default:
        // "markers" and "all" carry no player-facing delta.
        break;
    }
  }

  private buildHello(): ServerMessage | null {
    const a = this.active;
    if (!a) return null;
    const info: NetMapInfo = {
      mapId: a.config.id,
      imageWidth: a.config.width ?? 0,
      imageHeight: a.config.height ?? 0,
      imagePath: `${GM_MAP_IMAGE_PREFIX}${encodeURIComponent(a.config.id)}/image`,
      feetPerCell: this.settings().feetPerCell,
      cellSize: a.store.state.fog.cellSize,
      gridColor: this.settings().gridColor,
      gridLineWidth: this.settings().gridLineWidth,
    };
    return { type: "hello", info, snapshot: buildSnapshot(a.store, this.isRevealed) };
  }

  // ---- WebSocket ----

  private onConnection(socket: WebSocket, req: IncomingMessage): void {
    this.clients.add(socket);
    const peer = req.socket.remoteAddress ?? "unknown";
    this.log(`client connected from ${peer} (${this.clients.size} total)`);
    socket.on("message", (data) => this.onClientMessage(data));
    socket.on("close", () => {
      this.clients.delete(socket);
      this.log(`client disconnected from ${peer} (${this.clients.size} total)`);
    });
    socket.on("error", () => this.clients.delete(socket));
    this.send(socket, this.buildHello() ?? { type: "idle" });
  }

  private onClientMessage(data: RawData): void {
    const a = this.active;
    if (!a) return;
    const text = Array.isArray(data)
      ? Buffer.concat(data).toString("utf8")
      : typeof data === "string"
      ? data
      : Buffer.from(data as ArrayBuffer).toString("utf8");
    const msg = parseClientMessage(text);
    if (!msg) {
      this.warn("ignored malformed client message");
      return;
    }

    if (msg.type === "moveToken") {
      const token = a.store.state.tokens.find((t) => t.id === msg.id);
      // Players may only move tokens the DM marked player-controlled.
      if (!token || token.playerControlled !== true) {
        this.warn(
          `ignored moveToken for "${msg.id}" (${token ? "not player-controlled" : "unknown token"})`
        );
        return;
      }
      let p: Point = { x: msg.x, y: msg.y };
      if (this.settings().snapToGrid) {
        p = snapTokenPoint(p, token.radius, a.store.state.fog);
      }
      p = this.clampToImage(p);
      a.store.updateToken(msg.id, { x: p.x, y: p.y });
    } else if (msg.type === "ping") {
      const p = this.clampToImage({ x: msg.x, y: msg.y });
      this.log(`ping at (${Math.round(p.x)}, ${Math.round(p.y)})`);
      a.store.addPing({
        x: p.x,
        y: p.y,
        color: this.settings().pingColor,
        createdAt: Date.now(),
      });
    }
  }

  private clampToImage(p: Point): Point {
    const a = this.active;
    const w = a?.config.width ?? 0;
    const h = a?.config.height ?? 0;
    return {
      x: w > 0 ? Math.max(0, Math.min(w, p.x)) : p.x,
      y: h > 0 ? Math.max(0, Math.min(h, p.y)) : p.y,
    };
  }

  private send(socket: WebSocket, msg: ServerMessage): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }

  private broadcast(msg: ServerMessage): void {
    const text = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.readyState === WebSocket.OPEN) {
        try {
          c.send(text);
        } catch {
          /* ignore */
        }
      }
    }
  }

  // ---- HTTP ----

  private onHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const url = req.url ?? "/";
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return;
    }
    const tok = url.match(/^\/map\/([^/]+)\/token\/([^/]+)\/image$/);
    if (tok) {
      void this.serveTokenImage(decodeURIComponent(tok[1]), decodeURIComponent(tok[2]), res);
      return;
    }
    const m = url.match(/^\/map\/(.+)\/image$/);
    if (m) {
      void this.serveImage(decodeURIComponent(m[1]), res);
      return;
    }
    if (url === "/" || url.startsWith("/health")) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        this.active
          ? `GM Map server — sharing "${this.active.config.id}"`
          : "GM Map server — idle"
      );
      return;
    }
    res.writeHead(404);
    res.end();
  }

  private async serveImage(id: string, res: ServerResponse): Promise<void> {
    const a = this.active;
    if (!a || a.config.id !== id) {
      this.warn(`image request 404 for "${id}"`);
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const buf = await this.app.vault.adapter.readBinary(a.imageFile.path);
      res.writeHead(200, {
        "Content-Type": contentTypeFor(a.imageFile.path),
        "Cache-Control": "no-store",
      });
      res.end(Buffer.from(buf));
      this.log(`served image "${id}" (${(buf.byteLength / 1024).toFixed(0)} KB)`);
    } catch (e) {
      this.warn(`failed to read image for "${id}":`, (e as Error).message);
      res.writeHead(500);
      res.end();
    }
  }

  /**
   * Serve a token's picture. Only player-visible tokens (player-controlled, or
   * visible and currently revealed) are served, so DM-only token art never
   * leaks to clients probing token ids.
   */
  private async serveTokenImage(
    id: string,
    tokenId: string,
    res: ServerResponse
  ): Promise<void> {
    const a = this.active;
    if (!a || a.config.id !== id) {
      res.writeHead(404);
      res.end();
      return;
    }
    const token = a.store.state.tokens.find((t) => t.id === tokenId);
    const playerVisible =
      token &&
      (token.playerControlled === true ||
        (token.visible && this.isRevealed({ x: token.x, y: token.y })));
    if (!token || !token.image || !playerVisible) {
      res.writeHead(404);
      res.end();
      return;
    }
    const vaultPath = resolveImageVaultPath(token.image, a.config.notePath);
    const file = this.app.vault.getAbstractFileByPath(vaultPath);
    if (!(file instanceof TFile)) {
      this.warn(`token image 404 for "${tokenId}" ("${token.image}")`);
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const buf = await this.app.vault.adapter.readBinary(file.path);
      res.writeHead(200, {
        "Content-Type": contentTypeFor(file.path),
        "Cache-Control": "no-store",
      });
      res.end(Buffer.from(buf));
    } catch (e) {
      this.warn(`failed to read token image for "${tokenId}":`, (e as Error).message);
      res.writeHead(500);
      res.end();
    }
  }
}

function contentTypeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    default:
      return "application/octet-stream";
  }
}
