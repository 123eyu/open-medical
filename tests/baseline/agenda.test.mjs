import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const normalizeId = (id) => id.replace(UUID, "<uuid>");
const PLUGIN_ROOT = fileURLToPath(new URL("../../plugins", import.meta.url));
const CHANNEL_FAKE = fileURLToPath(
  new URL("../fixtures/plugins/channel-fake", import.meta.url),
);

const snapshot = (name) =>
  JSON.parse(
    readFileSync(new URL(`./__snapshots__/${name}`, import.meta.url), "utf8"),
  );

function shape(overview) {
  // The HTTP route does not expose an injected `now`; the demo pack uses
  // relative dates, so the snapshot stores the stable part: kind counts,
  // total, and item ids with random UUIDs normalized.
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

async function readOverview(app) {
  const response = await app.request("/api/doctor/overview?limit=100");
  assert.equal(response.status, 200);
  const overview = response.body;
  const actual = shape(overview);
  assert.equal(overview.counts.all, overview.items.length);
  assert.equal(
    Object.values(overview.counts)
      .filter((value) => typeof value === "number")
      .reduce((sum, value) => sum + value, 0) -
      overview.counts.all,
    overview.total,
    "各 kind 计数之和（排除 all）应等于 total",
  );
  return actual;
}

test("默认未连接渠道：今日待办只剩复诊，随访/消息来源不出现", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
  });
  t.after(() => app.close());

  const actual = await readOverview(app);
  assert.deepEqual(actual, snapshot("agenda-dormant.json"));
  assert.deepEqual(Object.keys(actual.itemsByKind), ["visit"]);
  assert.equal(actual.counts.followup, undefined);
  assert.equal(actual.counts.messages, undefined);
});

test("渠道已连接：今日待办快照与示例资料一致（保留原快照）", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
    serverOptions: { pluginDirs: [PLUGIN_ROOT, CHANNEL_FAKE] },
  });
  t.after(() => app.close());

  const actual = await readOverview(app);
  assert.deepEqual(actual, snapshot("agenda.json"));
});
