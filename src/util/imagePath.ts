/** Resolve a relative image path (e.g. ./assets/img.jpg) against a note's vault path. */
export function resolveRelative(notePath: string, relativePath: string): string {
  const parts = notePath.split("/");
  parts.pop(); // remove note filename, keep directory segments
  for (const seg of relativePath.split("/")) {
    if (seg === "." || seg === "") continue;
    else if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/**
 * Resolve a configured map image path to a concrete vault path. Relative paths
 * (starting with ".") are resolved against the declaring note; a leading "/" is
 * stripped; everything else is treated as already vault-relative.
 */
export function resolveImageVaultPath(path: string, notePath?: string): string {
  return path.startsWith(".") && notePath
    ? resolveRelative(notePath, path)
    : path.startsWith("/")
    ? path.slice(1)
    : path;
}
