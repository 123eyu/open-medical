import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

const HOST_FIXTURES = fileURLToPath(
  new URL("../fixtures/host", import.meta.url),
);
const STATUS = join(HOST_FIXTURES, "status-provider");
const PLAIN = join(HOST_FIXTURES, "service-provider");

const byId = (plugins) =>
  Object.fromEntries(plugins.map((plugin) => [plugin.id, plugin]));

test("bootstrap.plugins 增加 available/connected/capabilities，connected 由 status(ctx) 计算", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
    seedDemoPack: false,
    serverOptions: { pluginDirs: [STATUS, PLAIN] },
  });
  t.after(() => app.close());

  const first = await app.request("/api/bootstrap");
  assert.equal(first.status, 200);
  const plugins = byId(first.body.plugins);
  assert.equal(plugins["status-provider"].available, true);
  assert.equal(plugins["status-provider"].enabled, true);
  assert.equal(plugins["status-provider"].connected, true);
  assert.deepEqual(plugins["status-provider"].capabilities, [
    "echo",
    "connected",
  ]);
  assert.equal(plugins["service-provider"].available, true);
  assert.equal(plugins["service-provider"].connected, null);
  assert.deepEqual(plugins["service-provider"].capabilities, []);

  app.server.pluginHost.setConfig("status-provider", "connected", false);
  const second = await app.request("/api/bootstrap");
  assert.equal(byId(second.body.plugins)["status-provider"].connected, false);

  const disabled = await app.request("/api/plugins/status-provider", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  const third = await app.request("/api/bootstrap");
  const afterDisable = byId(third.body.plugins)["status-provider"];
  assert.equal(afterDisable.enabled, false);
  assert.equal(afterDisable.available, true, "available 与 enabled 不是一回事");
  assert.equal(afterDisable.connected, null);
});
