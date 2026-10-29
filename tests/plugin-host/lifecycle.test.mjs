import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { startTestServer, waitFor } from "../helpers/server.mjs";

const HOST_FIXTURES = fileURLToPath(
  new URL("../fixtures/host", import.meta.url),
);
const A = join(HOST_FIXTURES, "lifecycle-a");
const B = join(HOST_FIXTURES, "lifecycle-b");
const FAIL = join(HOST_FIXTURES, "lifecycle-fail");
const DRAIN = join(HOST_FIXTURES, "lifecycle-drain");
const HANG = join(HOST_FIXTURES, "lifecycle-hang");

const log = () => globalThis.__pluginLifecycleLog || [];
const indexes = (needle) =>
  log()
    .map((entry, index) => (entry === needle ? index : -1))
    .filter((index) => index >= 0);

async function start(pluginDirs) {
  globalThis.__pluginLifecycleLog = [];
  return startTestServer({
    provider: createScriptedProvider([]),
    seedDemoPack: false,
    serverOptions: { pluginDirs },
  });
}

test("lifecycle：依赖拓扑启动、逆序停止、失败隔离、start/stop 幂等、drain 超时", async (t) => {
  const app = await start([A, B, FAIL, DRAIN, HANG]);
  const host = app.server.pluginHost;
  t.after(async () => {
    await host.drainAll({ timeoutMs: 20 });
    await app.close();
    delete globalThis.__pluginLifecycleLog;
  });

  await waitFor(
    () =>
      indexes("lifecycle-a:start").length === 1 &&
      indexes("lifecycle-b:start").length === 1 &&
      indexes("lifecycle-drain:start").length === 1,
    { description: "插件生命周期启动" },
  );

  assert.ok(
    indexes("lifecycle-a:start")[0] < indexes("lifecycle-b:start")[0],
    "被依赖插件应先启动",
  );
  assert.ok(
    indexes("lifecycle-fail:start").length === 1,
    "启动失败的插件仍然被调用",
  );
  assert.match(
    host.lifecycleErrors.get("lifecycle-fail"),
    /fixture lifecycle start failed/,
  );

  await host.startAll();
  assert.equal(indexes("lifecycle-a:start").length, 1, "重复 start 不应重复启动");
  assert.equal(indexes("lifecycle-b:start").length, 1, "重复 start 不应重复启动");

  await host.stopAll();
  assert.equal(indexes("lifecycle-a:stop").length, 1);
  assert.equal(indexes("lifecycle-b:stop").length, 1);
  assert.ok(
    indexes("lifecycle-b:stop")[0] < indexes("lifecycle-a:stop")[0],
    "停止顺序应与启动顺序相反",
  );

  await host.stopAll();
  assert.equal(indexes("lifecycle-a:stop").length, 1, "重复 stop 不应重复清理");

  const drained = await host.drainAll({ timeoutMs: 20 });
  const hang = drained.find((item) => item.id === "lifecycle-hang");
  assert.equal(hang.ok, false);
  assert.match(hang.error, /超时/);
  assert.equal(
    indexes("lifecycle-hang:drain").length,
    1,
    "超时的 drain 只尝试一次",
  );
});

test("server.shutdown 会先 stopAll 再 drainAll", async () => {
  const app = await start([A, B, DRAIN]);
  await waitFor(() => indexes("lifecycle-drain:start").length === 1, {
    description: "插件生命周期启动",
  });

  await app.close();
  const stop = indexes("lifecycle-drain:stop");
  const drain = indexes("lifecycle-drain:drain");
  assert.equal(stop.length, 1);
  assert.equal(drain.length, 1);
  assert.ok(stop[0] < drain[0], "shutdown 应先 stop 再 drain");
  delete globalThis.__pluginLifecycleLog;
});
