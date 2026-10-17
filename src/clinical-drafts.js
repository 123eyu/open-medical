import { useState } from "react";

// Unsaved additions stay in this tab's memory, scoped to the patient. Never
// persist patient text in browser storage or transmit it before explicit Add.
const drafts = new Map();
export function hasClinicalDraft(patientId, section) {
  const fields = { diagnoses: ["diagnosis", "icd"], medications: ["medication", "allergy"], labs: ["lab"], visits: ["visit"] };
  return (fields[section] || []).some(field => drafts.has(`${patientId}:${field}`));
}
export function useClinicalDraft(patientId, field, initial) {
  const key = `${patientId}:${field}`;
  const [value, update] = useState(() => drafts.get(key) ?? initial);
  const setValue = next => {
    if (JSON.stringify(next) === JSON.stringify(initial)) drafts.delete(key);
    else drafts.set(key, next);
    update(next);
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
