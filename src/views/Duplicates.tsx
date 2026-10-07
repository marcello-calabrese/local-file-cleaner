import { open } from "@tauri-apps/plugin-dialog";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, Copy, FileIcon } from "lucide-react";
import { useMemo, useRef } from "react";
import { toast } from "sonner";
import { Thumb } from "../components/Thumb";
import { Badge, Button, Checkbox, EmptyState } from "../components/ui";
import { cn } from "../lib/cn";
import { fileName, formatBytes, formatCount, formatDate, isWithin, parentDir } from "../lib/format";
import type { DuplicateGroup, FileItem } from "../lib/ipc";
import { useRangeSelect } from "../lib/useRangeSelect";
import { useScan } from "../store/scan";
import { RevealButton, ViewLayout } from "./common";

const DECODABLE = /\.(jpe?g|png|webp|bmp|gif|tiff?)$/i;

export function Duplicates() {
  const groups = useScan((s) => s.result?.duplicates ?? []);
  const selection = useScan((s) => s.selected.duplicates);
  const select = useScan((s) => s.select);
  const setSelection = useScan((s) => s.setSelection);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Flat [path, size] list in display order, for Shift+click ranges.
  const flat = useMemo(
    () => groups.flatMap((g) => g.files.map((f) => [f.path, f.size] as [string, number])),
    [groups],
  );
  const offsets = useMemo(() => {
    const out: number[] = [];
    let n = 0;
    for (const g of groups) {
      out.push(n);
      n += g.files.length;
    }
    return out;
  }, [groups]);
  const onToggle = useRangeSelect("duplicates", flat);

  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => 56 + groups[i].files.length * 52,
    overscan: 6,
    gap: 12,
  });

  /** Selects every file except the one `pick` keeps, in each group. */
  const keep = (pick: (files: FileItem[]) => FileItem | undefined) => {
    const items: [string, number][] = [];
    for (const g of groups) {
      const kept = pick(g.files);
      if (!kept) continue;
      for (const f of g.files) if (f !== kept) items.push([f.path, f.size]);
    }
    setSelection("duplicates", items);
  };
  const newest = (fs: FileItem[]) => fs.reduce((a, b) => (b.modified > a.modified ? b : a));
  const oldest = (fs: FileItem[]) => fs.reduce((a, b) => (b.modified < a.modified ? b : a));
  const keepInFolder = async () => {
    const dir = await open({ directory: true, title: "Keep the copies inside this folder" });
    if (typeof dir !== "string") return;
    let groupsMatched = 0;
    keep((fs) => {
      const inside = fs.find((f) => isWithin(f.path, dir));
      if (inside) groupsMatched++;
      return inside;
    });
    toast(`Selected copies outside the folder in ${formatCount(groupsMatched)} groups`, {
      description: "Groups with no copy in that folder were left untouched.",
    });
  };

  const wasted = groups.reduce((s, g) => s + g.size * (g.files.length - 1), 0);

  return (
    <ViewLayout
      view="duplicates"
      title="Duplicates"
      subtitle={
        groups.length
          ? `${formatCount(groups.length)} groups of identical files · ${formatBytes(wasted)} in extra copies`
          : "Identical files"
      }
      toolbar={
        groups.length > 0 && (
          <>
            <Button variant="ghost" onClick={() => keep(newest)}>Keep newest</Button>
            <Button variant="ghost" onClick={() => keep(oldest)}>Keep oldest</Button>
            <Button variant="ghost" onClick={keepInFolder}>Keep in folder…</Button>
          </>
        )
      }
    >
      {groups.length === 0 ? (
        <EmptyState
          icon={<Copy size={28} />}
          title="No duplicates found"
          hint="Every file in the scanned folders is unique."
        />
      ) : (
        <div ref={scrollRef} className="h-full overflow-y-auto px-6 pb-6">
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => (
              <div
                key={row.key}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <GroupCard
                  group={groups[row.index]}
                  offset={offsets[row.index]}
                  selection={selection}
                  onToggle={onToggle}
                  onToggleAll={(on) =>
                    select(
                      "duplicates",
                      groups[row.index].files.map((f) => [f.path, f.size]),
                      on,
                    )
                  }
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </ViewLayout>
  );
}

function GroupCard({
  group,
  offset,
  selection,
  onToggle,
  onToggleAll,
}: {
  group: DuplicateGroup;
  offset: number;
  selection: Map<string, number>;
  onToggle: (index: number, checked: boolean, e: { shiftKey: boolean }) => void;
  onToggleAll: (on: boolean) => void;
}) {
  const picked = group.files.filter((f) => selection.has(f.path)).length;
  const all = picked === group.files.length;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border bg-surface transition-colors",
        all ? "border-warn/60" : "border-line",
      )}
    >
      <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <Checkbox
          checked={all}
          indeterminate={picked > 0 && !all}
          onChange={() => onToggleAll(picked === 0)}
        />
        <div className="flex-1 text-sm">
          <span className="font-semibold">{group.files.length} copies</span>
          <span className="text-muted"> · {formatBytes(group.size)} each</span>
        </div>
        {all && (
          <Badge className="bg-warn/15 text-warn">
            <AlertTriangle size={11} className="mr-1" /> All copies selected
          </Badge>
        )}
        <Badge>{formatBytes(group.size * (group.files.length - 1))} reclaimable</Badge>
      </div>
      {group.files.map((f, i) => {
        const checked = selection.has(f.path);
        return (
          <div
            key={f.path}
            onClick={(e) => onToggle(offset + i, !checked, e)}
            className={cn(
              "group flex cursor-pointer items-center gap-3 px-4 py-2 transition-colors",
              checked ? "bg-danger/8" : "hover:bg-surface-2",
            )}
          >
            <Checkbox checked={checked} danger onChange={(v, e) => onToggle(offset + i, v, e)} />
            {DECODABLE.test(f.path) ? (
              <Thumb path={f.path} className="h-9 w-9 shrink-0 rounded-md" />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted">
                <FileIcon size={16} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className={cn("truncate text-sm", checked && "text-danger line-through decoration-danger/50")}>
                {fileName(f.path)}
              </div>
              <div className="truncate text-xs text-muted" title={f.path}>
                {parentDir(f.path)}
              </div>
            </div>
            <div className="text-xs text-muted tabular-nums">{formatDate(f.modified)}</div>
            <RevealButton path={f.path} />
          </div>
        );
      })}
    </div>
  );
}
