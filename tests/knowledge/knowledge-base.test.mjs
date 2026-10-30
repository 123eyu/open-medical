import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../server/store.mjs";
import { GuidelineLibrary, knowledgeTools } from "../../server/medical/guidelines.mjs";
import { KnowledgeOrganizer } from "../../server/medical/knowledge-organizer.mjs";
import { MEDICAL_GRAPH_VERSION } from "../../shared/medical-graph.mjs";
import { verifyKnowledgeAnswer } from "../../server/medical/knowledge-answer.mjs";
import { configureAssessmentTools, assessmentAnswer } from "../../server/medical/assessment-tools.mjs";
import { renderKnowledgeDigest } from "../../server/medical/medical-workspace-domain.mjs";
import { ToolRegistry } from "../../server/core/tool-registry.mjs";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

const GUIDELINE = `# 2型糖尿病诊疗指南
## 药物治疗
二甲双胍是2型糖尿病患者控制高血糖的一线用药。
若无禁忌证，二甲双胍应一直保留在治疗方案中。
eGFR<30 ml/min/1.73m2 的患者禁用二甲双胍。
## 血糖监测
HbA1c 控制目标一般为 <7.0%。
SGLT2抑制剂可用于合并动脉粥样硬化性心血管疾病的患者。`;

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "omw-kb-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new Store(":memory:");
  const library = new GuidelineLibrary(store);
  const organizer = new KnowledgeOrganizer({ store, library, root, getProvider: () => null, getTranscription: () => null });
  library.graphEvidence = (query, ids, collection) => organizer.searchEvidence(query, ids, collection);
  const tools = Object.fromEntries(knowledgeTools(library).map((tool) => [tool.definition.function.name, tool]));
  return { store, library, organizer, tools };
}

function saveAnalysis(store, doc, nodes, relations) {
  store.db.prepare("INSERT INTO knowledge_analysis VALUES(?,?) ON CONFLICT(doc_id) DO UPDATE SET data=excluded.data").run(doc.id, JSON.stringify({
    docId: doc.id, sourceKind: "指南/共识", sourceHash: doc.sha256, extractionVersion: MEDICAL_GRAPH_VERSION,
    updatedAt: new Date().toISOString(), batches: [{ startLine: 1, endLine: 8, nodes, relations }],
  }));
}

const node = (label, type, line, quote, aliases = []) => ({ label, type, aliases, quote, startLine: line, endLine: line });

