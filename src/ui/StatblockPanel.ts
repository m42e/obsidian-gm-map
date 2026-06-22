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

    // An explicit linked note always points at vault content: a path or
    // wikilink, optionally narrowed to a #heading or a #^block (paragraph).
    if (marker.linkedNote) {
      const resolved = await this.resolveLink(marker.linkedNote);
      if (resolved) {
        await this.renderMarkdown(resolved.content, resolved.path);
      } else {
        this.bodyEl.createDiv({
          cls: "gm-map-statblock-empty",
          text: `Note "${marker.linkedNote}" not found in vault.`,
        });
      }
      return;
    }

    // A free-form note may itself be a wikilink (resolved to its target, down
    // to a heading or paragraph) or plain markdown text rendered as-is.
    if (marker.note) {
      const resolved = await this.resolveLink(marker.note, { wikilinkOnly: true });
      await this.renderMarkdown(
        resolved?.content ?? marker.note,
        resolved?.path ?? ""
      );
      return;
    }

    this.bodyEl.createDiv({
      cls: "gm-map-statblock-empty",
      text: "No linked note. Right-click the marker to add one.",
    });
  }

  /** Render markdown into the panel body, tracked for later cleanup. */
  private async renderMarkdown(content: string, sourcePath: string): Promise<void> {
    const target = this.bodyEl.createDiv({ cls: "gm-map-marker-note" });
    const component = new Component();
    this.owner.addChild(component);
    this.rendered = component;
    await MarkdownRenderer.render(this.app, content, target, sourcePath, component);
  }

  /**
   * Resolve a link to vault content. The spec may be a `[[wikilink]]` or a bare
   * vault path, each optionally narrowed with a `#heading` or a `#^block`
   * (paragraph) reference. Returns the (optionally narrowed) content and its
   * path, or null when it doesn't resolve to a file.
   *
   * With `wikilinkOnly`, bare paths are rejected so plain note text is never
   * accidentally treated as a link.
   *
   * Handles: `[[path]]`, `[[path#heading]]`, `[[path#^block]]`, `[[path|alias]]`,
   *          `[[path#heading|alias]]`, `path/Note.md`, `path/Note.md#^block`.
   */
  private async resolveLink(
    spec: string,
    opts: { wikilinkOnly?: boolean } = {}
  ): Promise<{ content: string; path: string } | null> {
    const trimmed = spec.trim();

    let inner: string;
    const wiki = trimmed.match(/^\[\[([^\]]+)\]\]$/);
    if (wiki) {
      inner = wiki[1].split("|")[0]; // drop any |alias
    } else if (opts.wikilinkOnly || trimmed.includes("\n")) {
      return null; // plain text, not a link
    } else {
      inner = trimmed;
    }

    const hashIdx = inner.indexOf("#");
    const linkPath = (hashIdx >= 0 ? inner.slice(0, hashIdx) : inner).trim();
    const fragment = hashIdx >= 0 ? inner.slice(hashIdx + 1).trim() : "";
    if (!linkPath) return null;

    const target = this.resolveFile(linkPath);
    if (!target) return null;

    const content = await this.app.vault.read(target);
    if (!fragment) return { content: content.trim(), path: target.path };

    const section = fragment.startsWith("^")
      ? extractBlock(content, fragment.slice(1))
      : extractSection(content, fragment);
    return { content: (section ?? content).trim(), path: target.path };
  }

  /** Locate a vault file by exact path or by Obsidian link resolution. */
  private resolveFile(linkPath: string): TFile | null {
    const direct = this.app.vault.getAbstractFileByPath(linkPath);
    if (direct instanceof TFile) return direct;
    const dest = this.app.metadataCache.getFirstLinkpathDest(linkPath, "");
    return dest instanceof TFile ? dest : null;
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

/**
 * Extracts a single block (paragraph, list item, table, …) identified by an
 * Obsidian block reference `^blockId`. The id marker may sit at the end of a
 * block's last line or on its own line directly after the block. Returns the
 * block text with the marker stripped, or null when the id isn't found.
 */
function extractBlock(content: string, blockId: string): string | null {
  const id = blockId.trim();
  if (!id) return null;

  const lines = content.split("\n");
  const marker = new RegExp(`(?:^|\\s)\\^${escapeRegExp(id)}\\s*$`);

  for (let i = 0; i < lines.length; i++) {
    if (!marker.test(lines[i])) continue;

    // Remove the trailing `^id` marker from the matched line.
    const stripped = lines[i].replace(/\s*\^[\w-]+\s*$/, "");

    // Marker on its own line → the block is the preceding non-blank lines.
    if (stripped.trim() === "") {
      const block: string[] = [];
      for (let j = i - 1; j >= 0 && lines[j].trim() !== ""; j--) {
        block.unshift(lines[j]);
      }
      return block.join("\n").trim() || null;
    }

    // List item → just that item.
    if (/^\s*(?:[-*+]|\d+[.)])\s/.test(stripped)) return stripped.trim();

    // Paragraph → walk back over its (possibly wrapped) lines.
    const block = [stripped];
    for (let j = i - 1; j >= 0; j--) {
      const prev = lines[j];
      if (
        prev.trim() === "" ||
        /^#{1,6}\s/.test(prev) ||
        /^\s*(?:[-*+]|\d+[.)])\s/.test(prev)
      ) {
        break;
      }
      block.unshift(prev);
    }
    return block.join("\n").trim() || null;
  }
  return null;
}

/** Escape a string for safe literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
