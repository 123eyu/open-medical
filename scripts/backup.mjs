import { DatabaseSync } from "node:sqlite";
import { resolve, dirname } from "node:path";
import { mkdirSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export function backupDatabase(source, destination) {
  source = resolve(source);
  destination = resolve(destination);
  if (!existsSync(source)) throw new Error("源数据库不存在");
  if (existsSync(destination)) throw new Error("目标已存在，拒绝覆盖备份");
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(source, { readOnly: true });
  try {
    const result = database.prepare("PRAGMA quick_check").get();
    if (result.quick_check !== "ok")
      throw new Error("源数据库完整性检查未通过");
    const schema = database
      .prepare("SELECT value FROM meta WHERE key=?")
      .get("schema_version");
    if (!["2", "3", "4", "5", "6", "7", "8"].includes(schema?.value))
      throw new Error("数据库版本不支持");
    // SQLite produces a consistent snapshot, including committed WAL data.
    database.prepare("VACUUM INTO ?").run(destination);
    chmodSync(destination, 0o600);
  } finally {
    database.close();
  }
  return destination;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const source =
      process.env.MEDICAL_DATABASE || resolve(homedir(), ".open-medical-workbench/medical.sqlite");
    const destination =
      process.argv[2] ||
      resolve(
        homedir(), ".open-medical-workbench/backups",
        `medical-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
      );
    console.log("已创建一致性备份：" + backupDatabase(source, destination));
    console.log(
      "备份包含本地医疗资料，请按原数据库同等标准保管。恢复时先退出应用，再用备份恢复数据目录；详见 docs/DESKTOP.md。",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
