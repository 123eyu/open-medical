import { useRef, useState } from "react";
import { api } from "./agent-runtime";
import {
  KNOWLEDGE_KINDS,
  coverageLabel,
} from "../shared/knowledge-profiles.mjs";
export function KnowledgeSearch({ collection, onRead, onAsk }) {
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState(""),
    [reviewStatus, setReview] = useState(""),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  const invalidate = () => {
    generation.current++;
    setResult(null);
    setBusy(false);
    setError("");
  };
  const search = async (e) => {
    e.preventDefault();
    if (!query.trim() || busy) return;
    const id = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const value = await api(
        "/api/knowledge/search?" +
          new URLSearchParams({
            q: query.trim(),
            collection,
            kind,
            reviewStatus,
            limit: "20",
          }),
      );
      if (id === generation.current)
        setResult({ ...value, query: query.trim(), kind, reviewStatus });
    } catch (e) {
      if (id === generation.current) setError(e.message);
    } finally {
      if (id === generation.current) setBusy(false);
    }
  };
  return (
    <section>
      <div className="kw-section-heading">
        <div>
          <h2>搜索资料内容</h2>
        </div>
      </div>
      <form onSubmit={search} className="kw-search-form">
        <div className="kw-search-box">
          <input
            aria-label="知识库检索问题"
            placeholder="输入问题、疾病、药名或指标"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              invalidate();
            }}
          />
          <button className="primary" disabled={busy || !query.trim()}>
            {busy ? "检索中…" : "检索"}
          </button>
        </div>
        <details className="kw-search-options">
          <summary>筛选范围</summary>
          <div className="kw-filters">
            <label>
              资料类别
              <select
                aria-label="检索资料类别"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  invalidate();
                }}
              >
                <option value="">全部类别</option>
                {KNOWLEDGE_KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              来源范围
              <select
                aria-label="检索来源范围"
                value={reviewStatus}
                onChange={(e) => {
                  setReview(e.target.value);
                  invalidate();
                }}
              >
                <option value="">使用中的来源</option>
                <option value="retired">已停用（历史资料）</option>
              </select>
            </label>
          </div>
        </details>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <>
          <div className="kw-section-heading">
            <h3>找到 {result.count ?? result.hits.length} 条相关片段{result.count > result.hits.length ? `（当前显示前 ${result.hits.length} 条，请缩小检索范围查看更多）` : ""}</h3>
            {onAsk && (
              <button
                className="secondary"
                onClick={() =>
                  onAsk({
                    query: result.query,
                    kind: result.kind,
                    reviewStatus: result.reviewStatus,
                    hits: result.hits,
                  })
                }
              >
                带着此问题继续问答
              </button>
            )}
          </div>
          {result.rag?.retrievalError && (
            <p role="status" className="form-error">
              {result.rag.retrievalError.message} 本次已使用关键词检索。
            </p>
          )}
          <div className="kw-results">
            {result.hits.map((hit, i) => (
              <article key={`${hit.docId}-${hit.startLine}-${i}`}>
                <header>
                  <h3>{hit.docTitle}</h3>
                  <span className="kw-badge">
                    第 {hit.startLine}–{hit.endLine} 行
                  </span>
                </header>
                <p className="knowledge-hit-meta">
                  {[
                    hit.reviewStatus === "retired" ? "已停用" : "",
                    hit.edition,
                    hit.location?.page ? `第 ${hit.location.page} 页` : "",
                    hit.location?.sheet
                      ? `${hit.location.sheet} 行 ${hit.location.row}`
                      : "",
                    hit.coverage?.status && hit.coverage.status !== "complete"
                      ? coverageLabel(hit.coverage)
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <blockquote>
                  {hit.matches?.length
                    ? hit.matches.map((m) => m.text).join("\n")
                    : hit.snippet}
                </blockquote>
                <button
                  className="secondary"
                  onClick={() => onRead(hit.docId, hit)}
                >
                  查看原文
                </button>
              </article>
            ))}
          </div>
          {!result.hits.length && (
            <div className="kw-empty">
              本库没有找到匹配依据。可调整关键词或来源范围，或补充完整资料。
            </div>
          )}
        </>
      )}
      {!result && !busy && (
        <div className="kw-empty">输入问题或关键词开始检索。</div>
      )}
    </section>
  );
}
