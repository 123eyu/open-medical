import { definePlugin } from "../../server/plugin-host/define.mjs";

// Transitional agenda sources. The collection code below is lifted verbatim
// from DoctorOverview.read; only where the data comes from changed (db and
// fixed-region services via ctx). DoctorOverview still owns merging, sorting,
// pagination and counts, so a future plugin migration only moves its source.
const DAY = 86400000;
const time = (value) => typeof value === "number" ? value : Date.parse(value) || 0;
const moment = (now) => typeof now === "number" ? now : Date.parse(now) || Date.now();

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
  agendaSources: [custom],
});
