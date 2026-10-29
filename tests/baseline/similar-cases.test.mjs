import test from "node:test";
import assert from "node:assert/strict";
import {
  createScriptedProvider,
  toolCall,
} from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

test("相似病例工作流：调用 similar_case_search → finish_similar_case_search，产出 similar_cases artifact", async (t) => {
  const provider = createScriptedProvider([
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
  const app = await startTestServer({ provider });
  t.after(() => app.close());

  const patients = await app.patients();
  const target = patients.find((patient) => patient.name === "示例·张沪生");
  assert.ok(target, "示例患者张沪生应存在");

  const response = await app.request("/api/agent/run", {
    method: "POST",
    body: {
      sessionId: target.sessionId,
      message: "这个患者有相似病例吗？仅本地检索",
      mode: "standard",
      externalConsent: true,
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "completed");

  const projected = await app.request(`/api/sessions/${target.sessionId}`);
  assert.equal(projected.status, 200);
  const run = projected.body.runs.find(
    (item) => item.id === response.body.runId,
  );
  assert.ok(run, "应能从会话详情读到相似病例 run");
  assert.equal(run.status, "completed");
  assert.equal(run.policy.workflow, "similar-case-search");
  assert.equal(run.policy.searchScope, "local");

  const completedTools = run.events
    .filter((event) => event.type === "tool.complete")
    .map((event) => event.payload?.tool);
  assert.ok(
    completedTools.includes("similar_case_search"),
    "应执行 similar_case_search",
  );
  assert.ok(
    completedTools.includes("finish_similar_case_search"),
    "应执行 finish_similar_case_search",
  );

  const artifact = run.artifacts.find(
    (item) => item.type === "similar_cases",
  );
  assert.ok(artifact, "相似病例工作流必须产出 similar_cases artifact");
  assert.equal(artifact.status, "draft");
  assert.equal(artifact.localSearched, true);
  assert.ok(Array.isArray(artifact.cases));
  assert.ok(Array.isArray(artifact.limitations));
});
