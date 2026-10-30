import { FilePen } from "lucide-react";

const sizeLabel = (bytes) =>
  bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export const binarySummary = (a) =>
  `二进制文件 · ${sizeLabel(a.size || 0)}${a.overwrites ? " · 将覆盖现有文件（旧版会自动备份）" : " · 新建"}`;

// Shown in the conversation when the assistant has proposed writes and the
// workspace still asks before each one. "Always allow" switches this
// workspace to automatic writes, so the prompt appears only until then.
export function WriteAuthorizationCard({
  pending,
  firstTime,
  root,
  busy,
  onReview,
  onApprove,
  onReject,
}) {
  if (!pending.length) return null;
  const shown = pending.slice(0, 5);
  return (
    <div className="wb-write-auth" role="group" aria-label="文件写入授权">
      <div className="wb-write-auth-head">
        <FilePen size={16} />
        <div>
          <b>
            {firstTime
              ? "助手请求写入你的本地文件夹"
              : `助手想修改 ${pending.length} 个文件`}
          </b>
          <p>
            {firstTime
              ? `批准后会直接写入 ${root}。选择“始终允许”后，本工作区之后的修改不再逐项询问。`
              : "批准后写入文件夹，可在“变更”中查看修改前后。"}
          </p>
        </div>
      </div>
      <ul>
        {shown.map((a) => (
          <li key={a.id}>
            <code>{a.path}</code>
            <span>
              {a.kind === "file.delete"
                ? "删除"
                : a.kind === "file.write.binary"
                  ? binarySummary(a)
                  : a.before === null
                    ? "新建"
                    : "修改"}
            </span>
          </li>
        ))}
        {pending.length > shown.length && (
          <li className="muted">还有 {pending.length - shown.length} 项…</li>
        )}
      </ul>
      <div className="wb-write-auth-actions">
        <button className="primary" disabled={busy} onClick={() => onApprove(false)}>
          批准
        </button>
        <button className="secondary" disabled={busy} onClick={() => onApprove(true)}>
          批准，并始终允许本工作区写入
        </button>
        <button className="secondary" disabled={busy} onClick={onReview}>
          查看修改
        </button>
        <button className="om-link" disabled={busy} onClick={onReject}>
          全部拒绝
        </button>
      </div>
    </div>
  );
}
