import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

const win = getCurrentWindow();

export function TitleBar() {
  return (
    <div data-tauri-drag-region className="flex h-10 shrink-0 items-center justify-between pl-4">
      <div data-tauri-drag-region className="pointer-events-none text-xs font-medium text-muted">
        Local File Cleaner
      </div>
      <div className="flex h-full">
        <WindowButton label="Minimize" onClick={() => win.minimize()}>
          <Minus size={15} />
        </WindowButton>
        <WindowButton label="Maximize" onClick={() => win.toggleMaximize()}>
          <Square size={12} />
        </WindowButton>
        <WindowButton label="Close" onClick={() => win.close()} close>
          <X size={16} />
        </WindowButton>
      </div>
    </div>
  );
}

function WindowButton({
  label,
  onClick,
  close,
  children,
}: {
  label: string;
  onClick: () => void;
  close?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={
        "flex h-full w-12 items-center justify-center text-muted transition-colors " +
        (close ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-surface-2 hover:text-fg")
      }
    >
      {children}
    </button>
  );
}
