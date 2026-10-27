export function taskUpdatedLabel(value) {
  if (!value) return "尚未开始";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "更新时间未记录";
  return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function taskPatientContext(task, patients = []) {
  if (!task.patientId) return "";
  const patient = patients.find(item => item.id === task.patientId);
  if (!patient) return `患者信息暂不可用 · 关联编号 ${task.patientId}`;
  const defaultTitle = String(task.title || "").replace(/\s+/g, "") === `${patient.name}·病例`.replace(/\s+/g, "");
  return [defaultTitle && "患者资料工作台", patient.name, patient.patientNumber ? `病历号 ${patient.patientNumber}` : `未编号 · 关联编号 ${patient.id}`].filter(Boolean).join(" · ");
}
