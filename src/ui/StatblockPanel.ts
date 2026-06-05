import { App, Component, MarkdownRenderer, TFile, setIcon } from "obsidian";
import { Marker, Token } from "../types";
import { StatblockIntegration } from "../integration/statblocks";

/**
 * Side panel (DM only) that shows the statblock for the selected token's bound
 * bestiary creature. Falls back to a helpful message when Fantasy Statblocks is
 * unavailable or the creature can't be found.
 */
export class StatblockPanel {
  readonly el: HTMLDivElement;
  private bodyEl: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private rendered: Component | null = null;

  constructor(
    parent: HTMLElement,
    private app: App,
    private statblocks: StatblockIntegration,
    private owner: Component,
    private onClose: () => void
  ) {
    this.el = parent.createDiv({ cls: "gm-map-statblock-panel" });
    const header = this.el.createDiv({ cls: "gm-map-statblock-header" });
    this.titleEl = header.createDiv({ cls: "gm-map-statblock-title" });
    const closeBtn = header.createEl("button", {
      cls: "gm-map-statblock-close",
      attr: { "aria-label": "Close statblock" },
    });
    setIcon(closeBtn, "x");
    closeBtn.onclick = () => this.onClose();
    this.bodyEl = this.el.createDiv({ cls: "gm-map-statblock-body" });
    this.hide();
  }

  show(token: Token): void {
    this.clearRendered();
    this.el.show();
    this.titleEl.setText(token.label || token.creature || "Token");

    this.bodyEl.empty();
    if (!token.creature) {
      this.bodyEl.createDiv({
        cls: "gm-map-statblock-empty",
        text: "No creature linked. Use the token menu to link a bestiary creature.",
      });
      return;
    }
    if (!this.statblocks.available) {
      this.bodyEl.createDiv({
        cls: "gm-map-statblock-empty",
        text: "Fantasy Statblocks plugin not found or its API is unavailable.",
      });
      return;
    }
    const target = this.bodyEl.createDiv({ cls: "gm-map-statblock-render" });
    const component = this.statblocks.render(token.creature, target);
    if (!component) {
      this.bodyEl.createDiv({
        cls: "gm-map-statblock-empty",
        text: `Creature "${token.creature}" was not found in the bestiary.`,
      });
      return;
    }
    this.owner.addChild(component);
    this.rendered = component;
  }

  hide(): void {
    this.clearRendered();
    this.el.hide();
  }

  async showMarker(marker: Marker): Promise<void> {
    this.clearRendered();
    this.el.show();
    this.titleEl.setText(marker.label || "Marker");
    this.bodyEl.empty();

    // Prefer linkedNote (file path), fall back to note (may be a wikilink string).
    const rawText = marker.linkedNote
      ? await this.readFileText(marker.linkedNote)
      : (marker.note ?? null);

    if (rawText !== null) {
      const sourcePath = marker.linkedNote ?? "";
      const resolved = await this.resolveWikilink(rawText, sourcePath);
      if (resolved) {
        const target = this.bodyEl.createDiv({ cls: "gm-map-marker-note" });
        const component = new Component();
        this.owner.addChild(component);
        this.rendered = component;
        await MarkdownRenderer.render(
          this.app,
          resolved.content,
          target,
          resolved.path,
          component
        );
      } else if (marker.linkedNote) {
        this.bodyEl.createDiv({
          cls: "gm-map-statblock-empty",
          text: `Note "${marker.linkedNote}" not found in vault.`,
        });
      } else {
        // note is plain text — render as markdown so formatting still works.
        const target = this.bodyEl.createDiv({ cls: "gm-map-marker-note" });
        const component = new Component();
        this.owner.addChild(component);
        this.rendered = component;
        await MarkdownRenderer.render(this.app, rawText, target, "", component);
      }
    } else {
      this.bodyEl.createDiv({
        cls: "gm-map-statblock-empty",
        text: "No linked note. Right-click the marker to add one.",
      });
    }
  }

  /** Read a vault file by path; returns its text or null if not found. */
  private async readFileText(filePath: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) return (await this.app.vault.read(file)).trim();
    return null;
  }

  /**
   * If `raw` is (or is the content of) a single wikilink, resolve it and
   * return the target content (optionally narrowed to a heading section).
   * Returns null if `raw` is not a wikilink or the target doesn't exist.
   *
   * Handles: `[[path]]`, `[[path#heading]]`, `[[path|alias]]`,
   *          `[[path#heading|alias]]`
   */
  private async resolveWikilink(
    raw: string,
    sourcePath: string
  ): Promise<{ content: string; path: string } | null> {
    const m = raw.trim().match(/^\[\[([^\]#|]+)(?:#([^\]|]+))?(?:\|[^\]]+)?\]\]$/);
    if (!m) return null;

    const linkPath = m[1].trim();
    const heading = m[2]?.trim();
    const target = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
    if (!(target instanceof TFile)) return null;

    const targetContent = await this.app.vault.read(target);
    if (heading) {
      const section = extractSection(targetContent, heading);
      return { content: section ?? targetContent, path: target.path };
    }
    return { content: targetContent, path: target.path };
  }

  private clearRendered(): void {
    if (this.rendered) {
      this.owner.removeChild(this.rendered);
      this.rendered = null;
    }
  }

  destroy(): void {
    this.clearRendered();
    this.el.remove();
  }
}

/**
 * Extracts the content of a named heading section from markdown text.
 * Returns content from the heading line (inclusive) up to — but not including
 * — the next heading of the same or higher level.  Returns null if the heading
 * is not found.
 */
function extractSection(content: string, heading: string): string | null {
  const lines = content.split("\n");
  const target = heading.trim().toLowerCase();

  let startIdx = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (m && m[2].trim().toLowerCase() === target) {
      startIdx = i;
      level = m[1].length;
      break;
    }
  }
  if (startIdx === -1) return null;

  const result = [lines[startIdx]];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= level) break;
    result.push(lines[i]);
  }
  return result.join("\n").trim();
}
