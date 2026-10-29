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

test("dormant：工具、提示、待办来源和后台循环都不启动", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
  });
  t.after(() => app.close());

  const plugins = await bootstrap(app);
  assert.equal(plugins.followup.enabled, true);
  assert.equal(plugins.followup.available, true);
  assert.equal(plugins.followup.connected, false);
  assert.equal(plugins.followup.active, false);

  const tools = app.server.runtime.toolDefinitions.map((item) => item.function.name);
  assert.equal(tools.includes("followup_create_propose"), false);
  assert.equal(tools.includes("care_overview"), false);
  assert.equal(tools.includes("wecom_group_message_propose"), false);
  const fragments = app.server.pluginHost.promptFragments();
  assert.equal(fragments.includes("followup_create_propose"), false);
  assert.equal(
    app.server.pluginHost.agendaSources().some((source) => source.pluginId === "followup"),
    false,
  );
  assert.equal(app.server.pluginHost.pluginServices.followup.started, false);

  const overview = await app.request("/api/doctor/overview?limit=100");
  assert.equal(overview.status, 200);
  assert.equal(overview.body.counts.followup, undefined);
  assert.equal(overview.body.counts.messages, undefined);
  assert.deepEqual(
    [...new Set(overview.body.items.map((item) => item.kind))],
    ["visit"],
  );

  // Business routes are closed, while connector management and shared routes
  // stay available.
  for (const path of ["/api/followups/overview", "/api/care/overview"]) {
    const response = await app.request(path);
    assert.equal(response.status, 409, path);
    assert.equal(response.body.code, "FOLLOWUP_INACTIVE", path);
  }
  const settings = await app.request("/api/chat-followups/settings");
  assert.equal(settings.status, 200);
  const reminders = await app.request("/api/reminders");
  assert.equal(reminders.status, 200);
  assert.deepEqual(reminders.body.reminders, []);

  // The dormant demo pack must not create followup, care or patient messages.
  assert.equal(rows(app, "follow_ups"), 0);
  assert.equal(rows(app, "care_replies"), 0);
  assert.equal(rows(app, "patient_messages"), 0);
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
  const tools = app.server.runtime.toolDefinitions.map((item) => item.function.name);
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

test("连接状态 未连接→已连接→断开：界面数据与后台循环跟随变化，已有数据保留", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
    serverOptions: { pluginDirs: ACTIVE_DIRS },
  });
  t.after(() => app.close());
  const host = app.server.pluginHost;
  const service = host.pluginServices["channel-fake"];
  // The fixture starts connected so the demo pack seeds followup/message data;
  // flip it off to exercise the same server through a real dormant phase.
  service.setConnected(false);
  const initial = await bootstrap(app);
  assert.equal(initial.followup.connected, false);
  assert.equal(initial.followup.active, false);
  await waitFor(() => host.pluginServices.followup.started === false, {
    description: "followup lifecycle not started while unconnected",
  });
  const before = {
    followups: rows(app, "follow_ups"),
    messages: rows(app, "patient_messages"),
  };
  assert.ok(before.followups > 0);
  assert.ok(before.messages > 0);
  const dormant = await app.request("/api/doctor/overview?limit=100");
  assert.equal(dormant.body.counts.followup, undefined);
  assert.equal(dormant.body.counts.messages, undefined);
  assert.equal((await app.request("/api/followups/overview")).status, 409);

  service.setConnected(true);
  const connected = await bootstrap(app);
  assert.equal(connected.followup.connected, true);
  assert.equal(connected.followup.active, true);
  await waitFor(() => host.pluginServices.followup.started === true, {
    description: "followup lifecycle started after connect",
  });
  const active = await app.request("/api/doctor/overview?limit=100");
  assert.ok(active.body.counts.followup > 0);
  assert.ok(active.body.counts.messages > 0);

  service.setConnected(false);
  const disconnected = await bootstrap(app);
  assert.equal(disconnected.followup.connected, false);
  assert.equal(disconnected.followup.active, false);
  await waitFor(() => host.pluginServices.followup.started === false, {
    description: "followup lifecycle stopped after disconnect",
  });
  const overview = await app.request("/api/doctor/overview?limit=100");
  assert.equal(overview.body.counts.followup, undefined);
  assert.equal(overview.body.counts.messages, undefined);
  const closed = await app.request("/api/followups/overview");
  assert.equal(closed.status, 409);
  assert.equal(closed.body.code, "FOLLOWUP_INACTIVE");
  // Existing data is retained even while the feature is dormant; the shared
  // reminder bus stays readable.
  assert.equal(rows(app, "follow_ups"), before.followups);
  assert.equal(rows(app, "patient_messages"), before.messages);
  assert.ok((await app.request("/api/reminders")).body.reminders.length > 0);
});
