import { createHash } from "node:crypto";
import { check, identifier } from "../errors.mjs";
import { sqliteTransaction } from "../sqlite-transaction.mjs";

// Receipts precede version checks: a response lost after commit must never
// replay the write over a later doctor's change, including after deletion.
export function mutateCase(library, id, action, input, operation) {
  identifier(id);
  identifier(input.requestId);
  check(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0,
    "REVISION_CONFLICT", "请重新打开案例，核对当前版本后再操作", 409);
  const payload = Object.fromEntries(Object.keys(input).filter(key => key !== "requestId").sort().map(key => [key, input[key]]));
  const fingerprint = createHash("sha256").update(JSON.stringify([id, action, payload])).digest("hex");
  const db = library.store.db, key = `case-mutation:${input.requestId}`;
  return sqliteTransaction(db, () => {
    const stored = db.prepare("SELECT value FROM meta WHERE key=?").get(key);
    if (stored) {
      const receipt = JSON.parse(stored.value);
      check(receipt.fingerprint === fingerprint, "REQUEST_CONFLICT", "此请求内容已变化，请核对当前案例后重新操作", 409);
      return { ...receipt.result, replayed: true };
    }
    const current = library.row(id);
    check(input.expectedRevision === (current.revision || 0), "REVISION_CONFLICT", "案例已被其他操作修改，请核对最新内容后再操作", 409);
    const result = operation(current);
    db.prepare("INSERT INTO meta(key,value) VALUES(?,?)").run(key, JSON.stringify({fingerprint, result}));
    return result;
  });
}
