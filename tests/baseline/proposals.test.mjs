import test from "node:test";
import assert from "node:assert/strict";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

test("患者档案修改提案确认后 revision 加 1、字段生效，重复确认失败或幂等", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
  });
  t.after(() => app.close());

  const [patient] = await app.patients();
  assert.ok(patient, "示例患者列表不应为空");

  const beforeResponse = await app.request(`/api/patients/${patient.id}`);
  assert.equal(beforeResponse.status, 200);
  const before = beforeResponse.body;

  const text = [
    "姓名,项目,数值,单位,日期",
    `${patient.name},前白蛋白,250,mg/L,2024-05-20`,
  ].join("\n");

  const preview = await app.request("/api/patients/lab-import/preview", {
    method: "POST",
    body: { text },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.stats.ready, 1);
  const row = preview.body.rows[0];
  assert.equal(row.status, "ready");
  assert.equal(row.patientId, patient.id);

  const commit = await app.request("/api/patients/lab-import/commit", {
    method: "POST",
    body: {
      text,
      selectedRows: [row.row],
      fingerprint: preview.body.fingerprint,
      requestId: "baseline-patient-update",
    },
  });
  assert.equal(commit.status, 201);
  assert.equal(commit.body.proposals.length, 1);
  const proposal = commit.body.proposals[0];
  assert.equal(proposal.patientId, patient.id);
  assert.equal(proposal.labs, 1);

  const pending = await app.request(
    `/api/pending-actions?type=patient-update&patientId=${patient.id}`,
  );
  assert.equal(pending.status, 200);
  const action = pending.body.actions.find((item) => item.id === proposal.id);
  assert.ok(action, "应能通过 API 查到刚创建的档案修改提案");
  assert.equal(action.status, "pending");
  assert.equal(action.type, "patient-update");

  const confirm = await app.request(
    `/api/pending-actions/${proposal.id}/confirm`,
    { method: "POST", body: {} },
  );
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.ok, true);
  assert.equal(confirm.body.action.status, "applied");
  assert.equal(confirm.body.applied.id, patient.id);

  const afterResponse = await app.request(`/api/patients/${patient.id}`);
  assert.equal(afterResponse.status, 200);
  const after = afterResponse.body;
  assert.equal(after.revision, before.revision + 1);
  // Importing adds results; it never drops the patient's earlier labs.
  assert.ok((before.labs || []).length > 0, "测试患者应已有检验记录");
  for (const lab of before.labs || [])
    assert.ok(
      after.labs.some((item) => item.item === lab.item && item.date === lab.date && item.value === lab.value),
      `原有检验 ${lab.item} ${lab.date} 应保留`,
    );
  assert.equal(after.labs.length, (before.labs || []).length + 1);
  assert.ok(
    after.labs.some(
      (lab) =>
        lab.item === "前白蛋白" &&
        lab.value === 250 &&
        lab.unit === "mg/L" &&
        lab.date === "2024-05-20",
    ),
    "确认后患者档案应包含提案中的检验结果",
  );

  // Repeating the confirmation must not apply the change twice: it either
  // reports the proposal as already resolved (409) or replays the receipt.
  const replay = await app.request(
    `/api/pending-actions/${proposal.id}/confirm`,
    { method: "POST", body: {} },
  );
  assert.ok(
    replay.status === 409 || replay.status === 200,
    `重复确认应失败或幂等，实际 HTTP ${replay.status}`,
  );
  if (replay.status === 409) {
    assert.equal(replay.body.code, "ACTION_RESOLVED");
  } else {
    assert.equal(replay.body.replayed, true);
  }

  const finalResponse = await app.request(`/api/patients/${patient.id}`);
  assert.equal(finalResponse.body.revision, after.revision);
  assert.equal(
    finalResponse.body.labs.filter((lab) => lab.item === "前白蛋白").length,
    1,
  );
});

test("检验导入：某位患者会超过 500 条上限时只跳过该患者，其他患者照常生成提案", async (t) => {
  const app = await startTestServer({ provider: createScriptedProvider([]) });
  t.after(() => app.close());
  const [full, other] = await app.patients();
  assert.ok(full && other, "需要两位示例患者");
  const filler = Array.from({ length: 499 }, (_, i) => ({ item: `历史项目${i}`, value: i, unit: "", date: "2020-01-01" }));
  app.server.patients.update(full.id, { labs: filler, expectedRevision: app.server.patients.row(full.id).revision });
  const text = [
    "姓名,项目,数值,单位,日期",
    `${full.name},前白蛋白,250,mg/L,2024-05-20`,
    `${full.name},白蛋白,40,g/L,2024-05-20`,
    `${other.name},前白蛋白,260,mg/L,2024-05-21`,
  ].join("\n");
  const preview = await app.request("/api/patients/lab-import/preview", { method: "POST", body: { text } });
  assert.equal(preview.status, 200);
  const rows = preview.body.rows.filter((row) => row.status === "ready").map((row) => row.row);
  assert.equal(rows.length, 3);
  const commit = await app.request("/api/patients/lab-import/commit", {
    method: "POST",
    body: { text, selectedRows: rows, fingerprint: preview.body.fingerprint, requestId: "lab-limit" },
  });
  assert.equal(commit.status, 201);
  assert.deepEqual(commit.body.proposals.map((p) => p.patientId), [other.id]);
  assert.deepEqual(commit.body.overLimit, [full.name]);
  assert.match(commit.body.note, /500 条上限/);
});
