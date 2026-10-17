import { coverageLabel } from "../shared/knowledge-profiles.mjs";
export const workspaceTabs = [
  ["documents", "资料"],
  ["search", "检索"],
  ["map", "知识图谱"],
];
export function documentIssues(doc) {
  if (doc.reviewStatus === "retired") return [];
  const issues = [];
  if (doc.coverage?.status !== "complete")
    issues.push({
      type: "coverage",
      label: coverageLabel(doc.coverage),
      action: "read",
    });
  if (doc.indexing?.status !== "ready")
    issues.push({
      type: "index",
      label:
        doc.indexing?.status === "running" ? "索引处理中" : "语义索引未完成",
      action: "index",
    });
  if (!doc.edition && !doc.year)
    issues.push({ type: "version", label: "版本未注明", action: "review" });
  return issues;
}
export function summarizeWorkspace(docs, jobs) {
  const active = docs.filter((d) => d.reviewStatus !== "retired");
  return {
    total: docs.length,
    searchable: active.filter((d) => d.indexing?.status === "ready").length,
    complete: active.filter((d) => d.coverage?.status === "complete").length,
    reviewed: active.filter((d) => d.reviewStatus === "reviewed").length,
    attention: active.filter((d) => documentIssues(d).length).length,
    running: jobs.filter((j) => ["queued", "running"].includes(j.status))
      .length,
    failed: jobs.filter((j) =>
      ["failed", "interrupted", "needs_input"].includes(j.status),
    ).length,
  };
}
export function graphState(docId, jobs) {
  const job = jobs.find((j) => j.docId === docId && !j.indexOnly);
  return !job
    ? "尚未生成"
    : job.status === "completed"
      ? "已生成"
      : ["running", "queued"].includes(job.status)
        ? "生成中"
        : "未完成";
}
