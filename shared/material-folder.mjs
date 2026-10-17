import { MATERIAL_CATEGORIES, autoClassifyMaterial } from "./material-classify.mjs";

// 建档对话输入不是病历材料：单独归「对话记录」组，不与病历混排。
const CHAT_INPUT_RE = /对话输入\.txt$/i;
const isChatInput = (file) =>
  CHAT_INPUT_RE.test(file.name || "") || file.category === "对话记录";

// Group by manual or automatic category, newest document date first.
// Legacy uploads without a saved category use the same classifier.
export function groupMaterials(files = []) {
  files = files.map(autoClassifyMaterial);
  const chatRecords = files.filter(isChatInput);
  const clinical = files.filter((file) => !isChatInput(file));
  const fileDate = (file) => file.documentDate || String(file.createdAt || "").slice(0, 10) || "";
  const groups = MATERIAL_CATEGORIES
    .map((category) => [
      category,
      clinical.filter((file) => (MATERIAL_CATEGORIES.includes(file.category) ? file.category : "其他") === category),
    ])
    .filter(([, grouped]) => grouped.length > 0)
    .map(([category, grouped]) => {
      grouped.sort((a, b) => fileDate(b).localeCompare(fileDate(a)) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      const dates = grouped.map(fileDate).filter(Boolean);
      return {
        category,
        files: grouped,
        count: grouped.length,
        dateRange: dates.length ? `${dates[dates.length - 1]} ~ ${dates[0]}` : "",
      };
    });
  if (chatRecords.length) {
    chatRecords.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    groups.push({
      category: "对话记录",
      files: chatRecords,
      count: chatRecords.length,
      dateRange: "",
    });
  }
  return groups;
}
