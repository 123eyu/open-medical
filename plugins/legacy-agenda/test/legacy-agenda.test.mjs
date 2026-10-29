import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createScriptedProvider } from "../../../tests/helpers/scripted-provider.mjs";
import { startTestServer } from "../../../tests/helpers/server.mjs";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const normalizeId = (id) => id.replace(UUID, "<uuid>");
const PRODUCTION_PLUGINS = fileURLToPath(new URL("../..", import.meta.url));
const THROWING_PLUGIN = fileURLToPath(
  new URL("../../../tests/fixtures/plugins/throwing-agenda", import.meta.url),
);
const SNAPSHOT = JSON.parse(
  readFileSync(
    new URL(
      "../../../tests/baseline/__snapshots__/agenda.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

const EXPECTED_KINDS = [
  ["all", "全部"],
  ["risk", "高危风险"],
  ["visit", "复诊"],
  ["followup", "随访"],
  ["tracking", "检查检验"],
  ["messages", "患者消息"],
  ["trial", "试验入组"],
  ["custom", "我的规则"],
];

function snapshotShape(overview) {
  const itemsByKind = {};
  for (const item of overview.items) {
    assert.equal(typeof item.id, "string");
    assert.equal(typeof item.kind, "string");
    assert.equal(typeof item.title, "string");
    assert.equal(typeof item.patientName, "string");
    (itemsByKind[item.kind] ||= []).push(normalizeId(item.id));
  }
  for (const ids of Object.values(itemsByKind)) ids.sort();
  return {
    counts: overview.counts,
    total: overview.total,
    itemsByKind,
  };
}

test("停用 legacy-agenda 后只剩复诊与 followup 插件来源；重新启用后恢复快照", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
  });
  t.after(() => app.close());

  const before = await app.request("/api/doctor/overview?limit=100");
  assert.equal(before.status, 200);
  assert.deepEqual(
    before.body.kinds.map(({ kind, label }) => [kind, label]),
    EXPECTED_KINDS,
    "kinds 的标签与顺序必须和原界面一致",
  );
  assert.deepEqual(snapshotShape(before.body), SNAPSHOT);

  const disabled = await app.request("/api/plugins/legacy-agenda", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.plugin.status, "disabled");

  const reduced = await app.request("/api/doctor/overview?limit=100");
  assert.equal(reduced.status, 200);
  assert.deepEqual(
    reduced.body.kinds.map(({ kind }) => kind),
    ["all", "visit", "followup", "messages"],
    "停用后固定区复诊与 followup 插件来源保留，其余旧来源消失",
  );
  assert.deepEqual(reduced.body.counts, {
    all: 5,
    visit: 1,
    followup: 1,
    messages: 3,
  });
  assert.equal(reduced.body.total, SNAPSHOT.total);
  assert.ok(
    reduced.body.items.every((item) =>
      ["visit", "followup", "messages"].includes(item.kind),
    ),
    "停用后今日待办只剩复诊与 followup 插件条目",
  );

  const rejected = await app.request("/api/doctor/overview?kind=risk");
  assert.equal(rejected.status, 400, "停用后 kind=risk 应返回 400");
  assert.equal(rejected.body.code, "INVALID_INPUT");
  for (const kind of ["followup", "messages"]) {
    const accepted = await app.request(`/api/doctor/overview?kind=${kind}`);
    assert.equal(accepted.status, 200, `followup 插件的 kind=${kind} 应保留`);
  }

  const enabled = await app.request("/api/plugins/legacy-agenda", {
    method: "PUT",
    body: { enabled: true },
  });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.plugin.status, "ready");

  const after = await app.request("/api/doctor/overview?limit=100");
  assert.equal(after.status, 200);
  assert.deepEqual(
    after.body.kinds.map(({ kind, label }) => [kind, label]),
    EXPECTED_KINDS,
  );
  assert.deepEqual(snapshotShape(after.body), SNAPSHOT);
});

test("单个 agendaSource 抛错时跳过该来源，其余条目与 errors 照常返回", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
    serverOptions: { pluginDirs: [PRODUCTION_PLUGINS, THROWING_PLUGIN] },
  });
  t.after(() => app.close());

  const response = await app.request("/api/doctor/overview?limit=100");
  assert.equal(response.status, 200);
  assert.ok(
    response.body.errors.some(
      (error) =>
        error.kind === "broken" && error.message.includes("broken agenda source"),
    ),
    "失败的来源应进入 errors",
  );
  assert.ok(
    !response.body.errors.some((error) => error.kind === "healthy"),
    "同一插件的正常来源不应被标记为错误",
  );
  assert.ok(
    response.body.items.some(
      (item) => item.kind === "healthy" && item.id === "healthy:1",
    ),
    "同一插件的正常来源条目应照常返回",
  );
  assert.ok(
    response.body.items.some((item) => item.kind === "visit"),
    "固定区复诊条目应照常返回",
  );
  assert.ok(
    !response.body.items.some((item) => item.kind === "broken"),
    "抛错来源不应产生条目",
  );
  const brokenKind = response.body.kinds.find((item) => item.kind === "broken");
  assert.equal(brokenKind?.count, 0, "抛错来源的分类仍以 0 计数出现");
});
