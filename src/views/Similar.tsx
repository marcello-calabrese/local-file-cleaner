import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, Images } from "lucide-react";
import { useMemo, useRef } from "react";
import { Thumb } from "../components/Thumb";
import { Badge, Button, Checkbox, EmptyState } from "../components/ui";
import { cn } from "../lib/cn";
import { fileName, formatBytes, formatCount, formatDate } from "../lib/format";
import type { SimilarGroup, SimilarImage } from "../lib/ipc";
import { summarize } from "../lib/summary";
import { useRangeSelect } from "../lib/useRangeSelect";
import { useScan } from "../store/scan";
import { RevealButton, ViewLayout } from "./common";

export function Similar() {
  const result = useScan((s) => s.result);
  const groups = result?.similar ?? [];
  const selection = useScan((s) => s.selected.similar);
  const select = useScan((s) => s.select);
  const setSelection = useScan((s) => s.setSelection);
  const scrollRef = useRef<HTMLDivElement>(null);

  const flat = useMemo(
    () =>
      groups.flatMap((g) => g.images.map((i) => [i.file.path, i.file.size] as [string, number])),
    [groups],
  );
  const offsets = useMemo(() => {
    let n = 0;
    return groups.map((g) => {
      const o = n;
      n += g.images.length;
      return o;
    });
  }, [groups]);
  const onToggle = useRangeSelect("similar", flat);

  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => 60 + Math.ceil(groups[i].images.length / 4) * 230,
    overscan: 3,
    gap: 12,
  });

  const keep = (score: (i: SimilarImage) => number) => {
    const items: [string, number][] = [];
    for (const g of groups) {
      const best = g.images.reduce((a, b) => (score(b) > score(a) ? b : a));
      for (const i of g.images) if (i !== best) items.push([i.file.path, i.file.size]);
    }
    setSelection("similar", items);
  };

  return (
    <ViewLayout
      view="similar"
      title="Similar photos"
      subtitle={
        groups.length
          ? `${formatCount(groups.length)} groups of look-alike pictures · up to ${formatBytes(summarize(result).similar.bytes)} reclaimable`
          : "Visually similar images"
      }
      toolbar={
        groups.length > 0 && (
          <>
            <Button variant="ghost" onClick={() => keep((i) => i.width * i.height)}>
              Keep highest resolution
            </Button>
            <Button variant="ghost" onClick={() => keep((i) => i.file.size)}>
              Keep largest file
            </Button>
            <Button variant="ghost" onClick={() => keep((i) => i.file.modified)}>
              Keep newest
            </Button>
          </>
        )
      }
    >
      {groups.length === 0 ? (
        <EmptyState
          icon={<Images size={28} />}
          title="No similar photos found"
          hint="Try a lower similarity setting on the Dashboard to catch more edited copies."
        />
      ) : (
        <div ref={scrollRef} className="h-full overflow-y-auto px-6 pb-6">
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => {
              const group = groups[row.index];
              return (
                <div
                  key={row.key}
                  data-index={row.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <GroupCard
                    group={group}
                    offset={offsets[row.index]}
                    selection={selection}
                    onToggle={onToggle}
                    onToggleAll={(on) =>
                      select("similar", group.images.map((i) => [i.file.path, i.file.size]), on)
                    }
                  />
                </div>
              );
            })}
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
  group: SimilarGroup;
  offset: number;
  selection: Map<string, number>;
  onToggle: (index: number, checked: boolean, e: { shiftKey: boolean }) => void;
  onToggleAll: (on: boolean) => void;
}) {
  const picked = group.images.filter((i) => selection.has(i.file.path)).length;
  const all = picked === group.images.length;

  return (
    <div
      className={cn(
        "rounded-2xl border bg-surface p-4 transition-colors",
        all ? "border-warn/60" : "border-line",
      )}
    >
      <div className="mb-3 flex items-center gap-3">
        <Checkbox
          checked={all}
          indeterminate={picked > 0 && !all}
          onChange={() => onToggleAll(picked === 0)}
        />
        <div className="flex-1 text-sm font-semibold">{group.images.length} similar photos</div>
        {all && (
          <Badge className="bg-warn/15 text-warn">
            <AlertTriangle size={11} className="mr-1" /> All selected
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {group.images.map((img, i) => {
          const checked = selection.has(img.file.path);
          return (
            <div
              key={img.file.path}
              onClick={(e) => onToggle(offset + i, !checked, e)}
              className={cn(
                "group relative cursor-pointer overflow-hidden rounded-xl border-2 transition-all",
                checked ? "border-danger" : "border-transparent hover:border-line",
              )}
            >
              <Thumb
                path={img.file.path}
                className={cn("aspect-[4/3] w-full transition-all", checked && "opacity-50 saturate-50")}
              />
              <div className="absolute top-2 left-2">
                <Checkbox checked={checked} danger onChange={(v, e) => onToggle(offset + i, v, e)} />
              </div>
              <div className="absolute top-1.5 right-1.5 flex gap-1">
                <Badge className="bg-black/55 text-white backdrop-blur">
                  {img.distance === 0 ? "Identical look" : `${100 - Math.round((img.distance / 64) * 100)}%`}
                </Badge>
              </div>
              <div className="flex items-center gap-1 bg-surface-2/60 px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium" title={img.file.path}>
                    {fileName(img.file.path)}
                  </div>
                  <div className="text-[11px] text-muted tabular-nums">
                    {img.width}×{img.height} · {formatBytes(img.file.size)} · {formatDate(img.file.modified)}
                  </div>
                </div>
                <RevealButton path={img.file.path} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
