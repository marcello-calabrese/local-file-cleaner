import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";

// Mirrors cleaner-core types (serde camelCase).

export interface ScanOptions {
  roots: string[];
  excludes: string[];
  skipSystem: boolean;
  findDuplicates: boolean;
  duplicatesPhotosOnly: boolean;
  findSimilar: boolean;
  similarityDistance: number;
  findCaches: boolean;
  minCacheSize: number;
  findUnused: boolean;
  unusedMonths: number;
  minUnusedSize: number;
  findEmptyDirs: boolean;
}

export type Phase = "starting" | "walking" | "quickHash" | "fullHash" | "imageHash" | "done";

export interface ProgressSnapshot {
  phase: Phase;
  filesSeen: number;
  dirsSeen: number;
  bytesSeen: number;
  bytesHashed: number;
  itemsDone: number;
  itemsTotal: number;
  errors: number;
}

export interface FileItem {
  path: string;
  size: number;
  /** Unix seconds */
  modified: number;
  /** Unix seconds */
  accessed: number;
}

export interface DuplicateGroup {
  hash: string;
  size: number;
  files: FileItem[];
}

export interface SimilarImage {
  file: FileItem;
  width: number;
  height: number;
  distance: number;
}

export interface SimilarGroup {
  images: SimilarImage[];
}

export interface CacheDir {
  path: string;
  kind: string;
  size: number;
  files: number;
}

export interface EmptyDir {
  path: string;
  nested: number;
}

export interface ScanStats {
  files: number;
  dirs: number;
  bytes: number;
  cloudOnlySkipped: number;
  errors: number;
  durationMs: number;
}

export interface ScanResponse {
  duplicates: DuplicateGroup[];
  similar: SimilarGroup[];
  caches: CacheDir[];
  unused: FileItem[];
  emptyDirs: EmptyDir[];
  stats: ScanStats;
  unusedTotal: number;
}

export interface DeleteOutcome {
  path: string;
  ok: boolean;
  error: string | null;
}

export interface SystemInfo {
  home: string | null;
  drives: string[];
  lastAccessTracking: boolean | null;
}

export function startScan(options: ScanOptions, onProgress: (p: ProgressSnapshot) => void) {
  const channel = new Channel<ProgressSnapshot>();
  channel.onmessage = onProgress;
  return invoke<ScanResponse>("start_scan", { options, onProgress: channel });
}

export const cancelScan = () => invoke<void>("cancel_scan");

export const moveToRecycleBin = (paths: string[]) =>
  invoke<DeleteOutcome[]>("move_to_recycle_bin", { paths });

export const systemInfo = () => invoke<SystemInfo>("system_info");

export const thumbUrl = (path: string) => convertFileSrc(path, "thumb");
