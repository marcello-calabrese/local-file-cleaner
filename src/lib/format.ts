export function formatBytes(bytes: number, digits = 1): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : digits)} ${units[i]}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString();
}

export function formatDate(unixSecs: number): string {
  if (!unixSecs) return "—";
  return new Date(unixSecs * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** "4 months ago" */
export function formatAgo(unixSecs: number): string {
  if (!unixSecs) return "never";
  const days = (Date.now() / 1000 - unixSecs) / 86400;
  if (days < 1) return "today";
  if (days < 30) return `${Math.floor(days)} days ago`;
  const months = days / 30.44;
  if (months < 12) return `${Math.floor(months)} month${months < 2 ? "" : "s"} ago`;
  const years = months / 12;
  return `${years.toFixed(years < 2 ? 1 : 0)} years ago`;
}

export function fileName(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i >= 0 ? path.slice(i + 1) : path;
}

export function parentDir(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : path;
}

/** Case-insensitive "is `path` inside `dir`" for Windows paths. */
export function isWithin(path: string, dir: string): boolean {
  const p = path.replace(/\//g, "\\").toLowerCase();
  const d = dir.replace(/\//g, "\\").toLowerCase().replace(/\+$/, "");
  return p === d || p.startsWith(d + "\\");
}
