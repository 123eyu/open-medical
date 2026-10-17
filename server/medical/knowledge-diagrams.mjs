import { check, string } from "../errors.mjs";
import { knowledgeEvidenceText } from "./knowledge-evidence.mjs";

const citation = {
  quote: { type: "string" },
  startLine: { type: "integer" },
  endLine: { type: "integer" },
};
const citationRequired = ["quote", "startLine", "endLine"];
export const knowledgeDiagramsSchema = {
  type: "array",
  maxItems: 2,
  description:
    "仅在本批有明确步骤或主题层级时提取；通常只选最适合的一种，无依据返回空数组。",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      type: { type: "string", enum: ["flowchart", "mindmap"] },
      title: { type: "string" },
      nodes: {
        type: "array",
        minItems: 2,
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            role: {
              type: "string",
              enum: ["start", "action", "decision", "end", "root", "topic"],
            },
            ...citation,
          },
          required: ["id", "label", "role", ...citationRequired],
        },
      },
      edges: {
        type: "array",
        minItems: 1,
        maxItems: 16,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            label: {
              type: "string",
              description: "分支条件逐字摘录；普通顺序或层级连线可为空",
            },
            ...citation,
          },
          required: ["from", "to", "label", ...citationRequired],
        },
      },
    },
    required: ["type", "title", "nodes", "edges"],
  },
};

export function validateKnowledgeDiagrams(input = [], evidence) {
  const ensure = (ok, message) => check(ok, "KNOWLEDGE_DIAGRAM", message);
  ensure(
    Array.isArray(input) && input.length <= 2,
    "每批最多保存两张有原文依据的结构图",
  );
  return input.map((d) => {
    ensure(["flowchart", "mindmap"].includes(d.type), "结构图类型无效");
    const title = string(d.title, "结构图标题", 100);
    ensure(
      Array.isArray(d.nodes) && d.nodes.length >= 2 && d.nodes.length <= 12,
      "结构图须含 2–12 个节点",
    );
    ensure(
      Array.isArray(d.edges) && d.edges.length >= 1 && d.edges.length <= 16,
      "结构图须含 1–16 条连线",
    );
    const roles =
      d.type === "mindmap"
        ? ["root", "topic"]
        : ["start", "action", "decision", "end"];
    const nodes = d.nodes.map((n) => {
      ensure(roles.includes(n.role), "节点形态须与结构图类型匹配");
      return {
        id: string(n.id, "步骤编号", 40),
        label: string(n.label, "步骤名称", 80),
        role: n.role,
        ...evidence(n, "结构图节点", n.label),
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    ensure(byId.size === nodes.length, "结构图内的步骤编号须唯一");
    const outgoing = new Map(nodes.map((n) => [n.id, []]));
    const incoming = new Map(nodes.map((n) => [n.id, 0]));
    const pairs = new Set();
    const edges = d.edges.map((e) => {
      ensure(
        byId.has(e.from) && byId.has(e.to) && e.from !== e.to,
        "连线两端须对应本图不同节点",
      );
      const label = typeof e.label === "string" ? e.label.trim() : "";
      ensure(
        label.length <= 160,
        "分支条件过长，请保留关键条件并在引文中保存完整内容",
      );
      const source = evidence(e, "结构图连线", `${e.from}→${e.to}`);
      if (byId.get(e.from).role === "decision")
        ensure(
          label,
          "判断节点的每条出线都必须有原文分支条件，不可补造默认的‘否’分支",
        );
      if (label && source)
        ensure(
          knowledgeEvidenceText(source.quote).includes(
            knowledgeEvidenceText(label, source.quote),
          ),
          "连线条件必须逐字摘录自其引文，不可改写或补造分支",
        );
      const key = JSON.stringify([e.from, e.to, label]);
      ensure(!pairs.has(key), "同图不能重复保存相同连线");
      pairs.add(key);
      outgoing.get(e.from).push(e.to);
      incoming.set(e.to, incoming.get(e.to) + 1);
      return { from: e.from, to: e.to, label, ...source };
    });
    let root;
    if (d.type === "mindmap") {
      const roots = nodes.filter((n) => n.role === "root");
      ensure(roots.length === 1, "思维导图必须有且仅有一个中心主题");
      root = roots[0];
      ensure(
        nodes.every((n) => incoming.get(n.id) === (n.id === root.id ? 0 : 1)),
        "思维导图每个子主题只应有一个父主题，不能交叉连线",
      );
    } else {
      const starts = nodes.filter((n) => n.role === "start");
      ensure(
        starts.length === 1,
        "流程图必须有一个明确的起点；本批只有局部流程时以原文的局部入口为起点",
      );
      root = starts[0];
      ensure(
        nodes.every((n) => n.role !== "end" || !outgoing.get(n.id).length),
        "结束节点不可继续连线，需要复诊回路时请使用行动节点",
      );
      ensure(
        nodes.every((n) => n.role !== "decision" || outgoing.get(n.id).length),
        "判断节点必须至少有一条有据分支",
      );
    }
    const seen = new Set([root.id]),
      queue = [root.id];
    for (let i = 0; i < queue.length; i++)
      for (const id of outgoing.get(queue[i]))
        if (!seen.has(id)) {
          seen.add(id);
          queue.push(id);
        }
    ensure(
      seen.size === nodes.length,
      "结构图包含无法从起点到达的节点或孤立循环，请拆分或修正连线",
    );
    return { type: d.type, title, rootId: root.id, nodes, edges };
  });
}
