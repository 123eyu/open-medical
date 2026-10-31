import test from "node:test";
import assert from "node:assert/strict";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

// The product is model-based: with no model connected, every chat/run/task
// submission is refused with MODEL_NOT_CONFIGURED. There is no rule-based mode
// that answers in the model's place.
async function unconfigured(t) {
  const provider = createScriptedProvider(["不应被调用"]);
  provider.apiKey = "";
  const app = await startTestServer({
    provider,
    seedDemoPack: false,
    serverOptions: { schedulerOptions: { autoStart: false } },
  });
  t.after(() => app.close());
  const session = await app.request("/api/sessions", { method: "POST", body: { title: "未连接模型" } });
  assert.equal(session.status, 201, session.text);
  return { app, provider, id: session.body.id };
}

const assertModelRequired = (response) => {
  assert.equal(response.status, 503, response.text);
  assert.equal(response.body.code, "MODEL_NOT_CONFIGURED");
  assert.match(response.body.error, /设置 → 模型与运行/);
};

test("未连接模型：对话、同步运行与各运行方式别名都返回 503，不生成规则回答", async (t) => {
  const { app, provider, id } = await unconfigured(t);
  const bootstrap = await app.request("/api/bootstrap");
  assert.equal(bootstrap.body.modelConfigured, false);

  const prompts = [
    "合成测试 时间线 2026-01-02 首诊 Hb 98 g/L",
    "血钾 6.1 是什么意思？",
    "请核对当前用药",
  ];
  for (const message of prompts) {
    for (const mode of [undefined, "model"]) {
      assertModelRequired(await app.request(`/api/chat/${id}`, { method: "POST", body: { message, ...(mode ? { mode } : {}) } }));
      assertModelRequired(await app.request("/api/agent/run", { method: "POST", body: { sessionId: id, message, ...(mode ? { mode } : {}) } }));
    }
  }
  for (const workflow of ["knowledge-answer", "literature-research", "patient-assessment"])
    assertModelRequired(await app.request(`/api/chat/${id}`, { method: "POST", body: { message: "问题", workflow } }));

  const session = (await app.request(`/api/sessions/${id}`)).body;
  assert.equal(session.runs.length, 0, "被拒绝的提交不留下运行记录");
  assert.equal(session.messages.length, 0);
  assert.equal(session.artifacts.length, 0, "不生成本地规则草稿");
  assert.equal(provider.calls.length, 0);

  const health = (await app.request("/api/agent/health")).body;
  assert.equal(health.modelConfigured, false);
  assert.equal(health.provider, null);
  assert.ok(health.modes.every((mode) => mode.kind !== "local"));
});

test("未连接模型：计划任务不能创建，后台消费方同样被拒绝", async (t) => {
  const { app, id } = await unconfigured(t);
  const created = await app.request(`/api/sessions/${id}/schedules`, {
    method: "POST",
    body: { name: "定期整理", message: "整理时间线", runAt: new Date(Date.now() + 600000).toISOString(), fileIds: [] },
  });
  assertModelRequired(created);
  for (const mode of ["local", "standard"])
    assert.equal(
      (await app.request(`/api/chat/${id}`, { method: "POST", body: { message: "问题", mode } })).status,
      400,
      "只接受 model / code 两种运行方式",
    );

  assert.throws(
    () => app.server.sessionBridge.dispatcher.prepare(id, { message: "后台任务", mode: "code" }),
    (error) => error.code === "INVALID_INPUT",
  );
  assert.throws(
    () => app.server.sessionBridge.dispatcher.prepare(id, { message: "后台任务", mode: "model", externalConsent: true }),
    (error) => error.code === "MODEL_NOT_CONFIGURED",
  );
});

test("代码模式只运行医生提交的沙箱代码，不需要模型也不生成回答", async (t) => {
  const { app, id } = await unconfigured(t);
  const bootstrap = (await app.request("/api/bootstrap")).body;
  const response = await app.request(`/api/chat/${id}`, {
    method: "POST",
    body: { message: "沙箱计算", mode: "code", sandboxCode: "result = 2 + 3" },
  });
  if (!bootstrap.sandbox?.available) {
    assert.equal(response.status, 503);
    assert.equal(response.body.code, "SANDBOX_UNAVAILABLE");
    return;
  }
  assert.equal(response.status, 200, response.text);
  assert.match(response.text, /"type":"message.complete"/);
  const session = (await app.request(`/api/sessions/${id}`)).body;
  assert.equal(session.runs.at(-1).mode, "code");
  assert.equal(session.artifacts.length, 0);
  assert.match(session.messages.at(-1).content, /沙箱计算结果（待复核）[\s\S]*5/);
  const missingCode = await app.request(`/api/chat/${id}`, { method: "POST", body: { message: "沙箱计算", mode: "code" } });
  assert.equal(missingCode.status, 400);
});

test("代码模式：所选资料和任务文本作为 sources 传入沙箱，未选的资料不传", async (t) => {
  const { app, id } = await unconfigured(t);
  const add = async (name, text) => {
    const file = await app.request(`/api/sessions/${id}/files`, { method: "POST", body: { name, text } });
    assert.equal(file.status, 201, file.text);
    return file.body.id;
  };
  const chosen = await add("检验.txt", "2026-01-02 Hb 98 g/L\n2026-02-03 Hb 105 g/L");
  await add("未选.txt", "不应传入沙箱");
  const service = app.server.sessionBridge.service;
  const real = service.sandbox;
  const seen = [];
  // 用记录型沙箱验证传参；真实沙箱可用时再端到端跑一次。
  service.sandbox = { status: () => ({ available: true }), run: async (input) => { seen.push(input); return { result: input.sources.length }; } };
  t.after(() => { service.sandbox = real; });
  const response = await app.request(`/api/chat/${id}`, {
    method: "POST",
    body: { message: "统计 Hb 行数", mode: "code", sandboxCode: "result = len(sources)", fileIds: [chosen] },
  });
  assert.equal(response.status, 200, response.text);
  assert.deepEqual(seen[0].sources.map((s) => s.name), ["检验.txt", "本轮输入"]);
  assert.match(seen[0].sources[0].text, /Hb 105 g\/L/);
  assert.equal(seen[0].sources[1].text, "统计 Hb 行数");
  const session = (await app.request(`/api/sessions/${id}`)).body;
  assert.deepEqual(session.runs.at(-1).fileIds, [chosen]);

  const unknown = await app.request(`/api/chat/${id}`, {
    method: "POST",
    body: { message: "越权", mode: "code", sandboxCode: "result = 1", fileIds: ["no-such-file"] },
  });
  assert.equal(unknown.status, 404);

  if (!real?.status?.()?.available) return;
  service.sandbox = real;
  const live = await app.request(`/api/chat/${id}`, {
    method: "POST",
    body: { message: "数行", mode: "code", sandboxCode: 'result = [s["name"] for s in sources] + [sum(len(s["text"].splitlines()) for s in sources)]', fileIds: [chosen] },
  });
  assert.equal(live.status, 200, live.text);
  const content = (await app.request(`/api/sessions/${id}`)).body.messages.at(-1).content;
  assert.match(content, /检验\.txt/);
  assert.match(content, /本轮输入/);
  assert.match(content, /\b3\b/);
});
