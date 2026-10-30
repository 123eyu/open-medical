import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

// Sessions written by the removed MedicalRuntime live in the old `sessions`
// table. On start they move into session workspaces (same id) and run on the
// one remaining engine.
const legacySession = (id, patientId) => ({
  id,
  title: "旧会话 · 血压复核",
  createdAt: Date.parse("2026-09-01T08:00:00Z"),
  updatedAt: Date.parse("2026-09-02T08:00:00Z"),
  revision: 3,
  patientId,
  files: [
    { id: "file-legacy-1", name: "门诊记录.txt", text: "2026-08-30 血压 150/95 mmHg", hash: "h1", createdAt: "2026-09-01T08:00:00Z", size: 30 },
  ],
  messages: [
    { id: "m1", role: "user", content: "请整理血压记录", runId: "run-done", createdAt: "2026-09-01T08:01:00Z", fileIds: ["file-legacy-1"] },
    { id: "m2", role: "assistant", content: "已整理：2026-08-30 血压 150/95 mmHg。", runId: "run-done", createdAt: "2026-09-01T08:02:00Z", status: "completed" },
    { id: "m3", role: "user", content: "继续", runId: "run-cut", createdAt: "2026-09-02T08:00:00Z", fileIds: [] },
  ],
  artifacts: [
    { id: "artifact-1", runId: "run-done", type: "summary", title: "血压整理", content: "150/95", status: "draft" },
    { id: "artifact-orphan", type: "note", title: "未归属成果", content: "保留", status: "draft" },
  ],
  runs: [
    { id: "run-done", status: "completed", mode: "local", startedAt: "2026-09-01T08:01:00Z", endedAt: "2026-09-01T08:02:00Z", events: [], fileIds: ["file-legacy-1"], artifacts: ["artifact-1"], children: [], policy: { intent: "summary" } },
    { id: "run-cut", status: "running", mode: "model", startedAt: "2026-09-02T08:00:00Z", endedAt: null, events: [], fileIds: [], artifacts: [], children: [], policy: { intent: "summary" } },
  ],
});

test("旧版 sessions 表会话启动时迁移为会话工作区，保留编号、材料、对话和成果", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "omw-legacy-session-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const database = join(root, "medical.sqlite");

  const first = await startTestServer({
    provider: createScriptedProvider([]),
    serverOptions: { database },
  });
  const [patient] = await first.patients();
  await first.close();

  const db = new DatabaseSync(database);
  db.prepare("INSERT INTO sessions VALUES (?,?)").run("legacy-session-1", JSON.stringify(legacySession("legacy-session-1", patient.id)));
  db.prepare("INSERT INTO sessions VALUES (?,?)").run("legacy-broken", "{not json");
  db.close();

  const app = await startTestServer({
    provider: createScriptedProvider([]),
    seedDemoPack: false,
    serverOptions: { database },
  });
  t.after(() => app.close());

  const left = app.server.store.db.prepare("SELECT id FROM sessions ORDER BY id").all().map((row) => row.id);
  assert.deepEqual(left, ["legacy-broken"], "迁移成功的旧行删除；读不出来的那条原样保留，下次启动再试");
  assert.equal(app.server.sessionBridge.isSessionWorkspace("legacy-session-1"), true);

  const response = await app.request("/api/sessions/legacy-session-1");
  assert.equal(response.status, 200);
  const session = response.body;
  assert.equal(session.title, "旧会话 · 血压复核");
  assert.equal(session.patientId, patient.id);
  assert.deepEqual(session.files.map((file) => file.id), ["file-legacy-1"]);
  assert.deepEqual(session.messages.map((message) => message.id), ["m1", "m2", "m3"]);
  const runs = Object.fromEntries(session.runs.map((run) => [run.id, run]));
  assert.equal(runs["run-done"].status, "completed");
  assert.equal(runs["run-cut"].status, "interrupted", "迁移时仍在执行的记录标为中断，不自动续跑");
  assert.deepEqual(
    session.artifacts.map((artifact) => artifact.id).sort(),
    ["artifact-1", "artifact-orphan"],
    "成果挂回各自的执行记录，未归属的挂到最后一条",
  );
  assert.equal(session.updatedAt, new Date(Date.parse("2026-09-02T08:00:00Z")).toISOString());

  const listed = (await app.request("/api/sessions")).body.sessions;
  assert.equal(listed.filter((item) => item.id === "legacy-session-1").length, 1, "会话列表里只有一份");

  // The migrated session runs on the unified engine like any other session.
  const run = await app.request("/api/agent/run", {
    method: "POST",
    body: { sessionId: "legacy-session-1", message: "列出材料", mode: "local", fileIds: ["file-legacy-1"] },
  });
  assert.equal(run.status, 200);
  const search = await app.request("/api/sessions/legacy-session-1/search?q=" + encodeURIComponent("血压"));
  assert.equal(search.status, 200);

  // Unknown ids are not looked up anywhere else.
  assert.equal((await app.request("/api/sessions/no-such-session")).status, 404);
});

test("显式会话编号直接创建会话工作区，重复编号返回 409", async (t) => {
  const app = await startTestServer({ provider: createScriptedProvider([]), seedDemoPack: false });
  t.after(() => app.close());
  const created = await app.request("/api/sessions", { method: "POST", body: { id: "chosen-id-1", title: "指定编号" } });
  assert.equal(created.status, 201);
  assert.equal(created.body.id, "chosen-id-1");
  assert.equal(app.server.sessionBridge.isSessionWorkspace("chosen-id-1"), true);
  const again = await app.request("/api/sessions", { method: "POST", body: { id: "chosen-id-1" } });
  assert.equal(again.status, 409);
});
