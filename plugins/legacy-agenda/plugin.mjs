import { definePlugin } from "../../server/plugin-host/define.mjs";
import { isCalendarDate } from "../../shared/calendar-date.mjs";

// Transitional agenda sources. The collection code below is lifted verbatim
// from DoctorOverview.read; only where the data comes from changed (db and
// fixed-region services via ctx). DoctorOverview still owns merging, sorting,
// pagination and counts, so a future plugin migration only moves its source.
const DAY = 86400000;
const TRIAL_STEP = { shortlisted: "联系患者，说明研究", contacted: "登记知情同意", consented: "确认入组" };
const time = (value) => typeof value === "number" ? value : Date.parse(value) || 0;
const moment = (now) => typeof now === "number" ? now : Date.parse(now) || Date.now();
const hasTable = (db, name) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const overdue = (at, now) => { const days = Math.floor((now - time(at)) / DAY); return days >= 1 ? `已逾期 ${days} 天` : ""; };

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
    if (hasTable(db, "care_alerts")) for (const row of db.prepare("SELECT id,patient_id,level,reason,created_at FROM care_alerts WHERE status='open'").all()) {
      if (row.level !== "urgent") continue;
      items.push({ id: `care-alert:${row.id}`, kind: "risk", patientId: row.patient_id,
        title: "患者消息提示紧急情况", detail: row.reason, at: row.created_at,
        weight: 0, severity: "critical",
        action: { type: "view", view: "care", tab: "alerts", label: "立即查看" } });
    }
    return items;
  },
};

const followup = {
  kind: "followup",
  label: "随访",
  order: 30,
  read(ctx, { now } = {}) {
    const db = ctx.db;
    const current = moment(now);
    const items = [];
    for (const row of db.prepare("SELECT id,patient_id,due_at,data FROM reminders WHERE status='pending'").all()) {
      const data = JSON.parse(row.data);
      items.push({ id: `reminder:${row.id}`, kind: "followup", patientId: row.patient_id, title: data.title,
        detail: [overdue(row.due_at, current), "联系患者后登记随访结果"].filter(Boolean).join("，"), at: row.due_at,
        weight: row.due_at < current - DAY ? 1 : 5,
        action: { type: "patient", tab: "followups", label: "登记随访" } });
    }
    for (const row of db.prepare("SELECT id,patient_id,status,next_due,data FROM follow_ups WHERE status='paused' OR (status='active' AND next_due<=?)").all(current)) {
      const data = JSON.parse(row.data);
      if (row.status === "paused") {
        if (data.lastError) items.push({ id: `schedule:${row.id}`, kind: "failure", lane: "work", patientId: row.patient_id,
          title: `随访计划「${data.name}」已暂停`, detail: data.lastError, at: row.next_due,
          action: { type: "patient", tab: "followups", label: "检查计划" } });
        continue;
      }
      items.push({ id: `schedule:${row.id}`, kind: "followup", patientId: row.patient_id, title: data.name,
        detail: [overdue(row.next_due, current), "随访到期，联系患者"].filter(Boolean).join("，"), at: row.next_due, weight: 5,
        action: { type: "patient", tab: "followups", label: "查看随访" } });
    }
    return items;
  },
};

const tracking = {
  kind: "tracking",
  label: "检查检验",
  order: 40,
  read(ctx, { now } = {}) {
    const db = ctx.db;
    const current = moment(now);
    const schedule = ctx.services.schedule;
    const items = [];
    for (const row of db.prepare("SELECT id,patient_id,status,due_at,data FROM care_tasks WHERE status IN ('awaiting_review','awaiting_communication') OR (status='waiting_result' AND due_at<=?)").all(current)) {
      const task = JSON.parse(row.data);
      const label = { waiting_result: "结果尚未收到，跟进时间已到", awaiting_review: "结果已收到，等待医生核对", awaiting_communication: "医生已核对，需告知患者" }[row.status];
      items.push({ id: `tracking:${row.id}`, kind: "tracking", patientId: row.patient_id, title: task.title, detail: label,
        at: row.due_at, weight: row.status === "awaiting_review" ? 3 : 5,
        action: { type: "patient", tab: "tracking", label: "继续跟进" } });
    }
    // Lab values added to the chart since the doctor last marked them read.
    for (const { patientId, labs } of schedule?.allNewLabs() || []) {
      const shown = labs.slice(0, 3).map((l) => `${l.item} ${l.value}${l.unit || ""}`).join("、");
      const date = isCalendarDate(labs[0].date) ? labs[0].date : "";
      const undated = labs.filter(lab => !isCalendarDate(lab.date)).length;
      items.push({ id: `labs:${patientId}`, kind: "tracking", patientId, title: `待阅检验结果 ${labs.length} 项`, detail: `${shown}${labs.length > 3 ? " 等" : ""}（${date ? `最近日期 ${date}` : "日期待核对"}${date && undated ? `；另有 ${undated} 条日期待核对` : ""}），查看后点「标记已阅」`,
        at: date, weight: 4, count: labs.length, action: { type: "patient", tab: "labs", label: "查看结果" } });
    }
    return items;
  },
};

