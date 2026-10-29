import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

const HELLO = join(
  fileURLToPath(new URL("../fixtures/plugins", import.meta.url)),
  "hello",
);

async function propose(app, input) {
  const response = await app.request("/api/p/hello/greet", {
    method: "POST",
    body: input,
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.proposal.type, "hello.greet");
  return response.body.proposal;
}

test("插件提案：确认后在同一事务内写表；apply 抛错时整笔回滚且保持 pending", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
    serverOptions: { pluginDirs: [HELLO] },
  });
  t.after(() => app.close());

  const success = await propose(app, {
    name: "张三",
    message: "你好，随访顺利",
  });
  const confirmed = await app.request(
    `/api/pending-actions/${success.id}/confirm`,
    { method: "POST", body: {} },
  );
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.action.status, "applied");
  assert.equal(confirmed.body.action.type, "hello.greet");
  assert.deepEqual(confirmed.body.applied, {
    name: "张三",
    message: "你好，随访顺利",
  });
  assert.equal(
    app.server.store.db
      .prepare("SELECT COUNT(*) AS n FROM hello_greetings")
      .get().n,
    1,
  );
  const ping = await app.request("/api/p/hello/ping");
  assert.equal(ping.status, 200);
  assert.equal(ping.body.greetings, 1);

  const failure = await propose(app, {
    name: "李四",
    message: "这次应当回滚",
    fail: true,
  });
  const failed = await app.request(
    `/api/pending-actions/${failure.id}/confirm`,
    { method: "POST", body: {} },
  );
  assert.notEqual(failed.status, 200);

  const rows = app.server.store.db
    .prepare("SELECT name,message FROM hello_greetings ORDER BY id")
    .all();
  assert.deepEqual(
    rows.map((row) => ({ ...row })),
    [{ name: "张三", message: "你好，随访顺利" }],
    "apply 在插入后抛错，插入必须随事务回滚",
  );

  const pending = await app.request("/api/pending-actions");
  assert.equal(pending.status, 200);
  assert.equal(
    pending.body.actions.find((action) => action.id === failure.id).status,
    "pending",
    "失败后提案保持 pending，可修正后重新确认",
  );
});

test("插件停用后，已创建的插件提案确认被拒绝；重新启用后可确认", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
    serverOptions: { pluginDirs: [HELLO] },
  });
  t.after(() => app.close());

  const proposal = await propose(app, {
    name: "赵六",
    message: "停用期间不能确认",
  });
  const disabled = await app.request("/api/plugins/hello", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);

  const rejected = await app.request(
    `/api/pending-actions/${proposal.id}/confirm`,
    { method: "POST", body: {} },
  );
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, "PLUGIN_UNAVAILABLE");
  assert.equal(
    app.server.store.db
      .prepare("SELECT COUNT(*) AS n FROM hello_greetings")
      .get().n,
    0,
  );

  await app.request("/api/plugins/hello", {
    method: "PUT",
    body: { enabled: true },
  });
  const confirmed = await app.request(
    `/api/pending-actions/${proposal.id}/confirm`,
    { method: "POST", body: {} },
  );
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.action.status, "applied");
  assert.equal(
    app.server.store.db
      .prepare("SELECT COUNT(*) AS n FROM hello_greetings")
      .get().n,
    1,
  );
});
