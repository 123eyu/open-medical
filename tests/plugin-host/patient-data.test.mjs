import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

const PLUGIN_ROOT = fileURLToPath(new URL("../../plugins", import.meta.url));
const CHANNEL_FAKE = fileURLToPath(
  new URL("../fixtures/plugins/channel-fake", import.meta.url),
);
const DELETE_THROWS = fileURLToPath(
  new URL("../fixtures/plugins/delete-throws", import.meta.url),
);
const ACTIVE_DIRS = [PLUGIN_ROOT, CHANNEL_FAKE];

const start = (pluginDirs = ACTIVE_DIRS, options = {}) =>
  startTestServer({
    provider: createScriptedProvider([]),
    ...options,
    serverOptions: { pluginDirs, ...(options.serverOptions || {}) },
  });

const countForPatient = (app, table, patientId) =>
  app.server.store.db
    .prepare(`SELECT COUNT(*) n FROM ${table} WHERE patient_id=?`)
    .get(patientId).n;

const demoPatient = async (app, name = "示例·李婉珍") => {
  const patients = await app.patients();
  const patient = patients.find((item) => item.name === name);
  assert.ok(patient, `${name} 应存在`);
  return patient;
};

async function addRiskMonitor(app, patientId) {
  const response = await app.request(
    `/api/patients/${patientId}/lab-monitors`,
    {
      method: "POST",
      body: {
        item: "HbA1c",
        op: "gt",
        threshold: 1,
        severity: "warning",
        unit: "%",
      },
    },
  );
  assert.equal(response.status, 201);
  return response.body;
}

async function addCareTask(app, patientId) {
  const response = await app.request(
    `/api/patients/${patientId}/care-tasks`,
    {
      method: "POST",
      body: {
        title: "删除测试跟进",
        kind: "test",
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        note: "删除患者时应清理",
      },
    },
  );
  assert.equal(response.status, 201);
  return response.body;
}

async function addTrialEnrollment(app, patientId) {
  const trial = await app.request("/api/trials", {
    method: "POST",
    body: {
      title: "删除测试试验",
      version: "v1",
      inclusion: "年龄 18–75 岁",
      exclusion: "妊娠",
    },
  });
  assert.equal(trial.status, 201);
  const enrollment = await app.request(
    `/api/trials/${trial.body.id}/enrollments/${patientId}`,
    {
      method: "PUT",
      body: { stage: "shortlisted", note: "删除测试", expectedRevision: 0 },
    },
  );
  assert.equal(enrollment.status, 200);
  return trial.body;
}

