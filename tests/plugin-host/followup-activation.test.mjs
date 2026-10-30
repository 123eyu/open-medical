import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { startTestServer, waitFor } from "../helpers/server.mjs";

const PLUGIN_ROOT = fileURLToPath(new URL("../../plugins", import.meta.url));
const CHANNEL_FAKE = fileURLToPath(
  new URL("../fixtures/plugins/channel-fake", import.meta.url),
);
const ACTIVE_DIRS = [PLUGIN_ROOT, CHANNEL_FAKE];
const byId = (plugins) =>
  Object.fromEntries(plugins.map((plugin) => [plugin.id, plugin]));

async function bootstrap(app) {
  const response = await app.request("/api/bootstrap");
  assert.equal(response.status, 200);
  return byId(response.body.plugins);
}

function rows(app, table) {
  return app.server.store.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
}

test("未连接患者渠道：随访计划与提醒照常可用，患者消息的工具、待办、接口都不出现", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
  });
  t.after(() => app.close());

  const plugins = await bootstrap(app);
  assert.equal(plugins.followup.enabled, true);
  assert.equal(plugins.followup.available, true);
  assert.equal(plugins.followup.connected, false);
  assert.equal(plugins.followup.active, true, "随访不再依赖患者渠道");
  await waitFor(
    () => app.server.pluginHost.pluginServices.followup.started === true,
    { description: "followup lifecycle started without a channel" },
  );

  const tools = app.server.sessionBridge.toolNames();
  assert.ok(tools.includes("followup_create_propose"));
  assert.ok(tools.includes("followups_overview"));
  assert.equal(tools.includes("care_overview"), false);
  assert.equal(tools.includes("care_send_propose"), false);
  assert.equal(tools.includes("wecom_group_message_propose"), false);
  const fragments = app.server.pluginHost.promptFragments();
  assert.ok(fragments.includes("followup_create_propose"));
  const sources = app.server.pluginHost
    .agendaSources()
    .filter((source) => source.pluginId === "followup")
    .map((source) => source.kind);
  assert.deepEqual(sources, ["followup"], "患者消息待办来源在未连接时隐藏");

  const overview = await app.request("/api/doctor/overview?limit=100");
  assert.equal(overview.status, 200);
  assert.ok(overview.body.counts.followup > 0, "示例随访提醒进入今日待办");
  assert.equal(overview.body.counts.messages, undefined);

  assert.equal((await app.request("/api/followups/overview")).status, 200);
  assert.equal((await app.request("/api/followup-plans")).status, 200);
  for (const path of ["/api/care/overview", "/api/inbox"]) {
    const response = await app.request(path);
    assert.equal(response.status, 409, path);
    assert.equal(response.body.code, "PATIENT_CHANNEL_NOT_CONNECTED", path);
  }
  const settings = await app.request("/api/chat-followups/settings");
  assert.equal(settings.status, 200, "连接管理始终可用");
  const reminders = await app.request("/api/reminders");
  assert.equal(reminders.status, 200);
  assert.ok(reminders.body.reminders.length > 0);

  // 示例资料只建医生自己的随访提醒：没有问卷、患者消息或回复草稿。
  const jobs = app.server.store.db.prepare("SELECT data FROM follow_ups").all().map((row) => JSON.parse(row.data));
  assert.ok(jobs.length > 0);
  assert.ok(jobs.every((job) => !job.questionnaire));
  assert.equal(rows(app, "care_replies"), 0);
  assert.equal(rows(app, "patient_messages"), 0);
  assert.equal(rows(app, "followup_surveys"), 0);
});

test("active：工具、待办来源、提示和后台循环随连接恢复", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
    serverOptions: { pluginDirs: ACTIVE_DIRS },
  });
  t.after(() => app.close());

  const plugins = await bootstrap(app);
  assert.equal(plugins.followup.active, true);
  assert.equal(plugins.followup.connected, true);

  await waitFor(
    () => app.server.pluginHost.pluginServices.followup.started === true,
    { description: "followup lifecycle started" },
  );
  const tools = app.server.sessionBridge.toolNames();
  assert.ok(tools.includes("followup_create_propose"));
  assert.ok(tools.includes("care_overview"));

  const overview = await app.request("/api/doctor/overview?limit=100");
  assert.equal(overview.status, 200);
  assert.ok(overview.body.counts.followup > 0);
  assert.ok(overview.body.counts.messages > 0);
  assert.ok(rows(app, "follow_ups") > 0);
  assert.ok(rows(app, "patient_messages") > 0);

  const reminders = await app.request("/api/reminders");
  assert.equal(reminders.status, 200);
  assert.ok(reminders.body.reminders.length > 0);
});

test("连接状态 未连接→已连接→断开：只有患者消息跟随变化，随访提醒一直可用", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
    serverOptions: { pluginDirs: ACTIVE_DIRS },
  });
  t.after(() => app.close());
  const host = app.server.pluginHost;
  const service = host.pluginServices["channel-fake"];
  // The fixture starts connected so the demo pack seeds followup/message data;
  // flip it off to exercise the same server without a channel.
  service.setConnected(false);
  const initial = await bootstrap(app);
  assert.equal(initial.followup.connected, false);
  assert.equal(initial.followup.active, true);
  const before = {
    followups: rows(app, "follow_ups"),
    messages: rows(app, "patient_messages"),
  };
  assert.ok(before.followups > 0);
  assert.ok(before.messages > 0);
  const unconnected = await app.request("/api/doctor/overview?limit=100");
  assert.ok(unconnected.body.counts.followup > 0);
  assert.equal(unconnected.body.counts.messages, undefined);
  assert.equal((await app.request("/api/followups/overview")).status, 200);
  assert.equal((await app.request("/api/care/overview")).status, 409);

  service.setConnected(true);
  const connected = await bootstrap(app);
  assert.equal(connected.followup.connected, true);
  assert.equal(connected.followup.active, true);
  const active = await app.request("/api/doctor/overview?limit=100");
  assert.ok(active.body.counts.followup > 0);
  assert.ok(active.body.counts.messages > 0);
  assert.equal((await app.request("/api/care/overview")).status, 200);

  service.setConnected(false);
  const disconnected = await bootstrap(app);
  assert.equal(disconnected.followup.connected, false);
  assert.equal(disconnected.followup.active, true);
  assert.equal(host.pluginServices.followup.started, true, "断开渠道不停随访定时");
  const overview = await app.request("/api/doctor/overview?limit=100");
  assert.ok(overview.body.counts.followup > 0);
  assert.equal(overview.body.counts.messages, undefined);
  const closed = await app.request("/api/care/overview");
  assert.equal(closed.status, 409);
  assert.equal(closed.body.code, "PATIENT_CHANNEL_NOT_CONNECTED");
  // Existing data is retained while messaging is unavailable.
  assert.equal(rows(app, "follow_ups"), before.followups);
  assert.equal(rows(app, "patient_messages"), before.messages);
  assert.ok((await app.request("/api/reminders")).body.reminders.length > 0);
});
