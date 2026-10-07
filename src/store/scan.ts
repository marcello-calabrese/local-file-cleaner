import { create } from "zustand";
import {
  cancelScan,
  moveToRecycleBin,
  startScan,
  type DeleteOutcome,
  type ProgressSnapshot,
  type ScanOptions,
  type ScanResponse,
} from "../lib/ipc";

export type ResultView = "duplicates" | "similar" | "caches" | "unused" | "empty";
export type View = "dashboard" | ResultView;

/** path -> size in bytes */
export type Selection = Map<string, number>;

const OPTIONS_KEY = "lfc.options.v1";

const defaultOptions: ScanOptions = {
  roots: [],
  excludes: [],
  skipSystem: true,
  findDuplicates: true,
  duplicatesPhotosOnly: true,
  findSimilar: true,
  similarityDistance: 6,
  findCaches: true,
  minCacheSize: 10 * 1024 * 1024,
  findUnused: true,
  unusedMonths: 3,
  minUnusedSize: 1024 * 1024,
  findEmptyDirs: true,
};

function loadOptions(): ScanOptions {
  try {
    const saved = localStorage.getItem(OPTIONS_KEY);
    if (saved) return { ...defaultOptions, ...JSON.parse(saved) };
  } catch {
    /* ignore corrupt settings */
  }
  return defaultOptions;
}

const emptySelections = (): Record<ResultView, Selection> => ({
  duplicates: new Map(),
  similar: new Map(),
  caches: new Map(),
  unused: new Map(),
  empty: new Map(),
});

interface ScanState {
  view: View;
  options: ScanOptions;
  status: "idle" | "scanning" | "done" | "cancelled" | "error";
  error?: string;
  progress?: ProgressSnapshot;
  startedAt?: number;
  result?: ScanResponse;
  selected: Record<ResultView, Selection>;

  setView: (view: View) => void;
  setOptions: (patch: Partial<ScanOptions>) => void;
  scan: () => Promise<void>;
  cancel: () => void;

  /** Select or deselect a batch of [path, size] pairs. */
  select: (view: ResultView, items: [string, number][], selected: boolean) => void;
  /** Replace the whole selection of a view. */
  setSelection: (view: ResultView, items: [string, number][]) => void;
  clearSelection: (view: ResultView) => void;

  /** Recycle the current selection of `view`; returns per-path outcomes. */
  recycle: (view: ResultView) => Promise<DeleteOutcome[]>;
}

export const useScan = create<ScanState>((set, get) => ({
  view: "dashboard",
  options: loadOptions(),
  status: "idle",
  selected: emptySelections(),

  setView: (view) => set({ view }),

  setOptions: (patch) => {
    const options = { ...get().options, ...patch };
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
    set({ options });
  },

  scan: async () => {
    if (get().status === "scanning") return;
    set({
      status: "scanning",
      error: undefined,
      progress: undefined,
      startedAt: Date.now(),
      selected: emptySelections(),
    });
    try {
      const result = await startScan(get().options, (progress) => set({ progress }));
      set({ status: "done", result });
    } catch (e) {
      const message = String(e);
      if (message.includes("cancelled")) set({ status: "cancelled" });
      else set({ status: "error", error: message });
    }
  },

  cancel: () => {
    void cancelScan();
  },

  select: (view, items, selected) => {
    const next = new Map(get().selected[view]);
    for (const [path, size] of items) {
      if (selected) next.set(path, size);
      else next.delete(path);
    }
    set({ selected: { ...get().selected, [view]: next } });
  },

  setSelection: (view, items) => {
    set({ selected: { ...get().selected, [view]: new Map(items) } });
  },

  clearSelection: (view) => {
    set({ selected: { ...get().selected, [view]: new Map() } });
  },

  recycle: async (view) => {
    const paths = [...get().selected[view].keys()];
    if (paths.length === 0) return [];
    const outcomes = await moveToRecycleBin(paths);
    const gone = new Set(outcomes.filter((o) => o.ok).map((o) => o.path.toLowerCase()));
    const result = get().result;
    if (result && gone.size > 0) {
      set({ result: removePaths(result, gone), selected: dropFromSelections(get().selected, gone) });
    }
    return outcomes;
  },
}));

/**
 * Removes recycled paths everywhere: a file can appear in several views.
 * Exact matching is enough: cache folder contents and empty folders never
 * contain items listed in other views.
 */
function removePaths(r: ScanResponse, gone: Set<string>): ScanResponse {
  const keep = (p: string) => !gone.has(p.toLowerCase());
  const unused = r.unused.filter((f) => keep(f.path));
  return {
    ...r,
    duplicates: r.duplicates
      .map((g) => ({ ...g, files: g.files.filter((f) => keep(f.path)) }))
      .filter((g) => g.files.length > 1),
    similar: r.similar
      .map((g) => ({ ...g, images: g.images.filter((i) => keep(i.file.path)) }))
      .filter((g) => g.images.length > 1),
    caches: r.caches.filter((c) => keep(c.path)),
    unused,
    unusedTotal: r.unusedTotal - (r.unused.length - unused.length),
    emptyDirs: r.emptyDirs.filter((e) => keep(e.path)),
  };
}

function dropFromSelections(
  selected: Record<ResultView, Selection>,
  gone: Set<string>,
): Record<ResultView, Selection> {
  const out = emptySelections();
  for (const view of Object.keys(selected) as ResultView[]) {
    for (const [p, s] of selected[view]) if (!gone.has(p.toLowerCase())) out[view].set(p, s);
  }
  return out;
}

export function selectionBytes(sel: Selection): number {
  let total = 0;
  for (const size of sel.values()) total += size;
  return total;
}
