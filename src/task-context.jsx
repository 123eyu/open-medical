// 任务上下文的前端部分：入口构造上下文对象，输入框和对话记录用标签展示。
// 执行要求在服务端（server/medical/task-context.mjs）按 kind 生成，
// 这里只放医生能看懂的标签、范围和资料。
const SCOPE_LABELS = {
  collection: "知识库",
  topic: "主题",
  kind: "资料类别",
  reviewStatus: "来源状态",
  template: "模板",
  purpose: "用途",
  mode: "方式",
  source: "优先来源",
  yearFrom: "起始年",
  yearTo: "结束年",
};
const SCOPE_VALUES = {
  purpose: { previsit: "准备接诊", postvisit: "诊后文书" },
  mode: { search: "查找论文", research: "文献研究" },
};

const scopeEntries = (context) =>
  Object.entries(context.scope || {}).filter(([key, value]) => key !== "template" && value !== undefined && value !== null && value !== "");
const lineRef = (item) => `${item.docTitle || item.docId}${item.startLine ? ` 第 ${item.startLine}–${item.endLine} 行` : ""}`;

// 用医生看得懂的方式概括附带资料；原始数据折叠在下面备查。
function dataPreview(context) {
  const data = context.data;
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.hints)) return data.hints.length ? [`检索线索：${data.hints.map(lineRef).join("；")}`] : ["检索线索：无"];
  if (Array.isArray(data.hits)) return data.hits.length ? [`检索页候选片段：${data.hits.map(lineRef).join("；")}`] : [];
  if (data.document) return [`文档：${data.document.title}${data.range ? ` 第 ${data.range.startLine}–${data.range.endLine} 行` : ""}（版本：${data.document.edition}；${data.document.status}）`];
  if (context.kind === "patient-brief") {
    const count = (key) => (Array.isArray(data[key]) ? data[key].length : 0);
    return [`档案快照：诊断 ${count("diagnoses")} 条 · 用药 ${count("medications")} 条 · 检验 ${count("latestLabs")} 组 · 近期就诊 ${count("recentVisits")} 条 · 随访 ${count("recentFollowups")} 条 · 待跟进 ${count("careTasks")} 项${data.informationGaps?.length ? ` · 信息缺口：${data.informationGaps.join("、")}` : ""}`];
  }
  if (context.kind === "followup-record") return [`随访记录：${data.outcome || ""}，登记于 ${data.recordedAt || "未记录"}；下次随访：${data.nextDueAt || "未安排"}`];
  return [];
}
const scopeText = ([key, value]) => `${SCOPE_LABELS[key] || key}：${SCOPE_VALUES[key]?.[value] || value}`;

export function contextSummary(context) {
  const scope = scopeEntries(context).map(scopeText);
  return [context.label, ...scope].join("\n");
}

export function TaskContextDetails({ contexts }) {
  if (!contexts?.length) return null;
  return (
    <details className="task-context-details">
      <summary>查看附带内容</summary>
      <p className="muted">这些内容会随你的问题一起交给助手，用来限定检索范围或提供资料，不会写进你的提问。点标签上的 × 可在发送前移除。</p>
      {contexts.map((context) => (
        <section key={context.kind}>
          <b>{context.label}</b>
          {scopeEntries(context).length > 0 && <p>{scopeEntries(context).map(scopeText).join(" · ")}</p>}
          {dataPreview(context).map((line) => <p key={line}>{line}</p>)}
          {context.data !== undefined && (
            <details>
              <summary>原始数据</summary>
              <pre>{JSON.stringify(context.data, null, 2).slice(0, 6000)}</pre>
            </details>
          )}
        </section>
      ))}
    </details>
  );
}

const hintOf = (item) => ({
  docId: item.docId,
  docTitle: item.docTitle,
  startLine: item.startLine,
  endLine: item.endLine,
});

// 知识图谱节点：医生自己输入问题，限定在该知识库、围绕该主题。
export function knowledgeTopicContext(collection, node) {
  return {
    kind: "knowledge-topic",
    label: `知识库：${collection} · ${node.label}`,
    scope: { collection, topic: node.label },
    data: { hints: (node.evidence || []).slice(0, 5).map(hintOf) },
  };
}

// 检索结果页「就此提问」：保留检索条件和候选片段。
export function knowledgeSearchContext(collection, result) {
  return {
    kind: "knowledge-search",
    label: `知识库：${collection}${result.kind ? ` · ${result.kind}` : ""}`,
    scope: {
      collection,
      ...(result.kind ? { kind: result.kind } : {}),
      ...(result.reviewStatus ? { reviewStatus: result.reviewStatus } : {}),
    },
    data: {
      hits: (result.hits || []).slice(0, 6).map((h) => ({ ...hintOf(h), sha256: h.sha256 || null })),
    },
  };
}

// 阅读器「循证准备」：限定到一份文档（可带行号范围）。
export function knowledgeSourceContext(collection, doc, range) {
  return {
    kind: "knowledge-source",
    label: `知识库：${collection} · ${doc.title}${range ? ` 第 ${range.startLine}–${range.endLine} 行` : ""}`,
    scope: { collection },
    data: {
      document: {
        id: doc.id,
        title: doc.title,
        edition: doc.edition || "未注明",
        status: doc.statusLabel || "使用中",
        sha256: doc.sha256,
      },
      ...(range ? { range: { startLine: range.startLine, endLine: range.endLine } } : {}),
    },
  };
}

export const DEMO_CONTEXT = { kind: "demo", label: "虚构示例体验" };
