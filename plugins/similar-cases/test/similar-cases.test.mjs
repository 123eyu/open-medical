import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  createScriptedProvider,
  textTurn,
  toolCall,
} from "../../../tests/helpers/scripted-provider.mjs";
import { startTestServer } from "../../../tests/helpers/server.mjs";

const PLUGIN_DIR = fileURLToPath(new URL("..", import.meta.url));

async function patientSession(app) {
  const patients = await app.patients();
  const target = patients.find((patient) => patient.name === "示例·张沪生");
  assert.ok(target, "示例患者张沪生应存在");
  return target.sessionId;
}

const systemText = (provider, index) =>
  provider.calls[index].messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");

test("停用相似病例插件后工作流返回 409、提示与收尾工具消失；重新启用后恢复", async (t) => {
  const provider = createScriptedProvider([
    textTurn("停用状态下的普通回答"),
    toolCall(
      "similar_case_search",
      {
        caseText: "原发性高血压 血压波动 肾功能稳定",
        diagnosis: "原发性高血压",
        limit: 5,
      },
      "call_similar_search",
    ),
    toolCall(
      "finish_similar_case_search",
      {
        summary: "仅本地检索：找到本地候选，尚需医生结合来源核对。",
        items: [],
        limitations: ["本轮限定本机检索，未进行网上检索", "候选需医生核对"],
      },
      "call_similar_finish",
    ),
  ]);
  const app = await startTestServer({
    provider,
    serverOptions: { pluginDirs: [PLUGIN_DIR] },
  });
  t.after(() => app.close());

  const disabled = await app.request("/api/plugins/similar-cases", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.plugin.status, "disabled");
  assert.equal(app.server.pluginHost.workflow("similar-case-search"), null);
  assert.equal(app.server.pluginHost.promptFragments(), "");

  const sessionId = await patientSession(app);
  const rejected = await app.request("/api/agent/run", {
    method: "POST",
    body: {
      sessionId,
      message: "请查找这位患者的相似病例，仅本地检索",
      mode: "standard",
      externalConsent: true,
    },
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, "PLUGIN_UNAVAILABLE");

  const ordinary = await app.request("/api/agent/run", {
    method: "POST",
    body: {
      sessionId,
      message: "请简要回答今天的工作安排",
      mode: "standard",
      externalConsent: true,
    },
  });
  assert.equal(ordinary.status, 200);
  assert.equal(ordinary.body.status, "completed");
  assert.ok(
    !provider.calls[0].tools.some(
      (tool) => tool.function.name === "finish_similar_case_search",
    ),
    "停用后工具列表不应包含 finish_similar_case_search",
  );
  const disabledSystem = systemText(provider, 0);
  assert.doesNotMatch(disabledSystem, /用 similar_case_search 检索本地病例库/);
  assert.doesNotMatch(disabledSystem, /本轮只完成相似病例检索/);

  const enabled = await app.request("/api/plugins/similar-cases", {
    method: "PUT",
    body: { enabled: true },
  });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.plugin.status, "ready");

  const response = await app.request("/api/agent/run", {
    method: "POST",
    body: {
      sessionId,
      message: "请查找这位患者的相似病例，仅本地检索",
      mode: "standard",
      externalConsent: true,
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "completed");
  assert.ok(
    provider.calls[1].tools.some(
      (tool) => tool.function.name === "finish_similar_case_search",
    ),
    "启用后工具列表应恢复 finish_similar_case_search",
  );
  const enabledSystem = systemText(provider, 1);
  assert.match(enabledSystem, /用 similar_case_search 检索本地病例库/);
  assert.match(enabledSystem, /本轮只完成相似病例检索/);
  assert.match(enabledSystem, /本轮医生限定仅本地检索/);

  const projected = await app.request(`/api/sessions/${sessionId}`);
  const run = projected.body.runs.find(
    (item) => item.id === response.body.runId,
  );
  assert.ok(run, "应能从会话详情读到相似病例 run");
  assert.equal(run.policy.workflow, "similar-case-search");
  assert.equal(run.policy.searchScope, "local");
  assert.ok(
    run.artifacts.some((artifact) => artifact.type === "similar_cases"),
    "重新启用后必须恢复 similar_cases artifact",
  );
});
