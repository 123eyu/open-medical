import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { WechatExpService } from "../server/wechat-exp.mjs";
import { createScriptedProvider } from "../../../tests/helpers/scripted-provider.mjs";
import { startTestServer, waitFor } from "../../../tests/helpers/server.mjs";

const byId = (plugins) => Object.fromEntries(plugins.map((p) => [p.id, p]));

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const startAt = (database, options = {}) =>
  startTestServer({
    provider: createScriptedProvider([]),
    seedDemoPack: false,
    serverOptions: { database, ...options },
  });

test("运行时停用 channel-wechat：路由 404、服务停止、内嵌 9101 本地服务端口释放", async (t) => {
  const root = mkdtempSync(join(process.cwd(), ".wechat-lifecycle-"));
  const database = join(root, "medical.sqlite");
  const port = await freePort();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const running = await startAt(database, {
    channelWechat: {
      createExp: () =>
        new WechatExpService({ dataDir: root, port, log: () => {} }),
    },
  });
  t.after(() => running.close());

  const service = running.server.channelWechat;
  await waitFor(() => service.started, { description: "channel-wechat 启动" });
  assert.equal((await running.request("/api/wechat/status")).status, 200);
  assert.equal((await running.request("/api/wechat-exp/status")).status, 200);

  // The embedded bridge starts only for an enabled connection and a present
  // export tool; create both after startup, then reconcile immediately.
  mkdirSync(join(root, "wechat-exp"), { recursive: true });
  writeFileSync(join(root, "wechat-exp", "wechat_exp.exe"), "");
  running.server.store.db
    .prepare("INSERT INTO chat_connections VALUES (?,?)")
    .run(
      "wechat-exp",
      JSON.stringify({
        channel: "wechat-exp",
        protocol: "wx-cli",
        enabled: true,
        accountId: "wxid_test",
        revision: 1,
        cursor: "0",
      }),
    );
  await service.wechatExp.reconcile(running.server.chatFollowups);
  await waitFor(() => service.wechatExp.bridgeLive, {
    description: "内嵌 wx-cli 服务启动",
  });
  const health = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ready: true,
    current_account: { wxid: "wxid_test" },
    worker_id: "wechat-exp-embedded",
  });

  const disabled = await running.request("/api/plugins/channel-wechat", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal((await running.request("/api/wechat/status")).status, 404);
  assert.equal((await running.request("/api/wechat-exp/status")).status, 404);
  assert.equal(service.started, false);
  assert.equal(service.timer, null);
  assert.equal(service.wechatExp.bridgeLive, false);
  assert.equal(service.wechatExp.status().bridgeRunning, false);
  assert.equal(
    running.server.pluginHost.pluginServices.channel
      .list()
      .filter((adapter) => adapter.id.startsWith("wechat-")).length,
    0,
    "停用后不得残留已注册 adapter",
  );

  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
  assert.equal((await running.request("/api/agent/health")).status, 200);
});

test("从已停用数据库启动：相关路由 404、后台服务不启动、服务正常启动", async (t) => {
  const root = mkdtempSync(join(process.cwd(), ".wechat-lifecycle-"));
  const database = join(root, "medical.sqlite");
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const first = await startAt(database);
  await waitFor(() => first.server.channelWechat.started, {
    description: "首次启动 channel-wechat",
  });
  const disabled = await first.request("/api/plugins/channel-wechat", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  await first.close();

  const second = await startAt(database);
  t.after(() => second.close());
  const list = byId((await second.request("/api/plugins")).body.plugins);
  assert.equal(list["channel-wechat"].enabled, false);
  assert.equal(second.server.channelWechat.started, false);
  assert.equal(second.server.channelWechat.timer, null);
  assert.equal(second.server.channelWechat.wechatExp.bridgeLive, false);
  assert.equal((await second.request("/api/wechat/status")).status, 404);
  assert.equal((await second.request("/api/wechat-exp/status")).status, 404);
  assert.equal((await second.request("/api/agent/health")).status, 200);
});
