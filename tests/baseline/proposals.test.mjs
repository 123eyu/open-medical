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
