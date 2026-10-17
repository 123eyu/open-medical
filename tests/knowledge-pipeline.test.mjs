import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { Store } from "../server/store.mjs";
import {
  GuidelineLibrary,
  knowledgeTools,
} from "../server/medical/guidelines.mjs";
import {
  knowledgeChunks,
  sourceCoverage,
} from "../server/medical/knowledge-content.mjs";
import { indexKnowledgeDoc } from "../server/medical/knowledge-index.mjs";
import { validateKnowledgeBatch } from "../server/medical/knowledge-organizer.mjs";
import {
  extractKnowledgeWorkbook,
  extractKnowledgeDelimited,
} from "../server/medical/knowledge-tabular.mjs";
import { fixture } from "./helpers.mjs";
import { library, waitJob } from "./knowledge-organization-helpers.mjs";

const memory = (t) => {
  const s = new Store(":memory:");
  t.after(() => s.close());
  return s;
};
const stubEmbedder = {
  model: "pipeline-test",
  available: () => true,
  status: () => ({ enabled: true }),
  embed: async (texts) => texts.map(() => [1, 0]),
};

test("attachment ingestion cannot substitute the read preview for the complete source", async (t) => {
  const lib = new GuidelineLibrary(memory(t));
  const ingest = knowledgeTools(lib).find(
    (p) => p.definition.function.name === "knowledge_ingest",
  );
  const source = {
    id: "attachment-1",
    name: "source.pdf",
    text: "[PDF 第 1 页]\n封面\n[PDF 第 2 页]\n末页独有内容",
    extraction: { pageCount: 2, emptyPages: [] },
  };
  const context = { sources: [source] };
  await assert.rejects(
    () => ingest.execute({ title: "资料", text: "封面" }, context),
    (e) => e.code === "SOURCE_REQUIRED",
  );
  await assert.rejects(
    () => ingest.execute({ title: "资料", sourceId: "other" }, context),
    (e) => e.code === "SOURCE_NOT_FOUND",
  );
  const doc = await ingest.execute(
    { title: "资料", sourceId: source.id },
    context,
  );
  assert.equal(lib.get(doc.id).text, source.text);
  assert.equal(doc.coverage.status, "complete");
  assert.equal(doc.coverage.originalRetained, false);
  const excerpt = await ingest.execute(
    { title: "摘录", text: "封面", excerpt: true },
    context,
  );
  assert.equal(excerpt.coverage.status, "excerpt");
  assert.equal(
    sourceCoverage("[PDF 第 1 页]\n封面", {
      trusted: true,
      extraction: { pageCount: 2, emptyPages: [] },
    }).status,
    "needs_review",
  );
});

test("checkpointed indexing resumes successful batches after failure and process restart", async (t) => {
  const store = memory(t);
  let calls = 0,
    fail = true,
    published = [];
  const embedder = {
    ...stubEmbedder,
    embed: async (inputs) => {
      calls++;
      if (fail && calls === 2)
        throw Object.assign(Error("offline"), {
          code: "EMBEDDING_UNAVAILABLE",
        });
      return inputs.map(() => [1, 0]);
    },
  };
  const vectorStore = {
    upsertDoc: async (_id, _model, rows) => {
      published = rows;
    },
  };
  let lib = new GuidelineLibrary(store, embedder, vectorStore);
  const text = Array.from(
    { length: 36 },
    (_, i) => `## Chapter ${i}\n${"内容".repeat(200)}`,
  ).join("\n");
  const doc = await lib.addDocument({ title: "批次恢复", text });
  assert.equal(doc.indexing.status, "failed");
  assert.equal(doc.indexing.processed, 16);
  assert.equal(published.length, 0);
  assert.equal(doc.indexing.error.code, "EMBEDDING_UNAVAILABLE");
  fail = false;
  calls = 0;
  lib = new GuidelineLibrary(store, embedder, vectorStore);
  await indexKnowledgeDoc(lib, doc.id);
  assert.equal(calls, 2);
  assert.equal(published.length, 36);
  assert.equal(lib.get(doc.id).indexing.status, "ready");
  await indexKnowledgeDoc(lib, doc.id);
  assert.equal(calls, 2);
});

test("section and table chunks preserve raw source and inherit headings without fake line numbers", () => {
  const text =
    "[PDF 第 3 页]\n# Title\n## Scope\n| Item | Unit |\n| --- | --- |\n" +
    Array.from({ length: 15 }, (_, i) => `| entry${i} | mg/L |`).join("\n");
  const chunks = knowledgeChunks(text, { maxChars: 100 });
  const row = chunks.find((c) => c.text.includes("entry14"));
  assert.equal(row.metadata.page, 3);
  assert.ok(row.metadata.headings.includes("Scope"));
  assert.match(row.embeddingText, /Item \| Unit/);
  assert.equal(
    text
      .split("\n")
      .slice(row.startLine - 1, row.endLine)
      .join("\n"),
    row.text,
  );
});

