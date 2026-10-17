import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { fixture } from "./helpers.mjs";
import { createWorkspaceServer } from "../server/platform.mjs";

test("desktop runtime blocks browser pages and bootstrap while authenticated APIs and ingress still work", async t => {
  const desktopAccessToken = randomBytes(32).toString("hex");
  const f = await fixture(t, { desktopAccessToken, ingestSecret: "synthetic-ingest" });
  for (const path of ["/", "/index.html", "/assets/app.js", "/api/bootstrap", "/api/agent/health", "/api/skills", "/api/sessions"]) {
    const response = await fetch(f.origin + path);
    assert.equal(response.status, 403, path);
    assert.equal((await response.json()).code, "DESKTOP_ONLY");
  }
  assert.equal((await f.request("/api/bootstrap")).status, 403, "API token cannot bootstrap another UI session");
  assert.equal((await fetch(f.origin + "/api/bootstrap?token=" + f.server.token)).status, 403);
  assert.equal((await fetch(f.origin + "/api/bootstrap", { headers: { "x-omw-desktop": "wrong" } })).status, 403);
  const boot = await fetch(f.origin + "/api/bootstrap", { headers: { "x-omw-desktop": desktopAccessToken } });
  assert.equal(boot.status, 200);
  assert.equal(boot.headers.get("cache-control"), "no-store");
  assert.equal((await boot.json()).token, f.server.token);
  assert.equal((await fetch(f.origin + "/api/sessions", { headers: { "x-omw-desktop": desktopAccessToken } })).status, 401, "native credential does not bypass API authorization");
  assert.equal((await f.session("桌面访问验证")).title, "桌面访问验证");
  assert.equal((await f.request("/api/sessions", "GET", undefined, { origin: "https://external.invalid" })).status, 403);
  assert.equal((await fetch(f.origin + "/api/ingest/messages", { method: "POST", headers: { "content-type": "application/json" }, body: '{"messages":[{"direction":"in","text":"synthetic","externalId":"desktop-access"}]}' })).status, 401);
  assert.equal((await fetch(f.origin + "/api/ingest/messages", { method: "POST", headers: { "content-type": "application/json", "x-ingest-secret": "synthetic-ingest" }, body: '{"messages":[{"direction":"in","text":"synthetic","externalId":"desktop-access"}]}' })).status, 201);
  const ws = new WebSocket(f.origin.replace("http:", "ws:") + "/api/ws?token=" + f.server.token);
  t.after(() => ws.terminate());
  const ready = await new Promise((resolve, reject) => { ws.once("message", data => resolve(JSON.parse(data))); ws.once("error", reject); });
  assert.equal(ready.params.type, "gateway.ready");
  ws.close();
  const denied = new WebSocket(f.origin.replace("http:", "ws:") + "/api/ws");
  t.after(() => denied.terminate());
  await assert.rejects(new Promise((resolve, reject) => { denied.once("open", resolve); denied.once("error", reject); }), /403/);
});

test("generic background API is headless unless web development is explicitly enabled", async t => {
  const dist = mkdtempSync(join(tmpdir(), "omw-web-dev-"));
  writeFileSync(join(dist, "index.html"), "<h1>Development fixture</h1>");
  t.after(() => rmSync(dist, { recursive: true, force: true }));
  for (const webUi of [false, true]) {
    const server = createWorkspaceServer({ database: ":memory:", dist, webUi });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      assert.equal((await fetch(origin + "/")).status, webUi ? 200 : 403);
      assert.equal((await fetch(origin + "/api/bootstrap")).status, 200);
    } finally { await server.shutdown(); }
  }
});
