import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../../server/agent.mjs";
import { validateMigrationSql } from "../../server/plugin-host/host.mjs";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

const FIXTURES = fileURLToPath(new URL("../fixtures/plugins", import.meta.url));
const HELLO = join(FIXTURES, "hello");

function createTempRoot() {
  const attempts = [];
  for (const base of [process.env.MEDICAL_TEST_TMP, tmpdir(), "/tmp"]) {
    if (!base) continue;
    try {
      return mkdtempSync(join(base, "omw-plugin-migrations-"));
    } catch (error) {
      attempts.push(`${base}: ${error.code || error.message}`);
    }
  }
  throw new Error(`无法创建测试临时目录：${attempts.join("；")}`);
}

async function startWithDatabase(database, pluginDirs) {
  const server = createServer({
    database,
    provider: createScriptedProvider([]),
    pluginDirs,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return {
    server,
    request: async (path, { method = "GET", body } = {}) => {
      const response = await fetch(new URL(path, base), {
        method,
        headers: {
          "x-medical-token": server.token,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text ? JSON.parse(text) : null,
      };
    },
    close: () => server.shutdown(),
  };
}

test("迁移校验支持多表前缀插件，但拒绝无关表名", () => {
  const names = validateMigrationSql(
    `CREATE TABLE IF NOT EXISTS followup_jobs (id TEXT);
     CREATE TABLE IF NOT EXISTS chat_messages (id TEXT);
     CREATE INDEX IF NOT EXISTS care_alerts_time ON care_alerts(created_at);`,
    ["followup_", "chat_", "care_"],
  );
  assert.deepEqual(names, [
    "followup_jobs",
    "chat_messages",
    "care_alerts",
  ]);
  for (const sql of [
    "CREATE TABLE other_jobs (id TEXT)",
    "CREATE TABLE chat_messages (id TEXT); CREATE TABLE nope (id TEXT)",
  ]) {
    assert.throws(
      () => validateMigrationSql(sql, ["followup_", "chat_", "care_"]),
      /followup_ \/ chat_ \/ care_/,
    );
  }
  assert.throws(
    () => validateMigrationSql("CREATE TABLE chat_messages (id TEXT)", []),
    /tablePrefix/,
  );
});

test("迁移幂等：同一数据库启动两次只执行一次迁移", async (t) => {
  const root = createTempRoot();
  const database = join(root, "medical.sqlite");
  // LanceDB spills through TMPDIR; point it at the writable test root so the
  // native vector store does not panic on restricted runners.
  const previousTmpDir = process.env.TMPDIR;
  process.env.TMPDIR = root;
  t.after(() => {
    if (previousTmpDir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpDir;
    rmSync(root, { recursive: true, force: true });
  });

  const first = await startWithDatabase(database, [HELLO]);
  try {
    await first.request("/api/plugins/hello", {
      method: "PUT",
      body: { enabled: true },
    });
    const list = await first.request("/api/plugins");
    assert.equal(list.body.plugins[0].status, "ready");
    assert.equal(
      first.server.store.db
        .prepare("SELECT COUNT(*) AS n FROM plugin_migrations")
        .get().n,
      1,
    );
    assert.equal((await first.request("/api/p/hello/ping")).status, 200);
  } finally {
    await first.close();
  }

  const second = await startWithDatabase(database, [HELLO]);
  try {
    await second.request("/api/plugins/hello", {
      method: "PUT",
      body: { enabled: true },
    });
    const list = await second.request("/api/plugins");
    assert.equal(list.body.plugins[0].status, "ready");
    assert.equal(
      second.server.store.db
        .prepare("SELECT COUNT(*) AS n FROM plugin_migrations")
        .get().n,
      1,
      "第二次启动不应重复记录迁移",
    );
    assert.equal((await second.request("/api/p/hello/ping")).status, 200);
    assert.equal(
      second.server.store.db
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='hello_greetings'",
        )
        .get().n,
      1,
    );
  } finally {
    await second.close();
  }
});

test("坏插件：表名前缀错误、缺依赖、setup 抛错都标记 unavailable，服务照常启动", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
    serverOptions: { pluginDirs: [FIXTURES] },
  });
  t.after(() => app.close());

  const enabled = await app.request("/api/plugins/hello", {
    method: "PUT",
    body: { enabled: true },
  });
  assert.equal(enabled.status, 200);

  const response = await app.request("/api/plugins");
  assert.equal(response.status, 200);
  const byId = Object.fromEntries(
    response.body.plugins.map((plugin) => [plugin.id, plugin]),
  );
  assert.equal(byId.hello.status, "ready");
  assert.equal(byId["bad-prefix"].status, "unavailable");
  assert.match(byId["bad-prefix"].reason, /bad_prefix_/);
  assert.equal(byId["needs-missing"].status, "unavailable");
  assert.match(byId["needs-missing"].reason, /not-installed/);
  assert.equal(byId["setup-throws"].status, "unavailable");
  assert.match(byId["setup-throws"].reason, /setup failed/);

  assert.equal((await app.patients()).length, 3, "坏插件不影响固定区");
  assert.equal(
    (await app.request("/api/p/hello/ping")).status,
    200,
    "坏插件不影响正常插件",
  );

  const badApi = await app.request("/api/p/bad-prefix/ping");
  assert.equal(badApi.status, 404);
  assert.equal(badApi.body.code, "NOT_FOUND");
});
