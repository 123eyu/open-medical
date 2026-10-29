import test from "node:test";
import assert from "node:assert/strict";
import {
  createScriptedProvider,
  textTurn,
  toolCall,
} from "../helpers/scripted-provider.mjs";
import { startTestServer, waitFor } from "../helpers/server.mjs";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = fileURLToPath(new URL("../../plugins", import.meta.url));
const CHANNEL_FAKE = fileURLToPath(
  new URL("../fixtures/plugins/channel-fake", import.meta.url),
);

test("随访提案确认后，今日待办出现对应随访事项", async (t) => {
  const provider = createScriptedProvider([]);
  // The followup plugin is dormant without a connected channel. This test is
  // about followup behaviour, so inject the test-only connected channel.
  const app = await startTestServer({
    provider,
    serverOptions: { pluginDirs: [PLUGIN_ROOT, CHANNEL_FAKE] },
  });
  t.after(() => app.close());

  const patients = await app.patients();
  const target = patients.find((patient) => patient.name === "示例·张沪生");
  assert.ok(target, "示例患者张沪生应存在");

  const name = "基线复诊随访";
  provider.enqueue(
    () =>
      toolCall(
        "followup_create_propose",
        {
          patientId: target.id,
          name,
          once: true,
          // Computed at model-call time so the plan is still in the future
          // when the API confirmation applies it.
          firstDueAt: new Date(Date.now() + 5000).toISOString(),
          summary: `为 ${target.name} 创建随访提醒`,
        },
        "call_followup_propose",
      ),
    textTurn("已创建随访提案，等待确认。"),
  );

  const runResponse = await app.request("/api/agent/run", {
    method: "POST",
    body: {
      sessionId: target.sessionId,
      message: "给这位患者创建一个随访提醒",
      mode: "standard",
      externalConsent: true,
    },
  });
  assert.equal(runResponse.status, 200);
  assert.equal(runResponse.body.status, "completed");

  const projected = await app.request(`/api/sessions/${target.sessionId}`);
  assert.equal(projected.status, 200);
  const run = projected.body.runs.find(
    (item) => item.id === runResponse.body.runId,
  );
  assert.ok(run, "应能从会话详情读到随访提案 run");
  assert.ok(
    run.events
      .filter((event) => event.type === "tool.complete")
      .some((event) => event.payload?.tool === "followup_create_propose"),
    "run 事件应记录 followup_create_propose 执行完成",
  );

  const pending = await app.request(
    `/api/pending-actions?type=followup-create&patientId=${target.id}`,
  );
  assert.equal(pending.status, 200);
  const action = pending.body.actions.find(
    (item) => item.payload?.name === name,
  );
  assert.ok(action, "应能通过 API 查到刚创建的随访提案");
  assert.equal(action.status, "pending");

  const confirm = await app.request(
    `/api/pending-actions/${action.id}/confirm`,
    { method: "POST", body: {} },
  );
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.ok, true);
  assert.equal(confirm.body.applied.name, name);
  assert.equal(confirm.body.applied.patientId, target.id);

  const item = await waitFor(
    async () => {
      const response = await app.request("/api/doctor/overview?limit=100");
      if (response.status !== 200) return null;
      return response.body.items.find(
        (entry) =>
          entry.kind === "followup" &&
          entry.patientId === target.id &&
          entry.title === `随访：${name}`,
      );
    },
    { timeoutMs: 15000, intervalMs: 250, description: "随访事项进入今日待办" },
  );

  assert.ok(item.id.startsWith("reminder:"), "待办条目应来自随访提醒");
  assert.equal(item.patientName, target.name);

  const reminders = await app.request(
    `/api/reminders?patientId=${target.id}&status=pending`,
  );
  assert.equal(reminders.status, 200);
  assert.ok(
    reminders.body.reminders.some(
      (reminder) => reminder.title === `随访：${name}`,
    ),
    "随访提醒应处于 pending",
  );
});
