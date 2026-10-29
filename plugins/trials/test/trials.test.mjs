import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createScriptedProvider } from "../../../tests/helpers/scripted-provider.mjs";
import { startTestServer } from "../../../tests/helpers/server.mjs";

const snapshot = JSON.parse(
  readFileSync(new URL("./fixtures/routes.snapshot.json", import.meta.url), "utf8"),
);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const normalize = (value) => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalize(item)]),
    );
  if (typeof value === "string")
    return value.replace(UUID, "<uuid>").replace(TIME, "<time>");
  return value;
};

async function createProtocol(app) {
  return app.request("/api/trials", {
    method: "POST",
    body: {
      title: "迁移快照试验",
      version: "v1",
      recruitment: "正在招募",
      inclusion: "年龄 18–75 岁\n确诊 2 型糖尿病",
      exclusion: "妊娠",
      protocolText: "快照用方案原文",
    },
  });
}

test("trials：旧试验接口迁移前后响应一致", async (t) => {
  const app = await startTestServer({ provider: createScriptedProvider([]) });
  t.after(() => app.close());
  const [patient] = await app.patients();
  const created = await createProtocol(app);
  assert.equal(created.status, 201);
  const id = created.body.id;
  const calls = {
    list: ["/api/trials", { method: "GET" }],
    trial: [`/api/trials/${id}`, { method: "GET" }],
    candidates: [`/api/trials/${id}/candidates`, { method: "GET" }],
    enrollment: [
      `/api/trials/${id}/enrollments/${patient.id}`,
      { method: "GET" },
    ],
  };
  for (const [name, [path, options]] of Object.entries(calls)) {
    const response = await app.request(path, options);
    assert.deepEqual(
      normalize({ status: response.status, body: response.body }),
      snapshot[name],
      name,
    );
  }
});

test("trials：工具、提案类型和工作流由插件注册", async (t) => {
  const app = await startTestServer({ provider: createScriptedProvider([]) });
  t.after(() => app.close());
  const [patient] = await app.patients();
  const trial = (await app.request("/api/trials")).body.trials[0];
  const tools = app.server.pluginHost
    .legacyToolPlugins()
    .map((tool) => tool.definition.function.name);
  for (const name of [
    "trial_list",
    "trial_candidates",
    "trial_patient_screening",
    "trial_batch_screen_propose",
    "trial_enrollment_propose",
  ])
    assert.ok(tools.includes(name), name);

  assert.equal(
    app.server.pluginHost.proposalHandler("trial-enrollment").pluginId,
    "trials",
  );
  assert.ok(app.server.pluginHost.workflow("trial-eligibility"));
  assert.match(
    app.server.pluginHost.workflow("trial-eligibility").guidance(),
    /临床试验自动纳排初筛/,
  );

  const action = app.server.pending.propose({
    type: "trial-enrollment",
    patientId: patient.id,
    payload: {
      trialId: trial.id,
      patientId: patient.id,
      stage: "shortlisted",
      note: "提案快照",
    },
    summary: "试验入组状态",
  });
  const confirmed = await app.request(
    `/api/pending-actions/${action.id}/confirm`,
    { method: "POST", body: {} },
  );
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.action.type, "trial-enrollment");
  const enrollment = await app.request(
    `/api/trials/${trial.id}/enrollments/${patient.id}`,
  );
  assert.equal(enrollment.body.stage, "shortlisted");
});

test("trials：停用后接口 404、工具和工作流不注册、待办来源消失", async (t) => {
  const app = await startTestServer({ provider: createScriptedProvider([]) });
  t.after(() => app.close());
  const disabled = await app.request("/api/plugins/trials", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);

  assert.equal((await app.request("/api/trials")).status, 404);
  const after = app.server.pluginHost
    .legacyToolPlugins()
    .map((tool) => tool.definition.function.name);
  assert.ok(!after.some((name) => name.startsWith("trial_")));
  assert.equal(app.server.pluginHost.workflow("trial-eligibility"), null);
  assert.equal(app.server.pluginHost.proposalHandler("trial-enrollment"), null);

  const overview = await app.request("/api/doctor/overview?limit=100");
  assert.equal(overview.status, 200);
  assert.equal(overview.body.counts.trial, undefined);
  assert.ok(!overview.body.kinds.some((item) => item.kind === "trial"));
});
