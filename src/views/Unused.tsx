import { ArrowDown, ArrowUp, Clock } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Checkbox, EmptyState } from "../components/ui";
import { cn } from "../lib/cn";
import { fileName, formatAgo, formatBytes, formatCount, parentDir } from "../lib/format";
import type { FileItem } from "../lib/ipc";
import { useRangeSelect } from "../lib/useRangeSelect";
import { useScan } from "../store/scan";
import { RevealButton, ViewLayout, VirtualList } from "./common";

type SortKey = "size" | "lastUsed" | "name";

const lastUsed = (f: FileItem) => Math.max(f.modified, f.accessed);

export function Unused() {
  const result = useScan((s) => s.result);
  const months = useScan((s) => s.options.unusedMonths);
  const selection = useScan((s) => s.selected.unused);
  const setSelection = useScan((s) => s.setSelection);
  const clear = useScan((s) => s.clearSelection);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "size", desc: true });

  const files = useMemo(() => {
    const list = [...(result?.unused ?? [])];
    const cmp: Record<SortKey, (a: FileItem, b: FileItem) => number> = {
      size: (a, b) => a.size - b.size,
      lastUsed: (a, b) => lastUsed(a) - lastUsed(b),
      name: (a, b) => fileName(a.path).localeCompare(fileName(b.path)),
    };
    list.sort((a, b) => (sort.desc ? -1 : 1) * cmp[sort.key](a, b));
    return list;
  }, [result?.unused, sort]);
  const items = useMemo(() => files.map((f) => [f.path, f.size] as [string, number]), [files]);
  const onToggle = useRangeSelect("unused", items);
  const total = result?.unusedTotal ?? 0;

  const header = (key: SortKey, label: string, className?: string) => (
    <button
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }))}
      className={cn("flex items-center gap-1 hover:text-fg", sort.key === key && "text-fg", className)}
    >
      {label}
      {sort.key === key && (sort.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
    </button>
  );

  return (
    <ViewLayout
      view="unused"
      title="Unused files"
      subtitle={
        total
          ? `${formatCount(total)} files not opened or changed for ${months}+ months` +
            (total > files.length ? ` · showing the ${formatCount(files.length)} largest` : "")
          : "Files you haven't touched in a while"
      }
      toolbar={
        files.length > 0 && (
          <>
            <Button variant="ghost" onClick={() => setSelection("unused", items)}>Select all</Button>
            <Button variant="ghost" onClick={() => clear("unused")}>Select none</Button>
          </>
        )
      }
    >
      {files.length === 0 ? (
        <EmptyState
          icon={<Clock size={28} />}
          title="Nothing unused"
          hint="Every file was opened or changed recently. Try a longer period or a lower size limit."
        />
      ) : (
        <VirtualList
          count={files.length}
          rowHeight={48}
          header={
            <div className="sticky top-0 z-10 mb-1 flex items-center gap-4 rounded-lg bg-surface-2 px-4 py-2 text-xs font-medium text-muted backdrop-blur">
              <span className="w-[18px]" />
              {header("name", "Name", "flex-1")}
              {header("lastUsed", "Last used", "w-32")}
              {header("size", "Size", "w-20 justify-end")}
              <span className="w-[27px]" />
            </div>
          }
          render={(i) => {
            const f = files[i];
            const checked = selection.has(f.path);
            return (
              <div
                onClick={(e) => onToggle(i, !checked, e)}
                className={cn(
                  "group flex h-12 cursor-pointer items-center gap-4 rounded-lg px-4 transition-colors",
                  checked ? "bg-danger/8" : "hover:bg-surface-2",
                )}
              >
                <Checkbox checked={checked} danger onChange={(v, e) => onToggle(i, v, e)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{fileName(f.path)}</div>
                  <div className="truncate text-xs text-muted" title={f.path}>
                    {parentDir(f.path)}
                  </div>
                </div>
                <div className="w-32 text-xs text-muted">{formatAgo(lastUsed(f))}</div>
                <div className="w-20 text-right text-sm tabular-nums">{formatBytes(f.size)}</div>
                <RevealButton path={f.path} />
              </div>
            );
          }}
        />
      )}
    </ViewLayout>
  );
}
