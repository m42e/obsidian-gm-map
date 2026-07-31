import { MarkdownPostProcessorContext, parseYaml, setIcon } from "obsidian";
import type GmMapPlugin from "../../main";
import { MapConfig } from "../types";
import { RawMapBlock, normalizeMarkers, normalizeSpells, normalizeTokens } from "./mapBlock";

/**
 * Renders a ```gm-map code block as a launcher card with buttons to open the
 * DM and player views. The block declares static configuration and may also
 * declare tokens and markers. Fog of war is stored in a sidecar file.
 *
 * Example:
 * ```gm-map
 * id: dungeon-level-1
 * image: Maps/dungeon.png
 * grid: 70
 * gridOffsetX: 12
 * gridOverlay: true
 * tokens:
 *   - { x: 400, y: 320, label: Goblin, color: "#c0392b", creature: Goblin }
 *   - { x: 600, y: 200, label: Hero, image: assets/hero.png, playerControlled: true }
 * markers:
 *   - { x: 800, y: 600, label: Trap, color: "#f1c40f", note: Pit trap }
 * ```
 */
export class GmMapCodeBlock {
  constructor(private plugin: GmMapPlugin) {}

  process = (
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): void => {
    let raw: RawMapBlock;
    try {
      raw = (parseYaml(source) as RawMapBlock) ?? {};
    } catch (e) {
      this.renderError(el, `Invalid YAML: ${(e as Error).message}`);
      return;
    }

    if (!raw.image) {
      this.renderError(el, 'Missing required "image" field.');
      return;
    }

    const grid =
      raw.grid && raw.grid > 0 ? raw.grid : this.plugin.settings.defaultGrid;
    const defaults = {
      grid,
      tokenColor: this.plugin.settings.defaultTokenColor,
      markerColor: this.plugin.settings.defaultMarkerColor,
      spellColor: this.plugin.settings.defaultSpellColor,
    };

    const config: MapConfig = {
      id: raw.id?.trim() || raw.image,
      image: raw.image,
      width: raw.width,
      height: raw.height,
      grid,
      fogOpacity:
        typeof raw.fogOpacity === "number"
          ? raw.fogOpacity
          : this.plugin.settings.defaultFogOpacity,
      gridOffsetX:
        typeof raw.gridOffsetX === "number" ? raw.gridOffsetX : undefined,
      gridOffsetY:
        typeof raw.gridOffsetY === "number" ? raw.gridOffsetY : undefined,
      gridOverlay: raw.gridOverlay === true ? true : undefined,
      tokens: normalizeTokens(raw.tokens, defaults),
      markers: normalizeMarkers(raw.markers, defaults),
      spells: normalizeSpells(raw.spells, defaults),
      notePath: ctx.sourcePath,
    };

    this.renderCard(el, config);
  };

  private renderCard(el: HTMLElement, config: MapConfig): void {
    el.empty();
    const card = el.createDiv({ cls: "gm-map-card" });

    const header = card.createDiv({ cls: "gm-map-card-header" });
    const iconEl = header.createDiv({ cls: "gm-map-card-icon" });
    setIcon(iconEl, "map");
    const titleWrap = header.createDiv({ cls: "gm-map-card-titles" });
    titleWrap.createDiv({ cls: "gm-map-card-title", text: config.id });
    titleWrap.createDiv({ cls: "gm-map-card-sub", text: config.image });

    const counts: string[] = [];
    const tokenCount = config.tokens?.length ?? 0;
    const markerCount = config.markers?.length ?? 0;
    const spellCount = config.spells?.length ?? 0;
    if (tokenCount)
      counts.push(`${tokenCount} token${tokenCount === 1 ? "" : "s"}`);
    if (markerCount)
      counts.push(`${markerCount} marker${markerCount === 1 ? "" : "s"}`);
    if (spellCount)
      counts.push(`${spellCount} spell${spellCount === 1 ? "" : "s"}`);
    if (counts.length) {
      header.createDiv({ cls: "gm-map-card-count", text: counts.join(" \u00b7 ") });
    }

    const actions = card.createDiv({ cls: "gm-map-card-actions" });

    const dmBtn = actions.createEl("button", { cls: "mod-cta" });
    setIcon(dmBtn.createSpan({ cls: "gm-map-btn-icon" }), "shield");
    dmBtn.createSpan({ text: "Open DM view" });
    dmBtn.onclick = () => void this.plugin.openDmView(config);

    const playerBtn = actions.createEl("button");
    setIcon(playerBtn.createSpan({ cls: "gm-map-btn-icon" }), "monitor");
    playerBtn.createSpan({ text: "Open player window" });
    playerBtn.onclick = () => void this.plugin.openPlayerView(config);
  }

  private renderError(el: HTMLElement, message: string): void {
    el.empty();
    const box = el.createDiv({ cls: "gm-map-card gm-map-card-error" });
    box.createDiv({ cls: "gm-map-card-title", text: "GM Map" });
    box.createDiv({ text: message });
  }
}
