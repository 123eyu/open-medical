import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createScriptedProvider } from "../../../tests/helpers/scripted-provider.mjs";
import { startTestServer } from "../../../tests/helpers/server.mjs";

const snapshot = JSON.parse(
  readFileSync(new URL("./fixtures/routes.snapshot.json", import.meta.url), "utf8"),
);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const normalize = (value) => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalize(item)]),
    );
  if (typeof value === "string") return value.replace(UUID, "<uuid>");
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 1e12 &&
    value < 1e13
  )
    return "<time>";
  return value;
};

async function createMonitor(app, patientId) {
  return app.request(`/api/patients/${patientId}/lab-monitors`, {
    method: "POST",
    body: {
      item: "白细胞计数",
      unit: "10^9/L",
      op: "gt",
      threshold: 0,
      recheckDays: null,
      severity: "warning",
      note: "快照",
    },
  });
}

test("risk-rules：旧风险与检验监测接口迁移前后响应一致", async (t) => {
  const app = await startTestServer({ provider: createScriptedProvider([]) });
  t.after(() => app.close());
  const [patient] = await app.patients();
  const out = {};
  const calls = {
    alertsBefore: ["/api/risk-alerts", { method: "GET" }],
    monitorsBefore: [
      `/api/patients/${patient.id}/lab-monitors`,
      { method: "GET" },
    ],
    monitorCreate: [
      `/api/patients/${patient.id}/lab-monitors`,
      {
        method: "POST",
        body: {
          item: "白细胞计数",
          unit: "10^9/L",
          op: "gt",
          threshold: 0,
          recheckDays: null,
          severity: "warning",
          note: "快照",
        },
      },
    ],
    monitorsAfter: [
      `/api/patients/${patient.id}/lab-monitors`,
      { method: "GET" },
    ],
    alertsAfter: [
      `/api/risk-alerts?patientId=${patient.id}`,
      { method: "GET" },
    ],
  };
  let monitor;
  for (const [name, [path, options]] of Object.entries(calls)) {
    const response = await app.request(path, options);
    if (name === "monitorCreate") monitor = response.body;
    out[name] = { status: response.status, body: response.body };
  }
  const paused = await app.request(
    `/api/patients/${patient.id}/lab-monitors/${monitor.id}`,
    { method: "PATCH", body: { revision: 0, status: "paused" } },
  );
  out.monitorPause = { status: paused.status, body: paused.body };
  assert.deepEqual(normalize(out), snapshot);
});

test("risk-rules：停用后风险接口和待办来源消失，用药安全仍固定可用", async (t) => {
  const app = await startTestServer({ provider: createScriptedProvider([]) });
  t.after(() => app.close());
  const [patient] = await app.patients();
  await createMonitor(app, patient.id);
  const before = await app.request("/api/doctor/overview?limit=100");
  assert.ok(before.body.items.some((item) => item.kind === "risk"));

  const disabled = await app.request("/api/plugins/risk-rules", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal((await app.request("/api/risk-alerts")).status, 404);
  assert.equal(
    (await app.request(`/api/patients/${patient.id}/lab-monitors`)).status,
    404,
  );

  const after = await app.request("/api/doctor/overview?limit=100");
  assert.equal(after.status, 200);
  assert.equal(after.body.counts.risk, undefined);
  assert.ok(!after.body.items.some((item) => item.kind === "risk"));

  const tools = app.server.runtime.toolDefinitions.map(
    (tool) => tool.function.name,
  );
  assert.ok(tools.includes("review_medication_safety"));
  assert.ok(
    (await app.request(`/api/patients/${patient.id}/brief`)).body.counts
      .activeRisks === 0,
  );
  assert.equal((await app.request(`/api/patients/${patient.id}/brief`)).status, 200);
});
