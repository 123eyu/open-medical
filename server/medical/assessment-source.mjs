import { createHash } from "node:crypto";

// Exact registered facts, not a model summary. Keep status, dates and source
// fields on each record; do not silently cap the chart at brief-display limits.
export function assessmentPatientSource(patient) {
  const revision = patient.revision || 0;
  const lines = [
    `患者已登记档案快照 · 修订 ${revision} · 记录更新于 ${patient.updatedAt || "未记录"}`,
    "这是医生登记的结构化档案，不是上传原件、指南或独立核验结果；仅表示本次评估读取时的记录。",
    `基本信息：${JSON.stringify({ birthYear: patient.birthYear ?? null, gender: patient.gender || "unknown" })}`,
    `过敏核对：${JSON.stringify({ status: patient.allergies?.length ? "recorded" : patient.allergyStatus || "unknown", allergies: patient.allergies || [] })}`,
    ...(patient.clinicalSummary ? [`病情摘要：${JSON.stringify(patient.clinicalSummary)}`] : []),
    ...(patient.note ? [`医生登记备注：${JSON.stringify(patient.note)}`] : []),
    ...(patient.treatmentPlan ? [`已登记治疗方案：${JSON.stringify(patient.treatmentPlan)}`] : []),
    ...[["诊断", "diagnoses"], ["用药", "medications"], ["检验", "labs"], ["就诊", "visits"]].flatMap(([label, key]) =>
      patient[key]?.length ? patient[key].map((entry, index) => `${label} ${index + 1}：${JSON.stringify(entry)}`) : [`${label}：未登记（不表示临床不存在）`]),
  ];
  const text = lines.join("\n"), hash = createHash("sha256").update(text).digest("hex");
  return { id: `patient-assessment:${patient.id}:${revision}:${hash.slice(0, 16)}`, name: `患者已登记档案快照（修订 ${revision}）`, text, hash,
    sourceType: "patient-chart-snapshot", patientId: patient.id, patientRevision: revision, capturedFromUpdatedAt: patient.updatedAt || null };
}
