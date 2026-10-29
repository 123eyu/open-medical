import { createHash } from "node:crypto";
import { check } from "../../../server/errors.mjs";
import { sqliteTransaction } from "../../../server/sqlite-transaction.mjs";

// History IDs distinguish repeated state transitions. The state fingerprint also
// covers older writers and memories created without a history entry. Same-topic
// peers participate because restore/edit can supersede another active preference.
export function habitRevision(db, id) {
  const target = db
    .prepare("SELECT topic FROM doctor_memories WHERE id=?")
    .get(id);
  if (!target) return null;
  const rows = db
    .prepare(
      `SELECT id,kind,status,pinned,topic,content,origin,rule,
    (SELECT COALESCE(MAX(id),0) FROM habit_history WHERE habit_id=m.id) historyId
    FROM doctor_memories m WHERE id=? OR (?<>'' AND topic=?) ORDER BY id`,
    )
    .all(id, target.topic, target.topic);
  return createHash("sha256")
    .update(
      JSON.stringify({
        rows,
        epoch: db
          .prepare("SELECT epoch FROM habit_revision_epoch WHERE id=1")
          .get().epoch,
      }),
    )
    .digest("hex");
}

export function habitMutation(
  db,
  id,
  operation,
  input,
  execute,
  { required = false } = {},
) {
  const { expectedRevision, requestId } = input || {};
  check(
    !required || (typeof expectedRevision === "string" && requestId),
    "REVISION_REQUIRED",
    "请重新载入习惯的当前状态后再操作，尚未提交任何修改",
    409,
  );
  if (requestId !== undefined)
    check(
      typeof requestId === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(requestId),
      "INVALID_INPUT",
      "习惯操作请求编号无效",
    );
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        id,
        operation,
        expectedRevision,
        historyId: input?.historyId,
        content:
          typeof input?.content === "string"
            ? input.content.trim()
            : input?.content,
        pinned: input?.pinned,
      }),
    )
    .digest("hex");
  return sqliteTransaction(db, () => {
    if (requestId) {
      const receipt = db
        .prepare(
          "SELECT fingerprint,result FROM habit_mutation_receipts WHERE request_id=?",
        )
        .get(requestId);
      if (receipt) {
        check(
          receipt.fingerprint === fingerprint,
          "REQUEST_CONFLICT",
          "该请求编号已用于不同的习惯操作，请核对后重新提交",
          409,
        );
        return { ...JSON.parse(receipt.result), replayed: true };
      }
    }
    if (expectedRevision !== undefined)
      check(
        expectedRevision === habitRevision(db, id),
        "REVISION_CONFLICT",
        "这条习惯或同主题习惯已有后续调整。你的草稿仍保留，请载入当前内容并明确核对后再提交",
        409,
      );
    const result = execute();
    if (operation.startsWith("memory-")) {
      db.prepare(
        "UPDATE habit_revision_epoch SET epoch=epoch+1 WHERE id=1",
      ).run();
      if (result && typeof result === "object" && result.id)
        result.revision = habitRevision(db, result.id);
    }
    if (requestId)
      db.prepare(
        "INSERT INTO habit_mutation_receipts(request_id,habit_id,fingerprint,result) VALUES (?,?,?,?)",
      ).run(requestId, id, fingerprint, JSON.stringify(result));
    return result;
  });
}