test("workbooks preserve worksheets, row headers, cell addresses, formula gaps and hidden content", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("实验室A");
  sheet.addRow(["项目", "单位", "参考区间"]);
  sheet.addRow(["合成指标甲", "mg/L", "4–8"]);
  sheet.addRow(["无缓存公式", { formula: "1+1" }]);
  const hidden = book.addWorksheet("实验室B", { state: "hidden" });
  hidden.addRow(["项目", "单位", "参考区间"]);
  hidden.addRow(["合成指标甲", "mmol/L", "1–2"]);
  const parts = await extractKnowledgeWorkbook(await book.xlsx.writeBuffer());
  assert.match(parts[1].text, /B2【单位】=mg\/L/);
  assert.match(parts[2].text, /公式无缓存结果/);
  assert.ok(parts.at(-1).hidden);
  assert.equal(parts.at(-1).sheet, "实验室B");
  assert.match(parts.at(-1).text, /mmol\/L/);
  const row = knowledgeChunks(parts[1].text).find((c) =>
    c.text.includes("mg/L"),
  );
  assert.equal(row.metadata.row, 2);
  assert.equal(row.metadata.sheet, "实验室A");
  const csv = extractKnowledgeDelimited(
    '问题,回答\n"含逗号,的问题","跨行\n回答"\n',
    "问答.csv",
  );
  assert.equal(csv.length, 2);
  assert.match(csv[1].text, /【回答】=跨行\n回答/);
});

test("medical attributes require literal evidence and may follow the entity type across source profiles", () => {
  const quote = "合成指标的单位 mg/L，参考区间 4–8，仅用于软件测试。";
  const batch = { text: quote, startLine: 1, endLine: 1 };
  const value = {
    title: "检验",
    summary: "测试",
    nodes: [
      {
        label: "合成指标",
        type: "指标",
        quote,
        startLine: 1,
        endLine: 1,
        attributes: [
          { field: "单位", value: "mg/L", quote, startLine: 1, endLine: 1 },
        ],
      },
    ],
    relations: [],
  };
  assert.equal(
    validateKnowledgeBatch(value, batch, "检验/检查参考").nodes[0].attributes[0]
      .value,
    "mg/L",
  );
  assert.equal(
    validateKnowledgeBatch(value, batch, "论文/研究").nodes[0].attributes[0].value,
    "mg/L",
  );
  value.nodes[0].attributes[0].field = "给药途径";
  assert.throws(() => validateKnowledgeBatch(value, batch, "论文/研究"), /字段不适用/);
  value.nodes[0].attributes[0].field = "单位";
  value.nodes[0].attributes[0].value = "mmol/L";
  assert.throws(
    () => validateKnowledgeBatch(value, batch, "检验/检查参考"),
    /逐字来自/,
  );
});

test("vector retrieval filters the target collection before top-k and excludes failed documents", async (t) => {
  const f = await fixture(t, { embedder: stubEmbedder });
  const lib = f.server.guidelines;
  for (let i = 0; i < 24; i++)
    await lib.addDocument({
      title: `noise-${i}`,
      collection: "noise",
      text: `foreign material ${i}`,
    });
  const target = await lib.addDocument({
    title: "target",
    collection: "target",
    text: "target content",
  });
  const result = await lib.search({
    query: "unrelated semantic query",
    collection: "target",
  });
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].docId, target.id);
  const row = lib.docRow(target.id);
  row.indexing.status = "failed";
  lib.store.db
    .prepare("UPDATE guideline_docs SET data=? WHERE id=?")
    .run(JSON.stringify(row), target.id);
  assert.equal(
    (
      await lib.search({
        query: "unrelated semantic query",
        collection: "target",
      })
    ).hits.length,
    0,
  );
});

test("raw Excel upload builds a searchable library without a chat model and retains the original", async (t) => {
  const f = await fixture(t, { embedder: stubEmbedder });
  const collection = await library(f, "检验参考测试");
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("院内参考");
  sheet.addRow(["项目", "标本", "单位", "参考范围"]);
  sheet.addRow(["测试指标", "血清", "mg/L", "4–8"]);
  const params = new URLSearchParams({
    collection,
    name: "reference.xlsx",
    sourceKind: "检验/检查参考",
    indexOnly: "true",
    title: "院内检验表",
  });
  const response = await fetch(
    f.origin + "/api/knowledge/organization?" + params,
    {
      method: "POST",
      headers: {
        "x-medical-token": f.server.token,
        "x-knowledge-consent": "true",
      },
      body: await book.xlsx.writeBuffer(),
    },
  );
  assert.equal(response.status, 202);
  const submitted = await response.json();
  const job = await waitJob(f, submitted.id);
  assert.equal(job.status, "completed", job.error);
  const doc = f.server.guidelines.get(job.docId);
  assert.equal(doc.kind, "检验");
  assert.equal(doc.coverage.status, "complete");
  assert.ok(doc.coverage.originalRetained);
  assert.equal(doc.indexing.status, "ready");
  const hits = await f.server.guidelines.search({
    query: "测试指标",
    collection,
    localOnly: true,
  });
  assert.equal(hits.hits[0].location.sheet, "院内参考");
  assert.equal(hits.hits[0].location.row, 2);
  const read = f.server.guidelines.readLines(
    doc.id,
    hits.hits[0].startLine,
    hits.hits[0].endLine,
  );
  assert.match(read.lines.join("\n"), /C2【单位】=mg\/L/);
});

test("long documents accepted by the parser are also accepted by the library", async (t) => {
  const lib = new GuidelineLibrary(memory(t));
  const doc = await lib.addDocument({
    title: "长文",
    text: "a".repeat(500001),
  });
  assert.equal(lib.get(doc.id).text.length, 500001);
});