test("知识库：入库后可检索、按行读取并核验引用", async (t) => {
  const { library, tools } = setup(t);
  const doc = await library.addDocument({ title: "糖尿病指南", text: GUIDELINE, collection: "糖尿病" });
  const hit = await tools.knowledge_search.execute({ query: "二甲双胍 禁忌", collection: "糖尿病" });
  assert.equal(hit.count, 1);
  assert.ok(hit.hits[0].startLine <= 5 && hit.hits[0].endLine >= 5);
  const sentence = await tools.knowledge_search.execute({ query: "肾功能不全能用二甲双胍吗", collection: "糖尿病" });
  assert.equal(sentence.count, 1, "自然语言整句仍能通过双字词命中");
  const read = tools.knowledge_read.execute({ docId: doc.id, startLine: 1, endLine: 8 });
  assert.match(read.numberedText, /L5: eGFR<30/);
  const cite = tools.knowledge_cite.execute({ docId: doc.id, quote: "eGFR<30 ml/min/1.73m2 的患者禁用二甲双胍。", startLine: 1, endLine: 8 });
  assert.equal(cite.startLine, 5);
  assert.match(cite.citation, /^\[糖尿病指南 · L5–5\]\(\/\?view=knowledge&knowledgeDoc=/);
});

test("知识库：单个常见双字词不算命中，避免噪声结果", async (t) => {
  const { library, tools } = setup(t);
  await library.addDocument({ title: "糖尿病指南", text: GUIDELINE, collection: "糖尿病" });
  const noise = await tools.knowledge_search.execute({ query: "糖化血红蛋白目标", collection: "糖尿病" });
  assert.equal(noise.count, 0, "只共享「目标」两个字不应命中 HbA1c 段落");
});

test("知识库：资料列表与知识库清单不读取正文，且排除已停用资料", async (t) => {
  const { library, store } = setup(t);
  const doc = await library.addDocument({ title: "糖尿病指南", text: GUIDELINE, collection: "糖尿病" });
  await library.addDocument({ title: "旧版", text: "旧版正文 二甲双胍", collection: "旧库" });
  const [listed] = library.list({ collection: "糖尿病" });
  assert.equal(listed.id, doc.id);
  assert.equal(listed.text, undefined);
  assert.equal(listed.chunkCount > 0, true);
  const old = library.list({ collection: "旧库" })[0];
  const row = JSON.parse(store.db.prepare("SELECT data FROM guideline_docs WHERE id=?").get(old.id).data);
  store.db.prepare("UPDATE guideline_docs SET data=? WHERE id=?").run(JSON.stringify({ ...row, reviewStatus: "retired" }), old.id);
  library.saveCollection("糖尿病", { description: "内分泌指南", whenToUse: "糖尿病用药与监测", limitations: "", expectedRevision: 0 });
  const digest = library.collectionDigest();
  assert.deepEqual(digest.map((item) => item.name), ["糖尿病"], "空库和只有停用资料的库不进入清单");
  assert.equal(digest[0].documentCount, 1);
  assert.equal(digest[0].whenToUse, "糖尿病用药与监测");
  const prompt = renderKnowledgeDigest(() => digest);
  assert.match(prompt, /本机知识库/);
  assert.match(prompt, /"糖尿病"/);
  assert.equal(renderKnowledgeDigest(() => []), "", "没有资料时不占用提示词");
  assert.equal(renderKnowledgeDigest(() => { throw new Error("db closed"); }), "");
});

test("知识图谱：原文别名帮助检索，图谱变化后缓存失效", async (t) => {
  const { library, store, organizer, tools } = setup(t);
  const doc = await library.addDocument({ title: "糖尿病指南", text: GUIDELINE, collection: "糖尿病" });
  assert.equal((await tools.knowledge_search.execute({ query: "metformin", collection: "糖尿病" })).count, 0);
  const first = "二甲双胍是2型糖尿病患者控制高血糖的一线用药。";
  saveAnalysis(store, doc, [node("二甲双胍", "药物", 3, first, ["metformin"]), node("2型糖尿病", "疾病", 3, first)],
    [{ from: "二甲双胍", to: "2型糖尿病", relation: "一线用药", relationType: "推荐治疗", quote: first, startLine: 3, endLine: 3 }]);
  const viaGraph = await tools.knowledge_search.execute({ query: "metformin", collection: "糖尿病" });
  assert.equal(viaGraph.count, 1);
  assert.equal(viaGraph.hits[0].matchedVia, "graph");
  const graph = organizer.graph("糖尿病");
  assert.equal(organizer.graph("糖尿病"), graph, "输入未变化时复用已组装的图谱");
  assert.equal(graph.nodes.length, 2);
  const contra = "eGFR<30 ml/min/1.73m2 的患者禁用二甲双胍。";
  saveAnalysis(store, doc, [node("二甲双胍", "药物", 3, first, ["metformin"]), node("2型糖尿病", "疾病", 3, first), node("肾功能不全", "禁忌", 5, contra)],
    [{ from: "二甲双胍", to: "肾功能不全", relation: "禁用", relationType: "禁忌", quote: contra, startLine: 5, endLine: 5 }]);
  const updated = organizer.graph("糖尿病");
  assert.notEqual(updated, graph);
  assert.equal(updated.nodes.length, 3);
  assert.equal(organizer.graph("其他库").nodes.length, 0, "图谱按知识库隔离");
});

test("回答核验：已保存的治疗方案复核不再要求模型正文另附知识库链接", () => {
  const messages = [
    { role: "user", name: "runtime_task_input", content: "评估方案" },
    { role: "assistant", tool_calls: [{ id: "r", function: { name: "knowledge_read" } }] },
    { role: "tool", tool_call_id: "r", content: JSON.stringify({ lines: ["x"] }) },
    { role: "assistant", content: "复核完成" },
  ];
  assert.throws(() => verifyKnowledgeAnswer({ messages }), /知识库引用核验/);
  const withDraft = [...messages.slice(0, 3),
    { role: "assistant", tool_calls: [{ id: "d", function: { name: "draft_treatment_review" } }] },
    { role: "tool", tool_call_id: "d", content: JSON.stringify({ matches: [{ sourceId: "m1" }] }) },
    { role: "assistant", content: "复核完成" }];
  assert.doesNotThrow(() => verifyKnowledgeAnswer({ messages: withDraft }));
});

test("治疗方案复核：可读取知识库原文并作为出处，未读范围被拒绝", async (t) => {
  const { library, tools } = setup(t);
  const doc = await library.addDocument({ title: "糖尿病指南", text: GUIDELINE, collection: "糖尿病" });
  const material = { id: "m1", name: "出院小结.txt", hash: "h1", text: "诊断：2型糖尿病\n用药：二甲双胍 0.5g bid\neGFR 25" };
  const workspace = { patientId: null, materials: [material] };
  const run = { artifacts: [], runtimeState: { observations: [] } };
  const registry = new ToolRegistry();
  const fn = (name, properties = {}, required = []) => ({ type: "function", function: { name, description: name, parameters: { type: "object", properties, required, additionalProperties: false } } });
  registry.register({ definition: fn("read_source", { sourceId: { type: "string" }, startLine: { type: "integer" }, endLine: { type: "integer" } }), execute: async (args) => ({ lines: material.text.split("\n").slice(args.startLine - 1, args.endLine) }) });
  for (const name of ["knowledge_search", "knowledge_read", "knowledge_cite"])
    registry.register({ definition: tools[name].definition, execute: tools[name].execute });
  registry.register({ definition: fn("draft_treatment_review", { summary: { type: "string" } }, ["summary"]), execute: async (args) => {
    const artifact = { type: "treatment_review", ...args };
    run.artifacts.push(artifact);
    return artifact;
  } });
  configureAssessmentTools(registry, workspace, run);
  assert.ok(registry.get("knowledge_read"), "复核时开放知识库原文读取");
  assert.ok(registry.get("knowledge_cite"));
  assert.ok(registry.get("draft_treatment_review").definition.function.parameters.properties.knowledgeCitations);

  const context = { sources: [material] };
  await registry.get("read_source").execute({ sourceId: "m1", startLine: 1, endLine: 3 }, context);
  const draft = registry.get("draft_treatment_review");
  await assert.rejects(draft.execute({ summary: "s", citations: [{ sourceId: "m1", startLine: 2, endLine: 3 }], knowledgeCitations: [{ docId: doc.id, startLine: 5, endLine: 5 }] }, context), /knowledge_read 已读取/);
  await registry.get("knowledge_read").execute({ docId: doc.id, startLine: 3, endLine: 5 }, context);
  const saved = await draft.execute({ summary: "eGFR 25 时二甲双胍需停用", citations: [{ sourceId: "m1", startLine: 2, endLine: 3 }], knowledgeCitations: [{ docId: doc.id, startLine: 5, endLine: 5 }] }, context);
  assert.equal(saved.knowledgeMatches.length, 1);
  assert.match(saved.knowledgeMatches[0].quote, /禁用二甲双胍/);
  assert.match(saved.knowledgeMatches[0].url, new RegExp(`knowledgeDoc=${doc.id}&line=5&endLine=5&sourceHash=${doc.sha256}`));
  run.artifacts = [saved];
  run.id = "run1"; run.policy = { workflow: "patient-assessment" };
  const answer = assessmentAnswer({ runs: [run] }, "run1", { text: "" });
  assert.match(answer.text, /### 指南与知识库出处\n\n1\. \[糖尿病指南 · L5–5\]\(\/\?view=knowledge&knowledgeDoc=/);
});

test("端到端：知识库清单进入系统提示，模型可检索、读取并带核验引用回答", async (t) => {
  let step = 0, docId = null, cited = null;
  const toolResult = (messages, name) => {
    const ids = new Set(messages.flatMap((m) => (m.tool_calls || []).filter((c) => c.function.name === name).map((c) => c.id)));
    const result = messages.filter((m) => m.role === "tool" && ids.has(m.tool_call_id)).at(-1);
    return result && JSON.parse(result.content);
  };
  const call = (name, args) => [{ id: `c${step}`, type: "function", function: { name, arguments: JSON.stringify(args) } }];
  const turn = ({ messages }) => {
    // Query expansion shares the chat model; answer it without advancing the dialog.
    if (String(messages[0]?.content || "").startsWith("You translate search queries")) return "[]";
    step++;
    if (step === 1) return call("knowledge_search", { query: "二甲双胍 禁忌", collection: "糖尿病" });
    if (step === 2) {
      const hit = toolResult(messages, "knowledge_search").hits[0];
      docId = hit.docId;
      return call("knowledge_read", { docId, startLine: hit.startLine, endLine: hit.endLine });
    }
    if (step === 3) return call("knowledge_cite", { docId, quote: "eGFR<30 ml/min/1.73m2 的患者禁用二甲双胍。", startLine: 1, endLine: 8 });
    cited = toolResult(messages, "knowledge_cite").citation;
    return `eGFR<30 时禁用二甲双胍 ${cited}`;
  };
  const provider = createScriptedProvider(Array.from({ length: 12 }, () => turn));
  const app = await startTestServer({ provider, seedDemoPack: false });
  t.after(() => app.close());
  const added = await app.request("/api/knowledge", { method: "POST", body: { title: "糖尿病指南", text: GUIDELINE, collection: "糖尿病" } });
  assert.equal(added.status, 201, added.text);
  const session = await app.request("/api/sessions", { method: "POST", body: { title: "用药问答" } });
  const result = await app.request("/api/agent/run", { method: "POST", body: { sessionId: session.body.id, mode: "standard", externalConsent: true, message: "肾功能差的糖尿病患者还能用二甲双胍吗？" } });
  assert.equal(result.status, 200, result.text);
  const system = provider.calls[0].messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  assert.match(system, /本机知识库/);
  assert.match(system, /"name":"糖尿病"/);
  assert.match(system, /先检索并读取本地原文再回答/);
  assert.ok(cited, "模型拿到了核验后的引用");
  const detail = (await app.request(`/api/sessions/${session.body.id}`)).body;
  const reply = detail.messages.filter((m) => m.role === "assistant").at(-1).content;
  assert.ok(reply.includes(cited), reply);
});
