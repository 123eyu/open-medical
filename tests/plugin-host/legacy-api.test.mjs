import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

const HOST_FIXTURES = fileURLToPath(
  new URL("../fixtures/host", import.meta.url),
);
const LEGACY = join(HOST_FIXTURES, "legacy-api");
const CONFLICT_A = join(HOST_FIXTURES, "legacy-conflict-a");
const CONFLICT_B = join(HOST_FIXTURES, "legacy-conflict-b");

const start = (pluginDirs) =>
  startTestServer({
    provider: createScriptedProvider([]),
    seedDemoPack: false,
    serverOptions: { pluginDirs },
  });

test("legacyApiPaths：exact > :param > *，方法匹配，/api/patients 分支之前，false 继续固定路由", async (t) => {
  const app = await start([LEGACY]);
  t.after(() => app.close());

  const exact = await app.request("/api/legacy/order/exact");
  assert.equal(exact.status, 200);
  assert.deepEqual(exact.body, { route: "exact" });

  const param = await app.request("/api/legacy/order/other");
  assert.equal(param.status, 200);
  assert.deepEqual(param.body, { route: "param", id: "other" });

  const wildcard = await app.request("/api/legacy/order/other/deep");
  assert.equal(wildcard.status, 200);
  assert.deepEqual(wildcard.body, {
    route: "wildcard",
    rest: "other/deep",
  });

  const post = await app.request("/api/legacy/post", {
    method: "POST",
    body: {},
  });
  assert.equal(post.status, 201);
  assert.equal(post.body.route, "post");

  const methodMismatch = await app.request("/api/legacy/method-only", {
    method: "POST",
    body: {},
  });
  assert.equal(methodMismatch.status, 404);
  assert.notEqual(methodMismatch.body?.route, "method-only");

  const patient = await app.request("/api/patients/pat_123/legacy-echo");
  assert.equal(patient.status, 200);
  assert.deepEqual(patient.body, { route: "patient", id: "pat_123" });

  const fallthrough = await app.request("/api/legacy/fallthrough");
  assert.equal(fallthrough.status, 404);

  const boom = await app.request("/api/legacy/boom");
  assert.equal(boom.status, 500);
  assert.equal(boom.body.code, "LEGACY_BOOM");
});

test("legacyApiPaths 仍在 guard 之后：无 token 返回 401 且不执行 handler", async (t) => {
  const app = await start([LEGACY]);
  t.after(() => app.close());

  const unauthorized = await app.request("/api/legacy/order/exact", {
    auth: false,
  });
  assert.equal(unauthorized.status, 401);
  assert.notEqual(unauthorized.body?.route, "exact");

  const tokenUnauthorized = await app.request(
    "/api/legacy/order/exact?token=wrong",
    { auth: false },
  );
  assert.equal(tokenUnauthorized.status, 401);
});

test("legacyApiPaths 冲突时相关插件标记 unavailable，服务照常启动", async (t) => {
  const app = await start([CONFLICT_A, CONFLICT_B]);
  t.after(() => app.close());

  const list = await app.request("/api/plugins");
  assert.equal(list.status, 200);
  const byId = Object.fromEntries(
    list.body.plugins.map((plugin) => [plugin.id, plugin]),
  );
  assert.equal(byId["legacy-conflict-a"].status, "unavailable");
  assert.equal(byId["legacy-conflict-b"].status, "unavailable");
  assert.match(byId["legacy-conflict-a"].reason, /冲突/);
  assert.match(byId["legacy-conflict-b"].reason, /冲突/);

  const route = await app.request("/api/legacy/conflict");
  assert.equal(route.status, 404);
  const health = await app.request("/api/agent/health");
  assert.equal(health.status, 200);
});

test("legacyApiPaths 只匹配已启用插件", async (t) => {
  const app = await start([LEGACY]);
  t.after(() => app.close());

  assert.equal((await app.request("/api/legacy/method-only")).status, 200);

  const disabled = await app.request("/api/plugins/legacy-api", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.plugin.enabled, false);
  assert.equal((await app.request("/api/legacy/method-only")).status, 404);

  const enabled = await app.request("/api/plugins/legacy-api", {
    method: "PUT",
    body: { enabled: true },
  });
  assert.equal(enabled.status, 200);
  assert.equal((await app.request("/api/legacy/method-only")).status, 200);
});
