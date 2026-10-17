// 全局聊天 Agent 底座 + 患者自动分组（迭代一）：
// - patient_scan 确定性匹配器（诊断/检验/年龄条件与依据行）
// - patient-grouping 提案生命周期（快照、确认合并、幂等、归档跳过、拒绝）
// - 普通任务与历史全局会话：查询、分组、续聊和文书整理共用工具面
// - 今日待办按分组联动过滤
// 全部使用合成数据与合成模型，无真实患者资料。
import test from "node:test";
import assert from "node:assert/strict";
import { scanPatients } from "../server/medical/patient-scan.mjs";
import { patientStats } from "../server/medical/patient-stats.mjs";
import { createMedicalWorkspaceDomain } from "../server/medical/medical-workspace-domain.mjs";
import { fixture } from "./helpers.mjs";

const answer = (content) => ({ message: { role: "assistant", content } });
const toolCall = (id, name, args) => ({
  message: {
    role: "assistant",
    content: null,
    tool_calls: [{ id, function: { name, arguments: JSON.stringify(args ?? {}) } }],
  },
});

const DAY = 86400000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

test("patient_scan: diagnosis/lab/age conditions return matched patients with evidence", () => {
  const now = Date.parse("2026-10-10T12:00:00");
  const registry = {
    all: () => [
      {
        id: "p-recent", name: "术后近期", birthYear: 1970, gender: "male", groups: ["胆囊"],
        diagnoses: [{ name: "胆囊切除术后状态", date: iso(-30) }],
        labs: [{ item: "HbA1c", value: 8.2, unit: "%", date: iso(-10) }],
      },
      {
        id: "p-old", name: "术后已久", birthYear: 1940, gender: "female",
        diagnoses: [{ name: "胃大部切除术后状态", date: iso(-400) }],
        labs: [{ item: "HbA1c", value: 6.1, unit: "%", date: iso(-5) }],
      },
      { id: "p-archived", name: "已归档", archived: true, diagnoses: [{ name: "术后", date: iso(-1) }] },
      { id: "p-none", name: "无相关", birthYear: 1990 },
    ],
  };
  const recent = scanPatients(registry, { diagnosisContains: "术后", diagnosisWithinDays: 90 }, now);
  assert.equal(recent.total, 1);
  assert.equal(recent.matched[0].id, "p-recent");
  assert.match(recent.matched[0].evidence[0], /胆囊切除术后状态/);
  assert.match(recent.matched[0].evidence[0], /90 天内/);

  const uncontrolled = scanPatients(registry, { lab: { item: "HbA1c", op: ">", value: 7, withinDays: 90 } }, now);
  assert.equal(uncontrolled.total, 1);
  assert.equal(uncontrolled.matched[0].id, "p-recent");
  assert.match(uncontrolled.matched[0].evidence[0], /HbA1c 8\.2%/);

  const combined = scanPatients(registry, { diagnosisContains: "术后", diagnosisWithinDays: 90, lab: { item: "HbA1c", op: "<", value: 7 } }, now);
  assert.equal(combined.total, 0, "同一患者须同时满足全部条件");

  const elderly = scanPatients(registry, { ageMin: 75 }, now);
  assert.equal(elderly.total, 1);
  assert.equal(elderly.matched[0].id, "p-old");

  const byGroup = scanPatients(registry, { group: "胆囊" }, now);
  assert.equal(byGroup.total, 1);

  assert.throws(() => scanPatients(registry, {}), { code: "INVALID_INPUT" });
  assert.throws(() => scanPatients(registry, { lab: { item: "HbA1c", op: "~", value: 7 } }), { code: "INVALID_INPUT" });
});

