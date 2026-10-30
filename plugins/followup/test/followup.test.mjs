import "../../../tests/helpers/fixed-clock.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createScriptedProvider } from "../../../tests/helpers/scripted-provider.mjs";
import { startTestServer, waitFor } from "../../../tests/helpers/server.mjs";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const normalizeNode = (value) => {
  if (Array.isArray(value)) return value.map(normalizeNode);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        // The host OS is reported as-is; the snapshot was recorded on Linux.
        key === "platform" && typeof item === "string" ? "<platform>" : normalizeNode(item),
      ]),
    );
  if (typeof value === "string")
    return value
      .replace(UUID, "<uuid>")
      .replace(/202\d-\d\d-\d\dT[^"]+/g, "<time>");
  // Demo-pack dates are intentionally relative; wall-clock timestamps are not
  // part of the route contract.
  if (typeof value === "number" && value > 1e12) return "<time>";
  return value;
};
const normalize = (value) => normalizeNode(value);

const SNAPSHOT = JSON.parse(
  readFileSync(new URL("./fixtures/routes.snapshot.json", import.meta.url), "utf8"),
);
const byId = (plugins) =>
  Object.fromEntries(plugins.map((plugin) => [plugin.id, plugin]));
const PLUGIN_ROOT = fileURLToPath(new URL("../../../plugins", import.meta.url));
const CHANNEL_FAKE = fileURLToPath(
  new URL("../../../tests/fixtures/plugins/channel-fake", import.meta.url),
);
const followupDirs = [PLUGIN_ROOT, CHANNEL_FAKE];
// Patient messaging needs a connected channel; these tests exercise the
// full plugin, so every server starts with the test-only channel adapter.
const startServer = (options = {}) =>
  startTestServer({
    ...options,
    serverOptions: { ...options.serverOptions, pluginDirs: followupDirs },
  });
const tempRoot = () => mkdtempSync(join(process.cwd(), ".followup-test-"));

test("随访私有路由迁移后与迁移前快照一致", async (t) => {
  const app = await startServer({ provider: createScriptedProvider([]) });
  t.after(() => app.close());

  for (const [route, expected] of Object.entries(SNAPSHOT)) {
    const response = await app.request(route);
    assert.equal(response.status, expected.status, `${route} 状态码应保持不变`);
    assert.deepEqual(
      normalize(response.body),
      normalize(expected.body),
      `${route} 响应应保持不变`,
    );
  }
});

test("随访联系记录 POST 仍返回 201", async (t) => {
  const app = await startServer({ provider: createScriptedProvider([]) });
  t.after(() => app.close());
  const patientId = (await app.request("/api/patients")).body.patients[0].id;
  const response = await app.request(
    `/api/patients/${patientId}/followup-records`,
    {
      method: "POST",
      body: { status: "completed", note: "已电话联系，情况稳定", contactMethod: "phone" },
    },
  );
  assert.equal(response.status, 201);
  assert.equal(response.body.patientId, patientId);
  assert.equal(response.body.outcome.status, "completed");
});

test("运行时停用 followup：路由 404、后台轮询停止、待办来源消失", async (t) => {
  const app = await startServer({ provider: createScriptedProvider([]) });
  t.after(() => app.close());

  const service = app.server.pluginHost.pluginServices.followup;
  assert.ok(service, "followup 服务应已装配");
  await waitFor(
    () =>
      service.followups.timer &&
      service.chatFollowups.timer &&
      service.care.timer,
    { description: "随访、聊天同步与 care 轮询启动" },
  );

  const disabled = await app.request("/api/plugins/followup", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.plugin.status, "disabled");

  assert.equal(service.followups.timer, null, "随访轮询应停止");
  assert.equal(service.chatFollowups.timer, null, "聊天同步轮询应停止");
  assert.equal(service.care.timer, null, "care tick 应停止");

  for (const route of [
    "/api/followup-plans",
    "/api/followups/overview",
    "/api/care/overview",
    "/api/chat-followups/settings",
    "/api/chat-aibot/replies",
  ]) {
    assert.equal((await app.request(route)).status, 404, `${route} 停用后应 404`);
  }

  const overview = await app.request("/api/doctor/overview?limit=100");
  assert.equal(overview.status, 200);
  assert.ok(
    !overview.body.kinds.some(({ kind }) => ["followup", "messages"].includes(kind)),
    "停用后今日待办不应再有 followup/messages 来源",
  );
  const rejected = await app.request("/api/doctor/overview?kind=followup");
  assert.equal(rejected.status, 400);
  assert.equal((await app.request("/api/agent/health")).status, 200);
});

test("从已停用数据库启动：随访工具不注册、没有后台轮询、服务正常启动", async (t) => {
  const root = tempRoot();
  const database = join(root, "medical.sqlite");
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const first = await startServer({
    provider: createScriptedProvider([]),
    seedDemoPack: false,
    serverOptions: { database },
  });
  const disabled = await first.request("/api/plugins/followup", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  await first.close();

  const second = await startServer({
    provider: createScriptedProvider([]),
    seedDemoPack: false,
    serverOptions: { database },
  });
  t.after(() => second.close());

  const list = byId((await second.request("/api/plugins")).body.plugins);
  assert.equal(list.followup.enabled, false);
  assert.equal(list.followup.status, "disabled");
  const service = second.server.pluginHost.pluginServices.followup;
  assert.ok(service, "停用插件的 setup 仍装配服务，但不得启动轮询");
  assert.ok(!service.followups.timer);
  assert.ok(!service.chatFollowups.timer);
  assert.ok(!service.care.timer);

  const toolNames = second.server.sessionBridge.toolNames();
  assert.ok(!toolNames.includes("followup_create_propose"));
  assert.ok(!toolNames.includes("followups_overview"));
  assert.ok(!toolNames.includes("care_overview"));
  assert.equal((await second.request("/api/followup-plans")).status, 404);
  assert.equal((await second.request("/api/agent/health")).status, 200);
});

test("同时停用两个渠道插件后 followup 变为 unavailable，服务仍正常启动", async (t) => {
  const root = tempRoot();
  const database = join(root, "medical.sqlite");
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const first = await startServer({
    provider: createScriptedProvider([]),
    seedDemoPack: false,
    serverOptions: { database },
  });
  for (const id of ["channel-wecom", "channel-wechat"]) {
    const response = await first.request(`/api/plugins/${id}`, {
      method: "PUT",
      body: { enabled: false },
    });
    assert.equal(response.status, 200);
  }
  await first.close();

  const second = await startServer({
    provider: createScriptedProvider([]),
    seedDemoPack: false,
    serverOptions: { database },
  });
  t.after(() => second.close());

  const list = byId((await second.request("/api/plugins")).body.plugins);
  assert.equal(list.followup.enabled, true);
  assert.equal(list.followup.available, false);
  assert.equal(list.followup.status, "unavailable");
  assert.match(list.followup.reason, /channel-wecom|channel-wechat/);
  assert.equal(second.server.pluginHost.pluginServices.followup, undefined);
  assert.equal((await second.request("/api/followup-plans")).status, 404);
  assert.equal((await second.request("/api/agent/health")).status, 200);
});

test("care 历史提案由插件 legacyProposalTypes 委派，确认后生效且 type 不变", async (t) => {
  const app = await startServer({ provider: createScriptedProvider([]) });
  t.after(() => app.close());

  const service = app.server.pluginHost.pluginServices.followup;
  const marker = `迁移关注词${Date.now() % 100000}`;
  const proposal = app.server.pending.propose({
    type: "care-settings",
    payload: { scope: "global", changes: { redFlags: { extra: [marker] } } },
    summary: "迁移后修改患者管理关注词",
  });
  assert.equal(proposal.type, "care-settings", "历史提案 type 字符串不能改变");

  const confirmed = await app.request(
    `/api/pending-actions/${proposal.id}/confirm`,
    { method: "POST", body: {} },
  );
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.action.type, "care-settings");
  assert.equal(confirmed.body.action.status, "applied");
  assert.ok(service.care.publicSettings().redFlags.extra.includes(marker));
});
