import { FolderX } from "lucide-react";
import { useMemo } from "react";
import { Badge, Button, Checkbox, EmptyState } from "../components/ui";
import { cn } from "../lib/cn";
import { fileName, formatCount, parentDir } from "../lib/format";
import { useRangeSelect } from "../lib/useRangeSelect";
import { useScan } from "../store/scan";
import { RevealButton, ViewLayout, VirtualList } from "./common";

export function EmptyDirs() {
  const dirs = useScan((s) => s.result?.emptyDirs ?? []);
  const selection = useScan((s) => s.selected.empty);
  const setSelection = useScan((s) => s.setSelection);
  const clear = useScan((s) => s.clearSelection);
  const items = useMemo(() => dirs.map((d) => [d.path, 0] as [string, number]), [dirs]);
  const onToggle = useRangeSelect("empty", items);

  return (
    <ViewLayout
      view="empty"
      title="Empty folders"
      subtitle={
        dirs.length
          ? `${formatCount(dirs.length)} folders with nothing inside`
          : "Folders without any files"
      }
      toolbar={
        dirs.length > 0 && (
          <>
            <Button variant="ghost" onClick={() => setSelection("empty", items)}>Select all</Button>
            <Button variant="ghost" onClick={() => clear("empty")}>Select none</Button>
          </>
        )
      }
    >
      {dirs.length === 0 ? (
        <EmptyState icon={<FolderX size={28} />} title="No empty folders" />
      ) : (
        <VirtualList
          count={dirs.length}
          rowHeight={48}
          render={(i) => {
            const d = dirs[i];
            const checked = selection.has(d.path);
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
                  <div className="truncate text-sm">{fileName(d.path)}</div>
                  <div className="truncate text-xs text-muted" title={d.path}>
                    {parentDir(d.path)}
                  </div>
                </div>
                {d.nested > 1 && <Badge>+{formatCount(d.nested - 1)} empty inside</Badge>}
                <RevealButton path={d.path} />
              </div>
            );
          }}
        />
      )}
    </ViewLayout>
  );
}
