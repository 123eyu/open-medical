import { definePlugin } from "../../server/plugin-host/define.mjs";

// Transitional agenda sources. The collection code below is lifted verbatim
// from DoctorOverview.read; only where the data comes from changed (db and
// fixed-region services via ctx). DoctorOverview still owns merging, sorting,
// pagination and counts, so a future plugin migration only moves its source.
const DAY = 86400000;
const time = (value) => typeof value === "number" ? value : Date.parse(value) || 0;
const moment = (now) => typeof now === "number" ? now : Date.parse(now) || Date.now();
const hasTable = (db, name) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

const risk = {
  kind: "risk",
  label: "高危风险",
  order: 10,
  read(ctx) {
    const db = ctx.db;
    const items = [];
    for (const row of db.prepare("SELECT id,patient_id,severity,updated_at,data FROM risk_alerts WHERE status='active'").all()) {
      const data = JSON.parse(row.data);
      items.push({ id: `risk:${row.id}`, kind: "risk", patientId: row.patient_id, title: data.title, detail: data.message,
        at: row.updated_at, weight: row.severity === "critical" ? 0 : 4, severity: row.severity,
        action: { type: "patient", tab: "overview", label: "核对风险" } });
    }
    if (ctx.services.followupHost?.isActive?.() !== false && hasTable(db, "care_alerts")) for (const row of db.prepare("SELECT id,patient_id,level,reason,created_at FROM care_alerts WHERE status='open'").all()) {
      if (row.level !== "urgent") continue;
      items.push({ id: `care-alert:${row.id}`, kind: "risk", patientId: row.patient_id,
        title: "患者消息提示紧急情况", detail: row.reason, at: row.created_at,
        weight: 0, severity: "critical",
        action: { type: "view", view: "care", tab: "alerts", label: "立即查看" } });
    }
    return items;
  },
};

const custom = {
  kind: "custom",
  label: "我的规则",
  order: 70,
  read(ctx, { now } = {}) {
    const ext = ctx.services.extensions;
    const current = moment(now);
    const items = [];
    for (const item of ext?.openItems() || []) {
      const entry = { id: `rule:${item.id}`, itemId: item.id, patientId: item.patientId, title: item.title, detail: `${item.detail ? `${item.detail} · ` : ""}来自规则「${item.rule}」`,
        at: item.createdAt, weight: 5, resolvable: true, fallbackName: "我的规则",
        action: item.sessionId ? { type: "task", sessionId: item.sessionId, label: "打开汇总" } : item.replyId ? { type: "view", view: "care", tab: "drafts", label: "核对发送" } : { type: "patient", tab: "overview", label: "查看患者" } };
      if (item.lane === "work" || !item.patientId) items.push({ ...entry, kind: "review", lane: "work" });
      else items.push({ ...entry, kind: "custom" });
    }
    for (const s of ext?.suggestions() || []) items.push({ id: `evolve:${s.id}`, kind: "evolve", lane: "work", title: s.title, detail: s.evidence, at: s.createdAt, fallbackName: "工作台进化",
      action: { type: "view", view: "settings", settingsTab: "workbench", label: "查看建议" } });
    for (const c of (ext?.changes() || []).filter((c) => c.status === "applied" && current - time(c.createdAt) < 7 * DAY)) items.push({ id: `evolved:${c.id}`, kind: "evolve", lane: "work", title: `已自动调整：${c.title}`,
      detail: c.detail, at: c.createdAt, fallbackName: "工作台进化", action: { type: "view", view: "settings", settingsTab: "workbench", label: "查看或撤销" } });
    return items;
  },
};

export default definePlugin({
  id: "legacy-agenda",
  version: "1.0.0",
  title: "今日待办旧来源（过渡）",
  enabledByDefault: true,
  agendaSources: [risk, custom],
});
