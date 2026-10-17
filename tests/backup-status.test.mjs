// 备份状态与手动备份：状态从目录推导、快照可打开、保留策略清理旧份。
// API 层用 :memory: 实例验证 unsupported 语义；文件层用临时库验证真实快照。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../server/store.mjs";
import { Backups } from "../server/medical/backups.mjs";
import { fixture } from "./helpers.mjs";

test("memory instances report backup as unsupported instead of pretending", async (t) => {
  const f = await fixture(t);
  const status = (await f.json("/api/backup/status")).data;
  assert.equal(status.supported, false);
  assert.equal(status.warning, true);
  const run = await f.json("/api/backup/run", "POST");
  assert.equal(run.status, 409);
  assert.match(run.data.error, /内存数据库/);
});

test("file backups: snapshot opens, status turns fresh, retention keeps the newest", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "omw-backup-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, "medical.sqlite"));
  const patient = store.db.prepare("SELECT COUNT(*) n FROM patients").get();
  assert.ok(Number.isInteger(patient.n));
  store.close();

  const backups = new Backups(join(dir, "medical.sqlite"), { maxKeep: 2 });
  assert.equal(backups.status().supported, true);
  assert.equal(backups.status().warning, true, "从未备份时提醒");

  backups.run();
  backups.run(); // 同秒第二次也必须成功（序号避让）
  const after = backups.status();
  assert.equal(after.fresh, true);
  assert.ok(after.lastBackupAt);
  assert.equal(after.count, 2);

  // 快照本身可作为 SQLite 打开（恢复可用性的下限验证）。
  const probe = new DatabaseSync(backups.list()[0].path, { readOnly: true });
  assert.equal(probe.prepare("PRAGMA quick_check").get().quick_check, "ok");
  probe.close();

  backups.run();
  assert.equal(backups.list().length, 2, "保留策略只留最近 2 份");
});
