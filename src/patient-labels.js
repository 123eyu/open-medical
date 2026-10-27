export function patientAgeLabel(patient, currentYear = new Date().getFullYear()) {
  const value = patient.birthYear;
  if (value === undefined || value === null || value === "") return "";
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > currentYear) return "";
  return `约${currentYear - year}岁 · ${year}年生`;
}

export function patientIdentityLabel(patient) {
  // 无病历号时显示「未编号」而不是内部 ID 片段——哈希前缀对医生是乱码。
  return [patient.patientNumber || "未编号", patientAgeLabel(patient),
    patient.phone ? `尾号 ${patient.phone.slice(-4)}` : null].filter(Boolean).join(" · ");
}
export function patientOptionLabel(patient, patients = []) {
  return patients.some((other) => other.id !== patient.id && other.name === patient.name)
    ? `${patient.name} · ${patientIdentityLabel(patient)}` : patient.name;
}
