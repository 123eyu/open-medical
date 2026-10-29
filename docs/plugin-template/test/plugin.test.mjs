import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createScriptedProvider } from "__ROOT_REL__/tests/helpers/scripted-provider.mjs";
import { startTestServer } from "__ROOT_REL__/tests/helpers/server.mjs";

const PLUGIN_DIR = fileURLToPath(new URL("..", import.meta.url));

test("__PLUGIN_ID__：模板插件可加载、迁移并注册工具", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
    seedDemoPack: false,
    serverOptions: { pluginDirs: [PLUGIN_DIR] },
  });
  t.after(() => app.close());

  const list = await app.request("/api/plugins");
  const plugin = list.body.plugins.find((item) => item.id === "__PLUGIN_ID__");
  assert.equal(plugin.status, "ready");
  assert.equal(plugin.enabled, true);

  assert.equal(
    app.server.store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='__PLUGIN_TABLE___notes'",
      )
      .get().n,
    1,
  );
  const tools = app.server.pluginHost
    .legacyToolPlugins()
    .map((tool) => tool.definition.function.name);
  assert.ok(tools.includes("__PLUGIN_TOOL___notes_list"));

  const ping = await app.request("/api/p/__PLUGIN_ID__/ping");
  assert.equal(ping.status, 200);
  assert.equal(ping.body.ok, true);
});
