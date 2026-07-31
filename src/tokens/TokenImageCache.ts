/**
 * Lazily loads and caches token body images for canvas rendering. Token images
 * are referenced by an opaque key (a vault path); the supplied `resolve`
 * function turns that key into a loadable URL. Loads are asynchronous: `get`
 * returns null until the image is ready, then `onLoad` fires so the renderer
 * can redraw.
 */
export class TokenImageCache {
  private cache = new Map<string, HTMLImageElement | null>();
  private loading = new Set<string>();

  constructor(
    private resolve: (key: string) => string | null,
    private onLoad: () => void
  ) {}

  /** Return the loaded image for `key`, or null while it loads or if it failed. */
  get(key: string): HTMLImageElement | null {
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    if (this.loading.has(key)) return null;

    const url = this.resolve(key);
    if (!url) {
      this.cache.set(key, null);
      return null;
    }
    this.loading.add(key);
    const img = new Image();
    img.onload = () => {
      this.loading.delete(key);
      this.cache.set(key, img);
      this.onLoad();
    };
    img.onerror = () => {
      this.loading.delete(key);
      this.cache.set(key, null);
      this.onLoad();
    };
    img.src = url;
    return null;
  }

  /** Drop all cached images (e.g. when switching maps). */
  clear(): void {
    this.cache.clear();
    this.loading.clear();
  }
}
