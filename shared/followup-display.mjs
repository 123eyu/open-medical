export function followupDate(value) {
  if (value === undefined || value === null || value === "") return "时间待核对";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间待核对";
  return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export const contactOutcomeLabels = { completed: "已完成联系", unreachable: "未联系上", declined: "患者暂不接受" };
