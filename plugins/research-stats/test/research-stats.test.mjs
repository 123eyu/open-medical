import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createScriptedProvider } from "../../../tests/helpers/scripted-provider.mjs";
import { startTestServer } from "../../../tests/helpers/server.mjs";

const snapshot = JSON.parse(
  readFileSync(
    new URL("./fixtures/routes.snapshot.json", import.meta.url),
    "utf8",
  ),
);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const normalize = (value) =>
  typeof value === "string"
    ? value.replace(UUID, "<uuid>")
    : Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]))
        : value;

async function dataset(app) {
  const status = await app.request("/api/demo-pack");
  assert.equal(status.status, 200);
  const detail = await app.request(`/api/sessions/${status.body.sessionId}`);
  assert.equal(detail.status, 200);
  const file = detail.body.files.find((item) => item.name === "示例研究数据.csv");
  assert.ok(file, "示例研究数据.csv 应存在");
  return { sessionId: status.body.sessionId, sourceId: file.id };
}

test("research-stats：旧统计接口迁移前后响应一致", async (t) => {
  const app = await startTestServer({ provider: createScriptedProvider([]) });
  t.after(() => app.close());
  const { sessionId, sourceId } = await dataset(app);
  const calls = {
    profile: { sessionId, sourceId },
    test: {
      sessionId,
      sourceId,
      outcome: "sbp",
      group: "group",
      method: "auto",
    },
    "sample-size": {
      design: "means",
      alpha: 0.05,
      power: 0.8,
      delta: 8,
      sd: 12,
    },
    deidentify: { sessionId, sourceId, columns: ["subject"] },
  };
  for (const [name, expected] of Object.entries(snapshot)) {
    const response = await app.request(`/api/research/${name}`, {
      method: "POST",
      body: calls[name],
    });
    assert.equal(response.status, expected.status, name);
    assert.deepEqual(normalize(response.body), normalize(expected.body), name);
  }
});

test("research-stats：停用后接口 404、插件工具不注册，固定区 cohort_profile 保留", async (t) => {
  const app = await startTestServer({ provider: createScriptedProvider([]) });
  t.after(() => app.close());
  const before = app.server.pluginHost
    .legacyToolPlugins()
    .map((tool) => tool.definition.function.name);
  assert.ok(before.includes("stats_test"));
  assert.ok(before.includes("sample_size"));
  assert.ok(before.includes("deidentify_csv"));
  assert.ok(
    app.server.runtime.toolDefinitions.some(
      (tool) => tool.function.name === "cohort_profile",
    ),
    "cohort_profile 是固定区全局助手能力，不能被插件带走",
  );

  const disabled = await app.request("/api/plugins/research-stats", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.plugin.enabled, false);
  const route = await app.request("/api/research/profile", {
    method: "POST",
    body: { sessionId: "missing", sourceId: "missing" },
  });
  assert.equal(route.status, 404);
  const after = app.server.pluginHost
    .legacyToolPlugins()
    .map((tool) => tool.definition.function.name);
  assert.ok(!after.includes("stats_test"));
  assert.ok(!after.includes("sample_size"));
  assert.ok(!after.includes("deidentify_csv"));
  assert.ok(
    app.server.runtime.toolDefinitions.some(
      (tool) => tool.function.name === "cohort_profile",
    ),
  );
});
