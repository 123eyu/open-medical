import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.mjs";
import {
  organizerProvider,
  library,
  waitJob,
  upload,
} from "./knowledge-organization-helpers.mjs";
import { validateKnowledgeBatch } from "../server/medical/knowledge-organizer.mjs";
import { assembleKnowledgeGraph } from "../server/medical/knowledge-graph.mjs";
import { graphSlice, layoutGraph } from "../src/knowledge-graph-model.mjs";

const quote =
  "合成药甲仅用于成人合成病，禁用于合成高危人群；合成检查是诊断依据。";
const evidence = { quote, startLine: 1, endLine: 1 };
const medicalBatch = () => ({
  title: "合成医学资料",
  summary: "软件测试资料，不用于诊疗。",
  nodes: [
    {
      label: "合成药甲",
      type: "药物",
      ...evidence,
      attributes: [{ field: "适应证", value: "成人合成病", ...evidence }],
    },
    { label: "合成病", type: "疾病", ...evidence },
    { label: "合成高危人群", type: "人群", ...evidence },
    { label: "合成检查", type: "检查", ...evidence },
    { label: "诊断依据", type: "诊断", ...evidence },
  ],
  relations: [
    {
      from: "合成药甲",
      to: "合成病",
      relation: "仅用于成人",
      relationType: "适应证",
      assertion: "条件性",
      qualifiers: [{ field: "适用人群", value: "成人", ...evidence }],
      ...evidence,
    },
    {
      from: "合成药甲",
      to: "合成高危人群",
      relation: "禁用于",
      relationType: "禁忌",
      assertion: "否定",
      ...evidence,
    },
    {
      from: "合成检查",
      to: "诊断依据",
      relation: "是诊断依据",
      relationType: "诊断依据",
      assertion: "明确陈述",
      ...evidence,
    },
  ],
});
test("medical entities keep indications, contraindications and grounded qualifiers in guideline sources", () => {
  const result = validateKnowledgeBatch(
    medicalBatch(),
    { text: quote, startLine: 1, endLine: 1 },
    "指南/共识",
  );
  assert.equal(result.nodes[0].attributes[0].value, "成人合成病");
  assert.equal(result.relations[0].qualifiers[0].value, "成人");
  assert.equal(result.relations[1].assertion, "否定");
  const bad = medicalBatch();
  bad.relations[0].qualifiers[0].value = "儿童";
  assert.throws(
    () =>
      validateKnowledgeBatch(
        bad,
        { text: quote, startLine: 1, endLine: 1 },
        "指南/共识",
      ),
    (e) => e.code === "KNOWLEDGE_CITATION",
  );
  const unsupported = medicalBatch();
  unsupported.nodes[1].attributes = [
    { field: "给药途径", value: "成人", ...evidence },
  ];
  assert.throws(
    () =>
      validateKnowledgeBatch(unsupported, {
        text: quote,
        startLine: 1,
        endLine: 1,
      }),
    /字段不适用/,
  );
});
test("merge retains conflicting source claims, normalizes names, does not collapse formulations or infer edges", () => {
  const a = medicalBatch(),
    b = medicalBatch();
  b.nodes[0].label = "合成药甲片";
  b.nodes[0].aliases = ["合成药甲"];
  b.relations = b.relations.map((e) => ({
    ...e,
    from: e.from === "合成药甲" ? "合成药甲片" : e.from,
  }));
  const sources = [
    {
      doc: { id: "a", title: "来源甲", sha256: "hash-a" },
      analysis: { sourceKind: "指南/共识", batches: [a, a] },
    },
    {
      doc: { id: "b", title: "来源乙", sha256: "hash-b" },
      analysis: { sourceKind: "药品说明书", batches: [b] },
    },
  ];
  const graph = assembleKnowledgeGraph(sources);
  assert.equal(graph.nodes.length, 6);
  assert.equal(graph.edges.length, 6);
  assert.equal(
    graph.nodes.find((n) => n.label === "合成病").evidence.length,
    2,
  );
  assert.equal(graph.nodes.find((n) => n.label === "合成药甲").degree, 2);
  assert.ok(
    graph.edges.every((e) => e.evidenceKind === "原文提取" && e.sourceHash),
  );
  assert.equal(graph.communities.length, 2);
});
test("search finds aliases outside initial graph limit; all visible links have endpoints", () => {
  const nodes = Array.from({ length: 180 }, (_, i) => ({
    id: String(i),
    label: `概念${i}`,
    type: "疾病",
    degree: i,
    aliases: i === 0 ? ["特定别名"] : [],
  }));
  const graph = {
    nodes,
    edges: [{ from: "0", to: "1", relationType: "诊断依据" }],
  };
  assert.equal(graphSlice(graph).nodes.length, 90);
  assert.equal(graphSlice(graph, { query: "特定别名" }).nodes[0].id, "0");
  const selected = graphSlice(graph, { selected: "0" });
  assert.equal(selected.nodes.length, 2);
  const positions = layoutGraph(selected.nodes, selected.edges);
  assert.ok(
    positions.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
  );
  assert.deepEqual(positions, layoutGraph(selected.nodes, selected.edges));
});
test("collection build is scoped, idempotent and incremental; retired documents are excluded", async (t) => {
  const f = await fixture(t, { provider: organizerProvider });
  const name = await library(f, "项目甲"),
    other = await library(f, "项目乙");
  for (const [collection, title] of [
    [name, "甲"],
    [other, "乙"],
  ])
    await f.server.guidelines.addDocument({
      collection,
      title,
      text: "合成疾病讨论合成检查。",
    });
  assert.equal(
    (await f.json("/api/knowledge/map/build", "POST", { collection: name }))
      .status,
    412,
  );
  assert.equal(
    (
      await f.json("/api/knowledge/map/build", "POST", {
        externalConsent: true,
      })
    ).status,
    400,
  );
  const first = await f.json("/api/knowledge/map/build", "POST", {
    collection: name,
    externalConsent: true,
  });
  assert.equal(first.status, 202);
  assert.equal(first.data.jobs.length, 1);
  const again = await f.json("/api/knowledge/map/build", "POST", {
    collection: name,
    externalConsent: true,
  });
  if (again.data.jobs.length)
    assert.equal(again.data.jobs[0].id, first.data.jobs[0].id);
  assert.equal((await waitJob(f, first.data.jobs[0].id)).status, "completed");
  assert.equal(f.server.knowledgeOrganizer.graph(name).completedDocuments, 1);
  assert.equal(f.server.knowledgeOrganizer.graph(other).nodes.length, 0);
  const repeat = await f.json("/api/knowledge/map/build", "POST", {
    collection: name,
    externalConsent: true,
  });
  assert.equal(repeat.data.jobs.length, 0);
  assert.equal(repeat.data.skipped, 1);
  await f.server.guidelines.addDocument({
    collection: name,
    title: "新增资料",
    text: "另一份合成疾病讨论合成检查。",
  });
  const increment = (
    await f.json("/api/knowledge/map/build", "POST", {
      collection: name,
      externalConsent: true,
    })
  ).data;
  assert.equal(increment.jobs.length, 1);
  assert.equal(increment.skipped, 1);
  await waitJob(f, increment.jobs[0].id);
  const doc = f.server.guidelines.list({ collection: name })[0];
  f.server.guidelines.updateMetadata(doc.id, {
    expectedRevision: doc.revision || 0,
    reviewStatus: "retired",
  });
  assert.equal(f.server.knowledgeOrganizer.graph(name).documentCount, 1);
});
test("failed replacements keep the previous graph and resume without rebuilding completed documents", async (t) => {
  const f = await fixture(t, { provider: organizerProvider }),
    name = await library(f);
  const doc = await f.server.guidelines.addDocument({
    collection: name,
    title: "保留结果",
    text: "合成疾病讨论合成检查。",
  });
  const organizer = f.server.knowledgeOrganizer;
  const initial = await organizer.buildGraph({
    collection: name,
    externalConsent: true,
  });
  await waitJob(f, initial.jobs[0].id);
  const old = organizer.analysis(doc.id);
  old.extractionVersion = 1;
  f.server.store.db
    .prepare("UPDATE knowledge_analysis SET data=? WHERE doc_id=?")
    .run(JSON.stringify(old), doc.id);
  const original = organizer.organizeBatch;
  organizer.organizeBatch = async () => {
    throw new Error("模拟服务暂时不可用");
  };
  const next = await organizer.buildGraph({
    collection: name,
    externalConsent: true,
  });
  assert.equal((await waitJob(f, next.jobs[0].id)).status, "failed");
  assert.equal(organizer.graph(name).nodes.length, 2);
  assert.equal(organizer.graph(name).failedDocuments, 1);
  assert.equal(organizer.list(name)[0].previousAnalysis, undefined);
  organizer.organizeBatch = original;
  const retry = await organizer.buildGraph({
    collection: name,
    externalConsent: true,
  });
  assert.equal(retry.jobs[0].id, next.jobs[0].id);
  assert.equal((await waitJob(f, retry.jobs[0].id)).status, "completed");
  assert.equal(organizer.graph(name).pendingDocuments, 0);
});
test("model configuration errors do not enqueue a collection", async (t) => {
  const f = await fixture(t),
    name = await library(f);
  await f.server.guidelines.addDocument({
    collection: name,
    title: "资料",
    text: "合成疾病讨论合成检查。",
  });
  const result = await f.json("/api/knowledge/map/build", "POST", {
    collection: name,
    externalConsent: true,
  });
  assert.equal(result.status, 409);
  assert.equal(f.server.knowledgeOrganizer.list(name).length, 0);
});