test("patient_stats: lab control rate, countBy buckets and filter dimensions are deterministic", () => {
  const registry = {
    all: () => [
      { id: "a", name: "甲", gender: "male", birthYear: 1950, groups: ["糖尿病"], diagnoses: [{ name: "2型糖尿病" }], labs: [{ item: "HbA1c", value: 8.2, date: iso(-10) }] },
      { id: "b", name: "乙", gender: "female", birthYear: 1960, groups: ["糖尿病", "高血压"], diagnoses: [{ name: "2型糖尿病" }, { name: "原发性高血压" }], labs: [{ item: "HbA1c", value: 6.4, date: iso(-20) }] },
      { id: "c", name: "丙", gender: "male", birthYear: 1985, groups: [], diagnoses: [], labs: [] },
      { id: "d", name: "已归档", archived: true, groups: ["糖尿病"], labs: [{ item: "HbA1c", value: 9, date: iso(-1) }] },
    ],
  };
  // 达标率：最近一次 HbA1c > 7 的患者 1 位；未查过检验的丙不计入分母。
  const control = patientStats(registry, { lab: { item: "HbA1c", op: ">", value: 7 } });
  assert.equal(control.totalActive, 3);
  assert.equal(control.lab.tested, 2);
  assert.equal(control.lab.matched, 1);
  // 分组分布：归档患者不计入。
  const byGroup = patientStats(registry, { countBy: "group" });
  assert.deepEqual(byGroup.buckets[0], { key: "糖尿病", count: 2 });
  assert.ok(byGroup.buckets.find((b) => b.key === "高血压" && b.count === 1));
  // 年龄段 + 诊断过滤叠加：两位糖尿病患者分别落入 ≥75 与 60–74 段。
  const elderly = patientStats(registry, { countBy: "ageBand", diagnosisContains: "糖尿病" });
  assert.equal(elderly.diagnosisCount, 2);
  assert.ok(elderly.buckets.find((b) => b.key === "≥75" && b.count === 1));
  assert.ok(elderly.buckets.find((b) => b.key === "60–74" && b.count === 1));
  assert.equal(elderly.totalActive, 3);
  assert.throws(() => patientStats(registry, {}), { code: "INVALID_INPUT" });
});

