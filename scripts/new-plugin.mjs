#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(ROOT, "docs", "plugin-template");
const ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sql",
  ".txt",
]);

function fail(message) {
  console.error(`plugin:new: ${message}`);
  process.exit(1);
}

function usage() {
  console.log(`用法：npm run plugin:new -- <id> "<标题>" [--dir <plugins 目录>]

  id      小写字母开头，只含小写字母、数字和连字符，2–39 个字符
  标题    插件显示名称
  --dir   可选，默认 <仓库>/plugins；测试或自定义布局时使用

示例：
  npm run plugin:new -- pain-score "疼痛评分"
  node scripts/new-plugin.mjs pain-score "疼痛评分" --dir /tmp/plugins`);
}

function parseArgs(argv) {
  const positional = [];
  let pluginsDir = join(ROOT, "plugins");
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--dir") {
      const value = argv[index + 1];
      if (!value) fail("--dir 缺少目录");
      pluginsDir = resolve(ROOT, value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--dir=")) {
      pluginsDir = resolve(ROOT, arg.slice("--dir=".length));
      continue;
    }
    if (arg.startsWith("-")) fail(`未知参数 ${arg}`);
    positional.push(arg);
  }
  return { positional, pluginsDir };
}

function replacePlaceholders(content, values) {
  let output = content;
  for (const [placeholder, value] of Object.entries(values))
    output = output.split(placeholder).join(value);
  return output;
}

function rewriteTree(directory, values) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      rewriteTree(absolute, values);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    // The template lives one or two levels below the plugin root, so resolve
    // the repository prefix from each file instead of from the destination.
    // Resolve symlinks on both sides (macOS /var -> /private/var); Node loads
    // the module from its real path, so the relative import must match it.
    const rootRelative = relative(realpathSync(dirname(absolute)), realpathSync(ROOT))
      .split(sep)
      .join("/");
    const original = readFileSync(absolute, "utf8");
    const replaced = replacePlaceholders(original, {
      ...values,
      __ROOT_REL__: rootRelative.startsWith(".")
        ? rootRelative
        : `./${rootRelative}`,
    });
    if (replaced !== original) writeFileSync(absolute, replaced);
  }
}

const { positional, pluginsDir } = parseArgs(process.argv.slice(2));
if (positional.length !== 2) {
  usage();
  fail("需要恰好两个参数：<id> 和 <标题>");
}
const [id, rawTitle] = positional;
const title = rawTitle.trim();
if (!ID_PATTERN.test(id))
  fail("id 必须匹配 /^[a-z][a-z0-9-]{1,39}$/（小写字母开头，2–40 位）");
if (!title) fail("标题不能为空");
if (title.length > 80) fail("标题不能超过 80 个字符");
if (/["\\\r\n]/.test(title)) fail("标题不能包含双引号、反斜杠或换行");
if (id.replaceAll("-", "_").length > 39)
  fail("id 最多 39 个字符（模板会追加表前缀下划线）");
if (!existsSync(TEMPLATE) || !statSync(TEMPLATE).isDirectory())
  fail(`模板目录不存在：${TEMPLATE}`);

const destination = resolve(pluginsDir, id);
if (basename(destination) !== id) fail("目标目录必须是 plugins/<id>");
if (existsSync(destination))
  fail(`目标已存在：${relative(ROOT, destination) || destination}`);

const values = {
  __PLUGIN_ID__: id,
  __PLUGIN_TITLE__: title,
  __PLUGIN_TABLE__: id.replaceAll("-", "_"),
  __PLUGIN_TOOL__: id.replaceAll("-", "_"),
};

try {
  cpSync(TEMPLATE, destination, { recursive: true, errorOnExist: true });
  rewriteTree(destination, values);
} catch (error) {
  // Do not leave a half-generated plugin that the host would try to load.
  rmSync(destination, { recursive: true, force: true });
  fail(`创建失败：${error.message}`);
}

console.log(`已创建插件 ${id}：${relative(ROOT, destination) || destination}`);
console.log("下一步：");
console.log("  1. 修改 plugin.mjs / ui/Tab.jsx / prompt.md 中的模板示例。");
console.log(`  2. npm test  # 会运行 plugins/${id}/test/plugin.test.mjs`);
console.log("  3. 在设置 → 插件中启用并检查患者页与今日待办。");
