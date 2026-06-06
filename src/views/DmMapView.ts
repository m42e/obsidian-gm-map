import { WorkspaceLeaf, setIcon } from "obsidian";
import { BaseMapView } from "./BaseMapView";
import { RenderMode } from "../render/MapRenderer";
import { DmTool, Marker, Token, VIEW_TYPE_DM, VIEW_TYPE_PLAYER } from "../types";
import { Point } from "../render/Viewport";
import { StatblockPanel } from "../ui/StatblockPanel";
import { TokenEditModal } from "../ui/TokenEditModal";
import { MarkerEditModal } from "../ui/MarkerEditModal";
import { GridAlignPanel } from "../ui/GridAlignPanel";
import { PlayerMapView } from "./PlayerMapView";
import type GmMapPlugin from "../../main";

/**
 * The DM-facing map view: a toolbar for fog/tokens/markers plus a statblock
 * side panel. The DM sees dimmed fog (to work underneath) and DM-only markers.
 */
export class DmMapView extends BaseMapView {
  readonly mode: RenderMode = "dm";

  private tool: DmTool = "pan";
  private fogReveal = true;
  private brushSize: number;
  private statblockPanel: StatblockPanel | null = null;
  private gridPanel: GridAlignPanel | null = null;
  private gridAlignBtn: HTMLElement | null = null;
  private zoomSlider: HTMLInputElement | null = null;
  private toolButtons = new Map<DmTool, HTMLElement>();

  // Drag state.
  private dragging = false;
  private draggingTokenId: string | null = null;
  private draggingMarkerId: string | null = null;
  private moved = false;
  private lastClient = { x: 0, y: 0 };