test("patient-grouping: propose snapshots patients, confirm merges groups idempotently", async (t) => {
  const f = await fixture(t);
  const first = f.server.patients.create({ name: "分组患者甲", groups: ["慢病"] });
  const second = f.server.patients.create({ name: "分组患者乙" });

  const proposal = f.server.pendingActions.propose({
    type: "patient-grouping",
    payload: {
      groupName: "术后三个月内",
      patients: [
        { patientId: first.id, reason: "诊断「胆囊切除术后状态」2026-09-15" },
        { patientId: second.id, reason: "就诊「术后复查」2026-09-20" },
        { patientId: first.id, reason: "重复条目应被去重" },
      ],
      note: "来自全局助手对话",
      sourceSessionId: "synthetic-session",
    },
    summary: "建议分组「术后三个月内」：2 位患者",
  });
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.patientId, null, "多患者提案不绑定单一患者");
  assert.deepEqual(proposal.payload.patients.map((p) => p.name), ["分组患者甲", "分组患者乙"]);
  assert.deepEqual(proposal.payload.patients[0].groups, ["慢病"], "提案快照当前分组供托盘展示");

  assert.throws(
    () => f.server.pendingActions.propose({ type: "patient-grouping", payload: { groupName: "空", patients: [] }, summary: "空" }),
    { code: "INVALID_INPUT" },
  );
  assert.throws(
    () => f.server.pendingActions.propose({ type: "patient-grouping", payload: { groupName: "缺依据", patients: [{ patientId: first.id }] }, summary: "缺依据" }),
    { code: "INVALID_INPUT" },
  );

  const listed = (await f.json("/api/pending-actions?type=patient-grouping")).data;
  assert.equal(listed.actions.length, 1);

  const confirmed = await f.json(`/api/pending-actions/${proposal.id}/confirm`, "POST");
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.action.status, "applied");
  assert.deepEqual(confirmed.data.applied, { added: 2, already: 0, skipped: [] });
  assert.deepEqual(f.server.patients.row(first.id).groups, ["慢病", "术后三个月内"], "确认后合并且保留既有分组");
  assert.deepEqual(f.server.patients.row(second.id).groups, ["术后三个月内"]);

  assert.equal((await f.json(`/api/pending-actions/${proposal.id}/confirm`, "POST")).status, 409);

  // 医生确认前患者分组可能已变：重复确认同类提案按幂等处理，不产生重复分组。
  const again = f.server.pendingActions.propose({
    type: "patient-grouping",
    payload: { groupName: "术后三个月内", patients: [{ patientId: first.id, reason: "再次建议" }] },
    summary: "重复建议",
  });
  const retried = await f.json(`/api/pending-actions/${again.id}/confirm`, "POST");
  assert.equal(retried.status, 200);
  assert.deepEqual(retried.data.applied, { added: 0, already: 1, skipped: [] });
  assert.deepEqual(f.server.patients.row(first.id).groups, ["慢病", "术后三个月内"]);

  // 提案生成后才归档的患者在确认时逐个跳过，其余照常生效（propose
  // 阶段已拒绝归档患者，这里模拟的是生成后的漂移）。
  const third = f.server.patients.create({ name: "分组患者丙" });
  const mixed = f.server.pendingActions.propose({
    type: "patient-grouping",
    payload: { groupName: "高血糖", patients: [{ patientId: second.id, reason: "HbA1c 8.2" }, { patientId: third.id, reason: "HbA1c 9.1" }] },
    summary: "混合建议",
  });
  const thirdRow = f.server.patients.row(third.id);
  f.server.patients.update(third.id, { expectedRevision: thirdRow.revision, archived: true });
  const mixedResult = await f.json(`/api/pending-actions/${mixed.id}/confirm`, "POST");
  assert.equal(mixedResult.status, 200);
  assert.equal(mixedResult.data.applied.added, 1);
  assert.equal(mixedResult.data.applied.skipped.length, 1);
  assert.equal(mixedResult.data.applied.skipped[0].reason, "已归档");
  assert.deepEqual(f.server.patients.row(third.id).groups, []);

  const rejected = f.server.pendingActions.propose({
    type: "patient-grouping",
    payload: { groupName: "被拒绝", patients: [{ patientId: second.id, reason: "演示" }] },
    summary: "拒绝演示",
  });
  await f.json(`/api/pending-actions/${rejected.id}/reject`, "POST");
  assert.equal(f.server.pendingActions.row(rejected.id).status, "rejected");
  assert.deepEqual(f.server.patients.row(second.id).groups, ["术后三个月内", "高血糖"], "拒绝后分组不变");
});

