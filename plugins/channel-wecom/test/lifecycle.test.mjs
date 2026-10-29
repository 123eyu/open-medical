import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createScriptedProvider } from "../../../tests/helpers/scripted-provider.mjs";
import { startTestServer, waitFor } from "../../../tests/helpers/server.mjs";

const tempRoot = () => mkdtempSync(join(process.cwd(), ".wecom-test-"));

const startAt = async (database, options = {}) =>
  startTestServer({
    provider: createScriptedProvider([]),
    seedDemoPack: false,
    serverOptions: {
      database,
      wecom: {
        corpId: "wwsnap0000000001",
        corpSecret: "snap-secret-123456",
        callbackToken: "snaptoken",
        aesKey: "a".repeat(43),
      },
      ...options,
    },
  });

const byId = (plugins) => Object.fromEntries(plugins.map((p) => [p.id, p]));

test("运行时停用 channel-wecom：路由 404、定时器与 WSS 停止、回调按未配置处理", async (t) => {
  const root = tempRoot();
  const database = join(root, "medical.sqlite");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const running = await startAt(database);
  t.after(() => running.close());

  const service = running.server.channelWecom;
  await waitFor(
    () =>
      service.started &&
      service.timer &&
      running.server.chatFollowups.aibot.timer,
    { description: "channel-wecom 定时器与 aibot 定时器启动" },
  );
  assert.equal((await running.request("/api/wecom/status")).status, 200);

  const disabled = await running.request("/api/plugins/channel-wecom", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal((await running.request("/api/wecom/status")).status, 404);
  assert.equal(service.started, false);
  assert.equal(service.timer, null);
  assert.equal(running.server.chatFollowups.aibot.timer, null);
  assert.equal(
    running.server.pluginHost.pluginServices.channel.list().length,
    0,
    "停用后不得残留已注册 adapter",
  );

  const callback = await running.request(
    "/api/wecom/callback?timestamp=1&nonce=n&msg_signature=x&echostr=y",
    { auth: false },
  );
  assert.equal(callback.status, 503);
  assert.equal(callback.body.code, "WECOM_UNCONFIGURED");
  assert.equal(callback.body.error, "企业微信回调未配置");
  assert.equal((await running.request("/api/agent/health")).status, 200);
});

test("从已停用数据库启动：不启动目录定时器/WSS，路由 404，服务仍可用", async (t) => {
  const root = tempRoot();
  const database = join(root, "medical.sqlite");
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const first = await startAt(database);
  await waitFor(() => first.server.channelWecom.started, {
    description: "首次启动 channel-wecom",
  });
  const disabled = await first.request("/api/plugins/channel-wecom", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  await first.close();

  const second = await startAt(database);
  t.after(() => second.close());
  const list = byId((await second.request("/api/plugins")).body.plugins);
  assert.equal(list["channel-wecom"].enabled, false);
  assert.equal(second.server.channelWecom.started, false);
  assert.equal(second.server.channelWecom.timer, null);
  assert.equal(second.server.chatFollowups.aibot.timer, null);
  assert.equal((await second.request("/api/wecom/status")).status, 404);
  assert.equal((await second.request("/api/agent/health")).status, 200);

  const callback = await second.request(
    "/api/wecom/callback?timestamp=1&nonce=n&msg_signature=x&echostr=y",
    { auth: false },
  );
  assert.equal(callback.status, 503);
  assert.equal(callback.body.error, "企业微信回调未配置");
});
