import type { ScanResponse } from "./ipc";
import type { ResultView } from "../store/scan";

export interface ViewSummary {
  count: number;
  /** Bytes that could be freed. */
  bytes: number;
}

export function summarize(r: ScanResponse | undefined): Record<ResultView, ViewSummary> {
  const none = { count: 0, bytes: 0 };
  if (!r) return { duplicates: none, similar: none, caches: none, unused: none, empty: none };
  return {
    duplicates: {
      count: r.duplicates.length,
      bytes: r.duplicates.reduce((s, g) => s + g.size * (g.files.length - 1), 0),
    },
    similar: {
      count: r.similar.length,
      // Everything but the largest image of each group.
      bytes: r.similar.reduce((s, g) => {
        const sizes = g.images.map((i) => i.file.size);
        return s + sizes.reduce((a, b) => a + b, 0) - Math.max(...sizes);
      }, 0),
    },
    caches: { count: r.caches.length, bytes: r.caches.reduce((s, c) => s + c.size, 0) },
    unused: { count: r.unusedTotal, bytes: r.unused.reduce((s, f) => s + f.size, 0) },
    empty: { count: r.emptyDirs.length, bytes: 0 },
  };
}