const messages = {
  kind: "messages",
  label: "患者消息",
  order: 50,
  read(ctx) {
    const db = ctx.db;
    const items = [];
    if (hasTable(db, "care_alerts")) for (const row of db.prepare("SELECT id,patient_id,level,reason,created_at FROM care_alerts WHERE status='open'").all()) {
      if (row.level === "urgent") continue;
      items.push({ id: `care-alert:${row.id}`, kind: "messages", patientId: row.patient_id,
        title: "患者消息需要医生回复", detail: row.reason, at: row.created_at,
        weight: 3,
        action: { type: "view", view: "care", tab: "alerts", label: "查看消息" } });
    }
    for (const row of db.prepare("SELECT patient_id,COUNT(*) n,MIN(time) oldest FROM patient_messages WHERE processed=0 AND patient_id IS NOT NULL GROUP BY patient_id").all()) {
      items.push({ id: `messages:${row.patient_id}`, kind: "messages", patientId: row.patient_id,
        title: `${row.n} 条聊天记录待整理`, detail: "查看原文，决定是否回复或记入档案", at: time(row.oldest), weight: 6,
        count: row.n, action: { type: "patient", tab: "messages", label: "处理消息" } });
    }
    const inbox = db.prepare("SELECT COUNT(*) n FROM patient_messages WHERE patient_id IS NULL").get().n;
    if (inbox) items.push({ id: "inbox", kind: "messages", title: `${inbox} 条消息不确定是哪位患者`, detail: "核对身份后归到对应患者", at: 0, weight: 3,
      count: inbox, action: { type: "patients", label: "认领消息" } });
    if (hasTable(db, "care_replies")) for (const row of db.prepare("SELECT patient_id,COUNT(*) n,MIN(created_at) oldest FROM care_replies WHERE status='draft' AND patient_id IS NOT NULL GROUP BY patient_id").all()) {
      items.push({ id: `care-draft:${row.patient_id}`, kind: "messages", patientId: row.patient_id, title: row.n > 1 ? `${row.n} 条回复待发送` : "回复待发送",
        detail: "已起草回复，核对后发给患者", at: row.oldest, weight: 4, count: row.n,
        action: { type: "view", view: "care", tab: "drafts", label: "核对发送" } });
    }
    return items;
  },
};

const trial = {
  kind: "trial",
  label: "试验入组",
  order: 60,
  read(ctx) {
    const db = ctx.db;
    const items = [];
    if (hasTable(db, "trial_enrollments")) {
      const titles = new Map(db.prepare("SELECT id,data FROM trial_protocols").all().map((r) => [r.id, JSON.parse(r.data).title]));
      for (const row of db.prepare("SELECT trial_id,patient_id,data FROM trial_enrollments").all()) {
        const e = JSON.parse(row.data);
        if (!TRIAL_STEP[e.stage] || !titles.has(row.trial_id)) continue;
        items.push({ id: `trial:${row.trial_id}:${row.patient_id}`, kind: "trial", patientId: row.patient_id, title: TRIAL_STEP[e.stage],
          detail: `临床试验「${titles.get(row.trial_id).slice(0, 40)}」`, at: e.updatedAt, weight: 6,
          action: { type: "view", view: "research", trialId: row.trial_id, label: "打开试验" } });
      }
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
  agendaSources: [risk, followup, tracking, messages, trial, custom],
});