test("medical validation separates treatment thresholds from diagnosis and discouragement from contraindications", () => {
  const value = medicalBatch();
  value.nodes.push({
    label: "合成指标",
    type: "指标",
    ...evidence,
    attributes: [
      {
        field: "诊断阈值",
        value: "成人",
        quote: "合成药甲仅用于成人合成病",
        startLine: 1,
        endLine: 1,
      },
    ],
  });
  assert.throws(
    () =>
      validateKnowledgeBatch(value, { text: quote, startLine: 1, endLine: 1 }),
    /治疗选择的数值/,
  );
  const conditional = medicalBatch();
  conditional.relations[0].qualifiers = [];
  assert.throws(
    () =>
      validateKnowledgeBatch(conditional, {
        text: quote,
        startLine: 1,
        endLine: 1,
      }),
    /条件性关系必须/,
  );
  const text = "成人不推荐使用合成药甲。";
  const contraindication = {
    title: "测试",
    summary: "测试字段",
    nodes: [
      {
        label: "合成药甲",
        type: "药物",
        quote: text,
        startLine: 1,
        endLine: 1,
        attributes: [
          {
            field: "禁忌",
            value: "不推荐使用",
            quote: text,
            startLine: 1,
            endLine: 1,
          },
        ],
      },
    ],
    relations: [],
  };
  assert.throws(
    () =>
      validateKnowledgeBatch(contraindication, {
        text,
        startLine: 1,
        endLine: 1,
      }),
    /不推荐不等于禁忌/,
  );
  contraindication.nodes[0].attributes[0].field = "不推荐情形";
  assert.equal(
    validateKnowledgeBatch(contraindication, { text, startLine: 1, endLine: 1 })
      .nodes[0].attributes[0].value,
    "不推荐使用",
  );
});

test("graph import uses stored whitespace-normalized text and matching source lines", async (t) => {
  const f = await fixture(t, {
    provider: organizerProvider,
    knowledgeOrganizerOptions: {
      extract: async () => [
        { text: "\n  合成疾病讨论合成检查。\n\n", kind: "text" },
      ],
    },
  });
  const collection = await library(f);
  const result = await upload(
    f,
    collection,
    "空白测试.txt",
    "输入交由合成提取器处理",
  );
  const job = await waitJob(f, result.data.id);
  assert.equal(job.status, "completed", job.error);
  const organizer = f.server.knowledgeOrganizer;
  const doc = f.server.guidelines.docRow(job.docId);
  assert.equal(organizer.analysis(doc.id).sourceHash, doc.sha256);
  assert.equal(organizer.graph(collection).edges[0].startLine, 1);
  assert.equal(organizer.detail(doc.id).locators[0].startLine, 1);
  assert.equal(organizer.detail(doc.id).locators[0].endLine, 1);
  assert.equal(
    (await organizer.buildGraph({ collection, externalConsent: true })).skipped,
    1,
  );
});
