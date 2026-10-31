import test from "node:test";
import assert from "node:assert/strict";
import { createScriptedProvider, textTurn } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

const narrated = (content, name, id) => ({
  message: {
    role: "assistant",
    content,
    tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }],
  },
});

test("最终回答只保留最后一轮，前面的过程说明单独保存", async (t) => {
  const provider = createScriptedProvider([
    narrated("我先看一下在管患者名单。", "list_patients", "call_1"),
    textTurn("共 0 位在管患者，暂时无法比较共同点。"),
  ]);
  const app = await startTestServer({ provider, seedDemoPack: false });
  t.after(() => app.close());
  const session = await app.request("/api/assistant/session", { method: "POST", body: {} });
  const response = await app.request("/api/agent/run", {
    method: "POST",
    body: { sessionId: session.body.id, message: "这些患者有什么共同点", mode: "model", externalConsent: true },
  });
  assert.equal(response.body.status, "completed", JSON.stringify(response.body));
  const detail = await app.request(`/api/sessions/${session.body.id}`);
  const answer = detail.body.messages.findLast((m) => m.role === "assistant");
  assert.equal(answer.content, "共 0 位在管患者，暂时无法比较共同点。");
  assert.equal(answer.progress, "我先看一下在管患者名单。");
});

test("最后一轮没有文字时保留全部文字", async (t) => {
  const provider = createScriptedProvider([
    narrated("已整理完毕，结果见下。", "list_patients", "call_1"),
    { message: { role: "assistant", content: "" } },
  ]);
  const app = await startTestServer({ provider, seedDemoPack: false });
  t.after(() => app.close());
  const session = await app.request("/api/assistant/session", { method: "POST", body: {} });
  const response = await app.request("/api/agent/run", {
    method: "POST",
    body: { sessionId: session.body.id, message: "整理一下", mode: "model", externalConsent: true },
  });
  assert.equal(response.body.status, "completed", JSON.stringify(response.body));
  const detail = await app.request(`/api/sessions/${session.body.id}`);
  const answer = detail.body.messages.findLast((m) => m.role === "assistant");
  assert.match(answer.content, /已整理完毕/);
  assert.equal(answer.progress, undefined);
});
