import "../helpers/fixed-clock.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "../../server/agent.mjs";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { captureSnapshot } from "./snapshot.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "../..");
const LEGACY_DB = join(HERE, "fixtures", "legacy.sqlite");
const LEGACY_SNAPSHOT = join(HERE, "fixtures", "legacy-snapshot.json");
const PLUGIN_ROOT = join(ROOT, "plugins");
const CHANNEL_FAKE = join(ROOT, "tests/fixtures/plugins/channel-fake");

const RETRYABLE_TEMP_ERRORS = new Set(["ENOENT", "EROFS", "EACCES", "EPERM"]);

function createTempRoot() {
  const attempts = [];
  for (const base of [process.env.MEDICAL_TEST_TMP, tmpdir(), "/tmp"]) {
    if (!base) continue;
    try {
      return mkdtempSync(join(base, "omw-upgrade-"));
    } catch (error) {
      attempts.push(`${base}: ${error.code || error.message}`);
      if (!RETRYABLE_TEMP_ERRORS.has(error.code)) throw error;
    }
  }
  throw new Error(`无法创建升级测试临时目录：${attempts.join("；")}`);
}

function tableSchema(db) {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
  return Object.fromEntries(
    tables.map((name) => [
      name,
      db
        .prepare(`PRAGMA table_info(${JSON.stringify(name)})`)
        .all()
        .map((column) => ({
          name: column.name,
          type: column.type,
          notnull: column.notnull,
          dflt_value: column.dflt_value,
          pk: column.pk,
        })),
    ]),
  );
}

function tableCounts(db) {
  const names = [
    "patients",
    "follow_ups",
    "followup_plans",
    "care_tasks",
    "pending_actions",
    "case_library",
    "doctor_memories",
    "doctor_profile",
    "guideline_docs",
    "patient_messages",
  ];
  return Object.fromEntries(
    names.map((name) => [
      name,
      db.prepare(`SELECT COUNT(*) n FROM ${name}`).get().n,
    ]),
  );
}

