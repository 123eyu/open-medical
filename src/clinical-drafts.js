import { useState } from "react";

// Unsaved additions stay in this tab's memory, scoped to the patient. Never
// persist patient text in browser storage or transmit it before explicit Add.
const drafts = new Map();
export function hasClinicalDraft(patientId, section) {
  const fields = { diagnoses: ["diagnosis", "icd", "diagnosisMeta"], medications: ["medication", "allergy", "medEdit"], labs: ["lab", "labEdit"], visits: ["visit", "visitEdit"] };
  return (fields[section] || []).some(field => drafts.has(`${patientId}:${field}`));
}
export function useClinicalDraft(patientId, field, initial) {
  const key = `${patientId}:${field}`;
  const [state, update] = useState(() => ({ key, value: drafts.get(key) ?? initial }));
  const value = state.key === key ? state.value : drafts.get(key) ?? initial;
  if (state.key !== key) update({ key, value });
  const setValue = next => {
    const resolved = typeof next === "function" ? next(drafts.get(key) ?? initial) : next;
    if (JSON.stringify(resolved) === JSON.stringify(initial)) drafts.delete(key);
    else drafts.set(key, resolved);
    update(current => current.key === key ? { key, value: resolved } : current);
  };
  return [value, setValue];
}
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", event => {
    if (!drafts.size) return;
    event.preventDefault();
    event.returnValue = "";
  });
}
