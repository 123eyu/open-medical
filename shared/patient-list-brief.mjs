import { abnormalLabs } from "./lab-flags.mjs";

// Compact clinical facts for list rows and pickers: what a doctor scans for
// before opening a chart. Every field is derived from saved data only; an
// unknown is reported as unknown, never as a negative finding.
export function allergyState(patient = {}) {
  const allergies = (patient.allergies || [])
    .map((a) => (typeof a === "string" ? a : [a?.substance, a?.reaction ? `（${a.reaction}）` : ""].join("")))
    .filter(Boolean);
  if (allergies.length) return { status: "recorded", allergies, label: `过敏：${allergies.join("、")}` };
  if (patient.allergyStatus === "none_known") return { status: "none_known", allergies, label: "无已知过敏" };
  return { status: "unknown", allergies, label: "过敏史未记录" };
}

export function patientListBrief(patient = {}, nextAppointment = "") {
  const medications = (patient.medications || []).filter((m) => m && m.status === "active");
  const abnormal = abnormalLabs(patient.labs || [], { gender: patient.gender || "" });
  const plan = patient.treatmentPlan && patient.treatmentPlan.status !== "completed" ? patient.treatmentPlan : null;
  const allergy = allergyState(patient);
  return {
    allergyStatus: allergy.status,
    allergies: allergy.allergies,
    activeMedications: medications.length,
    activeMedicationNames: medications.slice(0, 4).map((m) => m.name || m.drug || "").filter(Boolean),
    abnormalLabs: abnormal.slice(0, 4).map(({ item, value, unit, flag, date, source }) => ({ item, value, unit, flag, date, source })),
    abnormalLabCount: abnormal.length,
    nextAppointment: nextAppointment || "",
    reviewDate: plan?.reviewDate || "",
  };
}
