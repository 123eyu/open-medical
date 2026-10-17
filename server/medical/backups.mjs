import { readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { check } from "../errors.mjs";
import { backupDatabase } from "../../scripts/backup.mjs";

// 备份管理：一致性快照到数据库旁的 backups/ 目录，保留最近 N 份。
// 状态从目录文件推导（mtime），不另存状态源；本地 SQLite 是医生最大的
// 安全感也是最大的灾难点，备份体验必须「不用想」。
const MAX_KEEP = 14;
const DAY = 86400000;

export class Backups {
  constructor(databasePath, { maxKeep = MAX_KEEP } = {}) {
    this.databasePath = resolve(databasePath);
    this.directory = join(dirname(this.databasePath), "backups");
    this.maxKeep = maxKeep;
  }
  list() {
    try {
      return readdirSync(this.directory)
        .filter(name => name.endsWith(".sqlite"))
        .map(name => {
          const path = join(this.directory, name);
          const stat = statSync(path);
          return { name, path, size: stat.size, createdAt: stat.mtimeMs };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }
  status() {
    // :memory: 与不存在的库无法做文件快照（测试实例）；真实桌面/开发
    // 实例都是文件库。不支持时如实标注，而不是抛错让前端空转。
    const supported = this.databasePath !== ":memory:" && (() => { try { statSync(this.databasePath); return true; } catch { return false; } })();
    const latest = this.list()[0] || null;
    const ageMs = latest ? Date.now() - latest.createdAt : null;
    return {
      supported,
      directory: this.directory,
      count: this.list().length,
      lastBackupAt: latest ? new Date(latest.createdAt).toISOString() : null,
      // 超过一天没有备份就提醒：医生以为有备份是最危险的状态。
      fresh: ageMs === null ? false : ageMs < DAY,
      warning: !supported || ageMs === null || ageMs >= DAY,
    };
  }
  run() {
    check(this.status().supported, "BACKUP_UNSUPPORTED", "当前实例使用内存数据库，不支持文件备份；桌面与开发实例自动启用。", 409);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    // 同一秒内连续备份：追加序号避免「目标已存在」拒绝。
    let destination = join(this.directory, `medical-${stamp}.sqlite`);
    for (let n = 2; existsSync(destination); n++)
      destination = join(this.directory, `medical-${stamp}-${n}.sqlite`);
    backupDatabase(this.databasePath, destination);
    // 只保留最近 N 份，防止长期使用把磁盘吃满。
    for (const old of this.list().slice(this.maxKeep))
      try { unlinkSync(old.path); } catch { /* 清理失败不影响备份结果 */ }
    return this.status();
  }
}

export function backupRoutes(backups) {
  check(backups, "INVALID_INPUT", "备份管理未初始化");
  return {
    status: () => backups.status(),
    run: () => backups.run(),
  };
}
