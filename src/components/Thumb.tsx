import { ImageOff } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn";
import { thumbUrl } from "../lib/ipc";

export function Thumb({ path, className }: { path: string; className?: string }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  return (
    <div className={cn("relative overflow-hidden bg-surface-2", className)}>
      {state === "loading" && <div className="absolute inset-0 animate-pulse bg-surface-2" />}
      {state === "error" ? (
        <div className="flex h-full w-full items-center justify-center text-muted">
          <ImageOff size={20} />
        </div>
      ) : (
        <img
          src={thumbUrl(path)}
          loading="lazy"
          draggable={false}
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-300",
            state === "ok" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  );
}
