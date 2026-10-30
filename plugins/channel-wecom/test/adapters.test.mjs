import test from "node:test";
import assert from "node:assert/strict";
import { validateAdapter } from "../../channel/contract.mjs";
import { createScriptedProvider } from "../../../tests/helpers/scripted-provider.mjs";
import { startTestServer, waitFor } from "../../../tests/helpers/server.mjs";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CHANNEL_FAKE = fileURLToPath(
  new URL("../../../tests/fixtures/plugins/channel-fake", import.meta.url),
);
const start = (serverOptions = {}) =>
  startTestServer({
    provider: createScriptedProvider([]),
    seedDemoPack: false,
    // This suite asserts the WeCom-owned tools; followup must be active so its
    // wecom_* proposal tools are registered alongside the adapter tools.
    serverOptions: {
      pluginDirs: [PLUGIN_ROOT, CHANNEL_FAKE],
      ...serverOptions,
    },
  });

test("四个 WeCom adapter 通过 validateAdapter，能力矩阵与设计一致", async (t) => {
  const app = await start();
  t.after(() => app.close());
  const service = app.server.channelWecom;
  await waitFor(() => service.started, { description: "channel-wecom 启动" });

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
    "wecom-customer": {
      receive: "none",
      send: "confirm",
      history: false,
      groups: true,
      contacts: true,
      binding: true,
      qr: false,
    },
    "wecom-kf": {
      receive: "push",
      send: "direct",
      history: true,
      groups: false,
      contacts: false,
      binding: true,
      qr: false,
    },
    "wecom-aibot": {
      receive: "push",
      send: "direct",
      history: false,
      groups: true,
      contacts: false,
      binding: false,
      qr: false,
    },
    "wecom-archive": {
      receive: "none",
      send: "none",
      history: true,
      groups: false,
      contacts: false,
      binding: false,
      qr: false,
    },
  });
  assert.deepEqual(
    app.server.pluginHost.pluginServices.channel
      .list()
      .map((a) => a.id)
      .filter((id) => id.startsWith("wecom-")),
    ["wecom-aibot", "wecom-archive", "wecom-customer", "wecom-kf"],
  );

  const wecomTools = () => {
    const tools = [];
    app.server.pluginHost.registerTools(
      { register: (tool) => tools.push(tool.definition.function.name) },
      { kind: "session" },
      null,
    );
    // Other enabled plugins contribute their own tools to the same registry;
    // this assertion covers the WeCom adapter tool surface.
    return tools.filter((name) => name.startsWith("wecom_")).sort();
  };
  const contactTools = ["wecom_customers", "wecom_groups", "wecom_patient_contacts", "wecom_sync"];
  // Customer contact not configured: read tools and the WeCom prompt stay hidden.
  assert.ok(!wecomTools().some((name) => contactTools.includes(name)));
  assert.doesNotMatch(app.server.pluginHost.promptFragments(), /wecom_customers/);

  // Once the connector has a client, both appear.
  const connector = service.connector;
  connector.client = {};
  t.after(() => { connector.client = null; });
  assert.deepEqual(
    wecomTools().filter((name) => contactTools.includes(name)),
    contactTools,
  );
  assert.match(app.server.pluginHost.promptFragments(), /wecom_customers/);
});

test("客户联系 adapter 未确认时返回 awaiting_member 且不发出网络请求", async (t) => {
  const calls = [];
  const fetchImpl = async (...args) => {
    calls.push(args);
    throw new Error("network must not be used");
  };
  const app = await start({ wecom: { fetch: fetchImpl } });
  t.after(() => app.close());
  const service = app.server.channelWecom;
  await waitFor(() => service.started, { description: "channel-wecom 启动" });

  const result = await app.server.pluginHost.pluginServices.channel.send(
    "wecom-customer",
    { patientId: "p1", bindingId: "b1" },
    "请下周复诊。",
    { requestId: "r1" },
  );
  assert.equal(result.state, "awaiting_member");
  assert.match(result.error, /医生确认/);
  assert.equal(calls.length, 0, "未确认不得产生任何网络请求");

  const direct = await service.adapter("wecom-customer").send(
    { patientId: "p1", bindingId: "b1" },
    "请下周复诊。",
    {},
  );
  assert.equal(direct.state, "awaiting_member");
  assert.equal(calls.length, 0);
});
