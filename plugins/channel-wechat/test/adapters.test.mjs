import test from "node:test";
import assert from "node:assert/strict";
import { validateAdapter } from "../../channel/contract.mjs";
import { createScriptedProvider } from "../../../tests/helpers/scripted-provider.mjs";
import { startTestServer, waitFor } from "../../../tests/helpers/server.mjs";

const start = (serverOptions = {}) =>
  startTestServer({
    provider: createScriptedProvider([]),
    seedDemoPack: false,
    serverOptions,
  });

test("三个个人微信 adapter 通过 validateAdapter，能力矩阵与现状一致", async (t) => {
  const app = await start();
  t.after(() => app.close());
  const service = app.server.channelWechat;
  await waitFor(() => service.started, { description: "channel-wechat 启动" });

  for (const adapter of service.adapters) validateAdapter(adapter);
  const matrix = Object.fromEntries(
    service.adapters.map((adapter) => [
      adapter.id,
      {
        receive: adapter.capabilities.receive,
        send: adapter.capabilities.send,
        history: adapter.capabilities.history,
        groups: adapter.capabilities.groups,
        contacts: adapter.capabilities.contacts,
        binding: adapter.capabilities.binding,
        qr: adapter.capabilities.qr,
      },
    ]),
  );
  assert.deepEqual(matrix, {
    "wechat-desktop": {
      receive: "poll",
      send: "confirm",
      history: false,
      groups: false,
      contacts: true,
      binding: true,
      qr: false,
    },
    "wechat-cli": {
      receive: "poll",
      send: "none",
      history: true,
      groups: true,
      contacts: false,
      binding: true,
      qr: false,
    },
    "wechat-import": {
      receive: "none",
      send: "none",
      history: true,
      groups: false,
      contacts: false,
      binding: false,
      qr: false,
    },
  });
  const registered = app.server.pluginHost.pluginServices.channel
    .list()
    .map((adapter) => adapter.id)
    .filter((id) => id.startsWith("wechat-"));
  assert.deepEqual(registered, [
    "wechat-cli",
    "wechat-desktop",
    "wechat-import",
  ]);
});

test("桌面微信未确认时 channel.send 与 adapter.send 都不触发读取/发送", async (t) => {
  const calls = [];
  const reader = {
    platform: "win32",
    status: async () => ({ ready: true, message: "ok" }),
    send: async () => {
      calls.push("reader.send");
      return { fingerprint: "fake" };
    },
    read: async () => {
      calls.push("reader.read");
      return { text: "x" };
    },
  };
  const app = await start({ channelWechat: { reader } });
  t.after(() => app.close());
  const service = app.server.channelWechat;
  await waitFor(() => service.started, { description: "channel-wechat 启动" });

  const result = await app.server.pluginHost.pluginServices.channel.send(
    "wechat-desktop",
    { bindingId: "b1" },
    "请下周复诊。",
    { requestId: "r1" },
  );
  assert.equal(result.state, "awaiting_member");
  assert.match(result.error, /医生确认/);
  assert.equal(calls.length, 0, "未确认不得产生任何屏幕读取或发送动作");

  const direct = await service.adapter("wechat-desktop").send(
    { bindingId: "b1" },
    "请下周复诊。",
    {},
  );
  assert.equal(direct.state, "awaiting_member");
  assert.equal(calls.length, 0);
});
