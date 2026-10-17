// 检验结果 CSV 导入：解析、患者匹配、逐人提案生成与复核轨衔接。
// 全部合成数据；提案只创建不确认，档案写入由既有复核轨测试覆盖。
import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.mjs";

const CSV = [
  "姓名,患者编号,项目,数值,单位,日期",
  "导入患者甲,,血钾,4.2,mmol/L,2026-10-01",
  "导入患者乙,P-1001,HbA1c,8.1,%,2026-10-02",
  "导入患者丙,,空腹血糖,6.2,mmol/L,2026-10-03",
  ",P-1001,血肌酐,92,μmol/L,2026-10-03",
  "导入患者甲,,血钾,4.2,mmol/L,2026-9-30",
  "路人甲,,血钾,5,mmol/L,2026-10-01",
].join("\n");

async function setup(t) {
  const f = await fixture(t);
  const jia = (await f.json("/api/patients", "POST", { name: "导入患者甲" })).data;
  const yi = (await f.json("/api/patients", "POST", { name: "导入患者乙", patientNumber: "P-1001" })).data;
  const bing = (await f.json("/api/patients", "POST", { name: "导入患者丙" })).data;
  const b = (await f.json("/api/patients", "POST", { name: "重名患者" })).data;
  const b2 = (await f.json("/api/patients", "POST", { name: "重名患者", confirmDistinctPatient: true })).data;
  return { ...f, jia, yi, bing, b, b2 };
}

test("lab import preview: matching by name/number, classifying no-patient, invalid and ambiguous rows", async (t) => {
  const f = await setup(t);
  const preview = (await f.json("/api/patients/lab-import/preview", "POST", { text: CSV })).data;
  assert.equal(preview.stats.total, 6);
  assert.equal(preview.stats.ready, 4);
  assert.equal(preview.stats.invalid, 1, "非 YYYY-MM-DD 日期行需修正");
  assert.equal(preview.stats.noPatient, 1, "路人甲未建档");
  const byRow = Object.fromEntries(preview.rows.map((r) => [r.row, r]));
  assert.equal(byRow[2].patientName, "导入患者甲");
  assert.equal(byRow[3].patientId, f.yi.id, "编号优先匹配");
  assert.equal(byRow[6].status, "invalid");
  assert.equal(byRow[7].status, "no-patient");
  // 同名患者行要求补编号并列出候选
  const ambiguous = (await f.json("/api/patients/lab-import/preview", "POST", { text: "姓名,项目,数值,日期\n重名患者,血钾,4,2026-10-01\n" })).data;
  assert.equal(ambiguous.rows[0].status, "same-name");
  assert.equal(ambiguous.rows[0].candidates.length, 2);
  // 表头缺数值列、超行数拒绝（HTTP 层把校验错误转为状态码）
  const badCols = await f.json("/api/patients/lab-import/preview", "POST", { text: "姓名,项目\n甲,血钾\n" });
  assert.equal(badCols.status, 422);
  assert.match(badCols.data.error, /数值/);
  const tooBig = await f.json("/api/patients/lab-import/preview", "POST", { text: "x".repeat(200001) });
  assert.equal(tooBig.status, 413);
});

test("lab import commit: one patient-update proposal per patient, confirmed through the existing rail", async (t) => {
  const f = await setup(t);
  const commit = await f.json("/api/patients/lab-import/commit", "POST", { text: CSV, selectedRows: [2, 3, 4, 5] });
  assert.equal(commit.status, 201);
  assert.equal(commit.data.proposals.length, 3, "甲乙丙各一份提案（乙合并两行）");
  assert.equal(commit.data.skipped, 2);
  const jiaLabs = commit.data.proposals.find((p) => p.patientId === f.jia.id);
  assert.equal(jiaLabs.labs, 1);
  // 确认提案后检验写入档案（既有复核轨）。
  const confirmed = await f.json(`/api/pending-actions/${jiaLabs.id}/confirm`, "POST");
  assert.equal(confirmed.status, 200);
  const chart = (await f.json(`/api/patients/${f.jia.id}`)).data;
  assert.equal(chart.labs[0].item, "血钾");
  assert.equal(chart.labs[0].value, 4.2);
  assert.equal(chart.labs[0].unit, "mmol/L");
  // 全选不可导入行被拒绝（commit 为同步方法）
  assert.throws(
    () => f.server.labImporter.commit({ text: CSV, selectedRows: [6, 7] }),
    /可导入/,
  );
});
