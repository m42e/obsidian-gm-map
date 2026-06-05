import { setIcon } from "obsidian";
import { MapStateStore } from "../state/MapStateStore";

/**
 * Floating panel (DM only) to visually align the grid to the map by adjusting
 * cell size and X/Y offset. Changes are applied live and sync to the player
 * view. While open, the grid overlay is forced on so the effect is visible.
 */
export class GridAlignPanel {
  readonly el: HTMLDivElement;
  private sizeInput!: HTMLInputElement;
  private offsetXInput!: HTMLInputElement;
  private offsetYInput!: HTMLInputElement;
  private unsubscribe: () => void;
  private restoreOverlay = false;

  constructor(
    parent: HTMLElement,
    private store: MapStateStore,
    private onClose: () => void
  ) {
    this.el = parent.createDiv({ cls: "gm-map-grid-panel" });

    const header = this.el.createDiv({ cls: "gm-map-grid-header" });
    header.createSpan({ cls: "gm-map-grid-title", text: "Align grid" });
    const closeBtn = header.createEl("button", {
      cls: "gm-map-grid-close",
      attr: { "aria-label": "Close grid alignment" },
    });
    setIcon(closeBtn, "x");
    closeBtn.onclick = () => this.onClose();

    const body = this.el.createDiv({ cls: "gm-map-grid-body" });
    this.sizeInput = this.buildRow(body, "Cell size", 1, (v) =>
      this.store.setGrid({ cellSize: v })
    );
    this.offsetXInput = this.buildRow(body, "Offset X", 1, (v) =>
      this.store.setGrid({ offsetX: v })
    );
    this.offsetYInput = this.buildRow(body, "Offset Y", 1, (v) =>
      this.store.setGrid({ offsetY: v })
    );

    this.el.createDiv({
      cls: "gm-map-grid-hint",
      text: "Tip: drag the map under the grid until cells line up. Changing size or offset resets grid-revealed fog.",
    });

    this.syncInputs();
    this.unsubscribe = this.store.subscribe((event) => {
      if (event === "grid") this.syncInputs();
    });
  }

  /** Force the grid overlay visible while aligning; remember prior state. */
  show(): void {
    this.restoreOverlay = !this.store.state.gridOverlay;
    if (this.restoreOverlay) this.store.setGridOverlay(true);
    this.el.style.display = "flex";
    this.syncInputs();
  }

  hide(): void {
    this.el.style.display = "none";
  }

  private buildRow(
    parent: HTMLElement,
    label: string,
    step: number,
    apply: (value: number) => void
  ): HTMLInputElement {
    const row = parent.createDiv({ cls: "gm-map-grid-row" });
    row.createSpan({ cls: "gm-map-grid-label", text: label });

    const dec = row.createEl("button", { cls: "gm-map-grid-step", text: "−" });
    const input = row.createEl("input", {
      cls: "gm-map-grid-input",
      attr: { type: "number", step: String(step) },
    });
    const inc = row.createEl("button", { cls: "gm-map-grid-step", text: "+" });

    const commit = (value: number) => {
      if (Number.isNaN(value)) return;
      apply(Math.round(value));
    };
    input.onchange = () => commit(Number(input.value));
    input.oninput = () => commit(Number(input.value));
    dec.onclick = () => commit(Number(input.value) - step);
    inc.onclick = () => commit(Number(input.value) + step);

    return input;
  }

  private syncInputs(): void {
    const fog = this.store.state.fog;
    if (document.activeElement !== this.sizeInput) {
      this.sizeInput.value = String(Math.round(fog.cellSize));
    }
    if (document.activeElement !== this.offsetXInput) {
      this.offsetXInput.value = String(Math.round(fog.offsetX));
    }
    if (document.activeElement !== this.offsetYInput) {
      this.offsetYInput.value = String(Math.round(fog.offsetY));
    }
  }

  destroy(): void {
    this.unsubscribe();
    this.el.remove();
  }
}
