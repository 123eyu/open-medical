import { diagnosisStatus, diagnosisSources } from "./diagnoses.mjs";
import { dashboardLabGroups } from "./patient-dashboard.mjs";

export function patientReviewItems(patient) {
  const items = [];
  for (const [index, record] of (patient.diagnoses || []).entries()) {
    if (diagnosisStatus(record) === "needs_review")
      items.push({
        id: `diagnoses-${index}`,
        field: "diagnoses",
        title: typeof record === "string" ? record : record.name,
        indexes: [index],
      });
  }
  for (const group of dashboardLabGroups(patient.labs || []).filter(
    (g) => g.conflict,
  )) {
    const dates = [...new Set(group.points.map((p) => p.date))].filter(
      (date) =>
        new Set(group.points.filter((p) => p.date === date).map((p) => p.value))
          .size > 1,
    );
    const indexes = (patient.labs || []).flatMap((r, i) =>
      r.item === group.item &&
      (r.unit || "") === group.unit &&
      dates.includes(r.date)
        ? [i]
        : [],
    );
    items.push({
      id: `labs-${group.key}`,
      field: "labs",
      title: `${group.item} · ${group.unit || "单位未记录"}`,
      indexes,
    });
  }
  for (const [index, record] of (patient.medications || []).entries()) {
    if (!record.status || record.status === "unknown")
      items.push({
        id: `medications-${index}`,
        field: "medications",
        title: record.name,
        indexes: [index],
      });
  }
  if (!patient.allergies?.length && patient.allergyStatus !== "none_known")
    items.push({
      id: "allergyStatus",
      field: "allergyStatus",
      title: "过敏史尚未核对",
      indexes: [],
    });
  return items;
}

export function reviewItemSources(patient, item) {
  return [
    ...new Set(
      item.indexes.flatMap((index) =>
        diagnosisSources(patient[item.field]?.[index]),
      ),
    ),
  ];
}
