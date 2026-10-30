import test from "node:test";
import assert from "node:assert/strict";
import { createScriptedProvider, textTurn } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

test("计划任务：到点执行完成，同一时点不会重复执行", async (t) => {
  const provider = createScriptedProvider([textTurn("计划执行完成。")]);
  const app = await startTestServer({
    provider,
    seedDemoPack: false,
    serverOptions: { schedulerOptions: { autoStart: false } },
  });
  t.after(() => app.close());

  const session = await app.request("/api/assistant/session", { method: "POST", body: {} });
  assert.equal(session.status, 200);
  const scheduler = app.server.scheduler;
  const created = scheduler.create(session.body.id, {
    name: "每日核对",
    message: "核对今日待办",
    mode: "model",
    externalConsent: true,
    runAt: new Date(Date.now() + 60000).toISOString(),
    fileIds: [],
  });

  await scheduler.execute(scheduler.get(created.id));
  const done = scheduler.get(created.id);
  assert.equal(done.history.at(-1).status, "completed", done.history.at(-1).error);
  assert.equal(done.status, "completed");
  assert.ok(done.history.at(-1).runId);

  // Replaying the same occurrence must be refused rather than run twice.
  await scheduler.execute(scheduler.get(created.id));
  const replay = scheduler.get(created.id);
  assert.equal(replay.history.at(-1).status, "failed");
  assert.match(replay.history.at(-1).error, /已有执行记录/);
  assert.equal(provider.calls.length, 1);
});
