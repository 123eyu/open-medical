import test from "node:test";
import assert from "node:assert/strict";
import { abnormalLabs, labFlag, parseReferenceRange } from "../../shared/lab-flags.mjs";
import { patientListBrief } from "../../shared/patient-list-brief.mjs";

test("报告参考范围优先，缺失时才用通用范围并标注来源", () => {
  assert.deepEqual(labFlag({ item: "血钾", value: 5.9, unit: "mmol/L", referenceRange: "3.5-5.5" }), { flag: "high", range: "3.5-5.5", source: "report" });
  assert.deepEqual(labFlag({ item: "空腹血糖", value: 8.9, unit: "mmol/L" }), { flag: "high", range: "3.9–6.1", source: "generic" });
  assert.equal(labFlag({ item: "血钾", value: 4.1, unit: "mmol/L" }).flag, "normal");
  // An unparseable report range shows the text but never falls back to generic.
  assert.deepEqual(labFlag({ item: "血钾", value: 9, unit: "mmol/L", referenceRange: "见原报告" }), { flag: "", range: "见原报告", source: "report" });
});

test("性别相关范围只在性别已知时判断", () => {
  const record = { item: "血肌酐", value: 96, unit: "μmol/L" };
  assert.equal(labFlag(record, { gender: "male" }).flag, "normal");
  assert.equal(labFlag(record, { gender: "female" }).flag, "high");
  assert.equal(labFlag(record).flag, "");
  assert.deepEqual(parseReferenceRange("9–50（男）/ 7–35（女）", "female"), { low: 7, high: 35 });
  assert.equal(parseReferenceRange("11–13 秒 / INR ≈1.0", "male"), null);
});

test("名称与单位必须精确匹配，不能借用相近指标的范围", () => {
  assert.equal(labFlag({ item: "餐后2小时血糖", value: 12, unit: "mmol/L" }).source, "");
  assert.equal(labFlag({ item: "HbA1c", value: 70, unit: "mmol/mol" }).source, "");
  assert.equal(labFlag({ item: "白细胞计数", value: 12.2, unit: "×10⁹/L" }).flag, "high");
  assert.equal(labFlag({ item: "白细胞计数", value: 12.2, unit: "" }).flag, "");
});

test("只按最新日期判断；同日多值不判断", () => {
  const labs = [
    { item: "白细胞计数", value: 11.8, unit: "10^9/L", date: "2026-09-28" },
    { item: "白细胞计数", value: 7.2, unit: "10^9/L", date: "2026-10-12" },
    { item: "血钾", value: 5.9, unit: "mmol/L", date: "2026-10-12" },
    { item: "血钾", value: 4.0, unit: "mmol/L", date: "2026-10-12" },
  ];
  assert.deepEqual(abnormalLabs(labs), []);
  const brief = patientListBrief({ labs: [{ item: "CRP", value: 30, unit: "mg/L", date: "2026-10-01" }], medications: [{ name: "A", status: "active" }, { name: "B", status: "stopped" }] }, "2026-11-01");
  assert.equal(brief.abnormalLabCount, 1);
  assert.equal(brief.activeMedications, 1);
  assert.equal(brief.allergyStatus, "unknown");
  assert.equal(brief.nextAppointment, "2026-11-01");
});
