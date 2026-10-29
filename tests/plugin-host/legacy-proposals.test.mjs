import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

const LEGACY = join(
  fileURLToPath(new URL("../fixtures/plugins", import.meta.url)),
  "legacy-proposal",
);

async function propose(app, input) {
  const response = await app.request("/api/p/legacy-proposal/propose", {
    method: "POST",
    body: input,
  });
  assert.equal(response.status, 201);
  assert.equal(
    response.body.proposal.type,
    "legacy-proposal-create",
    "历史提案类型字符串不能改变",
  );
  return response.body.proposal;
}

test("legacyProposalTypes：确认后经由插件 apply 写入并保持原 type；失败整笔回滚", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
    serverOptions: { pluginDirs: [LEGACY] },
  });
  t.after(() => app.close());

  const enabled = await app.request("/api/plugins/legacy-proposal", {
    method: "PUT",
    body: { enabled: true },
  });
  assert.equal(enabled.status, 200);

  const success = await propose(app, {
    name: "张三",
    message: "历史提案委派成功",
  });
  const confirmed = await app.request(
    `/api/pending-actions/${success.id}/confirm`,
    { method: "POST", body: {} },
  );
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.action.status, "applied");
  assert.equal(confirmed.body.action.type, "legacy-proposal-create");
  assert.deepEqual(confirmed.body.applied, {
    name: "张三",
    message: "历史提案委派成功",
    type: "legacy-proposal-create",
  });
  assert.equal(
    app.server.store.db
      .prepare("SELECT COUNT(*) AS n FROM legacy_proposal_log")
      .get().n,
    1,
  );

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
    .prepare("SELECT name,message FROM legacy_proposal_log ORDER BY id")
    .all();
  assert.deepEqual(
    rows.map((row) => ({ ...row })),
    [{ name: "张三", message: "历史提案委派成功" }],
    "apply 插入后抛错时必须随 sqliteTransaction 回滚",
  );

  const pending = await app.request(
    "/api/pending-actions?type=legacy-proposal-create",
  );
  assert.equal(pending.status, 200);
  assert.equal(
    pending.body.actions.find((action) => action.id === failure.id)?.status,
    "pending",
    "失败后提案保持 pending",
  );
});

test("legacyProposalTypes：插件停用后仍可列出历史提案，确认返回 409 PLUGIN_UNAVAILABLE", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
    serverOptions: { pluginDirs: [LEGACY] },
  });
  t.after(() => app.close());

  await app.request("/api/plugins/legacy-proposal", {
    method: "PUT",
    body: { enabled: true },
  });
  const proposal = await propose(app, {
    name: "赵六",
    message: "停用期间不能确认",
  });

  const disabled = await app.request("/api/plugins/legacy-proposal", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);

  const listed = await app.request(
    "/api/pending-actions?type=legacy-proposal-create",
  );
  assert.equal(listed.status, 200, "插件停用不影响历史提案列表");
  assert.equal(
    listed.body.actions.find((action) => action.id === proposal.id)?.type,
    "legacy-proposal-create",
  );

  const rejected = await app.request(
    `/api/pending-actions/${proposal.id}/confirm`,
    { method: "POST", body: {} },
  );
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, "PLUGIN_UNAVAILABLE");
  assert.equal(
    app.server.store.db
      .prepare("SELECT COUNT(*) AS n FROM legacy_proposal_log")
      .get().n,
    0,
  );

  await app.request("/api/plugins/legacy-proposal", {
    method: "PUT",
    body: { enabled: true },
  });
  const confirmed = await app.request(
    `/api/pending-actions/${proposal.id}/confirm`,
    { method: "POST", body: {} },
  );
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.action.status, "applied");
});