for (const legacyGlobal of [false, true]) test(`unified agent: ${legacyGlobal ? "legacy global history" : "new task"} supports grouping and document work`, async (t) => {
  let sawTools = null;
  let step = 0;
  const f = await fixture(t, {
    provider: {
      apiKey: "synthetic",
      model: "synthetic",
      async complete(messages, tools) {
        sawTools = tools.map((tool) => tool.function.name);
        const latest = messages.filter(m => m.role === "user").at(-1)?.content;
        if (typeof latest === "string" && latest.includes("整理为病历时间线")) {
          assert.ok(sawTools.includes("extract_clinical_timeline"));
          if (messages.at(-1)?.role === "tool") return answer("已整理病历时间线草稿，请核对原文。");
          return toolCall("timeline-call", "extract_clinical_timeline", {});
        }
        if (typeof latest === "string" && latest.includes("刚才那个分组")) {
          assert.ok(messages.some(m => m.role === "assistant" && m.content?.includes("已生成分组提案")), "续聊保留上一轮回答");
          return answer("刚才的分组叫术后三个月内。");
        }
        step++;
        if (step === 1) return toolCall("call-1", "patient_scan", { diagnosisContains: "术后", diagnosisWithinDays: 90 });
        if (step === 2) {
          const scan = messages.filter((m) => m.role === "tool").map((m) => m.content).join("\n");
          const patientId = /"matched":\[\{[^}]*?"id":"([0-9a-f-]{36})"/.exec(scan)?.[1];
          return toolCall("call-2", "patient_grouping_propose", {
            groupName: "术后三个月内",
            patients: [{ patientId, reason: "诊断「术后」90 天内（patient_scan 证据）" }],
            note: "按你的要求整理",
          });
        }
        return answer("已生成分组提案，请在「待确认」面板核对。");
      },
    },
  });
  const patient = f.server.patients.create({
    name: "全局助手患者",
    diagnoses: [{ name: "胆囊切除术后状态", date: new Date(Date.now() - 20 * DAY).toISOString().slice(0, 10) }],
  });

  const first = legacyGlobal ? (await f.json("/api/assistant/session", "POST")).data : await f.session("统一任务");
  if (legacyGlobal) {
    const second = (await f.json("/api/assistant/session", "POST")).data;
    assert.equal(first.id, second.id, "旧入口仍可找回已有会话");
    assert.equal(first.title, "全局助手");
  } else {
    const second = await f.session("另一段对话");
    assert.notEqual(first.id, second.id, "新任务各有独立会话");
    assert.equal(f.server.workspaces.get(second.id).runs.length, 0);
  }

  const chat = await f.chat(first.id, "把术后三个月内的患者分成一组", { mode: "model", externalConsent: true });
  assert.equal(chat.status, 200);
  assert.ok(sawTools.includes("patient_scan"));
  assert.ok(sawTools.includes("patient_grouping_propose"));
  assert.ok(sawTools.includes("list_patients"));
  assert.ok(sawTools.includes("knowledge_collections"), "知识库工具应复用会话插件");

  const actions = (await f.json("/api/pending-actions?type=patient-grouping")).data.actions;
  assert.equal(actions.length, 1);
  assert.equal(actions[0].payload.groupName, "术后三个月内");
  assert.equal(actions[0].payload.sourceSessionId, first.id, "提案应能追溯到全局会话");

  assert.deepEqual(f.server.patients.row(patient.id).groups || [], [], "确认前不改变分组");
  const confirmed = await f.json(`/api/pending-actions/${actions[0].id}/confirm`, "POST");
  assert.equal(confirmed.status, 200);
  assert.deepEqual(f.server.patients.row(patient.id).groups, ["术后三个月内"]);

  // 上下文链式继承：第二轮对话能看到上一轮的助手答复。
  const followUp = f.server.workspaces.get(first.id);
  assert.ok(followUp.runs.length >= 1);
  const round2 = await f.chat(first.id, "刚才那个分组叫什么名字？", { mode: "model", externalConsent: true });
  assert.equal(round2.status, 200);
  const runs = f.server.workspaces.get(first.id).runs;
  assert.equal(runs.length, 2, "每条消息一个 run，上下文跨 run 继承");
  assert.equal(runs.some(run => run.policy?.workflow === "global-assistant"), false);

  // 同一段对话继续做材料整理，必须实际产生带来源的时间线。
  await f.json(`/api/sessions/${first.id}/files`, "POST", {
    name: "合成就诊记录.txt", text: "2026-10-01 患者门诊复诊。\n2026-10-08 完成复查。",
  });
  const document = await f.chat(first.id, "请把附件整理为病历时间线，保留来源。", { mode: "model", externalConsent: true });
  assert.equal(document.status, 200);
  const detail = (await f.json(`/api/sessions/${first.id}`)).data;
  assert.ok(detail.artifacts.some(a => a.type === "clinical_timeline"), JSON.stringify(detail.artifacts));
  assert.ok((await f.json("/api/sessions")).data.sessions.some(s => s.id === first.id), "旧会话和新任务均可从任务记录找回");

});

test("agenda: group filter keeps only that group's patients and hides unbound items", async (t) => {
  const f = await fixture(t);
  const grouped = f.server.patients.create({ name: "分组待办患者", groups: ["高血糖"] });
  const other = f.server.patients.create({ name: "普通待办患者" });
  f.server.pendingActions.propose({ type: "patient-update", patientId: grouped.id, payload: { allergies: ["青霉素"] }, summary: "分组患者的提案" });
  f.server.pendingActions.propose({ type: "patient-update", patientId: other.id, payload: { allergies: ["头孢"] }, summary: "普通患者的提案" });

  const all = (await f.json("/api/doctor/overview")).data;
  assert.equal(all.work.total, 2);
  const filtered = (await f.json("/api/doctor/overview?group=" + encodeURIComponent("高血糖"))).data;
  assert.equal(filtered.work.total, 1);
  assert.equal(filtered.work.items[0].patientId, grouped.id);
  const missing = (await f.json("/api/doctor/overview?group=" + encodeURIComponent("不存在"))).data;
  assert.equal(missing.work.total, 0);
  assert.equal(missing.counts.all, 0);
});

test("medical domain: all medical sessions share capabilities while projects stay opt-in", () => {
  const domain = createMedicalWorkspaceDomain({ readPatientBrief: () => ({ id: "x" }) });
  const sessions = [{ kind: "session", modeFlags: { global: true } }, { kind: "session" }, { kind: "session", patientId: "p-1" }];
  const toolSets = sessions.map(workspace => {
    assert.match(domain.systemFor(workspace), /医疗领域能力/);
    assert.match(domain.systemFor(workspace), /统一 Agent/);
    const registered = [];
    domain.registerTools({ registry: { tools: new Map(), register: entry => registered.push(entry.definition.function.name) },
      workspace: { ...workspace, materials: [], runs: [{ id: "r1", policy: { intent: "document" } }] }, runId: "r1" });
    for (const tool of ["patient_scan", "patient_stats", "patient_grouping_propose", "extract_clinical_timeline"])
      assert.ok(registered.includes(tool), tool);
    assert.equal(new Set(registered).size, registered.length, "工具只注册一次");
    return registered;
  });
  assert.deepEqual(toolSets[0], toolSets[1]);
  assert.ok(toolSets[2].includes("read_patient_brief"));
  assert.ok(!domain.systemFor({}).includes("医疗领域能力"));
  const registered = [];
  domain.registerTools({ registry: { register: entry => registered.push(entry) }, workspace: {}, runId: "r1" });
  assert.deepEqual(registered, []);
});

test("unified patient task can read across patients but cannot redirect a followup proposal", async t => {
  let other;
  let step = 0;
  const f = await fixture(t, { provider: { apiKey: "synthetic", model: "synthetic", async complete(messages) {
    step++;
    if (step === 1) return toolCall("read-other", "read_patient_chart", { patientId: other.id });
    if (step === 2) {
      assert.ok(messages.some(m => m.role === "tool" && m.content.includes(other.id)), "能读到另一位患者档案");
      return toolCall("wrong-followup", "followup_create_propose", { patientId: other.id, name: "复查", firstDueAt: "2026-11-01T08:00:00.000Z", summary: "合成测试" });
    }
    assert.ok(messages.some(m => m.role === "tool" && m.content.includes("PATIENT_CONTEXT_MISMATCH")), "仍拒绝错患者提案");
    return answer("请先切换到目标患者，再安排随访。");
  } } });
  const current = f.server.patients.create({ name: "当前合成患者" });
  other = f.server.patients.create({ name: "另一位合成患者" });
  const result = await f.chat(current.sessionId, "查看另一位患者并安排随访", { mode: "model", externalConsent: true });
  assert.equal(result.status, 200);
  assert.equal(step, 3);
  assert.deepEqual((await f.json("/api/pending-actions?type=followup-create")).data.actions, []);
});
