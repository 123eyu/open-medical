import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "new-plugin.mjs");

function createTempRoot() {
  const attempts = [];
  for (const base of [process.env.MEDICAL_TEST_TMP, tmpdir(), "/tmp"]) {
    if (!base) continue;
    try {
      return mkdtempSync(join(base, "omw-scaffold-"));
    } catch (error) {
      attempts.push(`${base}: ${error.code || error.message}`);
    }
  }
  throw new Error(`无法创建测试临时目录：${attempts.join("；")}`);
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60000,
    ...options,
  });
}

test("plugin:new：从模板生成插件，宿主可加载、迁移、注册工具，插件自带测试通过", async (t) => {
  const root = createTempRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const id = `scaffold-${randomUUID().slice(0, 8)}`;
  const title = "脚手架测试插件";

  const created = runNode([SCRIPT, id, title, "--dir", root]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const pluginDir = join(root, id);
  assert.deepEqual(
    readdirSync(pluginDir).sort(),
    ["migrations", "plugin.mjs", "prompt.md", "test", "ui"],
  );
  const manifest = readFileSync(join(pluginDir, "plugin.mjs"), "utf8");
  assert.match(manifest, new RegExp(`id: "${id}"`));
  assert.doesNotMatch(manifest, /__PLUGIN_/);
  assert.match(
    manifest,
    new RegExp(`tablePrefix: "${id.replaceAll("-", "_")}_"`),
  );

  const duplicate = runNode([SCRIPT, id, title, "--dir", root]);
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /目标已存在/);

  const invalid = runNode([SCRIPT, "Bad_ID", "非法", "--dir", root]);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /id 必须匹配/);

  const app = await startTestServer({
    provider: createScriptedProvider([]),
    seedDemoPack: false,
    serverOptions: { pluginDirs: [pluginDir] },
  });
  t.after(() => app.close());

  const listed = await app.request("/api/plugins");
  const plugin = listed.body.plugins.find((item) => item.id === id);
  assert.equal(plugin.status, "ready", plugin.reason);
  assert.equal(plugin.enabled, true);
  assert.equal(
    app.server.store.db
      .prepare("SELECT COUNT(*) AS n FROM plugin_migrations WHERE plugin_id=?")
      .get(id).n,
    1,
  );
  const tools = app.server.sessionBridge.toolNames();
  assert.ok(tools.includes(`${id.replaceAll("-", "_")}_notes_list`));
  const ping = await app.request(`/api/p/${id}/ping`);
  assert.equal(ping.status, 200);
  assert.equal(ping.body.plugin, id);

  const pluginTest = runNode(["--test", join(pluginDir, "test", "plugin.test.mjs")], {
    env: { ...process.env, TMPDIR: root },
  });
  assert.equal(pluginTest.status, 0, pluginTest.stderr || pluginTest.stdout);
});
