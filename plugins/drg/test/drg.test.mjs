import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createScriptedProvider } from "../../../tests/helpers/scripted-provider.mjs";
import { startTestServer } from "../../../tests/helpers/server.mjs";

const snapshot = JSON.parse(
  readFileSync(new URL("./fixtures/routes.snapshot.json", import.meta.url), "utf8"),
);

const calls = {
  "/api/drg/settings": { method: "GET" },
  "/api/drg/group": {
    method: "POST",
    body: {
      principalDx: "I50.900",
      secondaryDx: ["E11.900"],
      procedures: [],
      totalCost: 12000,
    },
  },
  "/api/drg/batch": {
    method: "POST",
    body: {
      csvText:
        "principal_dx,secondary_dx,procedures,total_cost\nI50.900,E11.900,,12000",
    },
  },
};

test("drg：旧测算接口迁移前后响应一致", async (t) => {
  const app = await startTestServer({ provider: createScriptedProvider([]) });
  t.after(() => app.close());
  for (const [path, expected] of Object.entries(snapshot)) {
    const response = await app.request(path, calls[path]);
    assert.equal(response.status, expected.status, path);
    assert.deepEqual(response.body, expected.body, path);
  }
});

test("drg：停用后接口 404，分组工具不注册", async (t) => {
  const app = await startTestServer({ provider: createScriptedProvider([]) });
  t.after(() => app.close());
  const before = app.server.pluginHost
    .legacyToolPlugins()
    .map((tool) => tool.definition.function.name);
  assert.ok(before.includes("drg_group"));
  assert.ok(before.includes("drg_batch_analyze"));

  const disabled = await app.request("/api/plugins/drg", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);

  for (const path of Object.keys(snapshot)) {
    const response = await app.request(path, calls[path]);
    assert.equal(response.status, 404, path);
  }
  const after = app.server.pluginHost
    .legacyToolPlugins()
    .map((tool) => tool.definition.function.name);
  assert.ok(!after.includes("drg_group"));
  assert.ok(!after.includes("drg_batch_analyze"));
});
