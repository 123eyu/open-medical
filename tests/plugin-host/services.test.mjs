import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

const HOST_FIXTURES = fileURLToPath(
  new URL("../fixtures/host", import.meta.url),
);
const fixture = (name) => join(HOST_FIXTURES, name);
const PROVIDER = fixture("service-provider");
const CONSUMER = fixture("service-consumer");
const ARRAY_DEP = fixture("service-array");

const start = (pluginDirs) =>
  startTestServer({
    provider: createScriptedProvider([]),
    seedDemoPack: false,
    serverOptions: { pluginDirs },
  });

const byId = (plugins) =>
  Object.fromEntries(plugins.map((plugin) => [plugin.id, plugin]));

test("provides.service 暴露为 ctx.service/ctx.plugins，依赖版本满足后可调用", async (t) => {
  const app = await start([PROVIDER, CONSUMER, ARRAY_DEP]);
  t.after(() => app.close());
  const host = app.server.pluginHost;

  const list = byId(host.list());
  assert.equal(list["service-provider"].status, "ready");
  assert.equal(list["service-consumer"].status, "ready");
  assert.equal(list["service-array"].status, "ready");

  const service = host.resolveService("echo");
  assert.deepEqual(service.echo("你好"), { text: "你好", apiVersion: 2 });
  assert.deepEqual(host.resolveService("echo", { apiVersion: 2 }).echo("v2"), {
    text: "v2",
    apiVersion: 2,
  });

  const consumer = host.pluginServices["service-consumer"];
  assert.deepEqual(consumer.call("依赖调用"), {
    text: "依赖调用",
    apiVersion: 2,
  });
  assert.equal(consumer.sameAsPlugins, true);
  assert.equal(consumer.apiVersion, 2);
  assert.deepEqual(host.pluginServices["service-array"].call("数组"), {
    text: "数组",
    apiVersion: 2,
  });
});

test("requires.plugins 版本范围不满足时插件 unavailable，服务 API 版本不匹配同样隔离", async (t) => {
  const version = await start([PROVIDER, fixture("service-version")]);
  t.after(() => version.close());
  const versionList = byId(version.server.pluginHost.list());
  assert.equal(versionList["service-version"].status, "unavailable");
  assert.match(versionList["service-version"].reason, /1\.2\.3.*\^2\.0\.0/);

  const apiVersion = await start([PROVIDER, fixture("service-api-version")]);
  t.after(() => apiVersion.close());
  const apiList = byId(apiVersion.server.pluginHost.list());
  assert.equal(apiList["service-api-version"].status, "unavailable");
  assert.match(apiList["service-api-version"].reason, /版本为 2/);
});

test("ctx.service 取不到服务时抛结构化错误并只影响当前插件", async (t) => {
  const app = await start([PROVIDER, fixture("service-missing")]);
  t.after(() => app.close());

  const list = byId(app.server.pluginHost.list());
  assert.equal(list["service-provider"].status, "ready");
  assert.equal(list["service-missing"].status, "unavailable");
  assert.match(list["service-missing"].reason, /not-a-service/);
});

test("requires.anyOf 至少满足一个即可；都不满足时 unavailable", async (t) => {
  const satisfied = await start([PROVIDER, fixture("service-any")]);
  t.after(() => satisfied.close());
  const satisfiedList = byId(satisfied.server.pluginHost.list());
  assert.equal(satisfiedList["service-any"].status, "ready");
  assert.deepEqual(satisfiedList["service-any"].available, true);

  const missing = await start([
    PROVIDER,
    fixture("service-any-missing"),
  ]);
  t.after(() => missing.close());
  const missingList = byId(missing.server.pluginHost.list());
  assert.equal(missingList["service-any-missing"].status, "unavailable");
  assert.match(missingList["service-any-missing"].reason, /missing-a/);
});

test("循环依赖 fail fast：相关插件 unavailable，服务不崩溃", async (t) => {
  const app = await start([fixture("cycle-a"), fixture("cycle-b")]);
  t.after(() => app.close());

  const list = byId(app.server.pluginHost.list());
  assert.equal(list["cycle-a"].status, "unavailable");
  assert.equal(list["cycle-b"].status, "unavailable");
  assert.match(list["cycle-a"].reason, /依赖存在环/);
  assert.equal((await app.request("/api/agent/health")).status, 200);
});
