import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const normalizeId = (id) => id.replace(UUID, "<uuid>");

test("今日待办快照与示例资料一致（kind 计数与条目 id 形态）", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
  });
  t.after(() => app.close());

  const response = await app.request("/api/doctor/overview?limit=100");
  assert.equal(response.status, 200);
  const overview = response.body;

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

  const actual = {
    counts: overview.counts,
    total: overview.total,
    itemsByKind,
  };
  const snapshot = JSON.parse(
    readFileSync(
      new URL("./__snapshots__/agenda.json", import.meta.url),
      "utf8",
    ),
  );

  assert.deepEqual(actual, snapshot);
  assert.equal(overview.counts.all, overview.items.length);
  assert.equal(
    Object.values(overview.counts)
      .filter((value) => typeof value === "number")
      .reduce((sum, value) => sum + value, 0) -
      overview.counts.all,
    overview.total,
    "各 kind 计数之和（排除 all）应等于 total",
  );
});
