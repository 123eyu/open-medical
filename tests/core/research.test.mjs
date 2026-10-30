import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchDataset, researchDataDictionary } from "../../server/medical/research-dataset.mjs";
import { configureResearchTools } from "../../server/medical/research-tools.mjs";
import { ResearchPython } from "../../server/core/research-python.mjs";
import { SESSION_TOOL_GROUPS } from "../../server/medical/medical-workspace-domain.mjs";
import { createScriptedProvider, textTurn, toolCall } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

const NOW = Date.parse("2026-10-30T00:00:00Z");
const roster = () => [
  {
    id: "p-1",
    name: "张三",
    phone: "13800138000",
    patientNumber: "MRN-77",
    gender: "male",
    birthYear: 1960,
    groups: ["糖尿病门诊"],
    tags: ["随访"],
    diagnoses: [{ name: "2型糖尿病（张三 13800138000）", code: "E11", date: "2024-01-10", status: "confirmed", source: "门诊记录.pdf" }],
    medications: [{ name: "二甲双胍", status: "active", dose: "0.5g", note: "家住某小区" }],
    labs: [
      { item: "HbA1c", value: 8.1, unit: "%", date: "2024-01-10" },
      { item: "HbA1c", value: 7.2, unit: "%", date: "2024-04-09" },
    ],
    visits: [{ date: "2024-04-09", reason: "复诊", note: "电话 13800138000" }],
  },
  {
    id: "p-2",
    name: "李四",
    gender: "female",
    birthYear: 1930,
    diagnoses: [{ name: "高血压", code: "I10", date: "2023-05-01" }],
    labs: [{ item: "糖化血红蛋白", value: 6.1, unit: "%", date: "2023-06-01" }],
    visits: [],
  },
  { id: "p-3", name: "王五", archived: true, diagnoses: [], labs: [], visits: [] },
];
const registry = (rows = roster()) => ({ all: () => structuredClone(rows) });

test("科研数据集：去身份、假名稳定、日期换成年份和相对天数", () => {
  const dataset = buildResearchDataset(registry(), { now: NOW });
  const text = JSON.stringify(dataset);
  for (const secret of ["张三", "李四", "13800138000", "MRN-77", "p-1", "门诊记录.pdf", "家住某小区", "2024-01-10"])
    assert.ok(!text.includes(secret), `不应包含 ${secret}`);
  assert.equal(dataset.tables.patients.length, 2, "默认不含归档患者");
  const first = dataset.tables.patients.find((p) => p.gender === "male");
  assert.match(first.pid, /^R[0-9a-f]{10}$/);
  assert.equal(first.age, 66);
  assert.equal(first.followupDays, 90);
  assert.equal(dataset.tables.patients.find((p) => p.gender === "female").age, 90, "≥90 岁统一记为 90");
  const labs = dataset.tables.labs.filter((l) => l.pid === first.pid);
  assert.deepEqual(labs.map((l) => [l.year, l.day]), [[2024, 0], [2024, 90]]);
  const again = buildResearchDataset(registry(), { now: NOW });
  assert.equal(again.snapshot.hash, dataset.snapshot.hash, "同一数据快照哈希一致");
  assert.equal(buildResearchDataset(registry(), { includeArchived: true, now: NOW }).tables.patients.length, 3);
});

test("数据字典：只给汇总，列出同一指标的不同写法", () => {
  const dictionary = researchDataDictionary(buildResearchDataset(registry(), { now: NOW }));
  assert.equal(dictionary.patients.total, 2);
  assert.deepEqual(dictionary.labs.items.map((i) => i.key).sort(), ["HbA1c", "糖化血红蛋白"]);
  const hba1c = dictionary.labs.items.find((i) => i.key === "HbA1c");
  assert.deepEqual([hba1c.patients, hba1c.records, hba1c.min, hba1c.max], [1, 2, 7.2, 8.1]);
  assert.equal(dictionary.coverage.labs.share, 1);
  assert.ok(!JSON.stringify(dictionary).match(/R[0-9a-f]{10}/), "字典不含逐人编号");
});

function harness(research, rows) {
  const tools = new Map();
  const saved = [];
  configureResearchTools(
    { register: (tool) => tools.set(tool.definition.function.name, tool) },
    { id: "ws-1" },
    { id: "run-1" },
    {
      patients: () => registry(rows),
      research: () => research,
      artifacts: { save: (owner, name, data, runId) => (saved.push({ owner, name, runId, size: data.length }), { id: `a${saved.length}`, name }) },
    },
  );
  return { tools, saved };
}

