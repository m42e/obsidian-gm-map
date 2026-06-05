import type { Plugin } from "obsidian";
import { MapState, STATE_VERSION } from "../types";

/**
 * Persists per-map dynamic state (fog/tokens/markers) inside the plugin's
 * data directory, separate from the note that declares the map. This avoids
 * rewriting the user's note on every fog brush stroke.
 *
 * Layout: <pluginDir>/maps/<sanitized-id>.json
 */
export class StatePersistence {
  constructor(private plugin: Plugin) {}

  private get dir(): string {
    const base = this.plugin.manifest.dir;
    if (!base) {
      // Fallback that should not normally happen for installed plugins.
      return `.obsidian/plugins/${this.plugin.manifest.id}/maps`;
    }
    return `${base}/maps`;
  }

  private fileFor(id: string): string {
    const safe = id.replace(/[^a-z0-9_-]/gi, "_");
    return `${this.dir}/${safe}.json`;
  }

  private async ensureDir(): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    if (!(await adapter.exists(this.dir))) {
      await adapter.mkdir(this.dir);
    }
  }

  async load(id: string): Promise<MapState | null> {
    const adapter = this.plugin.app.vault.adapter;
    const path = this.fileFor(id);
    try {
      if (!(await adapter.exists(path))) return null;
      const raw = await adapter.read(path);
      const parsed = JSON.parse(raw) as MapState;
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (e) {
      console.error(`GM Map: failed to load state for "${id}"`, e);
      return null;
    }
  }

  async save(state: MapState): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    try {
      await this.ensureDir();
      state.version = STATE_VERSION;
      await adapter.write(this.fileFor(state.id), JSON.stringify(state));
    } catch (e) {
      console.error(`GM Map: failed to save state for "${state.id}"`, e);
    }
  }
}
