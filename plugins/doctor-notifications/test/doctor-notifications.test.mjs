import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createScriptedProvider } from "../../../tests/helpers/scripted-provider.mjs";
import { startTestServer } from "../../../tests/helpers/server.mjs";

const PLUGIN_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CHANNEL_FAKE = fileURLToPath(
  new URL("../../../tests/fixtures/plugins/channel-fake", import.meta.url),
);
const dueNow = () => new Date(Date.now() + 60_000).toISOString();

test("doctor-notifications：提醒摘要通过 followup / care-tasks 服务取数，来源停用后为空", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
    serverOptions: { pluginDirs: [PLUGIN_ROOT, CHANNEL_FAKE] },
  });
  t.after(() => app.close());
  const [patient] = await app.patients();
  // Isolate the digest from the demo pack's seeded rows: this test asserts
  // which plugin service each part of the digest comes from.
  for (const table of ["reminders", "follow_ups", "care_tasks"])
    app.server.store.db.prepare(`DELETE FROM ${table}`).run();

  const followup = app.server.pluginHost.pluginServices.followup;
  followup.followups.create(patient.id, {
    name: "提醒摘要测试",
    once: true,
    firstDueAt: dueNow(),
    checklist: [],
    externalConsent: false,
  });
  // Keep the fixed reminder row out of the assertion so the source under
  // test is the plugin-owned follow_ups table.
  app.server.store.db
    .prepare("DELETE FROM reminders WHERE patient_id=? AND kind='followup'")
    .run(patient.id);
  app.server.pluginHost.pluginServices["care-tasks"].create(patient.id, {
    title: "提醒摘要跟进",
    kind: "test",
    dueAt: dueNow(),
    note: "",
  });

  const settings = await app.request("/api/doctor-notifications");
  assert.equal(settings.status, 200);
  assert.deepEqual(
    settings.body.channels.map((channel) => channel.channel),
    ["wechat", "feishu"],
  );
  const preview = settings.body.channels[0].preview;
  assert.ok(preview.followup >= 1, "随访来源应计入摘要");
  assert.ok(preview.tracking >= 1, "检查跟进来源应计入摘要");

  const disableFollowup = await app.request("/api/plugins/followup", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disableFollowup.status, 200);
  const withoutFollowup = await app.request("/api/doctor-notifications");
  assert.equal(withoutFollowup.status, 200);
  assert.equal(
    withoutFollowup.body.channels[0].preview.followup,
    0,
    "随访插件停用后摘要中的随访部分为空",
  );
  assert.ok(withoutFollowup.body.channels[0].preview.tracking >= 1);

  const disableCare = await app.request("/api/plugins/care-tasks", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disableCare.status, 200);
  const withoutCare = await app.request("/api/doctor-notifications");
  assert.equal(withoutCare.status, 200);
  assert.equal(withoutCare.body.channels[0].preview.tracking, 0);
  assert.equal(withoutCare.body.channels[0].preview.patients, 0);

  const disableSelf = await app.request("/api/plugins/doctor-notifications", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disableSelf.status, 200);
  assert.equal((await app.request("/api/doctor-notifications")).status, 404);
  assert.equal((await app.request("/api/doctor/overview")).status, 200);
  assert.equal((await app.request("/api/knowledge-bot")).status, 200);
});
