export function patientIdentityLabel(patient) {
  // 无病历号时显示「未编号」而不是内部 ID 片段——哈希前缀对医生是乱码。
  return [patient.patientNumber || "未编号", patient.birthYear ? `${patient.birthYear} 年生` : null,
    patient.phone ? `尾号 ${patient.phone.slice(-4)}` : null].filter(Boolean).join(" · ");
}
export function patientOptionLabel(patient, patients = []) {
  return patients.some((other) => other.id !== patient.id && other.name === patient.name)
    ? `${patient.name} · ${patientIdentityLabel(patient)}` : patient.name;
}
