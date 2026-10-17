// 示例患者包：一键装载（幂等）、固定标签可区分、到期随访进待办、
// 一键删除且级联清理、真实档案永不被触碰。
import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.mjs";

test("demo pack seeds, feeds the agenda and clears without touching real charts", async (t) => {
  const f = await fixture(t);
  // 一位真实患者先行存在：删除示例时必须原样保留。
  const real = (await f.json("/api/patients", "POST", { name: "真实患者" })).data;

  const before = (await f.json("/api/demo-pack")).data;
  assert.equal(before.installed, false);

  const seeded = (await f.json("/api/demo-pack", "POST")).data;
  assert.equal(seeded.installed, true);
  assert.equal(seeded.count, 3);
  // 幂等：重复装载不重复建档。
  assert.equal((await f.json("/api/demo-pack", "POST")).data.count, 3);

  const list = (await f.json("/api/patients?summary=1")).data.patients;
  const demos = list.filter(p => (p.tags || []).includes("示例患者"));
  assert.equal(demos.length, 3);
  assert.ok(list.some(p => p.name === "真实患者"));

  // 到期随访已拨到两天前：今日待办里能看到示例患者。
  const agenda = (await f.json("/api/doctor/overview")).data;
  assert.ok(agenda.counts.followup >= 1, "示例到期随访进入待办");

  const cleared = (await f.json("/api/demo-pack", "DELETE")).data;
  assert.equal(cleared.installed, false);
  assert.equal(cleared.removed, 3);
  const after = (await f.json("/api/patients?summary=1")).data.patients;
  assert.ok(after.some(p => p.id === real.id), "真实患者保留");
  assert.equal(after.filter(p => (p.tags || []).includes("示例患者")).length, 0);
  assert.equal((await f.json("/api/doctor/overview")).data.counts.followup, 0);
  assert.equal((await f.json("/api/demo-pack", "DELETE")).status, 404, "无示例可删时报 404");
});

import { DEMO_DRG, DEMO_DRG_CSV } from "../shared/demo-experience.mjs";

test("examples supply usable sources, module data, and local-only communication", async t => {
  const f = await fixture(t, { followupOptions: { autoStart: false } });
  let notifications = 0;
  f.server.care.channels.notify = async () => { notifications++; return { ok: true }; };
  const seeds = await Promise.all([f.json("/api/demo-pack", "POST"), f.json("/api/demo-pack", "POST")]);
  for (const result of seeds) assert.equal(result.status, 201, JSON.stringify(result.data));
  const pack = seeds[0].data;
  assert.deepEqual(pack.resources, seeds[1].data.resources);
  assert.equal(pack.resources.knowledge, 2);
  assert.equal(pack.resources.case, 3);
  assert.equal(pack.resources.trial, 1);
  assert.equal(pack.resources.tracking, 1);
  assert.equal(pack.resources.collection, 1);
  const postop = (await f.json(`/api/patients/${pack.patients.find(p => p.index === 2).id}`)).data;
  assert.ok(postop.treatmentPlan?.title);
  for (const patient of pack.patients) {
    const session = (await f.json(`/api/sessions/${patient.sessionId}`)).data;
    assert.equal(session.files.length, 3);
    assert.ok(session.files.some(file => file.name === "示例检验.csv"));
  }
  const session = (await f.json(`/api/sessions/${pack.sessionId}`)).data;
  const sourceId = session.files.find(file => file.name.endsWith(".csv")).id;
  const dataset = { sessionId: session.id, sourceId };
  assert.equal((await f.json("/api/research/profile", "POST", dataset)).data.rows, 12);
  const comparison = await f.json("/api/research/test", "POST", { ...dataset, outcome: "sbp", group: "group", method: "auto" });
  assert.equal(comparison.status, 200, JSON.stringify(comparison.data));
  const deid = await f.json("/api/research/deidentify", "POST", { ...dataset, columns: ["subject"] });
  assert.equal(deid.status, 200);
  assert.match(deid.data.csv, /subject_deid/);
  const grouping = await f.json("/api/drg/group", "POST", { ...DEMO_DRG, secondaryDx: ["E11.9"], procedures: [], totalCost: 6800 });
  assert.equal(grouping.status, 200);
  assert.ok(grouping.data.drgCode);
  const batch = await f.json("/api/drg/batch", "POST", { csvText: DEMO_DRG_CSV });
  assert.equal(batch.status, 200, JSON.stringify(batch.data));
  assert.equal(batch.data.rows, 2);
  const knowledge = await f.json("/api/knowledge/search?q=" + encodeURIComponent("复诊") + "&collection=" + encodeURIComponent("示例体验资料库"));
  assert.equal(knowledge.status, 200);
  assert.ok(knowledge.data.hits.length > 0);
  const patient = pack.patients.find(p => p.index === 1);
  assert.equal((await f.json(`/api/patients/${patient.id}/followup-surveys`)).data.surveys.length, 1);
  const replies = f.server.care.replies({ patientId: patient.id }).replies;
  assert.equal(replies.length, 1);
  assert.equal(replies[0].channel, "manual");
  const alerts = f.server.care.alerts({ patientId: patient.id }).alerts;
  await f.server.care.notifyAlert(alerts[0].id, true);
  assert.equal(notifications, 0, "demo alert must never call external notifications");
  await f.json("/api/demo-pack", "POST");
  assert.equal((await f.json(`/api/patients/${patient.id}/followup-surveys`)).data.surveys.length, 1);
  assert.equal((await f.json(`/api/sessions/${pack.sessionId}`)).data.files.length, 2);
});

test("cleanup uses ownership, includes archived examples and preserves unrelated data", async t => {
  const f = await fixture(t, { followupOptions: { autoStart: false } });
  const unrelated = (await f.json("/api/patients", "POST", { name: "示例·张沪生", tags: ["示例患者"] })).data;
  const doc = (await f.json("/api/knowledge", "POST", { title: "我的资料", text: "这是保留的资料，不属于示例包。", collection: "示例体验资料库" })).data;
  const seeded = await f.json("/api/demo-pack", "POST");
  assert.equal(seeded.status, 201, JSON.stringify(seeded.data));
  const pack = seeded.data;
  const archived = pack.patients[0];
  f.server.store.db.prepare("UPDATE patients SET data=json_set(data,'$.archived',json('true')) WHERE id=?").run(archived.id);
  const clear = await f.json("/api/demo-pack", "DELETE");
  assert.equal(clear.status, 200, JSON.stringify(clear.data));
  assert.equal(clear.data.installed, false);
  assert.equal((await f.json(`/api/patients/${unrelated.id}`)).status, 200);
  assert.equal((await f.json(`/api/knowledge/${doc.id}`)).status, 200);
  assert.equal((await f.json(`/api/sessions/${pack.sessionId}`)).status, 404);
  for (const table of ["case_library", "trial_protocols", "care_replies", "care_alerts", "followup_surveys", "appointments", "care_tasks"]) {
    assert.equal(f.server.store.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, table);
  }
  const reseed = await f.json("/api/demo-pack", "POST");
  assert.equal(reseed.status, 201);
  assert.equal(reseed.data.count, 3);
});
