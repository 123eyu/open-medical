import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PluginHost } from "../../server/plugin-host/host.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PLUGIN_ROOT = join(ROOT, "plugins");
const SERVER_ROOT = join(ROOT, "server");

// The table-ownership rule is deliberately enforced by source scanning. Each
// exception must be an exact file + table + line signature, with the reason
// recorded here; a generic "ignore this file" entry is not accepted.
const WHITELIST = [];

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}

function pluginOwnedTables() {
  const db = new DatabaseSync(":memory:");
  const host = new PluginHost({ db, pluginDirs: [PLUGIN_ROOT] });
  host.load();
  const owned = new Map();
  for (const record of host.records) {
    const spec = record.spec;
    if (!spec) continue;
    for (const table of spec.legacyTables || [])
      owned.set(table, record.id);
    if (!spec.migrations) continue;
    const migrationDir = join(record.dir, spec.migrations);
    for (const name of readdirSync(migrationDir).filter((file) =>
      file.endsWith(".sql"),
    )) {
      const sql = readFileSync(join(migrationDir, name), "utf8");
      for (const match of sql.matchAll(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`[]?([A-Za-z_][A-Za-z0-9_]*)/gi,
      ))
        owned.set(match[1], record.id);
    }
  }
  db.close();
  return owned;
}

function isWhitelisted(file, table, line) {
  return WHITELIST.some(
    (entry) =>
      entry.file === file &&
      entry.table === table &&
      line.includes(entry.lineIncludes),
  );
}

test("固定区源码不直接读写插件拥有的表（含迁移表与 legacyTables）", () => {
  const owned = pluginOwnedTables();
  assert.ok(owned.size > 20, "应能读取到插件的表归属");
  assert.equal(owned.get("follow_ups"), "followup");
  assert.equal(owned.get("followup_plans"), "followup");
  assert.equal(owned.get("care_tasks"), "care-tasks");
  assert.equal(owned.get("risk_alerts"), "risk-rules");
  assert.equal(owned.get("trial_protocols"), "trials");

  const ignored = ["server/plugin-host", "server/plugins"];
  const violations = [];
  for (const absolute of filesUnder(SERVER_ROOT).filter((file) =>
    file.endsWith(".mjs"),
  )) {
    const file = relative(ROOT, absolute).replaceAll("\\", "/");
    if (ignored.some((prefix) => file.startsWith(`${prefix}/`))) continue;
    readFileSync(absolute, "utf8")
      .split("\n")
      .forEach((line, index) => {
        for (const [table, pluginId] of owned) {
          if (!new RegExp(`\\b${table}\\b`).test(line)) continue;
          if (isWhitelisted(file, table, line)) continue;
          violations.push(
            `${file}:${index + 1} 直接使用了插件 ${pluginId} 的表 ${table}`,
          );
        }
      });
  }
  assert.deepEqual(violations, [], violations.join("\n"));
});
