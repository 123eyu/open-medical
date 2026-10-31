import test from "node:test";
import assert from "node:assert/strict";
import { createScriptedProvider, textTurn, toolCall } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

const names = (call) => call.tools.map((tool) => tool.function.name);

async function run(app, sessionId, message) {
  const response = await app.request("/api/agent/run", {
    method: "POST",
    body: { sessionId, message, mode: "model", externalConsent: true },
  });
  assert.equal(response.body.status, "completed", JSON.stringify(response.body));
  return response;
}

test("医疗会话：普通问答不列出编程、扩展、试验等按需工具，只给 enable_tools", async (t) => {
  const provider = createScriptedProvider([textTurn("好的。")]);
  const app = await startTestServer({ provider, seedDemoPack: false });
  t.after(() => app.close());
  const session = await app.request("/api/assistant/session", { method: "POST", body: {} });
  await run(app, session.body.id, "高血压患者血钾偏低要注意什么？");
  const listed = names(provider.calls[0]);
  for (const hidden of ["extension_propose", "read_file", "trial_list", "stats_test", "drg_group"])
    assert.ok(!listed.includes(hidden), `${hidden} 不应默认列出`);
  for (const kept of ["read_source", "knowledge_search", "patient_create_propose", "enable_tools"])
    assert.ok(listed.includes(kept), `${kept} 应常驻`);
});

test("提到定制需求时自动列出扩展工具", async (t) => {
  const provider = createScriptedProvider([textTurn("好的。")]);
  const app = await startTestServer({ provider, seedDemoPack: false });
  t.after(() => app.close());
  const session = await app.request("/api/assistant/session", { method: "POST", body: {} });
  await run(app, session.body.id, "以后出院小结都按我们医院的模板写");
  const listed = names(provider.calls[0]);
  assert.ok(listed.includes("extension_propose"));
  assert.ok(!listed.includes("read_file"), "其他组仍按需");
});

test("enable_tools 开启后下一轮可用，并在本会话后续任务保留", async (t) => {
  const provider = createScriptedProvider([
    toolCall("enable_tools", { group: "trials" }, "call_enable"),
    textTurn("已开启。"),
    textTurn("第二个任务。"),
  ]);
  const app = await startTestServer({ provider, seedDemoPack: false });
  t.after(() => app.close());
  const session = await app.request("/api/assistant/session", { method: "POST", body: {} });
  await run(app, session.body.id, "帮我看看这个病人");
  assert.ok(!names(provider.calls[0]).includes("trial_list"));
  assert.ok(names(provider.calls[1]).includes("trial_list"), "开启后的下一轮应列出");
  await run(app, session.body.id, "再看看别的");
  assert.ok(names(provider.calls[2]).includes("trial_list"), "同一会话的新任务应保留已开启的组");
});

test("直接调用未列出的工具：照常执行，并从下一轮起列出该组", async (t) => {
  const provider = createScriptedProvider([
    toolCall("extension_list", {}, "call_ext"),
    textTurn("看过了。"),
  ]);
  const app = await startTestServer({ provider, seedDemoPack: false });
  t.after(() => app.close());
  const session = await app.request("/api/assistant/session", { method: "POST", body: {} });
  await run(app, session.body.id, "你好");
  const result = provider.calls[1].messages.find((m) => m.role === "tool" && m.tool_call_id === "call_ext");
  assert.doesNotMatch(result.content, /UNKNOWN_TOOL|"error"/);
  assert.ok(names(provider.calls[1]).includes("extension_propose"));
});
