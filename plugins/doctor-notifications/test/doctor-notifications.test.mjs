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
  assert.equal(preview.detail, "count", "未选择时默认只发数量");
  assert.ok(preview.followup >= 1, "今天稍后到期的随访也应计入早上的摘要");
  assert.ok(preview.tracking >= 1, "检查跟进来源应计入摘要");
  assert.ok(!preview.text.includes(patient.name), "默认摘要不含患者姓名");

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
  const trackingBefore = withoutFollowup.body.channels[0].preview.tracking;
  assert.ok(trackingBefore >= 1);

  const disableCare = await app.request("/api/plugins/care-tasks", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disableCare.status, 200);
  const withoutCare = await app.request("/api/doctor-notifications");
  assert.equal(withoutCare.status, 200);
  assert.equal(
    withoutCare.body.channels[0].preview.tracking,
    trackingBefore - 1,
    "检查跟进插件停用后其条目从摘要中移除",
  );

  const disableSelf = await app.request("/api/plugins/doctor-notifications", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disableSelf.status, 200);
  assert.equal((await app.request("/api/doctor-notifications")).status, 404);
  assert.equal((await app.request("/api/doctor/overview")).status, 200);
  assert.equal((await app.request("/api/knowledge-bot")).status, 200);
});

test("doctor-notifications：推送内容与今日待办一致，姓名按医生选择显示", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
    serverOptions: { pluginDirs: [PLUGIN_ROOT, CHANNEL_FAKE] },
  });
  t.after(() => app.close());
  const [patient] = await app.patients();
  const db = app.server.store.db;
  // 把一位患者的治疗方案复评日期设为昨天：今日待办和推送都应出现「方案复评」。
  const row = db.prepare("SELECT data FROM patients WHERE id=?").get(patient.id);
  const data = JSON.parse(row.data);
  const yesterday = new Date(Date.now() - 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  data.treatmentPlan = { title: "降压方案", status: "active", reviewDate: yesterday, goal: "", interventions: "" };
  db.prepare("UPDATE patients SET data=? WHERE id=?").run(JSON.stringify(data), patient.id);

  const overview = await app.request("/api/doctor/overview?kind=plan-review");
  assert.equal(overview.status, 200);
  const review = overview.body.items.find((item) => item.patientId === patient.id);
  assert.ok(review, "复评日期已过的在用方案应进入今日待办");
  assert.match(review.title, /逾期 1 天/);
  assert.equal(review.action.tab, "medications");
  assert.ok(overview.body.kinds.some((k) => k.kind === "plan-review" && k.label === "方案复评"));

  const agendaTotal = (await app.request("/api/doctor/overview?limit=100")).body.total;
  const read = async () => (await app.request("/api/doctor-notifications")).body.channels.find((c) => c.channel === "feishu");
  const before = await read();
  assert.equal(before.preview.items, agendaTotal, "推送条数与今日待办一致");
  assert.match(before.preview.text, /方案复评 1/);
  assert.ok(!before.preview.text.includes(patient.name));

  const save = (detail, revision) => app.request("/api/doctor-notifications/feishu", {
    method: "PUT",
    body: { enabled: false, time: "09:00", timezone: "Asia/Shanghai", detail, expectedRevision: revision },
  });
  const invalid = await save("everything", before.revision);
  assert.equal(invalid.status, 400);

  const masked = await save("masked", before.revision);
  assert.equal(masked.status, 200);
  assert.equal(masked.body.detail, "masked");
  const surname = [...patient.name][0];
  assert.ok(masked.body.preview.text.includes(`${surname}*`), "姓氏遮挡后列出");
  assert.ok(!masked.body.preview.text.includes(patient.name), "遮挡模式不出现全名");
  assert.match(masked.body.preview.text, /【方案复评】/);
  assert.ok(!masked.body.preview.text.includes("降压方案"), "遮挡模式不含事项说明");

  const full = await save("full", masked.body.revision);
  assert.equal(full.status, 200);
  assert.ok(full.body.preview.text.includes(patient.name));
  assert.ok(full.body.preview.text.includes("降压方案"), "全名模式带简要说明");

  // 未带 detail 的保存保留医生之前的选择。
  const kept = await app.request("/api/doctor-notifications/feishu", {
    method: "PUT",
    body: { enabled: false, time: "08:30", timezone: "Asia/Shanghai", expectedRevision: full.body.revision },
  });
  assert.equal(kept.status, 200);
  assert.equal(kept.body.detail, "full");
});

test("doctor-notifications：到点经飞书私聊推送一次清单，当天不重复", async (t) => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    if (String(url).includes("tenant_access_token"))
      return new Response(JSON.stringify({ code: 0, tenant_access_token: "t-test" }));
    sent.push({ url: String(url), body });
    return new Response(JSON.stringify({ code: 0, data: {} }));
  };
  const app = await startTestServer({
    provider: createScriptedProvider([]),
    serverOptions: {
      pluginDirs: [PLUGIN_ROOT, CHANNEL_FAKE],
      doctorNotificationOptions: { fetchImpl, autoStart: false },
    },
  });
  t.after(() => app.close());
  const [patient] = await app.patients();
  const service = app.server.pluginHost.pluginServices["doctor-notifications"];
  service.vault.set("doctor-notifications:feishu", { appId: "cli_test", appSecret: "secret", userId: "ou_doctor" });
  // 保证至少有一项今日待办。
  app.server.pluginHost.pluginServices["care-tasks"].create(patient.id, {
    title: "复查血常规结果", kind: "test", dueAt: new Date(Date.now() - 3600000).toISOString(), note: "",
  });

  const current = (await app.request("/api/doctor-notifications")).body.channels.find((c) => c.channel === "feishu");
  assert.equal(current.hasConnection, true);
  const saved = await app.request("/api/doctor-notifications/feishu", {
    method: "PUT",
    body: { enabled: true, time: "00:00", timezone: "Asia/Shanghai", detail: "masked", expectedRevision: current.revision },
  });
  assert.equal(saved.status, 200);

  await service.tick();
  const messages = sent.filter((item) => item.url.includes("/im/v1/messages"));
  assert.equal(messages.length, 1, "到点推送一次");
  assert.equal(messages[0].body.receive_id, "ou_doctor");
  const text = JSON.parse(messages[0].body.content).text;
  assert.match(text, /今日待办提醒/);
  assert.match(text, /复查血常规结果/);
  assert.ok(!text.includes(patient.name), "遮挡模式不发全名");

  await service.tick();
  assert.equal(sent.filter((item) => item.url.includes("/im/v1/messages")).length, 1, "当天不重复推送");
  const after = (await app.request("/api/doctor-notifications")).body.channels.find((c) => c.channel === "feishu");
  assert.equal(after.delivery.status, "sent");
  assert.equal(after.delivery.detail, "masked");
});
