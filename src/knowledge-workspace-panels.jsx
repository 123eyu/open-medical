import { useState } from "react";
import { coverageLabel } from "../shared/knowledge-profiles.mjs";
import { graphState } from "./knowledge-workspace-model.mjs";

export function KnowledgeDocuments({
  docs,
  jobs,
  onRead,
  onReview,
  onIndex,
  onOrganize,
  onDelete,
  busy,
  onImport,
}) {
  const [query, setQuery] = useState("");
  const filtered = docs.filter((doc) =>
    `${doc.title} ${doc.org || ""} ${doc.edition || doc.year || ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <section>
      <div className="kw-section-heading">
        <label className="kw-document-filter">
          <span className="sr-only">查找资料</span>
          <input
            aria-label="查找资料"
            placeholder="按名称、机构或版本查找资料"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="toolbar-actions">
          <span className="kw-document-count">
            {query.trim() ? `${filtered.length} / ${docs.length}` : docs.length}{" "}
            份资料
          </span>
          <button className="primary" onClick={onImport}>
            添加资料
          </button>
        </div>
      </div>
      {!!filtered.length && (
        <div className="kw-table-scroll">
          <table className="kw-table kw-documents-table">
            <thead>
              <tr>
                <th>资料</th>
                <th>版本</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <button
                      className="text-button kw-doc-title"
                      onClick={() => onRead(doc.id)}
                    >
                      {doc.title}
                    </button>
                    {doc.org && <small>{doc.org}</small>}
                    {doc.indexing?.status === "failed" && (
                      <small>
                        语义检索暂不可用，仍可按关键词检索；可在
                        「设置 → 模型与运行」配置向量服务后重新索引启用。
                      </small>
                    )}
                    {graphState(doc.id, jobs) === "生成中" && (
                      <small>图谱生成中…</small>
                    )}
                    {(doc.edition || doc.year) && (
                      <small className="kw-mobile-version">
                        {doc.edition || doc.year}
                      </small>
                    )}
                    {doc.reviewStatus === "retired" && (
                      <span className="kw-badge">已停用</span>
                    )}
                    {["excerpt", "needs_review"].includes(
                      doc.coverage?.status,
                    ) && <small>{coverageLabel(doc.coverage)}</small>}
                  </td>
                  <td>{doc.edition || doc.year || "—"}</td>
                  <td>
                    <div className="kw-document-actions">
                      <button
                        className="text-button danger"
                        disabled={busy}
                        onClick={() => onDelete(doc)}
                      >
                        删除
                      </button>
                      <details className="kw-document-more">
                        <summary aria-label={`更多操作：${doc.title}`}>
                          更多
                        </summary>
                        <div className="kw-row-actions">
                          {doc.indexing?.error?.message && (
                            <small>{doc.indexing.error.message}</small>
                          )}
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => onReview(doc)}
                          >
                            来源与版本
                          </button>
                          {doc.indexing?.status !== "ready" && (
                            <button
                              className="text-button"
                              disabled={
                                busy || doc.indexing?.status === "running"
                              }
                              onClick={() => onIndex(doc)}
                            >
                              {doc.indexing?.status === "running"
                                ? "索引处理中"
                                : "重建语义索引"}
                            </button>
                          )}
                          {doc.reviewStatus !== "retired" &&
                            ["尚未生成", "未完成"].includes(
                              graphState(doc.id, jobs),
                            ) && (
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() => onOrganize(doc)}
                              >
                                {graphState(doc.id, jobs) === "未完成"
                                  ? "继续生成图谱"
                                  : "生成图谱"}
                              </button>
                            )}
                        </div>
                      </details>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!filtered.length && (
        <div className="kw-empty">
          {docs.length
            ? "没有找到匹配的资料，试试其他名称或版本。"
            : "还没有资料。添加文件后，即可在这里阅读、检索或向 AI 提问。"}
        </div>
      )}
    </section>
  );
}
