import test from "node:test";
import assert from "node:assert/strict";
import {
  createScriptedProvider,
  textTurn,
  toolCall,
} from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

test("Agent 流程：scripted provider 调用 list_patients 后给出最终回答，run 完成且记录工具调用", async (t) => {
  const call = toolCall("list_patients", {}, "call_list_patients");
  const provider = createScriptedProvider([
    call,
    textTurn("基线测试：共 3 位示例患者。"),
  ]);
  const app = await startTestServer({ provider });
  t.after(() => app.close());

  const sessionResponse = await app.request("/api/assistant/session", {
    method: "POST",
    body: {},
  });
  assert.equal(sessionResponse.status, 200);
  const sessionId = sessionResponse.body.id;
  assert.equal(typeof sessionId, "string");

  const runResponse = await app.request("/api/agent/run", {
    method: "POST",
    body: {
      sessionId,
      message: "列出所有患者",
      mode: "model",
      externalConsent: true,
    },
  });
  assert.equal(runResponse.status, 200);
  assert.equal(runResponse.body.status, "completed");

  assert.equal(provider.calls.length, 2);
  assert.ok(
    provider.calls[0].tools.some(
      (tool) => tool.function.name === "list_patients",
    ),
    "第一轮应把 list_patients 工具暴露给模型",
  );
  assert.ok(
    provider.calls[1].messages.some(
      (message) =>
        message.role === "tool" &&
        message.tool_call_id === "call_list_patients",
    ),
    "第二轮模型请求应包含 list_patients 的工具结果",
  );

  const projected = await app.request(`/api/sessions/${sessionId}`);
  assert.equal(projected.status, 200);
  const run = projected.body.runs.find(
    (item) => item.id === runResponse.body.runId,
  );
  assert.ok(run, "应能从会话详情读到本次 run");
  assert.equal(run.status, "completed");
  assert.equal(run.error, null);

  const starts = run.events.filter((event) => event.type === "tool.start");
  const completes = run.events.filter((event) => event.type === "tool.complete");
  assert.ok(
    starts.some((event) => event.payload?.tool === "list_patients"),
    "run 事件应记录 list_patients 开始执行",
  );
  assert.ok(
    completes.some((event) => event.payload?.tool === "list_patients"),
    "run 事件应记录 list_patients 执行完成",
  );
});
