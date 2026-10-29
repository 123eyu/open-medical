import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

const FIXTURES = fileURLToPath(new URL("../fixtures/plugins", import.meta.url));
const HELLO = join(FIXTURES, "hello");

test("插件加载：/api/plugins、bootstrap 与固定区并存；空目录不影响启动", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
    serverOptions: { pluginDirs: [HELLO] },
  });
  t.after(() => app.close());

  const initial = await app.request("/api/plugins");
  assert.equal(initial.body.plugins[0].status, "disabled", "hello 默认停用，避免影响截图基线");
  const enabled = await app.request("/api/plugins/hello", {
    method: "PUT",
    body: { enabled: true },
  });
  assert.equal(enabled.status, 200);

  const list = await app.request("/api/plugins");
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.plugins.map(({ id, title, version, enabled, status }) => ({
      id,
      title,
      version,
      enabled,
      status,
    })),
    [
      {
        id: "hello",
        title: "Hello 示例插件",
        version: "1.0.0",
        enabled: true,
        status: "ready",
      },
    ],
  );

  const bootstrap = await app.request("/api/bootstrap");
  assert.equal(bootstrap.status, 200);
  assert.ok(
    bootstrap.body.plugins.some((plugin) => plugin.id === "hello"),
    "bootstrap 应返回插件列表",
  );
  assert.equal((await app.patients()).length, 3, "固定区患者列表仍然正常");

  const empty = await startTestServer({
    provider: createScriptedProvider([]),
    serverOptions: { pluginDirs: [join(FIXTURES, "not-a-real-plugin-dir")] },
  });
  t.after(() => empty.close());
  const emptyList = await empty.request("/api/plugins");
  assert.equal(emptyList.status, 200);
  assert.deepEqual(emptyList.body.plugins, []);
  assert.equal((await empty.patients()).length, 3, "无插件时固定区照常工作");
});
