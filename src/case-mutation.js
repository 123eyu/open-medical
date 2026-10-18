import { api } from "./agent-runtime";

// Page-memory receipts survive navigation together with the original draft.
const requests = new Map();
export async function mutateCase(item, method, patch = {}) {
  const path = `/api/cases/${item.id}`;
  const input = { ...patch, expectedRevision: item.revision || 0 };
  const key = JSON.stringify([path, method, input]);
  if (!requests.has(key)) requests.set(key, crypto.randomUUID());
  return api(path, method, { ...input, requestId: requests.get(key) });
}
