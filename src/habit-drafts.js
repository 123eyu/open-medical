import { useEffect, useState } from "react";

// Only this tab's memory: closing the profile does not discard the original
// version or the doctor's draft. No habit content is written to browser storage.
const drafts = new Map();
export function useHabitDraft(field, initial) {
  const [value, update] = useState(() => drafts.get(field) ?? initial);
  const setValue = (next) => {
    if (JSON.stringify(next) === JSON.stringify(initial)) drafts.delete(field);
    else drafts.set(field, next);
    update(next);
  };
  useEffect(() => {
    const clear = () => update(initial);
    window.addEventListener("learning-cleared", clear);
    return () => window.removeEventListener("learning-cleared", clear);
  }, [initial]);
  return [value, setValue];
}
if (typeof window !== "undefined") {
  window.addEventListener("learning-cleared", () => drafts.clear());
  window.addEventListener("beforeunload", (event) => {
    if (!drafts.has("editing")) return;
    event.preventDefault();
    event.returnValue = "";
  });
}