test("删除患者：followup/care-tasks/risk-rules/trials 的插件数据在同一事务内清理", async (t) => {
  const app = await start();
  t.after(() => app.close());
  const patient = await demoPatient(app);

  assert.ok(countForPatient(app, "follow_ups", patient.id) > 0);
  await addCareTask(app, patient.id);
  await addRiskMonitor(app, patient.id);
  await addTrialEnrollment(app, patient.id);

  const statements = [
    ["follow_ups", "follow_ups"],
    ["followup_surveys", "followup_surveys"],
    ["care_tasks", "care_tasks"],
    ["care_replies", "care_replies"],
    ["care_alerts", "care_alerts"],
    ["risk_alerts", "risk_alerts"],
    ["lab_monitors", "lab_monitors"],
    ["trial_screenings", "trial_screenings"],
    ["trial_enrollments", "trial_enrollments"],
  ];
  for (const [label, table] of statements)
    assert.ok(
      countForPatient(app, table, patient.id) >= 0,
      `${label} 表应可查询`,
    );
  assert.ok(countForPatient(app, "care_tasks", patient.id) > 0);
  assert.ok(countForPatient(app, "risk_alerts", patient.id) > 0);
  assert.ok(countForPatient(app, "trial_enrollments", patient.id) > 0);

  const removed = await app.request(`/api/patients/${patient.id}`, {
    method: "DELETE",
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.ok, true);
  assert.equal(
    (await app.request(`/api/patients/${patient.id}`)).status,
    404,
  );
  for (const [label, table] of statements)
    assert.equal(
      countForPatient(app, table, patient.id),
      0,
      `${label} 应为已删除患者清理数据`,
    );
});

test("删除患者：任一插件 hook 抛错时整次删除回滚", async (t) => {
  const app = await start([...ACTIVE_DIRS, DELETE_THROWS]);
  t.after(() => app.close());
  const patient = await demoPatient(app);
  await addCareTask(app, patient.id);
  await addRiskMonitor(app, patient.id);
  await addTrialEnrollment(app, patient.id);

  const before = Object.fromEntries(
    [
      "follow_ups",
      "followup_surveys",
      "care_tasks",
      "risk_alerts",
      "lab_monitors",
      "trial_enrollments",
    ].map((table) => [table, countForPatient(app, table, patient.id)]),
  );
  assert.ok(before.follow_ups > 0);
  assert.ok(before.care_tasks > 0);
  assert.ok(before.risk_alerts > 0);
  assert.ok(before.trial_enrollments > 0);

  const removed = await app.request(`/api/patients/${patient.id}`, {
    method: "DELETE",
  });
  assert.equal(removed.status, 500);
  assert.equal((await app.request(`/api/patients/${patient.id}`)).status, 200);
  for (const [table, value] of Object.entries(before))
    assert.equal(
      countForPatient(app, table, patient.id),
      value,
      `${table} 在回滚后应保持原值`,
    );
  assert.ok(
    (await app.patients()).some((item) => item.id === patient.id),
    "患者列表仍应包含该患者",
  );
});

test("停用 followup/care-tasks/risk-rules 后，列表与简报保留字段并返回空值", async (t) => {
  const app = await start();
  t.after(() => app.close());
  const patient = await demoPatient(app);
  await addCareTask(app, patient.id);
  await addRiskMonitor(app, patient.id);

  const beforeList = await app.request("/api/patients");
  assert.equal(beforeList.status, 200);
  const before = beforeList.body.patients.find(
    (item) => item.id === patient.id,
  );
  assert.ok(before.counts.activeFollowups > 0);
  const beforeBrief = await app.request(`/api/patients/${patient.id}/brief`);
  assert.equal(beforeBrief.status, 200);
  assert.ok(beforeBrief.body.careTasks.length > 0);
  assert.ok(beforeBrief.body.counts.careTasks > 0);
  assert.ok(beforeBrief.body.counts.activeRisks > 0);

  for (const id of ["followup", "care-tasks", "risk-rules"]) {
    const disabled = await app.request(`/api/plugins/${id}`, {
      method: "PUT",
      body: { enabled: false },
    });
    assert.equal(disabled.status, 200, id);
  }

  const afterList = await app.request("/api/patients");
  assert.equal(afterList.status, 200);
  for (const item of afterList.body.patients) {
    assert.ok(Object.hasOwn(item.counts, "activeFollowups"));
    assert.ok(Object.hasOwn(item.counts, "dueFollowups"));
    assert.equal(typeof item.counts.activeFollowups, "number");
    assert.equal(typeof item.counts.dueFollowups, "number");
  }
  const after = afterList.body.patients.find((item) => item.id === patient.id);
  assert.equal(after.counts.activeFollowups, 0);
  assert.equal(after.counts.dueFollowups, 0);

  const afterBrief = await app.request(`/api/patients/${patient.id}/brief`);
  assert.equal(afterBrief.status, 200);
  assert.deepEqual(afterBrief.body.careTasks, []);
  assert.equal(afterBrief.body.counts.careTasks, 0);
  assert.equal(afterBrief.body.counts.activeRisks, 0);
  assert.equal(afterBrief.body.counts.activeFollowups, 0);
  assert.equal(afterBrief.body.counts.dueFollowups, 0);

  const detail = await app.request(`/api/patients/${patient.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.counts.activeFollowups, 0);
  assert.equal(detail.body.counts.dueFollowups, 0);
});

test("demo-pack 只安装已激活插件的示例数据，重新启用后可补齐", async (t) => {
  const app = await start(ACTIVE_DIRS, { seedDemoPack: false });
  t.after(() => app.close());

  for (const id of ["followup", "care-tasks", "trials"]) {
    const disabled = await app.request(`/api/plugins/${id}`, {
      method: "PUT",
      body: { enabled: false },
    });
    assert.equal(disabled.status, 200, id);
  }
  const installed = await app.request("/api/demo-pack", { method: "POST" });
  assert.equal(installed.status, 201);
  const rows = (table) =>
    app.server.store.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  assert.equal(rows("follow_ups"), 0);
  assert.equal(rows("care_tasks"), 0);
  assert.equal(rows("trial_protocols"), 0);

  for (const id of ["followup", "care-tasks", "trials"]) {
    const enabled = await app.request(`/api/plugins/${id}`, {
      method: "PUT",
      body: { enabled: true },
    });
    assert.equal(enabled.status, 200, id);
  }
  const filled = await app.request("/api/demo-pack", { method: "POST" });
  assert.equal(filled.status, 201);
  assert.ok(rows("follow_ups") > 0);
  assert.ok(rows("care_tasks") > 0);
  assert.ok(rows("trial_protocols") > 0);
  assert.ok(filled.body.resources.tracking > 0);
  assert.ok(filled.body.resources.trial > 0);
  assert.ok(filled.body.resources.reply > 0);
  assert.ok(filled.body.resources.alert > 0);

  const cleared = await app.request("/api/demo-pack", { method: "DELETE" });
  assert.equal(cleared.status, 200);
  assert.equal(rows("follow_ups"), 0);
  assert.equal(rows("followup_surveys"), 0);
  assert.equal(rows("care_tasks"), 0);
  assert.equal(rows("trial_protocols"), 0);
  assert.equal(rows("care_replies"), 0);
  assert.equal(rows("care_alerts"), 0);
  assert.deepEqual(cleared.body.patients, []);
});

test("全新数据库缺少 followup 插件时服务可启动，患者列表和简报字段正常", async (t) => {
  const dirs = readdirSync(PLUGIN_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "followup")
    .map((entry) => join(PLUGIN_ROOT, entry.name));
  const app = await start(dirs);
  t.after(() => app.close());

  assert.equal((await app.request("/api/agent/health")).status, 200);
  const patients = await app.patients();
  assert.equal(patients.length, 3);
  for (const patient of patients) {
    assert.equal(patient.counts.activeFollowups, 0);
    assert.equal(patient.counts.dueFollowups, 0);
  }
  const brief = await app.request(`/api/patients/${patients[0].id}/brief`);
  assert.equal(brief.status, 200);
  assert.ok(Array.isArray(brief.body.careTasks));
  assert.equal(brief.body.counts.activeFollowups, 0);
  assert.equal(brief.body.counts.dueFollowups, 0);
  assert.equal(
    app.server.store.db
      .prepare(
        "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='follow_ups'",
      )
      .get().n,
    0,
    "缺少 followup 插件时固定区不应再创建其表",
  );
});
