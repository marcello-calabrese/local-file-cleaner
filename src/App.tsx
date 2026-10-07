import { AnimatePresence, motion } from "motion/react";
import { Toaster } from "sonner";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { useScan, type View } from "./store/scan";
import { Caches } from "./views/Caches";
import { Dashboard } from "./views/Dashboard";
import { Duplicates } from "./views/Duplicates";
import { EmptyDirs } from "./views/EmptyDirs";
import { Similar } from "./views/Similar";
import { Unused } from "./views/Unused";

const VIEWS: Record<View, () => React.JSX.Element> = {
  dashboard: Dashboard,
  duplicates: Duplicates,
  similar: Similar,
  caches: Caches,
  unused: Unused,
  empty: EmptyDirs,
};

export default function App() {
  const view = useScan((s) => s.view);
  const Current = VIEWS[view];

  return (
    <div className="flex h-full flex-col bg-base">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-hidden rounded-tl-2xl border-t border-l border-line bg-surface/40">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              className="h-full pt-4"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
            >
              <Current />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <Toaster theme="system" position="bottom-right" richColors closeButton />
    </div>
  );
}
