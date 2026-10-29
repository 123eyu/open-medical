import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createScriptedProvider } from "../../../tests/helpers/scripted-provider.mjs";
import { startTestServer } from "../../../tests/helpers/server.mjs";

const PRODUCTION_PLUGINS = fileURLToPath(new URL("../..", import.meta.url));
const CHANNEL_FAKE = fileURLToPath(new URL("../../../tests/fixtures/plugins/channel-fake", import.meta.url));

test("learning 插件拥有学习设置、习惯与自动化；停用后一起消失且固定区技能仍在", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
    serverOptions: { pluginDirs: [PRODUCTION_PLUGINS, CHANNEL_FAKE] },
  });
  t.after(() => app.close());

  assert.equal((await app.request("/api/learning/settings")).status, 200);
  assert.equal((await app.request("/api/review-stats?range=90d")).status, 200);

  const created = await app.request("/api/extensions", {
    method: "POST",
    body: {
      kind: "automation",
      spec: {
        name: "学习插件规则",
        trigger: { type: "daily", time: "08:00" },
        condition: {},
        action: { type: "agenda", title: "规则提醒", detail: "由学习插件生成" },
      },
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.kind, "automation");

  const overview = await app.request("/api/extensions");
  assert.equal(overview.status, 200);
  assert.ok(overview.body.extensions.some((item) => item.kind === "automation"));
  assert.ok(overview.body.triggers?.daily);

  const disabled = await app.request("/api/plugins/learning", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal((await app.request("/api/learning/settings")).status, 404);
  assert.equal((await app.request("/api/review-stats")).status, 404);
  const skills = await app.request("/api/extensions");
  assert.equal(skills.status, 200);
  assert.ok(!skills.body.extensions.some((item) => item.kind === "automation"));
  assert.ok(Array.isArray(skills.body.extensions));

  const enabled = await app.request("/api/plugins/learning", {
    method: "PUT",
    body: { enabled: true },
  });
  assert.equal(enabled.status, 200);
  assert.equal((await app.request("/api/learning/settings")).status, 200);
});
