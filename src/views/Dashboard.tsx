import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  Clock,
  Copy,
  FolderPlus,
  FolderX,
  HardDrive,
  Home,
  Images,
  Loader2,
  Package,
  Play,
  ShieldCheck,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, Slider, Switch } from "../components/ui";
import { cn } from "../lib/cn";
import { formatBytes, formatCount } from "../lib/format";
import { systemInfo, type Phase, type SystemInfo } from "../lib/ipc";
import { summarize } from "../lib/summary";
import { useScan, type ResultView } from "../store/scan";

export function Dashboard() {
  const status = useScan((s) => s.status);
  const result = useScan((s) => s.result);
  const error = useScan((s) => s.error);
  const [info, setInfo] = useState<SystemInfo>();

  useEffect(() => {
    systemInfo().then(setInfo).catch(() => {});
  }, []);

  return (
    <div className="h-full overflow-y-auto px-8 pt-4 pb-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            <span className="gradient-text">Clean up</span> your disk
          </h1>
          <p className="mt-1 text-sm text-muted">
            Find duplicate photos, bulky caches, forgotten files and empty folders. Nothing is
            deleted until you review and confirm.
          </p>
        </header>

        <AnimatePresence mode="wait">
          {status === "scanning" ? (
            <ProgressPanel key="progress" />
          ) : (
            result && <ResultSummary key="summary" lastAccess={info?.lastAccessTracking} />
          )}
        </AnimatePresence>

        {status === "error" && (
          <Card className="border-danger/40 bg-danger/10 p-4 text-sm text-danger">{error}</Card>
        )}
        {status === "cancelled" && (
          <Card className="p-4 text-sm text-muted">Scan cancelled. Previous results were kept.</Card>
        )}

        {status !== "scanning" && <ScanSetup info={info} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- setup

function ScanSetup({ info }: { info?: SystemInfo }) {
  const options = useScan((s) => s.options);
  const setOptions = useScan((s) => s.setOptions);
  const scan = useScan((s) => s.scan);
  const nothingSelected = !(
    options.findDuplicates ||
    options.findSimilar ||
    options.findCaches ||
    options.findUnused ||
    options.findEmptyDirs
  );

  const addRoots = async () => {
    const picked = await open({ directory: true, multiple: true, title: "Choose folders to scan" });
    if (!picked) return;
    const list = Array.isArray(picked) ? picked : [picked];
    setOptions({ roots: unique([...options.roots, ...list]) });
  };
  const addRoot = (p: string) => setOptions({ roots: unique([...options.roots, p]) });
  const addExclude = async () => {
    const picked = await open({ directory: true, multiple: true, title: "Folders to skip" });
    if (!picked) return;
    const list = Array.isArray(picked) ? picked : [picked];
    setOptions({ excludes: unique([...options.excludes, ...list]) });
  };

  return (
    <>
      <Card className="p-5">
        <SectionTitle>Where to look</SectionTitle>
        <div className="mt-3 flex flex-wrap gap-2">
          {options.roots.length === 0 && (
            <div className="text-sm text-muted">No folders yet. Add one or pick a shortcut.</div>
          )}
          <AnimatePresence>
            {options.roots.map((r) => (
              <motion.div
                key={r}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 py-1.5 pr-1.5 pl-3 text-sm"
              >
                <span className="max-w-md truncate" title={r}>
                  {r}
                </span>
                <button
                  onClick={() => setOptions({ roots: options.roots.filter((x) => x !== r) })}
                  className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-fg"
                >
                  <X size={14} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={addRoots}>
            <FolderPlus size={16} /> Add folder
          </Button>
          {info?.home && (
            <Button variant="ghost" onClick={() => addRoot(info.home!)}>
              <Home size={15} /> My files
            </Button>
          )}
          {info?.drives.map((d) => (
            <Button key={d} variant="ghost" onClick={() => addRoot(d)}>
              <HardDrive size={15} /> {d.replace("\\", "")}
            </Button>
          ))}
        </div>
      </Card>

      <div>
        <SectionTitle>What to find</SectionTitle>
        <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-3">
          <FeatureCard
            icon={<Copy size={18} />}
            title="Duplicate files"
            description="Byte-identical copies, verified with BLAKE3."
            enabled={options.findDuplicates}
            onToggle={(v) => setOptions({ findDuplicates: v })}
          >
            <Row label="Photos only">
              <Switch
                checked={options.duplicatesPhotosOnly}
                onChange={(v) => setOptions({ duplicatesPhotosOnly: v })}
              />
            </Row>
          </FeatureCard>

          <FeatureCard
            icon={<Images size={18} />}
            title="Similar photos"
            description="Resized, re-saved or edited versions of the same picture."
            enabled={options.findSimilar}
            onToggle={(v) => setOptions({ findSimilar: v })}
          >
            <Row label="Similarity" value={similarityLabel(options.similarityDistance)}>
              {null}
            </Row>
            <Slider
              min={0}
              max={12}
              value={12 - options.similarityDistance}
              onChange={(v) => setOptions({ similarityDistance: 12 - v })}
            />
          </FeatureCard>

          <FeatureCard
            icon={<Package size={18} />}
            title="Cache folders"
            description="node_modules, build output, browser and app caches, temp."
            enabled={options.findCaches}
            onToggle={(v) => setOptions({ findCaches: v })}
          >
            <Row label="Larger than">
              <Segmented
                value={options.minCacheSize}
                options={SIZE_STEPS}
                onChange={(v) => setOptions({ minCacheSize: v })}
              />
            </Row>
          </FeatureCard>

          <FeatureCard
            icon={<Clock size={18} />}
            title="Unused files"
            description="Not opened or changed for a while."
            enabled={options.findUnused}
            onToggle={(v) => setOptions({ findUnused: v })}
          >
            <Row
              label="Not used for"
              value={`${options.unusedMonths} month${options.unusedMonths > 1 ? "s" : ""}`}
            >
              {null}
            </Row>
            <Slider
              min={1}
              max={36}
              value={options.unusedMonths}
              onChange={(v) => setOptions({ unusedMonths: v })}
            />
            <Row label="Larger than">
              <Segmented
                value={options.minUnusedSize}
                options={SIZE_STEPS}
                onChange={(v) => setOptions({ minUnusedSize: v })}
              />
            </Row>
          </FeatureCard>

          <FeatureCard
            icon={<FolderX size={18} />}
            title="Empty folders"
            description="Folders with nothing inside, including nested empty ones."
            enabled={options.findEmptyDirs}
            onToggle={(v) => setOptions({ findEmptyDirs: v })}
          />
        </div>
      </div>

      <Card className="p-5">
        <SectionTitle>Safety</SectionTitle>
        <Row
          label={
            <span className="flex items-center gap-2">
              <ShieldCheck size={15} className="text-ok" /> Skip Windows and program folders
            </span>
          }
        >
          <Switch checked={options.skipSystem} onChange={(v) => setOptions({ skipSystem: v })} />
        </Row>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Never scan:</span>
          {options.excludes.map((e) => (
            <span
              key={e}
              className="flex items-center gap-1.5 rounded-md bg-surface-2 py-1 pr-1 pl-2.5 text-xs"
            >
              <span className="max-w-xs truncate">{e}</span>
              <button
                className="text-muted hover:text-fg"
                onClick={() => setOptions({ excludes: options.excludes.filter((x) => x !== e) })}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <Button variant="ghost" className="py-1 text-xs" onClick={addExclude}>
            <FolderPlus size={14} /> Add exclusion
          </Button>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button
          variant="primary"
          className="px-8 py-3 text-base"
          disabled={options.roots.length === 0 || nothingSelected}
          onClick={() => void scan()}
        >
          <Play size={18} fill="currentColor" /> Start scan
        </Button>
      </div>
    </>
  );
}

const SIZE_STEPS: [number, string][] = [
  [0, "Any"],
  [1 << 20, "1 MB"],
  [10 << 20, "10 MB"],
  [100 << 20, "100 MB"],
];

function similarityLabel(distance: number): string {
  if (distance <= 1) return "Nearly identical";
  if (distance <= 4) return "Very high";
  if (distance <= 7) return "High";
  if (distance <= 10) return "Medium";
  return "Low";
}

function unique(list: string[]) {
  return [...new Set(list)];
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">{children}</h2>;
}

function Row({ label, value, children }: { label: ReactNode; value?: string; children: ReactNode }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      {value && <span className="font-medium">{value}</span>}
      {children}
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: number;
  options: [number, string][];
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex rounded-lg bg-surface-2 p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={(e) => {
            e.stopPropagation();
            onChange(v);
          }}
          className={cn(
            "rounded-md px-2 py-0.5 text-xs transition-colors",
            v === value ? "bg-accent text-white shadow" : "text-muted hover:text-fg",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  enabled,
  onToggle,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <Card
      className={cn(
        "flex flex-col p-4 transition-all duration-200",
        enabled ? "border-accent/40 shadow-lg shadow-accent/5" : "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors",
            enabled ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted",
          )}
        >
          {icon}
        </div>
        <div className="flex-1">
          <div className="font-medium">{title}</div>
          <div className="mt-0.5 text-xs text-muted">{description}</div>
        </div>
        <Switch checked={enabled} onChange={onToggle} />
      </div>
      {children && (
        <div className={cn("mt-1 flex flex-col gap-2", !enabled && "pointer-events-none")}>
          {children}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- progress

const PHASES: { phases: Phase[]; label: string }[] = [
  { phases: ["starting", "walking"], label: "Scanning folders" },
  { phases: ["quickHash", "fullHash"], label: "Comparing files" },
  { phases: ["imageHash"], label: "Analysing photos" },
];

function ProgressPanel() {
  const progress = useScan((s) => s.progress);
  const startedAt = useScan((s) => s.startedAt) ?? Date.now();
  const cancel = useScan((s) => s.cancel);
  const [cancelling, setCancelling] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  const phase = progress?.phase ?? "starting";
  const step = Math.max(0, PHASES.findIndex((p) => p.phases.includes(phase)));
  const elapsed = (Date.now() - startedAt) / 1000;
  const counted = progress && progress.itemsTotal > 0 && phase !== "walking";
  const pct = counted ? (progress.itemsDone / progress.itemsTotal) * 100 : null;
  const detail: Record<Phase, string> = {
    starting: "Starting…",
    walking: "Reading the folder tree in parallel",
    quickHash: "Quick fingerprint of same-size files",
    fullHash: "Verifying candidates byte by byte",
    imageHash: "Computing perceptual fingerprints",
    done: "Finishing up",
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <Card className="relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-accent/20 blur-3xl" />
        <div className="flex items-center gap-4">
          <Loader2 className="animate-spin text-accent" size={28} />
          <div className="flex-1">
            <div className="font-display text-xl font-semibold">{PHASES[step].label}</div>
            <div className="text-sm text-muted">{detail[phase]}</div>
          </div>
          <Button
            disabled={cancelling}
            onClick={() => {
              setCancelling(true);
              cancel();
            }}
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        </div>

        <div className="mt-5 flex gap-2">
          {PHASES.map((p, i) => (
            <div key={p.label} className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
                animate={{ width: i < step ? "100%" : i === step ? (pct !== null ? `${pct}%` : "35%") : "0%" }}
                transition={{ duration: 0.3 }}
              />
            </div>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-4 gap-4">
          <Stat label="Files" value={formatCount(progress?.filesSeen ?? 0)} />
          <Stat label="Folders" value={formatCount(progress?.dirsSeen ?? 0)} />
          <Stat
            label={counted ? "Checked" : "Data seen"}
            value={
              counted
                ? `${formatCount(progress.itemsDone)} / ${formatCount(progress.itemsTotal)}`
                : formatBytes(progress?.bytesSeen ?? 0)
            }
          />
          <Stat label="Elapsed" value={`${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, "0")}`} />
        </div>
      </Card>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 font-display text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------- summary

const SUMMARY_CARDS: { view: ResultView; label: string; icon: ReactNode; unit: string }[] = [
  { view: "duplicates", label: "Duplicates", icon: <Copy size={18} />, unit: "groups" },
  { view: "similar", label: "Similar photos", icon: <Images size={18} />, unit: "groups" },
  { view: "caches", label: "Cache folders", icon: <Package size={18} />, unit: "folders" },
  { view: "unused", label: "Unused files", icon: <Clock size={18} />, unit: "files" },
  { view: "empty", label: "Empty folders", icon: <FolderX size={18} />, unit: "folders" },
];

function ResultSummary({ lastAccess }: { lastAccess?: boolean | null }) {
  const result = useScan((s) => s.result)!;
  const options = useScan((s) => s.options);
  const setView = useScan((s) => s.setView);
  const summary = summarize(result);
  const reclaimable =
    summary.duplicates.bytes + summary.similar.bytes + summary.caches.bytes + summary.unused.bytes;
  const { stats } = result;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex flex-col gap-3"
    >
      <Card className="relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -top-24 -left-16 h-64 w-64 rounded-full bg-accent-2/15 blur-3xl" />
        <div className="text-sm text-muted">Up to</div>
        <div className="font-display text-5xl font-semibold tracking-tight">
          <span className="gradient-text">{formatBytes(reclaimable)}</span>
        </div>
        <div className="mt-1 text-sm text-muted">
          could be freed · scanned {formatCount(stats.files)} files ({formatBytes(stats.bytes)}) in{" "}
          {(stats.durationMs / 1000).toFixed(1)} s
          {stats.cloudOnlySkipped > 0 &&
            ` · ${formatCount(stats.cloudOnlySkipped)} online-only files left untouched`}
          {stats.errors > 0 && ` · ${formatCount(stats.errors)} items could not be read`}
        </div>
      </Card>

      {lastAccess === false && options.findUnused && (
        <Card className="flex items-start gap-3 border-warn/40 bg-warn/10 p-4 text-sm">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" />
          <div>
            <div className="font-medium">Windows is not recording when files are opened</div>
            <div className="text-muted">
              Last-access tracking is turned off on this PC, so "unused" is based mostly on the
              last-modified date. Files you only read may show up.
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-5 gap-3">
        {SUMMARY_CARDS.map((c, i) => {
          const s = summary[c.view];
          return (
            <motion.button
              key={c.view}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => setView(c.view)}
              className="group rounded-2xl border border-line bg-surface p-4 text-left transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-lg hover:shadow-accent/10"
            >
              <div className="text-muted transition-colors group-hover:text-accent">{c.icon}</div>
              <div className="mt-3 font-display text-2xl font-semibold tabular-nums">
                {formatCount(s.count)}
              </div>
              <div className="text-xs text-muted">
                {c.label}
                {s.bytes > 0 && ` · ${formatBytes(s.bytes)}`}
              </div>
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}

