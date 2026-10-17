import test from "node:test";
import assert from "node:assert/strict";
import { validateKnowledgeBatch } from "../server/medical/knowledge-organizer.mjs";
import { assembleKnowledgeGraph } from "../server/medical/knowledge-graph.mjs";
import {
  recommendedKnowledgeView,
  layoutKnowledgeDiagram,
  wrapDiagramText,
} from "../src/knowledge-diagram-model.mjs";
import { diagramBatch, diagramText } from "./knowledge-diagram-fixtures.mjs";
const validate = (value) =>
  validateKnowledgeBatch(
    value,
    { text: diagramText, startLine: 1, endLine: 2 },
    "指南/共识",
  );
test("source-grounded flow branches and documented follow-up cycles coexist with a separate topic tree", () => {
  const result = validate(diagramBatch());
  assert.equal(result.diagrams[0].rootId, "a");
  assert.equal(result.diagrams[0].edges[3].to, "b");
  for (const d of result.diagrams) {
    const layout = layoutKnowledgeDiagram(d);
    assert.equal(layout.nodes.length, d.nodes.length);
    assert.ok(
      layout.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)),
    );
    assert.equal(layout.edges.length, d.edges.length);
  }
  assert.equal(recommendedKnowledgeView(result.diagrams), "flowchart");
  assert.equal(recommendedKnowledgeView(result.diagrams.slice(1)), "mindmap");
  assert.equal(recommendedKnowledgeView(), "graph");
  assert.equal(wrapDiagramText("甲".repeat(160)).join(""), "甲".repeat(160));
});
test("invented branch labels, empty decision branches, broken citations and disconnected steps are rejected", () => {
  for (const [mutate, error] of [
    [(d) => (d.edges[1].label = "否则"), /逐字摘录/],
    [(d) => (d.edges[1].label = ""), /分支条件/],
    [(d) => (d.edges[1].quote = "凭空增加的诊疗建议"), /引文必须/],
    [(d) => (d.nodes[0].startLine = 9), /引文必须/],
    [(d) => d.edges.splice(1, 1), /无法从起点/],
    [(d) => (d.edges[0].to = "missing"), /连线两端/],
  ]) {
    const value = diagramBatch();
    mutate(value.diagrams[0]);
    assert.throws(() => validate(value), error);
  }
});
test("mind maps reject multiple parents, roots and disconnected cycles", () => {
  const value = diagramBatch();
  value.diagrams[1].edges.push({
    ...value.diagrams[1].edges[0],
    from: "c",
    to: "d",
  });
  assert.throws(() => validate(value), /一个父主题/);
  const roots = diagramBatch();
  roots.diagrams[1].nodes[1].role = "root";
  assert.throws(() => validate(roots), /一个中心主题/);
  const cycle = diagramBatch();
  cycle.diagrams[1].edges = [
    { ...cycle.diagrams[1].edges[0], from: "a", to: "c" },
    { ...cycle.diagrams[1].edges[0], from: "b", to: "d" },
    { ...cycle.diagrams[1].edges[0], from: "d", to: "e" },
    { ...cycle.diagrams[1].edges[0], from: "e", to: "b" },
  ];
  assert.throws(() => validate(cycle), /孤立循环/);
});
test("diagrams stay scoped to their original document and source revision; legacy batches still work", () => {
  const batch = validate(diagramBatch());
  const sources = ["one", "two"].map((id) => ({
    doc: { id, title: id, sha256: id + "-hash" },
    analysis: { sourceKind: "指南/共识", batches: [batch] },
  }));
  const graph = assembleKnowledgeGraph(sources);
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.diagrams.length, 4);
  assert.equal(new Set(graph.diagrams.map((d) => d.id)).size, 4);
  assert.ok(graph.diagrams.every((d) => d.sourceHash === d.docId + "-hash"));
  assert.deepEqual(assembleKnowledgeGraph(sources).diagrams, graph.diagrams);
  const legacy = diagramBatch();
  delete legacy.diagrams;
  assert.deepEqual(validate(legacy).diagrams, []);
});
