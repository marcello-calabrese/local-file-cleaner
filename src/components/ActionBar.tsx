import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { formatBytes, formatCount } from "../lib/format";
import type { ScanResponse } from "../lib/ipc";
import { selectionBytes, useScan, type ResultView, type Selection } from "../store/scan";
import { Button, Checkbox } from "./ui";

/** Duplicate / similar groups in which every copy is selected. */
export function fullySelectedGroups(
  view: ResultView,
  result: ScanResponse | undefined,
  sel: Selection,
): number {
  if (!result) return 0;
  if (view === "duplicates")
    return result.duplicates.filter((g) => g.files.every((f) => sel.has(f.path))).length;
  if (view === "similar")
    return result.similar.filter((g) => g.images.every((i) => sel.has(i.file.path))).length;
  return 0;
}

export function ActionBar({ view }: { view: ResultView }) {
  const selection = useScan((s) => s.selected[view]);
  const clear = useScan((s) => s.clearSelection);
  const [confirming, setConfirming] = useState(false);
  const count = selection.size;

  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-t border-line px-6 py-3">
        <div className="flex-1 text-sm">
          {count === 0 ? (
            <span className="text-muted">Select items to clean up. Nothing is removed without confirmation.</span>
          ) : (
            <span>
              <span className="font-semibold tabular-nums">{formatCount(count)}</span>
              <span className="text-muted"> selected · </span>
              <span className="font-semibold tabular-nums">{formatBytes(selectionBytes(selection))}</span>
            </span>
          )}
        </div>
        {count > 0 && (
          <Button variant="ghost" onClick={() => clear(view)}>
            Clear selection
          </Button>
        )}
        <Button variant="danger" disabled={count === 0} onClick={() => setConfirming(true)}>
          <Trash2 size={16} />
          Move to Recycle Bin
        </Button>
      </div>
      <AnimatePresence>
        {confirming && <ConfirmDialog view={view} onClose={() => setConfirming(false)} />}
      </AnimatePresence>
    </>
  );
}

function ConfirmDialog({ view, onClose }: { view: ResultView; onClose: () => void }) {
  const selection = useScan((s) => s.selected[view]);
  const result = useScan((s) => s.result);
  const recycle = useScan((s) => s.recycle);
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const paths = [...selection.keys()];
  const allCopies = fullySelectedGroups(view, result, selection);
  const isFolders = view === "caches" || view === "empty";
  const blocked = allCopies > 0 && !acknowledged;

  const run = async () => {
    setBusy(true);
    try {
      const outcomes = await recycle(view);
      const ok = outcomes.filter((o) => o.ok);
      const failed = outcomes.filter((o) => !o.ok);
      const freed = ok.reduce((s, o) => s + (selection.get(o.path) ?? 0), 0);
      if (ok.length > 0)
        toast.success(`Moved ${formatCount(ok.length)} items to the Recycle Bin`, {
          description: freed > 0 ? `${formatBytes(freed)} freed. You can restore them from the Recycle Bin.` : undefined,
        });
      if (failed.length > 0)
        toast.error(`${formatCount(failed.length)} items could not be moved`, {
          description: failed[0].error ?? undefined,
        });
      onClose();
    } catch (e) {
      toast.error("Nothing was moved", { description: String(e) });
      setBusy(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !busy && onClose()}
    >
      <motion.div
        className="w-[560px] max-w-[90vw] rounded-2xl border border-line bg-white p-6 shadow-2xl dark:bg-[#1b1b24]"
        initial={{ scale: 0.95, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 10 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-danger/15 text-danger">
            <Trash2 size={20} />
          </div>
          <div className="flex-1">
            <h2 className="font-display text-lg font-semibold">
              Move {formatCount(paths.length)} {isFolders ? "folders" : "files"} to the Recycle Bin?
            </h2>
            <p className="mt-1 text-sm text-muted">
              {formatBytes(selectionBytes(selection))} in total. You can restore them from the
              Recycle Bin until it is emptied.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="text-muted hover:text-fg">
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 max-h-52 overflow-auto rounded-lg border border-line bg-surface p-2 font-mono text-[11.5px] leading-relaxed text-muted select-text">
          {paths.slice(0, 300).map((p) => (
            <div key={p} className="truncate" title={p}>
              {p}
            </div>
          ))}
          {paths.length > 300 && <div className="pt-1 italic">…and {formatCount(paths.length - 300)} more</div>}
        </div>

        {allCopies > 0 && (
          <div className="mt-4 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-warn">
              <AlertTriangle size={16} />
              Every copy is selected in {formatCount(allCopies)} group{allCopies > 1 ? "s" : ""}
            </div>
            <p className="mt-1 text-muted">
              Those files would have no copy left outside the Recycle Bin.
            </p>
            <label className="mt-2 flex cursor-pointer items-center gap-2">
              <Checkbox checked={acknowledged} onChange={setAcknowledged} danger />
              <span>I understand, remove every copy</span>
            </label>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={run} disabled={busy || blocked}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            {busy ? "Moving…" : "Move to Recycle Bin"}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
