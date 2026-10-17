import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.mjs";
import { Store } from "../server/store.mjs";
import { GuidelineLibrary, knowledgeTools } from "../server/medical/guidelines.mjs";

test("chat carries selected attachments through creation, ingestion and reconciliation", async t => {
  let step = 0, sourceId, report;
  const call = (name, args) => ({ message: { role: "assistant", content: null, tool_calls: [{ id: `call-${step}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } });
  const f = await fixture(t, { provider: {
    apiKey: "synthetic", model: "synthetic",
    async complete(messages, definitions) {
      assert.ok(definitions.some(d => d.function.name === "knowledge_collection_save"));
      assert.ok(definitions.some(d => d.function.name === "knowledge_import_status"));
      step++;
      if (step === 1) return call("knowledge_collection_save", { name: "对话建库", description: "合成资料", whenToUse: "测试", limitations: "非临床", expectedRevision: 0 });
      if (step === 2) return call("knowledge_ingest", { title: "测试材料", sourceId, collection: "对话建库" });
      if (step === 3) return call("knowledge_import_status", { collection: "对话建库" });
      report = JSON.parse(messages.filter(m => m.role === "tool").at(-1).content);
      return { message: { role: "assistant", content: "已创建对话建库并保存 1 份资料，当前仅支持全文检索。" } };
    },
  } });
  // Organization is a separate background model workflow, outside this protocol test.
  f.server.guidelines.organizeIngest = undefined;
  f.server.guidelines.embedder = null;
  const session = await f.session("建库链路");
  const added = await f.json(`/api/sessions/${session.id}/files`, "POST", { name: "资料.txt", text: "用于验证附件上下文的合成资料。" });
  sourceId = added.data.id;
  const response = await f.chat(session.id, "创建对话建库并导入这份附件", { mode: "model", externalConsent: true, fileIds: [sourceId] });
  assert.equal(response.status, 200);
  assert.equal(report.summary.documentCount, 1);
  assert.equal(report.attachments.checkedCount, 1);
  assert.equal(report.attachments.allPresent, true);
  assert.equal(report.collection.needsDescription, false);
  assert.deepEqual(report.summary.indexing, { keyword_only: 1 });
});

test("assistant creates an empty library and edits its description with revision protection", async t => {
  const f = await fixture(t);
  const save = f.server.runtime.toolPlugins.get("knowledge_collection_save");
  const status = f.server.runtime.toolPlugins.get("knowledge_import_status");
  assert.ok(save && status);
  const input = { name: "教学参考", description: "合成教学材料", whenToUse: "软件测试", limitations: "非临床资料", expectedRevision: 0 };
  const result = await save.execute(input);
  assert.equal(result.saved, true);
  const url = "/api/knowledge/collections";
  let collection = (await f.json(url)).data.collections.find(c => c.name === input.name);
  assert.equal(collection.documentCount, 0);
  assert.equal(collection.needsDescription, false);
  assert.equal(collection.description, input.description);
  assert.equal(collection.revision, 1);
  assert.throws(() => save.execute({ ...input, description: "过期覆盖" }), { code: "REVISION_CONFLICT" });
  await save.execute({ ...input, description: "补充说明", expectedRevision: 1 });
  collection = (await f.json(url)).data.collections.find(c => c.name === input.name);
  assert.equal(collection.description, "补充说明");
  assert.equal(collection.revision, 2);
  assert.equal(status.execute({ collection: input.name }).attachments.allPresent, null);
  assert.throws(() => status.execute({ collection: "不存在" }), { code: "NOT_FOUND" });
});

test("import reconciliation detects missing and duplicate attachments within the selected library", async t => {
  const store = new Store(":memory:"); t.after(() => store.close());
  let embedded = 0;
  const lib = new GuidelineLibrary(store, {
    model: "test", available: () => true, status: () => ({}),
    embed: async texts => { embedded += texts.length; return texts.map(() => [1, 0]); },
  }, { upsertDoc: async () => {} });
  const tools = new Map(knowledgeTools(lib).map(tool => [tool.definition.function.name, tool]));
  const source = { id: "a", name: "相同名称.pdf", text: "[PDF 第 1 页]\n合成测试资料", extraction: { pageCount: 1, emptyPages: [] } };
  const missing = { id: "b", name: source.name, text: "[PDF 第 1 页]\n另一份合成资料" };
  const context = { sources: [source, { ...source, id: "copy", name: "副本.pdf" }, missing, { id: "empty", name: "不可读.pdf", text: "" }, { id: "input", name: "本轮输入", text: "建库" }] };
  const ingest = tools.get("knowledge_ingest");
  const doc = await ingest.execute({ title: "合成资料", sourceId: "a", collection: "目标库" }, context);
  await lib.addDocument({ title: "其他库资料", text: missing.text, collection: "其他库" });
  lib.updateMetadata(doc.id, { expectedRevision: 0, reviewStatus: "reviewed", reviewNote: "合成测试核对" });
  const before = embedded;
  const duplicate = await ingest.execute({ title: "不应覆盖", sourceId: "copy", collection: "目标库" }, context);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.id, doc.id);
  assert.equal(duplicate.title, "合成资料");
  assert.equal(duplicate.reviewStatus, "reviewed");
  assert.equal(embedded, before, "duplicate imports must not re-embed");
  const status = tools.get("knowledge_import_status");
  lib.organizationStatus = () => [{ status: "interrupted" }];
  const report = status.execute({ collection: "目标库" }, context);
  assert.equal(report.summary.documentCount, 1);
  assert.equal(report.summary.chunkCount, doc.chunkCount);
  assert.equal(report.summary.recordedEmbeddedChunks, doc.chunkCount);
  assert.deepEqual(report.summary.indexing, { ready: 1 });
  assert.deepEqual(report.summary.coverage, { complete: 1 });
  assert.equal(report.organization[0].status, "interrupted");
  assert.equal(report.attachments.checkedCount, 4);
  assert.equal(report.attachments.presentCount, 2);
  assert.equal(report.attachments.missingCount, 1);
  assert.equal(report.attachments.unreadableCount, 1);
  assert.equal(report.attachments.duplicateCount, 1);
  assert.equal(report.attachments.allPresent, false);
  assert.equal(report.attachments.items.find(s => s.sourceId === "b").docId, null);
  assert.equal(status.execute({ collection: "目标库", sourceIds: ["a", "copy"] }, context).attachments.allPresent, true);
  assert.throws(() => status.execute({ collection: "目标库", sourceIds: ["foreign"] }, context), { code: "SOURCE_NOT_FOUND" });
  lib.embedder.model = "new-model";
  assert.equal(status.execute({ collection: "目标库" }).summary.staleDocumentCount, 1);
  const row = lib.docRow(doc.id); row.indexing = { status: "failed", embedded: 0 };
  store.db.prepare("UPDATE guideline_docs SET data=? WHERE id=?").run(JSON.stringify(row), doc.id);
  const failed = status.execute({ collection: "目标库" }, context);
  assert.equal(failed.attachments.presentCount, 2, "saved text remains present when indexing fails");
  assert.deepEqual(failed.summary.indexing, { failed: 1 });
  assert.equal(failed.summary.recordedEmbeddedChunks, 0);
});
