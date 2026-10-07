import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FolderOpen } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, type ReactNode } from "react";
import { ActionBar } from "../components/ActionBar";
import type { ResultView } from "../store/scan";

export function ViewLayout({
  view,
  title,
  subtitle,
  toolbar,
  children,
}: {
  view: ResultView;
  title: string;
  subtitle: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-end justify-between gap-4 px-6 pt-2 pb-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
          <div className="mt-0.5 text-sm text-muted">{subtitle}</div>
        </div>
        {toolbar && <div className="flex flex-wrap justify-end gap-1.5">{toolbar}</div>}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
      <ActionBar view={view} />
    </div>
  );
}

/** Fixed-height virtualized list filling its parent. */
export function VirtualList({
  count,
  rowHeight,
  header,
  render,
}: {
  count: number;
  rowHeight: number;
  header?: ReactNode;
  render: (index: number) => ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });
  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-6 pb-4">
      {header}
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="absolute top-0 left-0 w-full"
            style={{ height: row.size, transform: `translateY(${row.start}px)` }}
          >
            {render(row.index)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function RevealButton({ path }: { path: string }) {
  return (
    <button
      title="Show in Explorer"
      onClick={(e) => {
        e.stopPropagation();
        void revealItemInDir(path);
      }}
      className="rounded-md p-1.5 text-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-surface-2 hover:text-fg"
    >
      <FolderOpen size={15} />
    </button>
  );
}
