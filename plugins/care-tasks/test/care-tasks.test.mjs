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
  if (typeof value === "string") {
    if (/^care_[0-9a-f-]{36}$/i.test(value)) return "<id>";
    if (/^[0-9a-f]{64}$/i.test(value)) return "<fingerprint>";
    return value.replace(UUID, "<uuid>");
  }
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 1e12 &&
    value < 1e13
  )
    return "<time>";
  return value;
};

async function createTask(app, patientId) {
  return app.request(`/api/patients/${patientId}/care-tasks`, {
    method: "POST",
    body: {
      title: "迁移快照事项",
      kind: "test",
      dueAt: new Date(Date.now() + 5 * 86400000).toISOString(),
      note: "快照备注",
      requestId: "11111111-1111-4111-8111-111111111111",
    },
  });
}

test("care-tasks：旧检查跟进接口迁移前后响应一致", async (t) => {
  const app = await startTestServer({ provider: createScriptedProvider([]) });
  t.after(() => app.close());
  const [patient] = await app.patients();
  const created = await createTask(app, patient.id);
  const listed = await app.request(
    `/api/patients/${patient.id}/care-tasks?status=active`,
  );
  assert.deepEqual(
    normalize({ status: created.status, body: created.body }),
    snapshot.create,
  );
  assert.deepEqual(
    normalize({ status: listed.status, body: listed.body }),
    snapshot.list,
  );
});

test("care-tasks：待办来源由插件提供，停用后接口和条目消失", async (t) => {
  const app = await startTestServer({ provider: createScriptedProvider([]) });
  t.after(() => app.close());
  const [patient] = await app.patients();
  const created = await createTask(app, patient.id);
  const patched = await app.request(
    `/api/patients/${patient.id}/care-tasks/${created.body.id}`,
    {
      method: "PATCH",
      body: {
        action: "receive",
        expectedRevision: 0,
        note: "结果已收到",
        source: "门诊检验",
      },
    },
  );
  assert.equal(patched.status, 200);
  assert.equal(patched.body.status, "awaiting_review");

  const before = await app.request("/api/doctor/overview?limit=100");
  assert.ok(
    before.body.items.some((item) => item.id === `tracking:${created.body.id}`),
  );

  const disabled = await app.request("/api/plugins/care-tasks", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal(
    (await app.request(`/api/patients/${patient.id}/care-tasks`)).status,
    404,
  );

  const after = await app.request("/api/doctor/overview?limit=100");
  assert.equal(after.status, 200);
  assert.ok(
    !after.body.items.some((item) =>
      item.id.startsWith(`tracking:${created.body.id}`),
    ),
  );
  // 固定区「待阅检验」仍保留 tracking 分类，但不再有插件条目。
  assert.equal(after.body.counts.tracking, 0);
  assert.ok(!after.body.kinds.some((item) => item.kind === "care-task"));
});
