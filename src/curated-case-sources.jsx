export function CuratedCaseSources({ sources = [] }) {
  if (!sources.length) return null;
  return <details className="case-curated-sources">
    <summary>精选案例经验 · 历史快照（{sources.length} 份）</summary>
    <p className="muted">以下是医生当时保存的经验与结局，不代表患者目前的临床状态。</p>
    {sources.map(source => <section key={source.caseId} aria-label="精选案例来源">
      <h4>{source.diagnosis || "案例快照"}</h4>
      <p className="muted">保存于 {Number.isFinite(new Date(source.capturedAt).getTime()) ? new Date(source.capturedAt).toLocaleString("zh-CN") : "日期未记录"} · 版本 {source.revision ?? 0}</p>
      {source.lessons && <p><b>当时记下的经验：</b>{source.lessons}</p>}
      {source.summary && <p><b>快照摘要：</b>{source.summary}</p>}
      {source.outcome && <p><b>快照结局：</b>{source.outcome}</p>}
      {source.tags?.length > 0 && <p><b>标签：</b>{source.tags.join("、")}</p>}
      <details><summary>来源编号</summary><p>案例 {source.caseId} · 版本 {source.revision ?? 0}（保留本次检索取得的内容）</p></details>
    </section>)}
  </details>;
}
