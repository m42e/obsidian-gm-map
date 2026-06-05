import { App, Component } from "obsidian";

/**
 * Minimal shape of the Fantasy Statblocks public API we rely on.
 * See https://plugins.javalent.com/statblocks/api
 */
interface StatblockAPI {
  render(creature: unknown, el: HTMLDivElement, display?: string): Component;
  hasCreature(name: string): boolean;
  getCreatureFromBestiary(name: string): unknown | null;
  bestiary: Map<string, unknown>;
}

interface StatblockPlugin {
  api?: StatblockAPI;
}

const PLUGIN_ID = "obsidian-5e-statblocks";

/** Thin wrapper around the Fantasy Statblocks API with graceful fallback. */
export class StatblockIntegration {
  constructor(private app: App) {}

  private get api(): StatblockAPI | null {
    const plugins = (this.app as unknown as {
      plugins: { plugins: Record<string, StatblockPlugin | undefined> };
    }).plugins;
    const plugin = plugins?.plugins?.[PLUGIN_ID];
    return plugin?.api ?? null;
  }

  get available(): boolean {
    return this.api !== null;
  }

  /** Sorted list of creature names available in the bestiary. */
  listCreatures(): string[] {
    const api = this.api;
    if (!api?.bestiary) return [];
    return Array.from(api.bestiary.keys()).sort((a, b) =>
      a.localeCompare(b)
    );
  }

  hasCreature(name: string): boolean {
    return this.api?.hasCreature(name) ?? false;
  }

  /**
   * Render a creature's statblock into the given element.
   * Returns a Component to register for cleanup, or null on failure.
   */
  render(name: string, el: HTMLDivElement): Component | null {
    const api = this.api;
    if (!api) return null;
    const creature = api.getCreatureFromBestiary(name);
    if (!creature) return null;
    try {
      return api.render(creature, el);
    } catch (e) {
      console.error(`GM Map: failed to render statblock for "${name}"`, e);
      return null;
    }
  }
}
