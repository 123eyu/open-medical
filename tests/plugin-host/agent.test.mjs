import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createScriptedProvider,
  textTurn,
  toolCall,
} from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

const HELLO = join(
  fileURLToPath(new URL("../fixtures/plugins", import.meta.url)),
  "hello",
);

async function assistantSession(app) {
  const response = await app.request("/api/assistant/session", {
    method: "POST",
    body: {},
  });
  assert.equal(response.status, 200);
  return response.body.id;
}

test("hello_echo 能被 Agent 调用，且 prompt.md 进入医疗系统提示", async (t) => {
  const provider = createScriptedProvider([
    toolCall("hello_echo", { text: "插件你好" }, "call_hello_echo"),
    textTurn("已通过 hello 插件回显。"),
  ]);
  const app = await startTestServer({
    provider,
    serverOptions: { pluginDirs: [HELLO] },
  });
  t.after(() => app.close());

  const enabledResponse = await app.request("/api/plugins/hello", {
    method: "PUT",
    body: { enabled: true },
  });
  assert.equal(enabledResponse.status, 200);

  const sessionId = await assistantSession(app);
  const response = await app.request("/api/agent/run", {
    method: "POST",
    body: {
      sessionId,
      message: "用 hello_echo 回显这句话",
      mode: "model",
      externalConsent: true,
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "completed");

  assert.ok(
    provider.calls[0].tools.some(
      (tool) => tool.function.name === "hello_echo",
    ),
    "第一轮工具列表应包含插件工具 hello_echo",
  );
  const toolMessage = provider.calls[1].messages.find(
    (message) =>
      message.role === "tool" &&
      message.tool_call_id === "call_hello_echo",
  );
  assert.ok(toolMessage, "第二轮模型请求应包含 hello_echo 的工具结果");
  assert.match(toolMessage.content, /插件你好/);

  const projected = await app.request(`/api/sessions/${sessionId}`);
  const run = projected.body.runs.find(
    (item) => item.id === response.body.runId,
  );
  assert.ok(
    run.events.some(
      (event) =>
        event.type === "tool.complete" &&
        event.payload?.tool === "hello_echo",
    ),
    "run 事件应记录 hello_echo 完成",
  );

  const fragment = app.server.pluginHost.promptFragments();
  assert.match(fragment, /hello_echo/);
  const system = provider.calls[0].messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");
  assert.ok(
    system.includes(fragment),
    "医疗系统提示应包含插件 prompt.md 内容",
  );
});

test("停用后工具不注册、API 404、待办消失；启用后全部恢复", async (t) => {
  const provider = createScriptedProvider([
    textTurn("停用状态回答"),
    textTurn("启用状态回答"),
  ]);
  const app = await startTestServer({
    provider,
    serverOptions: { pluginDirs: [HELLO] },
  });
  t.after(() => app.close());

  const enabledResponse = await app.request("/api/plugins/hello", {
    method: "PUT",
    body: { enabled: true },
  });
  assert.equal(enabledResponse.status, 200);

  const created = await app.request("/api/p/hello/greet", {
    method: "POST",
    body: { name: "王五", message: "留一条待办" },
  });
  assert.equal(created.status, 201);
  const confirmed = await app.request(
    `/api/pending-actions/${created.body.proposal.id}/confirm`,
    { method: "POST", body: {} },
  );
  assert.equal(confirmed.status, 200);
  assert.ok(
    app.server.pluginHost.agendaItems().some((item) => item.kind === "hello"),
    "启用时应有 hello 待办",
  );

  const disabled = await app.request("/api/plugins/hello", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.plugin.enabled, false);
  assert.equal(disabled.body.plugin.status, "disabled");

  let sessionId = await assistantSession(app);
  let run = await app.request("/api/agent/run", {
    method: "POST",
    body: {
      sessionId,
      message: "停用后还有什么工具",
      mode: "model",
      externalConsent: true,
    },
  });
  assert.equal(run.status, 200);
  assert.ok(
    !provider.calls[0].tools.some(
      (tool) => tool.function.name === "hello_echo",
    ),
    "停用后第一轮工具列表不应包含 hello_echo",
  );

  const disabledApi = await app.request("/api/p/hello/ping");
  assert.equal(disabledApi.status, 404);
  assert.equal(disabledApi.body.code, "NOT_FOUND");
  assert.deepEqual(app.server.pluginHost.agendaItems(), []);
  assert.equal(app.server.pluginHost.promptFragments(), "");

  const enabled = await app.request("/api/plugins/hello", {
    method: "PUT",
    body: { enabled: true },
  });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.plugin.enabled, true);
  assert.equal(enabled.body.plugin.status, "ready");

  sessionId = await assistantSession(app);
  run = await app.request("/api/agent/run", {
    method: "POST",
    body: {
      sessionId,
      message: "启用后有哪些工具",
      mode: "model",
      externalConsent: true,
    },
  });
  assert.equal(run.status, 200);
  assert.ok(
    provider.calls[1].tools.some(
      (tool) => tool.function.name === "hello_echo",
    ),
    "重新启用后第一轮工具列表应恢复 hello_echo",
  );
  assert.equal((await app.request("/api/p/hello/ping")).status, 200);
  assert.ok(
    app.server.pluginHost.agendaItems().some((item) => item.kind === "hello"),
    "重新启用后待办应恢复，历史数据不删除",
  );
});
