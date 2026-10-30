import test from "node:test";
import assert from "node:assert/strict";
import {
  AiSdkProvider,
  MAX_TOOL_ARGUMENT_CHARS,
} from "../../server/core/ai-sdk-provider.mjs";
import { createScriptedProvider, textTurn } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

function streamOf(parts) {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

const collect = (parts) =>
  AiSdkProvider.prototype.collect.call(
    { finalize: AiSdkProvider.prototype.finalize },
    streamOf(parts),
    {
      kind: "openai",
      idle: { signal: new AbortController().signal, touch() {} },
      onDelta() {},
    },
  );

const finish = { type: "finish", finishReason: { raw: "tool_calls", unified: "tool-calls" } };

test("模型一次给出 20 个工具调用：交给运行时处理，不再直接报错", async () => {
  const parts = [];
  for (let i = 0; i < 20; i++)
    parts.push({ type: "tool-call", toolCallId: `c${i}`, toolName: "list_patients", input: "{}" });
  const result = await collect([...parts, finish]);
  assert.equal(result.message.tool_calls.length, 20);
});

test("工具参数过大：调用被标记并替换为 {}，不中断本轮", async () => {
  const big = JSON.stringify({ content: "x".repeat(MAX_TOOL_ARGUMENT_CHARS + 10) });
  const result = await collect([
    { type: "tool-input-start", id: "a", toolName: "propose_file_write" },
    { type: "tool-input-delta", id: "a", delta: big.slice(0, 1000) },
    { type: "tool-input-delta", id: "a", delta: big.slice(1000) },
    finish,
  ]);
  const [call] = result.message.tool_calls;
  assert.equal(call.function.arguments, "{}");
  assert.equal(call.argumentsTooLarge, big.length);
});

test("运行时把超大参数作为工具错误交回模型，任务继续完成", async (t) => {
  const provider = createScriptedProvider([
    {
      tool_calls: [
        {
          id: "call_big",
          type: "function",
          function: { name: "list_patients", arguments: "{}" },
          argumentsTooLarge: 250000,
        },
      ],
    },
    textTurn("已改为分段处理。"),
  ]);
  const app = await startTestServer({ provider, seedDemoPack: false });
  t.after(() => app.close());
  const session = await app.request("/api/assistant/session", { method: "POST", body: {} });
  const run = await app.request("/api/agent/run", {
    method: "POST",
    body: { sessionId: session.body.id, message: "写一份长报告", mode: "standard", externalConsent: true },
  });
  assert.equal(run.body.status, "completed", JSON.stringify(run.body));
  const toolMessage = provider.calls[1].messages.find(
    (m) => m.role === "tool" && m.tool_call_id === "call_big",
  );
  assert.match(toolMessage.content, /TOOL_ARGS_TOO_LARGE/);
});

test("模型流中途断开：同一轮自动重试，任务照常完成", async (t) => {
  const { AppError } = await import("../../server/errors.mjs");
  let failed = false;
  const flaky = () => {
    if (!failed) {
      failed = true;
      throw new AppError("INCOMPLETE_STREAM", "模型流中断或没有正常结束", 502);
    }
    return textTurn("重试后完成。");
  };
  const provider = createScriptedProvider([flaky]);
  // The first attempt consumes the scripted turn; queue it again for the retry.
  provider.enqueue(flaky);
  const app = await startTestServer({ provider, seedDemoPack: false });
  t.after(() => app.close());
  const session = await app.request("/api/assistant/session", { method: "POST", body: {} });
  const run = await app.request("/api/agent/run", {
    method: "POST",
    body: { sessionId: session.body.id, message: "你好", mode: "standard", externalConsent: true },
  });
  assert.equal(run.body.status, "completed", JSON.stringify(run.body));
  assert.equal(provider.calls.length, 2);
});
