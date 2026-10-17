import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { _electron } from "playwright-core";
const require = createRequire(import.meta.url);

test("desktop-only: native window, reload, APIs, websocket, PDF and directory actions", { skip: process.env.DESKTOP_E2E !== "1", timeout: 90000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), "omw-desktop-only-"));
  await writeFile(join(dir, "model.env"), "AI_PROVIDER=local\n");
  const env = { ...process.env, MEDICAL_DESKTOP_TEST_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: require("electron"), args: [resolve("desktop/main.cjs"), "--e2e"], env, timeout: 30000 });
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  let page = await app.firstWindow();
  await page.locator(".app-navigation").waitFor();
  const origin = new URL(page.url()).origin;
  for (const path of ["/", "/api/bootstrap", "/api/sessions"])
    assert.equal((await fetch(origin + path)).status, 403, path);
  const boot = await page.evaluate(() => fetch("/api/bootstrap").then(r => r.json()));
  assert.ok(boot.token);
  const session = await fetch(origin + "/api/sessions", { method: "POST", headers: { "content-type": "application/json", "x-medical-token": boot.token }, body: '{"title":"桌面测试任务"}' }).then(r => r.json());
  assert.ok(session.id);
  const result = await fetch(origin + `/api/chat/${session.id}`, { method: "POST", headers: { "content-type": "application/json", "x-medical-token": boot.token }, body: JSON.stringify({ message: "合成测试 时间线 2026-01-02 首诊 Hb 98 g/L", mode: "local" }) });
  assert.match(await result.text(), /message.complete/);
  assert.equal(await page.evaluate(token => new Promise((resolve, reject) => {
    const ws = new WebSocket(location.origin.replace("http:", "ws:") + "/api/ws?token=" + token);
    ws.onmessage = event => { resolve(JSON.parse(event.data).params.type); ws.close(); };
    ws.onerror = () => reject(new Error("WebSocket failed"));
  }), boot.token), "gateway.ready");
  await page.reload();
  await page.locator(".app-navigation").waitFor();
  assert.equal(await page.evaluate(() => typeof process), "undefined");
  assert.equal(await page.evaluate(() => typeof require), "undefined");
  // An unrelated Electron window sharing the session must not inherit access.
  const otherStatus = await app.evaluate(async ({ BrowserWindow }, origin) => {
    const other = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    try {
      await other.loadURL(origin);
      return await other.webContents.executeJavaScript('fetch("/api/bootstrap").then(r => r.status)');
    } finally { other.destroy(); }
  }, origin);
  assert.equal(otherStatus, 403);
  if (process.platform === "darwin") {
    const reopened = app.waitForEvent("window");
    const closed = page.waitForEvent("close");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    await app.evaluate(({ app }) => app.emit("activate"));
    page = await reopened;
    await page.locator(".app-navigation").waitFor();
    assert.equal(await page.evaluate(() => fetch("/api/bootstrap").then(r => r.status)), 200);
  }
  const pdf = join(dir, "share.pdf");
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, pdf);
  const exported = await page.evaluate(() => window.omwDesktop.shareReport({ title: "合成病历摘要", fileName: "desktop-test", sections: [{ heading: "临床记录", rows: [["日期", "2026-01-02"]] }] }));
  assert.equal(exported.ok, true, JSON.stringify(exported));
  assert.equal((await readFile(pdf)).subarray(0, 5).toString(), "%PDF-");
  await app.evaluate(({ shell }) => { shell.openPath = async path => path; });
  assert.equal(await page.evaluate(() => window.omwDesktop.openDataDirectory()), dir);
  assert.equal(await page.evaluate(() => window.omwDesktop.openConfigDirectory()), dir);
  await page.goto(origin + "/?view=settings&settingsTab=desktop");
  await page.getByRole("heading", { name: "桌面应用", exact: true }).waitFor();
  await page.getByText("应用维护", { exact: true }).click();
  await page.getByRole("button", { name: "打开配置目录", exact: true }).waitFor();
  await mkdir("output/desktop-only", { recursive: true });
  await page.screenshot({ path: "output/desktop-only/desktop-settings.png" });
});
