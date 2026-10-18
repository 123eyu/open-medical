import { api } from "./agent-runtime";

// A failed response keeps the same receipt key. A deliberate change of the
// observed version or input creates a new operation, never a blind retry.
const requests = new Map();
if (typeof window !== "undefined") window.addEventListener("learning-cleared", () => requests.clear());
export function useHabitMutation() {
  return async (path, method, memory, body = {}) => {
    if (!memory?.revision)
      throw new Error("请打开习惯账本，核对当前内容后再操作");
    const input = { ...body, expectedRevision: memory.revision };
    const key = JSON.stringify([path, method, input]);
    if (!requests.has(key))
      requests.set(key, crypto.randomUUID());
    const result = await api(path, method, {
      ...input,
      requestId: requests.get(key),
    });
    return result;
  };
}
