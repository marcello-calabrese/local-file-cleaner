import { Clock, Copy, FolderX, Images, LayoutDashboard, Package, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "../lib/cn";
import { formatBytes, formatCount } from "../lib/format";
import { summarize } from "../lib/summary";
import { useScan, type View } from "../store/scan";

export const NAV: { view: View; label: string; icon: typeof Copy }[] = [
  { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { view: "duplicates", label: "Duplicates", icon: Copy },
  { view: "similar", label: "Similar Photos", icon: Images },
  { view: "caches", label: "Cache Folders", icon: Package },
  { view: "unused", label: "Unused Files", icon: Clock },
  { view: "empty", label: "Empty Folders", icon: FolderX },
];

export function Sidebar() {
  const view = useScan((s) => s.view);
  const setView = useScan((s) => s.setView);
  const result = useScan((s) => s.result);
  const summary = summarize(result);

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-1 px-3 pb-4">
      <div className="mb-5 flex items-center gap-2.5 px-2 pt-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-2 shadow-lg shadow-accent/30">
          <Sparkles size={18} className="text-white" />
        </div>
        <div className="leading-tight">
          <div className="font-display text-[15px] font-semibold">File Cleaner</div>
          <div className="text-[11px] text-muted">Reclaim your disk</div>
        </div>
      </div>

      {NAV.map(({ view: v, label, icon: Icon }) => {
        const active = v === view;
        const s = v === "dashboard" ? undefined : summary[v];
        const disabled = v !== "dashboard" && !result;
        return (
          <button
            key={v}
            disabled={disabled}
            onClick={() => setView(v)}
            className={cn(
              "relative flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
              active ? "text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
              disabled && "pointer-events-none opacity-40",
            )}
          >
            {active && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-0 rounded-lg border border-line bg-surface-2"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              >
                <span className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-full bg-accent" />
              </motion.span>
            )}
            <Icon size={17} className="relative" />
            <span className="relative flex-1">{label}</span>
            {s && s.count > 0 && (
              <span className="relative flex flex-col items-end leading-none">
                <span className="text-xs font-semibold tabular-nums">{formatCount(s.count)}</span>
                {s.bytes > 0 && (
                  <span className="mt-0.5 text-[10px] text-muted tabular-nums">
                    {formatBytes(s.bytes)}
                  </span>
                )}
              </span>
            )}
          </button>
        );
      })}
    </aside>
  );
}
