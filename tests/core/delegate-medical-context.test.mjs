import test from "node:test";
import assert from "node:assert/strict";
import { createScriptedProvider, textTurn, toolCall } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

// The material index in the system prompt lists the "本轮输入" source id.
function inputSourceId(messages) {
  const system = messages.find((m) => m.role === "system").content;
  const match = system.match(/"id":"([^"]+)","name":"本轮输入"/);
  assert.ok(match, "系统提示应包含本轮材料索引");
  return match[1];
}

test("医疗会话委派子任务：子任务能看到材料索引并读取本会话资料", async (t) => {
  let childToolResult;
  const provider = createScriptedProvider([
    toolCall("delegate_task", { task: "读取本轮输入并摘出血压数值" }, "call_delegate"),
    // Child round 1: read the parent's material by id from its own prompt.
    ({ messages }) => toolCall("read_source", { sourceId: inputSourceId(messages), startLine: 1, endLine: 5 }, "call_read"),
    // Child round 2: report.
    ({ messages }) => {
      childToolResult = messages.find((m) => m.role === "tool" && m.tool_call_id === "call_read")?.content;
      return textTurn("子任务：血压 148/92。");
    },
    textTurn("汇总：血压 148/92。"),
  ]);
  const app = await startTestServer({ provider, seedDemoPack: false });
  t.after(() => app.close());
  const session = await app.request("/api/assistant/session", { method: "POST", body: {} });
  const run = await app.request("/api/agent/run", {
    method: "POST",
    body: {
      sessionId: session.body.id,
      message: "血压记录：148/92 mmHg，请委派子任务整理",
      mode: "model",
      externalConsent: true,
    },
  });
  assert.equal(run.body.status, "completed", JSON.stringify(run.body));
  assert.ok(childToolResult, "子任务应收到 read_source 的结果");
  assert.doesNotMatch(childToolResult, /SOURCE_NOT_FOUND/);
  assert.match(childToolResult, /148\/92/);
});