async function startWithDatabase(database, { pluginDirs } = {}) {
  const provider = createScriptedProvider([]);
  const server = createServer({
    database,
    provider,
    userSkillsDir: join(resolve(database, ".."), "my-skills"),
    ...(pluginDirs ? { pluginDirs } : {}),
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const token = server.token;
  const request = async (path, { method = "GET", body } = {}) => {
    const init = {
      method,
      headers: { "x-medical-token": token },
    };
    if (body !== undefined) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const response = await fetch(new URL(path, url), init);
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: response.status, ok: response.ok, body: parsed, text };
  };
  return {
    server,
    url,
    token,
    request,
    close: () => server.shutdown(),
  };
}

function copyFixture(root, name) {
  const target = join(root, name);
  copyFileSync(LEGACY_DB, target);
  return target;
}

function withTempDir(t) {
  const root = createTempRoot();
  const previousTmp = process.env.TMPDIR;
  process.env.TMPDIR = root;
  t.after(() => {
    if (previousTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmp;
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function assertSchemaUpgrade(before, after) {
  for (const [table, columns] of Object.entries(before)) {
    assert.ok(after[table], `旧表 ${table} 不应被删除`);
    const next = after[table];
    assert.ok(
      next.length >= columns.length,
      `旧表 ${table} 的列不应减少（${columns.length} → ${next.length}）`,
    );
    for (const [index, column] of columns.entries()) {
      assert.deepEqual(
        next[index],
        column,
        `旧表 ${table} 的列 ${column.name} 被修改或删除`,
      );
    }
  }
}

function expectedMigrations(host) {
  const expected = new Map();
  for (const record of host.records) {
    if (!record.available || !record.spec?.migrations) continue;
    const dir = resolve(record.dir, record.spec.migrations);
    if (!existsSync(dir)) continue;
    expected.set(
      record.id,
      readdirSync(dir)
        .filter((name) => name.endsWith(".sql"))
        .sort(),
    );
  }
  return expected;
}

test("main 升级到当前分支：数据、接口快照和表结构保持一致", async (t) => {
  const root = withTempDir(t);
  const database = copyFixture(root, "upgrade.sqlite");
  const legacy = new DatabaseSync(database, { readOnly: true });
  const legacySchema = tableSchema(legacy);
  const legacyCounts = tableCounts(legacy);
  legacy.close();
  const expectedSnapshot = JSON.parse(
    await import("node:fs").then((fs) => fs.readFileSync(LEGACY_SNAPSHOT, "utf8")),
  );

  const app = await startWithDatabase(database, {
    pluginDirs: [PLUGIN_ROOT, CHANNEL_FAKE],
  });
  t.after(() => app.close());
  const patientsResponse = await app.request("/api/patients?summary=1");
  assert.equal(patientsResponse.status, 200);
  const patients = patientsResponse.body.patients;
  const snapshot = await captureSnapshot(app.request, patients);
  assert.deepEqual(snapshot, expectedSnapshot);

  // No legacy table or column may disappear or change shape. New tables and
  // appended columns are the only allowed schema changes.
  const upgradedSchema = tableSchema(app.server.store.db);
  assertSchemaUpgrade(legacySchema, upgradedSchema);
  const newTables = Object.keys(upgradedSchema).filter(
    (name) => !(name in legacySchema),
  );
  assert.ok(newTables.length > 0, "升级后应创建插件新表");

  const migrations = expectedMigrations(app.server.pluginHost);
  assert.ok(migrations.size > 0, "应至少有一个带迁移的插件");
  const rows = app.server.store.db
    .prepare("SELECT plugin_id,name FROM plugin_migrations ORDER BY plugin_id,name")
    .all();
  for (const [pluginId, files] of migrations) {
    const applied = rows
      .filter((row) => row.plugin_id === pluginId)
      .map((row) => row.name);
    assert.deepEqual(applied, files, `插件 ${pluginId} 的迁移记录不完整`);
  }
  assert.ok(
    rows.every((row) => migrations.has(row.plugin_id)),
    "plugin_migrations 不应包含未加载插件的记录",
  );

  // The fixture itself still contains the old rows after the upgrade.
  const afterCounts = tableCounts(app.server.store.db);
  for (const name of [
    "patients",
    "follow_ups",
    "followup_plans",
    "care_tasks",
    "pending_actions",
    "case_library",
    "doctor_memories",
    "doctor_profile",
    "guideline_docs",
  ]) {
    assert.ok(
      afterCounts[name] >= legacyCounts[name],
      `${name} 的旧数据不应减少（${legacyCounts[name]} → ${afterCounts[name]}）`,
    );
  }
});

test("未连接渠道时旧随访数据仍在库中，但接口按 T7.6 隐藏", async (t) => {
  const root = withTempDir(t);
  const database = copyFixture(root, "dormant.sqlite");
  const legacy = new DatabaseSync(database, { readOnly: true });
  const legacyCounts = tableCounts(legacy);
  legacy.close();
  const app = await startWithDatabase(database);
  t.after(() => app.close());

  // Default plugin directories: no test channel, so followup is dormant.
  const bootstrap = await app.request("/api/bootstrap");
  assert.equal(bootstrap.status, 200);
  const followup = bootstrap.body.plugins.find((item) => item.id === "followup");
  assert.ok(followup, "followup 插件应存在");
  assert.equal(followup.enabled, true);
  assert.equal(followup.connected, false);
  assert.equal(followup.active, false);

  const counts = tableCounts(app.server.store.db);
  for (const name of [
    "follow_ups",
    "followup_plans",
    "care_tasks",
    "patient_messages",
  ])
    assert.equal(counts[name], legacyCounts[name], `${name} 的旧行应原样保留`);
  assert.ok(counts.follow_ups > 0, "旧数据库应包含随访计划");
  assert.ok(counts.care_tasks > 0, "旧数据库应包含跟进事项");

  const overview = await app.request("/api/doctor/overview?limit=100");
  assert.equal(overview.status, 200);
  assert.equal(overview.body.counts.followup, undefined);
  assert.equal(overview.body.counts.messages, undefined);
  // Care-tasks has its own plugin and stays available without a channel;
  // only followup-owned kinds (followup/messages) disappear.
  assert.deepEqual(
    [...new Set(overview.body.items.map((item) => item.kind))].sort(),
    ["tracking", "visit"],
  );

  for (const path of ["/api/followups/overview", "/api/care/overview"]) {
    const response = await app.request(path);
    assert.equal(response.status, 409, path);
    assert.equal(response.body.code, "FOLLOWUP_INACTIVE", path);
  }
  const patients = await app.request("/api/patients");
  assert.equal(patients.status, 200);
  for (const patient of patients.body.patients) {
    const followups = await app.request(
      `/api/patients/${encodeURIComponent(patient.id)}/followups`,
    );
    assert.equal(followups.status, 409, "未连接渠道时不应暴露患者随访计划");
    assert.equal(followups.body.code, "FOLLOWUP_INACTIVE");
  }

  // T7.6 keeps the shared reminder bus (`/api/reminders`) readable while the
  // followup plugin is dormant; the rows are intentionally still returned so
  // fixed-area reminders are not lost. Plugin-owned routes are the hidden part.
  const reminders = await app.request("/api/reminders?status=pending&limit=100");
  assert.equal(reminders.status, 200);
  assert.ok(reminders.body.reminders.length > 0);
  assert.ok(
    reminders.body.reminders.every((item) => item.kind === "followup"),
    "示例随访提醒应仍在固定区提醒总线中",
  );
});
