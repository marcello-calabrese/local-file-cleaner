import { useRef } from "react";
import { useScan, type ResultView } from "../store/scan";

/**
 * Click toggles one item; Shift+click applies the same state to the whole
 * range since the last clicked item.
 */
export function useRangeSelect(view: ResultView, items: [string, number][]) {
  const select = useScan((s) => s.select);
  const anchor = useRef<number | null>(null);

  return (index: number, checked: boolean, e: { shiftKey: boolean }) => {
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
      select(view, items.slice(a, b + 1), checked);
    } else {
      select(view, [items[index]], checked);
    }
    anchor.current = index;
  };
}
