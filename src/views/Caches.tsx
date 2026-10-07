import { Package } from "lucide-react";
import { useMemo } from "react";
import { Badge, Button, Checkbox, EmptyState } from "../components/ui";
import { cn } from "../lib/cn";
import { fileName, formatBytes, formatCount, parentDir } from "../lib/format";
import { useRangeSelect } from "../lib/useRangeSelect";
import { useScan } from "../store/scan";
import { RevealButton, ViewLayout, VirtualList } from "./common";

export function Caches() {
  const caches = useScan((s) => s.result?.caches ?? []);
  const selection = useScan((s) => s.selected.caches);
  const setSelection = useScan((s) => s.setSelection);
  const clear = useScan((s) => s.clearSelection);
  const items = useMemo(() => caches.map((c) => [c.path, c.size] as [string, number]), [caches]);
  const onToggle = useRangeSelect("caches", items);
  const largest = caches[0]?.size ?? 1;
  const total = caches.reduce((s, c) => s + c.size, 0);

  return (
    <ViewLayout
      view="caches"
      title="Cache folders"
      subtitle={
        caches.length
          ? `${formatCount(caches.length)} folders · ${formatBytes(total)} of data that apps and tools can rebuild`
          : "Regenerable caches and build output"
      }
      toolbar={
        caches.length > 0 && (
          <>
            <Button variant="ghost" onClick={() => setSelection("caches", items)}>Select all</Button>
            <Button variant="ghost" onClick={() => clear("caches")}>Select none</Button>
          </>
        )
      }
    >
      {caches.length === 0 ? (
        <EmptyState
          icon={<Package size={28} />}
          title="No large cache folders"
          hint="Try lowering the size limit on the Dashboard."
        />
      ) : (
        <VirtualList
          count={caches.length}
          rowHeight={64}
          render={(i) => {
            const c = caches[i];
            const checked = selection.has(c.path);
            return (
              <div
                onClick={(e) => onToggle(i, !checked, e)}
                className={cn(
                  "group mb-1.5 flex h-[58px] cursor-pointer items-center gap-4 rounded-xl border px-4 transition-colors",
                  checked ? "border-danger/40 bg-danger/8" : "border-line bg-surface hover:bg-surface-2",
                )}
              >
                <Checkbox checked={checked} danger onChange={(v, e) => onToggle(i, v, e)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{fileName(c.path)}</span>
                    <Badge>{c.kind}</Badge>
                  </div>
                  <div className="truncate text-xs text-muted" title={c.path}>
                    {parentDir(c.path)} · {formatCount(c.files)} files
                  </div>
                </div>
                <div className="flex w-48 items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
                      style={{ width: `${Math.max(3, (c.size / largest) * 100)}%` }}
                    />
                  </div>
                  <span className="w-16 text-right text-sm font-semibold tabular-nums">
                    {formatBytes(c.size)}
                  </span>
                </div>
                <RevealButton path={c.path} />
              </div>
            );
          }}
        />
      )}
    </ViewLayout>
  );
}
