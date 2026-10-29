import test from "node:test";
import assert from "node:assert/strict";
import { createScriptedProvider } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

test("加载示例资料后，患者列表返回 3 位示例患者，详情包含诊断、用药和检验", async (t) => {
  const app = await startTestServer({
    provider: createScriptedProvider([]),
  });
  t.after(() => app.close());

  const patients = await app.patients();
  assert.equal(patients.length, 3);
  assert.deepEqual(
    patients.map((patient) => patient.name).sort(),
    ["示例·张沪生", "示例·李婉珍", "示例·王建国"].sort(),
  );

  const target = patients.find((patient) => patient.name === "示例·张沪生");
  assert.ok(target, "示例患者张沪生应出现在列表中");

  const response = await app.request(`/api/patients/${target.id}`);
  assert.equal(response.status, 200);
  const detail = response.body;

  assert.equal(detail.id, target.id);
  assert.equal(detail.name, "示例·张沪生");
  assert.ok(Number.isInteger(detail.revision) && detail.revision >= 0);
  assert.equal(typeof detail.sessionId, "string");
  assert.ok(detail.sessionId.length > 0);

  assert.ok(Array.isArray(detail.diagnoses) && detail.diagnoses.length >= 1);
  assert.ok(
    detail.diagnoses.some((diagnosis) => diagnosis.name === "原发性高血压"),
    "患者详情应包含原发性高血压诊断",
  );
  assert.ok(
    Array.isArray(detail.medications) && detail.medications.length >= 1,
    "患者详情应包含用药记录",
  );
  assert.ok(
    detail.medications.some((medication) => medication.name === "氨氯地平片"),
    "患者详情应包含氨氯地平片",
  );
  assert.ok(Array.isArray(detail.labs) && detail.labs.length >= 1);
  assert.ok(
    detail.labs.some((lab) => lab.item === "血肌酐"),
    "患者详情应包含血肌酐检验",
  );

  for (const patient of patients.filter((item) => item.id !== target.id)) {
    const other = await app.request(`/api/patients/${patient.id}`);
    assert.equal(other.status, 200);
    assert.equal(other.body.id, patient.id);
    assert.ok(Array.isArray(other.body.diagnoses));
    assert.ok(Array.isArray(other.body.labs));
  }
});
