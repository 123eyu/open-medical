import { createHash } from "node:crypto";
import { normalizeMedicalTerm } from "../../shared/medical-graph.mjs";
const idFor = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 20);

// Same-type, same-name concepts share a node. Aliases remain searchable evidence;
// they never collapse distinct drug formulations or ambiguous abbreviations.
export function assembleKnowledgeGraph(sources) {
  const diagrams = new Map();
  const nodes = new Map(),
    edges = new Map();
  for (const { doc, analysis } of sources) {
    for (const batch of analysis.batches || []) {
      if (!batch) continue;
      const local = new Map();
      const source = {
        docId: doc.id,
        docTitle: doc.title,
        sourceKind: analysis.sourceKind,
        edition: doc.edition,
        reviewStatus: doc.reviewStatus,
        sourceHash: doc.sha256,
        status: "待核对",
      };
      for (const diagram of batch.diagrams || []) {
        const id = idFor(JSON.stringify([doc.id, diagram.type, diagram.title, diagram.nodes, diagram.edges]));
        diagrams.set(id, { ...diagram, ...source, id });
      }
      for (const node of batch.nodes) {
        const id = idFor(node.type + ":" + normalizeMedicalTerm(node.label));
        local.set(node.label, id);
        const item = nodes.get(id) || {
          id,
          label: node.label,
          type: node.type,
          evidence: [],
          aliases: [],
        };
        item.aliases = [...new Set([...item.aliases, ...(node.aliases || [])])];
        if (
          !item.evidence.some(
            (e) =>
              e.docId === doc.id &&
              e.startLine === node.startLine &&
              e.quote === node.quote,
          )
        )
          item.evidence.push({ ...node, ...source });
        nodes.set(id, item);
      }
      for (const relation of batch.relations) {
        const from = local.get(relation.from),
          to = local.get(relation.to);
        if (!from || !to || from === to) continue;
        const id = idFor(
          JSON.stringify([
            doc.id,
            from,
            to,
            relation.relation,
            relation.quote,
            relation.startLine,
          ]),
        );
        edges.set(id, {
          ...relation,
          id,
          from,
          to,
          ...source,
          evidenceKind: "原文提取",
          relationType: relation.relationType || "其他",
          assertion: relation.assertion || "未标注",
        });
      }
    }
  }
  const neighbors = new Map([...nodes.keys()].map((id) => [id, new Set()]));
  for (const edge of edges.values()) {
    neighbors.get(edge.from).add(edge.to);
    neighbors.get(edge.to).add(edge.from);
  }
  const communities = [],
    seen = new Set();
  for (const id of nodes.keys()) {
    if (seen.has(id)) continue;
    const queue = [id];
    seen.add(id);
    for (let i = 0; i < queue.length; i++)
      for (const next of neighbors.get(queue[i])) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    const members = queue
      .map((key) => nodes.get(key))
      .sort(
        (a, b) =>
          neighbors.get(b.id).size - neighbors.get(a.id).size ||
          a.id.localeCompare(b.id),
      );
    const anchor =
      members.find((n) => ["疾病", "诊断"].includes(n.type)) || members[0];
    const community = idFor(queue.slice().sort().join(":"));
    for (const node of members)
      Object.assign(node, { community, degree: neighbors.get(node.id).size });
    communities.push({
      id: community,
      label: anchor.label,
      count: queue.length,
    });
  }
  return {
    nodes: [...nodes.values()].sort(
      (a, b) => b.degree - a.degree || a.label.localeCompare(b.label, "zh-CN"),
    ),
    edges: [...edges.values()],
    diagrams: [...diagrams.values()],
    communities: communities.sort((a, b) => b.count - a.count),
  };
}
