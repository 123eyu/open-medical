// 交互重设计 · 端到端（桌面端）：用 Electron 驱动真实桌面壳（本地 runtime + 构建产物），
// 跑与浏览器端同一套场景剧本。
// 前置：npm run build；本机装有 Google Chrome（桌面壳检测浏览器工具用）。
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { _electron } from "playwright-core";
import { SCENARIOS } from "./redesign-scenarios.mjs";

const require = createRequire(import.meta.url);
const DIST = resolve(process.cwd(), "dist/index.html");
const MAIN = resolve(process.cwd(), "desktop/main.cjs");
let electronPath = "";
try {
  electronPath = require("electron");
} catch {}
const canRun =
  existsSync(DIST) && existsSync(MAIN) && Boolean(electronPath) && process.platform === "darwin";

async function openDesktopApp(t) {
  const directory = await mkdtemp(join(tmpdir(), "omw-desktop-e2e-"));
  const desktopEnv = { ...process.env, MEDICAL_DESKTOP_TEST_DIR: directory };
  delete desktopEnv.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [MAIN, "--e2e"],
    cwd: process.cwd(),
    env: desktopEnv,
  });
  const desktopProcess = app.process();
  t.after(async () => {
    try {
      await app.close();
    } catch {}
    // Only remove this fixture's data after its isolated Electron process exits.
    if (desktopProcess.exitCode !== null) await rm(directory, { recursive: true, maxRetries: 3, retryDelay: 100 });
  });
  const window = await app.firstWindow();
  await window.waitForSelector(".app-navigation", { timeout: 30000 });
  await window.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
  const origin = new URL(window.url()).origin;
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  // 从原生窗口取得会话令牌后，供节点侧准备合成数据。
  const bootstrap = await window.evaluate(() => fetch("/api/bootstrap").then(r => r.json()));
  const token = bootstrap.token;
  const request = (path, method = "GET", data) =>
    fetch(origin + path, {
      method,
      headers: {
        "content-type": "application/json",
        "x-medical-token": token,
      },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
  const seed = {
    json: async (path, method = "GET", data) => {
      const r = await request(path, method, data);
      return { status: r.status, data: await r.json() };
    },
    request,
  };
  return { app, page: window, seed, origin };
}

for (const scenario of SCENARIOS) {
  if (scenario.desktopSkip) continue; // 桌面端下载行为不同，跳过
  test(`桌面 · ${scenario.name}`, { skip: !canRun }, async (t) => {
    const { page, seed, origin } = await openDesktopApp(t);
    await page.goto(origin + "/?view=home");
  await page.locator(".app-navigation").waitFor();
    await scenario.fn({ page, seed, origin });
  });
}