  // Snap-to-grid state.
  private snapToGrid = true;
  private snapBtn: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: GmMapPlugin) {
    super(leaf, plugin);
    this.brushSize = plugin.settings.defaultBrushSize;
    this.snapToGrid = plugin.settings.snapToGrid;
  }

  getViewType(): string {
    return VIEW_TYPE_DM;
  }

  getDisplayText(): string {
    return this.config ? `DM map: ${this.config.id}` : "DM map";
  }

  protected teardown(): void {
    this.statblockPanel?.destroy();
    this.statblockPanel = null;
    this.gridPanel?.destroy();
    this.gridPanel = null;
    this.gridAlignBtn = null;
    this.zoomSlider = null;
    this.snapBtn = null;
    super.teardown();
  }

  // ---- Toolbar ----

  protected buildChrome(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "gm-map-toolbar" });

    const addTool = (tool: DmTool, icon: string, label: string) => {
      const btn = bar.createEl("button", {
        cls: "gm-map-tool",
        attr: { "aria-label": label, title: label },
      });
      setIcon(btn, icon);
      btn.onclick = () => this.setTool(tool);
      this.toolButtons.set(tool, btn);
    };

    addTool("pan", "move", "Pan / select & move");
    addTool("player-pan", "navigation", "Pan player view");
    addTool("fog-grid", "grid", "Fog: grid cells");
    addTool("fog-brush", "brush", "Fog: freeform brush");
    addTool("token", "user", "Add token");
    addTool("marker", "map-pin", "Add DM marker");

    bar.createDiv({ cls: "gm-map-toolbar-sep" });

    // Fog reveal/hide toggle.
    const fogToggle = bar.createEl("button", {
      cls: "gm-map-tool gm-map-fogmode",
      attr: { title: "Toggle reveal / hide" },
    });
    const updateFogToggle = () => {
      fogToggle.empty();
      setIcon(fogToggle, this.fogReveal ? "eye" : "eye-off");
      fogToggle.toggleClass("is-hide", !this.fogReveal);
      fogToggle.setAttr(
        "aria-label",
        this.fogReveal ? "Mode: reveal" : "Mode: hide"
      );
    };
    fogToggle.onclick = () => {
      this.fogReveal = !this.fogReveal;
      updateFogToggle();
    };
    updateFogToggle();

    // Brush size.
    const brushWrap = bar.createDiv({ cls: "gm-map-brush-size" });
    brushWrap.createSpan({ text: "Brush" });
    const slider = brushWrap.createEl("input", {
      attr: { type: "range", min: "20", max: "400", step: "5" },
    });
    slider.value = String(this.brushSize);
    slider.oninput = () => (this.brushSize = Number(slider.value));

    // Zoom slider.
    const zoomWrap = bar.createDiv({ cls: "gm-map-brush-size" });
    zoomWrap.createSpan({ text: "Zoom" });
    const zoomSlider = zoomWrap.createEl("input", {
      attr: { type: "range", min: "0", max: "100", step: "1" },
    });
    zoomSlider.value = "50";
    zoomSlider.oninput = () => {
      if (!this.renderer || !this.canvas) return;
      const target = this.sliderToScale(Number(zoomSlider.value));
      const factor = target / this.renderer.viewport.scale;
      const center = { x: this.canvas.width / 2, y: this.canvas.height / 2 };
      this.renderer.viewport.zoomAt(center, factor);
      this.renderer.requestRender();
    };
    this.zoomSlider = zoomSlider;

    bar.createDiv({ cls: "gm-map-toolbar-sep" });

    // Snap-to-grid toggle.
    const snapBtn = bar.createEl("button", {
      cls: "gm-map-tool",
      attr: { title: "Snap tokens to grid" },
    });
    setIcon(snapBtn, "magnet");
    snapBtn.toggleClass("is-active", this.snapToGrid);
    snapBtn.onclick = () => {
      this.snapToGrid = !this.snapToGrid;
      snapBtn.toggleClass("is-active", this.snapToGrid);
    };
    this.snapBtn = snapBtn;

    // Grid overlay toggle (synced to the player view).
    const gridBtn = bar.createEl("button", {
      cls: "gm-map-tool",
      attr: { title: "Toggle grid overlay (DM + players)" },
    });
    setIcon(gridBtn, "layout-grid");
    gridBtn.toggleClass("is-active", this.store?.state.gridOverlay ?? false);
    gridBtn.onclick = () => {
      if (!this.store) return;
      const next = !this.store.state.gridOverlay;
      this.store.setGridOverlay(next);
      gridBtn.toggleClass("is-active", next);
    };

    // Grid alignment panel toggle.
    const alignBtn = bar.createEl("button", {
      cls: "gm-map-tool",
      attr: { title: "Align grid (size & offset)" },
    });
    setIcon(alignBtn, "ruler");
    alignBtn.onclick = () => this.toggleGridPanel();
    this.gridAlignBtn = alignBtn;

    // Reset fog actions.
    const hideAllBtn = bar.createEl("button", {
      cls: "gm-map-tool",
      attr: { title: "Cover entire map with fog" },
    });
    setIcon(hideAllBtn, "cloud");
    hideAllBtn.onclick = () => this.resetFog(false);

    const revealAllBtn = bar.createEl("button", {
      cls: "gm-map-tool",
      attr: { title: "Reveal entire map" },
    });
    setIcon(revealAllBtn, "sun");
    revealAllBtn.onclick = () => this.resetFog(true);

    bar.createDiv({ cls: "gm-map-toolbar-spacer" });

    // Fit + open player window.
    const fitBtn = bar.createEl("button", {
      cls: "gm-map-tool",
      attr: { title: "Fit map to view" },
    });
    setIcon(fitBtn, "maximize");
    fitBtn.onclick = () => {
      if (this.renderer && this.canvas) {
        this.renderer.viewport.fit(this.canvas.width, this.canvas.height);
        this.renderer.requestRender();
      }
    };

    // Save current tokens/markers/grid back into the note's code block.
    const saveBtn = bar.createEl("button", {
      cls: "gm-map-tool",
      attr: { title: "Save tokens, markers & grid to the note" },
    });
    setIcon(saveBtn, "save");
    saveBtn.createSpan({ text: "Save" });
    saveBtn.onclick = () => {
      if (this.config && this.store) {
        void this.plugin.saveMapToNote(this.config, this.store);
      }
    };

    const playerBtn = bar.createEl("button", {
      cls: "gm-map-tool gm-map-open-player",
      attr: { title: "Open player window" },
    });
    setIcon(playerBtn, "monitor");
    playerBtn.createSpan({ text: "Player view" });
    playerBtn.onclick = () => {
      if (this.config) void this.plugin.openPlayerView(this.config);
    };
  }

  private setTool(tool: DmTool): void {
    this.tool = tool;
    for (const [t, btn] of this.toolButtons) {
      btn.toggleClass("is-active", t === tool);
    }
    if (this.canvasWrap) {
      this.canvasWrap.dataset.tool = tool;
    }
    this.updatePlayerViewRect();
  }

  protected onZoomChanged(): void {
    this.syncZoomSlider();
  }

  private syncZoomSlider(): void {
    if (this.zoomSlider && this.renderer) {
      this.zoomSlider.value = String(this.scaleToSlider(this.renderer.viewport.scale));
    }
  }

  private scaleToSlider(scale: number): number {
    const lo = Math.log(0.05), hi = Math.log(8);
    return Math.round(((Math.log(scale) - lo) / (hi - lo)) * 100);
  }

  private sliderToScale(val: number): number {
    const lo = Math.log(0.05), hi = Math.log(8);
    return Math.exp(lo + (val / 100) * (hi - lo));
  }

  private resetFog(reveal: boolean): void {
    this.store?.resetFog(reveal);
    if (this.renderer) {
      this.renderer.fog.loadBrush(null).then(() => {
        this.loadedBrush = null;
        this.renderer?.fog.markDirty();
        this.renderer?.requestRender();
      }).catch(() => { /* ignore */ });
    }
  }

  // ---- Setup interactions & panel ----

  private toggleGridPanel(force?: boolean): void {
    if (!this.gridPanel) return;
    const open =
      force !== undefined ? force : this.gridPanel.el.style.display === "none";
    if (open) {
      this.gridPanel.show();
      this.setTool("pan");
    } else {
      this.gridPanel.hide();
    }
    this.gridAlignBtn?.toggleClass("is-active", open);
  }

  protected handleStoreEvent(event: import("../state/MapStateStore").StoreEvent): void {
    if (event === "pan") this.updatePlayerViewRect();
  }

  /** Compute and set the player viewport rectangle on the renderer.
   *  The rect is only shown when the active tool is "pan" or "player-pan" and
   *  the player view for this map is currently open. */
  private updatePlayerViewRect(): void {
    if (!this.renderer || !this.store || !this.config) return;

    const show = this.tool === "pan" || this.tool === "player-pan";
    if (!show) {
      this.renderer.playerViewRect = null;
      this.renderer.requestRender();
      return;
    }

    const playerLeaves = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_PLAYER);
    const playerLeaf = playerLeaves.find((l) => {
      const state = l.view.getState() as { config?: { id?: string } };
      return state?.config?.id === this.config?.id;
    });

    if (!playerLeaf) {
      this.renderer.playerViewRect = null;
      this.renderer.requestRender();
      return;
    }

    const playerView = playerLeaf.view as PlayerMapView;
    const canvasW = playerView.canvasWidth;
    const canvasH = playerView.canvasHeight;
    if (!canvasW || !canvasH) {
      this.renderer.playerViewRect = null;
      this.renderer.requestRender();
      return;
    }

    const dpi = this.plugin.settings.playerScreenDpi;
    const cellSizePx = this.store.state.fog.cellSize;
    const playerScale = dpi / Math.max(1, cellSizePx);
    const pan = this.store.state.playerPan ?? { x: 0, y: 0 };

    this.renderer.playerViewRect = {
      x: pan.x,
      y: pan.y,
      w: canvasW / playerScale,
      h: canvasH / playerScale,
    };
    this.renderer.requestRender();
  }

  protected onMapReady(): void {
    this.syncZoomSlider();
    this.setTool("pan");
    this.statblockPanel = new StatblockPanel(
      this.canvasWrap,
      this.app,
      this.plugin.statblocks,
      this,
      () => this.statblockPanel?.hide()
    );

    if (this.store) {
      this.gridPanel = new GridAlignPanel(this.canvasWrap, this.store, () =>
        this.toggleGridPanel(false)
      );
      this.gridPanel.hide();
    }

    const win = this.canvas.ownerDocument.defaultView as Window;

    this.registerDomEvent(this.canvas, "mousedown", (e: MouseEvent) =>
      this.onMouseDown(e)
    );
    this.registerDomEvent(win, "mousemove", (e: MouseEvent) =>
      this.onMouseMove(e)
    );
    this.registerDomEvent(win, "mouseup", (e: MouseEvent) =>
      this.onMouseUp(e)
    );
    this.registerDomEvent(this.canvas, "contextmenu", (e: MouseEvent) =>
      this.onContextMenu(e)
    );
  }

  // ---- Mouse handling ----

  private onMouseDown(e: MouseEvent): void {
    if (!this.renderer || !this.store) return;
    if (e.button === 2) return; // context menu handled separately
    this.dragging = true;
    this.moved = false;
    this.lastClient = { x: e.clientX, y: e.clientY };
    const img = this.imagePoint(e);

    switch (this.tool) {
      case "pan": {
        const token = this.renderer.hitTestToken(img);
        if (token) {
          this.draggingTokenId = token.id;
          this.renderer.selectedTokenId = token.id;
          this.renderer.requestRender();
          return;
        }
        const marker = this.renderer.hitTestMarker(img);
        if (marker) {
          this.draggingMarkerId = marker.id;
          this.renderer.selectedMarkerId = marker.id;
          this.renderer.requestRender();
          return;
        }
        // else pan (handled in mousemove)
        break;
      }
      case "player-pan":
        // pan is handled in mousemove
        break;
      case "fog-grid":
        this.paintGrid(img);
        break;
      case "fog-brush":
        this.suppressBrushReload = true;
        this.paintBrush(img);
        break;
      case "token":
        this.createToken(img);
        this.dragging = false;
        break;
      case "marker":
        this.createMarker(img);
        this.dragging = false;
        break;
    }
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.dragging || !this.renderer || !this.store) return;
    const dpr = window.devicePixelRatio || 1;
    const dx = (e.clientX - this.lastClient.x) * dpr;
    const dy = (e.clientY - this.lastClient.y) * dpr;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) this.moved = true;
    this.lastClient = { x: e.clientX, y: e.clientY };
    const img = this.imagePoint(e);

    if (this.draggingTokenId) {
      const token = this.store.state.tokens.find((t) => t.id === this.draggingTokenId);
      const snapped = token ? this.snapPoint(img, token.radius) : img;
      this.store.updateToken(this.draggingTokenId, { x: snapped.x, y: snapped.y });
      return;
    }
    if (this.draggingMarkerId) {
      this.store.updateMarker(this.draggingMarkerId, { x: img.x, y: img.y });
      return;
    }
    switch (this.tool) {
      case "pan":
        this.renderer.viewport.pan(dx, dy);
        this.renderer.requestRender();
        break;
      case "player-pan": {
        const vp = this.renderer.viewport;
        const cur = this.store.state.playerPan ?? { x: 0, y: 0 };
        this.store.setPlayerPan(
          cur.x + dx / vp.scale,
          cur.y + dy / vp.scale
        );
        break;
      }
      case "fog-grid":
        this.paintGrid(img);
        break;
      case "fog-brush":
        this.paintBrush(img);
        break;
    }
  }

  private onMouseUp(_e: MouseEvent): void {
    if (!this.dragging) return;
    this.dragging = false;

    // Click (no drag) on a token shows its statblock (only if a creature is linked).
    if (this.draggingTokenId && !this.moved) {
      const token = this.store?.state.tokens.find(
        (t) => t.id === this.draggingTokenId
      );
      if (token?.creature) {
        this.statblockPanel?.show(token);
      } else {
        this.statblockPanel?.hide();
      }
    }

    // Click (no drag) on a marker shows its linked note in the side panel.
    if (this.draggingMarkerId && !this.moved) {
      const marker = this.store?.state.markers.find(
        (m) => m.id === this.draggingMarkerId
      );
      if (marker) {
        void this.statblockPanel?.showMarker(marker);
      } else {
        this.statblockPanel?.hide();
      }
    }

    if (this.tool === "fog-brush") {
      this.commitBrush();
      this.suppressBrushReload = false;
    }

    this.draggingTokenId = null;
    this.draggingMarkerId = null;
  }

  private onContextMenu(e: MouseEvent): void {
    if (!this.renderer) return;
    e.preventDefault();
    const img = this.imagePoint(e);
    const token = this.renderer.hitTestToken(img);
    if (token) {
      this.editToken(token);
      return;
    }
    const marker = this.renderer.hitTestMarker(img);
    if (marker) {
      this.editMarker(marker);
    }
  }

  // ---- Fog painting ----

  private paintGrid(img: Point): void {
    if (!this.store) return;
    const { cellSize, originX, originY } = this.store.state.fog;
    const col = Math.floor((img.x - originX) / cellSize);
    const row = Math.floor((img.y - originY) / cellSize);
    this.store.setGridCell(col, row, this.fogReveal);
  }

  private paintBrush(img: Point): void {
    if (!this.renderer) return;
    this.renderer.fog.paintBrush(img, this.brushSize / 2, this.fogReveal);
    this.renderer.requestRender();
  }

  private commitBrush(): void {
    if (!this.renderer || !this.store) return;
    const data = this.renderer.fog.exportBrush();
    this.loadedBrush = data;
    this.store.setBrushMask(data);
  }

  // ---- Snap to grid ----

  /**
   * Snap an image-space point to the nearest grid position based on token radius.
   * Odd-sized creatures (1×1, 3×3 …) snap to cell center.
   * Even-sized creatures (2×2, 4×4 …) snap to the nearest grid corner/cross.
   */
  private snapPoint(img: Point, radius: number): Point {
    if (!this.snapToGrid || !this.store) return img;
    const { cellSize, originX, originY } = this.store.state.fog;
    if (cellSize <= 0) return img;

    // Determine creature size in cells (diameter / cellSize, rounded).
    const sizeInCells = Math.max(1, Math.round((radius * 2) / cellSize));

    if (sizeInCells % 2 === 0) {
      // Even (2×2, 4×4 …): center sits on a grid corner.
      return {
        x: Math.round((img.x - originX) / cellSize) * cellSize + originX,
        y: Math.round((img.y - originY) / cellSize) * cellSize + originY,
      };
    } else {
      // Odd (1×1, 3×3 …): center sits in the middle of a cell.
      return {
        x: (Math.floor((img.x - originX) / cellSize) + 0.5) * cellSize + originX,
        y: (Math.floor((img.y - originY) / cellSize) + 0.5) * cellSize + originY,
      };
    }
  }

  // ---- Tokens ----

  private createToken(img: Point): void {
    const defaultRadius = Math.max(12, this.store!.config.grid / 2);
    const token: Token = {
      id: randomId("tok"),
      x: img.x,
      y: img.y,
      radius: defaultRadius,
      label: "",
      color: this.plugin.settings.defaultTokenColor,
      visible: true,
    };
    new TokenEditModal(
      this.app,
      this.plugin.statblocks,
      token,
      (result) => {
        if (!result) return;
        token.label = result.label;
        token.color = result.color;
        token.radius = result.radius;
        token.creature = result.creature;
        // Re-snap with the final radius chosen in the modal.
        const snapped = this.snapPoint(img, result.radius);
        token.x = snapped.x;
        token.y = snapped.y;
        this.store?.addToken(token);
      }
    ).open();
  }

  private editToken(token: Token): void {
    new TokenEditModal(
      this.app,
      this.plugin.statblocks,
      token,
      (result) => {
        if (!result) return;
        this.store?.updateToken(token.id, {
          label: result.label,
          color: result.color,
          radius: result.radius,
          creature: result.creature,
          visible: result.visible,
        });
      },
      () => {
        this.store?.removeToken(token.id);
        if (this.renderer?.selectedTokenId === token.id) {
          this.renderer.selectedTokenId = null;
          this.statblockPanel?.hide();
        }
      }
    ).open();
  }

  // ---- Markers ----

  private createMarker(img: Point): void {
    const marker: Marker = {
      id: randomId("mrk"),
      x: img.x,
      y: img.y,
      label: "",
      color: this.plugin.settings.defaultMarkerColor,
    };
    new MarkerEditModal(this.app, marker, (result) => {
      if (!result) return;
      marker.label = result.label;
      marker.color = result.color;
      marker.note = result.note;
      marker.linkedNote = result.linkedNote;
      this.store?.addMarker(marker);
    }).open();
  }

  private editMarker(marker: Marker): void {
    new MarkerEditModal(
      this.app,
      marker,
      (result) => {
        if (!result) return;
        this.store?.updateMarker(marker.id, {
          label: result.label,
          color: result.color,
          note: result.note,
          linkedNote: result.linkedNote,
        });
      },
      () => {
        this.store?.removeMarker(marker.id);
        if (this.renderer?.selectedMarkerId === marker.id) {
          this.renderer.selectedMarkerId = null;
        }
      }
    ).open();
  }
}

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}