test("research_analyze：返回汇总与出处，图存为成果，分析序号递增", async () => {
  let received;
  const research = {
    run: async ({ tables, code }) => {
      received = { tables, code };
      return { result: { n: tables.patients.length }, log: "ok", figures: [{ name: "figure_1.png", data: Buffer.from("png") }], environment: { python: "3.12.0", modules: { pandas: "2.2.0" } } };
    },
  };
  const { tools, saved } = harness(research);
  assert.equal(tools.get("research_analyze").permission, "sandbox.execute");
  const first = await tools.get("research_analyze").execute({ purpose: "人数", code: "result=1" });
  assert.deepEqual(first.result, { n: 2 });
  assert.equal(first.status, "draft");
  assert.equal(first.provenance.analysisNumber, 1);
  assert.match(first.provenance.dataSnapshot.hash, /^[0-9a-f]{16}$/);
  assert.deepEqual(first.figures, [{ name: "analysis-1-figure_1.png", artifactId: "a1" }]);
  assert.equal(saved[0].runId, "run-1");
  assert.ok(!JSON.stringify(received.tables).includes("张三"), "沙箱只收到脱敏数据");
  const second = await tools.get("research_analyze").execute({ purpose: "再算", code: "result=2" });
  assert.equal(second.provenance.analysisNumber, 2);
  assert.match(second.note, /第 2 项分析/);
});

test("research_analyze：结果里出现大量逐人编号时拒绝", async () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, name: `患者${i}`, diagnoses: [], labs: [], visits: [] }));
  const research = { run: async ({ tables }) => ({ result: tables.patients.map((p) => p.pid), log: "", figures: [], environment: {} }) };
  const { tools } = harness(research, rows);
  await assert.rejects(tools.get("research_analyze").execute({ purpose: "列名单", code: "x" }), { code: "RESEARCH_ROW_LEVEL" });
  await assert.rejects(tools.get("research_analyze").execute({ purpose: " ", code: "x" }), { code: "INVALID_INPUT" });
});

test("科研计算环境未安装时明确报错，不降级执行", async () => {
  const research = new ResearchPython({ dataDir: null, python: null });
  const status = research.status();
  assert.equal(status.installed, false);
  if (status.supported) await assert.rejects(research.run({ code: "result=1", tables: {} }), { code: "RESEARCH_PYTHON_MISSING" });
  else await assert.rejects(research.run({ code: "result=1", tables: {} }), { code: "RESEARCH_SANDBOX_UNAVAILABLE" });
});

test("科研工具按需开启：提到危险因素、共性时列出", () => {
  const group = SESSION_TOOL_GROUPS.find((g) => g.id === "research-stats");
  assert.ok(group.names.includes("research_analyze") && group.names.includes("research_data_dictionary"));
  for (const text of ["分析一下糖尿病患者的危险因素", "这类患者有什么共性", "做个队列研究"]) assert.ok(group.when.test(text), text);
  assert.ok(!group.when.test("血钾偏低要注意什么"));
});

test("医疗会话中 agent 可查数据字典并在沙箱分析患者库，图表存为会话成果", async (t) => {
  let tablesSeen;
  const fake = {
    status: () => ({ supported: true, installed: true }),
    run: async ({ tables }) => {
      tablesSeen = tables;
      return { result: { patients: tables.patients.length }, log: "", figures: [{ name: "figure_1.png", data: Buffer.from("png") }], environment: { python: "3.12.0", modules: {} } };
    },
  };
  const provider = createScriptedProvider([
    toolCall("research_data_dictionary", {}, "call_dict"),
    toolCall("research_analyze", { purpose: "统计人数", code: "result={'n':len(tables['patients'])}" }, "call_analyze"),
    textTurn("分析完成。"),
  ]);
  const app = await startTestServer({ provider, seedDemoPack: false, serverOptions: { researchPython: fake } });
  t.after(() => app.close());
  for (const patient of roster().slice(0, 2)) {
    const { id: _id, ...input } = patient;
    const created = await app.request("/api/patients", { method: "POST", body: input });
    assert.equal(created.status, 201, JSON.stringify(created.body));
  }
  const session = await app.request("/api/assistant/session", { method: "POST", body: {} });
  const response = await app.request("/api/agent/run", {
    method: "POST",
    body: { sessionId: session.body.id, message: "分析糖尿病患者血糖控制的危险因素", mode: "standard", externalConsent: true },
  });
  assert.equal(response.body.status, "completed", JSON.stringify(response.body));
  const toolNames = provider.calls[0].tools.map((tool) => tool.function.name);
  assert.ok(toolNames.includes("research_analyze"), "科研提问应列出分析工具");
  const reply = (id) => JSON.parse(provider.calls.at(-1).messages.find((m) => m.role === "tool" && m.tool_call_id === id).content);
  assert.equal(reply("call_dict").patients.total, 2);
  const analysis = reply("call_analyze");
  assert.deepEqual(analysis.result, { patients: 2 }, JSON.stringify(analysis));
  assert.equal(analysis.figures.length, 1);
  assert.ok(!JSON.stringify(tablesSeen).includes("张三"));
  const detail = await app.request(`/api/sessions/${session.body.id}`);
  const status = await app.request("/api/research-env");
  assert.equal(status.body.installed, true);
  assert.ok(JSON.stringify(detail.body).includes("analysis-1-figure_1.png"), "图表应保存为会话成果");
});
