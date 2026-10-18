import { check } from "../errors.mjs";
import { DEMO_CSV, DEMO_KNOWLEDGE } from "../../shared/demo-experience.mjs";

// 示例患者包：让新医生不导入任何真实数据就能体验完整工作流
//（诊前速览、检验趋势、随访提醒、今日待办）。示例患者带固定标签，
// 与真实档案永久可区分，一键整包删除；真实数据永不被触碰。
export const DEMO_TAG = "示例患者";
const DAY = 86400000;
const iso = offset => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

const pack = () => [
  {
    name: "示例·张沪生", gender: "male", birthYear: 1952, phone: "", tags: [DEMO_TAG], groups: ["示例·高血压"],
    clinicalSummary: { text: "高血压 8 年余，近期血压波动，肾功能稳定。示例数据，可用于体验各页面。", source: "示例数据包" },
    diagnoses: [
      { name: "原发性高血压", code: "I10", date: iso(-2900), status: "confirmed", note: "长期服药，近期波动。", source: "示例数据包" },
      { name: "胆囊切除术后状态", date: iso(-95), status: "confirmed", note: "术后恢复顺利。", source: "示例数据包" },
    ],
    medications: [
      { name: "氨氯地平片", status: "active", dose: "5mg", frequency: "qd", source: "示例数据包" },
      { name: "阿司匹林肠溶片", status: "active", dose: "100mg", frequency: "qd", source: "示例数据包" },
    ],
    allergies: ["青霉素"],
    labs: [
      { item: "血钾", value: 4.1, unit: "mmol/L", date: iso(-10), source: "示例数据包" },
      { item: "血肌酐", value: 96, unit: "μmol/L", date: iso(-10), source: "示例数据包" },
      { item: "血肌酐", value: 92, unit: "μmol/L", date: iso(-100), source: "示例数据包" },
    ],
    visits: [{ date: iso(-10), reason: "门诊复查", note: "血压 148/86，调整用药待观察。患者自述近期踝部轻度肿胀，发生时间与用药先后待核对。", source: "示例数据包" }],
  },
  {
    name: "示例·李婉珍", gender: "female", birthYear: 1966, tags: [DEMO_TAG], groups: ["示例·糖尿病"],
    clinicalSummary: { text: "2 型糖尿病 6 年，HbA1c 波动于 7–8.5%，依从性一般。示例数据。", source: "示例数据包" },
    diagnoses: [{ name: "2型糖尿病", code: "E11.9", date: iso(-2100), status: "confirmed", source: "示例数据包" }],
    medications: [{ name: "二甲双胍", status: "active", dose: "0.5g", frequency: "bid", source: "示例数据包" }],
    labs: [
      { item: "HbA1c", value: 8.4, unit: "%", date: iso(-15), source: "示例数据包" },
      { item: "HbA1c", value: 7.6, unit: "%", date: iso(-105), source: "示例数据包" },
      { item: "HbA1c", value: 7.1, unit: "%", date: iso(-195), source: "示例数据包" },
      { item: "空腹血糖", value: 8.9, unit: "mmol/L", date: iso(-15), source: "示例数据包" },
    ],
    visits: [{ date: iso(-15), reason: "季度复查", note: "控制欠佳，加强饮食运动指导。", source: "示例数据包" }],
  },
  {
    name: "示例·王建国", gender: "male", birthYear: 1978, tags: [DEMO_TAG],
    clinicalSummary: { text: "阑尾切除术后一个月，恢复可，待复查血常规。示例数据。", source: "示例数据包" },
    diagnoses: [{ name: "急性阑尾炎", code: "K35", date: iso(-32), status: "confirmed", source: "示例数据包" }, { name: "腹腔镜阑尾切除术后", date: iso(-30), status: "confirmed", source: "示例数据包" }],
    medications: [],
    labs: [
      { item: "白细胞计数", value: 11.8, unit: "10^9/L", date: iso(-30), source: "示例数据包" },
      { item: "白细胞计数", value: 7.2, unit: "10^9/L", date: iso(-16), source: "示例数据包" },
    ],
    treatmentPlan: { title: "示例·术后复诊资料核对", status: "active", startDate: iso(-25), reviewDate: iso(7), goal: "整理术后复查资料并核对恢复记录", interventions: "携带病历与血常规报告复诊\n记录切口情况与患者反馈，交给医生核对", prognosis: "虚构记录：患者自述无腹痛，切口无渗液；进一步评估待复诊。", assessmentDate: iso(-16), source: "示例出院与复查记录" },
    visits: [{ date: iso(-30), reason: "急诊手术", note: "腹腔镜阑尾切除，顺利。", source: "示例数据包" }],
  },
];

export class DemoPack {
  constructor(patients, followups, store, services = {}) {
    Object.assign(this, { patients, followups, store, ...services });
    store.db.exec("CREATE TABLE IF NOT EXISTS demo_resources (key TEXT PRIMARY KEY, kind TEXT NOT NULL, id TEXT NOT NULL)");
    // Adopt only the old built-in pack, never arbitrary patients bearing a tag.
    for (const p of patients.all()) {
      const index = pack().findIndex(input => input.name === p.name);
      if (index >= 0 && (p.tags || []).includes(DEMO_TAG) && p.note === "这是示例患者（虚构数据），随时可在首页一键删除，不影响真实档案。") {
        store.db.prepare("INSERT OR IGNORE INTO demo_resources VALUES (?,?,?)").run(`patient:${index}`, "patient", p.id);
      }
    }
  }
  resources() { return this.store.db.prepare("SELECT * FROM demo_resources").all(); }
  exists(kind, id) {
    const tables = { patient: "patients", knowledge: "guideline_docs", case: "case_library", trial: "trial_protocols", appointment: "appointments", reply: "care_replies", alert: "care_alerts", tracking: "care_tasks" };
    if (kind === "collection") return Boolean(this.store.db.prepare("SELECT 1 FROM knowledge_collections WHERE name=?").get(id));
    if (kind === "session") return this.sessions.isSessionWorkspace(id);
    return Boolean(this.store.db.prepare(`SELECT 1 FROM ${tables[kind]} WHERE id=?`).get(id));
  }
  own(key, kind, create) {
    const saved = this.resources().find(r => r.key === key);
    if (saved && this.exists(kind, saved.id)) return saved.id;
    const item = create();
    this.store.db.prepare("INSERT OR REPLACE INTO demo_resources VALUES (?,?,?)").run(key, kind, item.id);
    return item.id;
  }
  demoIds() {
    return this.resources().filter(r => r.kind === "patient" && this.exists(r.kind, r.id)).map(r => r.id);
  }
  status() {
    const resources = this.resources().filter(r => this.exists(r.kind, r.id));
    const patients = resources.filter(r => r.kind === "patient").sort((a,b) => a.key.localeCompare(b.key)).map(r => {
      const p = this.patients.row(r.id);
      return { id: p.id, name: p.name, sessionId: p.sessionId, archived: Boolean(p.archived), index: Number(r.key.split(":")[1]) };
    });
    return { installed: resources.length > 0, count: patients.length, tag: DEMO_TAG, patients,
      sessionId: resources.find(r => r.key === "dataset")?.id || null,
      resources: resources.reduce((counts, r) => ({ ...counts, [r.kind]: (counts[r.kind] || 0) + 1 }), {}) };
  }
  seed() {
    check(!this.clearing, "DEMO_BUSY", "示例正在删除，请稍后再准备", 409);
    if (this.installing) return this.installing;
    this.installing = this.install().finally(() => { this.installing = null; });
    return this.installing;
  }
  async install() {
    for (const [index, input] of pack().entries()) {
      const id = this.own(`patient:${index}`, "patient", () => this.patients.create({ ...input, confirmDistinctPatient: true, note: "这是示例患者（虚构数据），随时可在首页一键删除，不影响真实档案。" }));
      const patient = this.patients.row(id);
      // Respect archived/edited examples; reloading only supplies missing resources.
      if (patient.archived) continue;
      if (input.treatmentPlan && !patient.treatmentPlan) this.patients.update(id, { expectedRevision: patient.revision, treatmentPlan: input.treatmentPlan });
      if (this.sessions) {
        const sources = [
          { name: "示例病历.md", text: `# ${input.name} · 虚构病历\n仅用于功能体验。\n${input.clinicalSummary.text}\n诊断：${input.diagnoses.map(d => `${d.date} ${d.name}`).join("；")}\n${input.visits.map(v => `${v.date} ${v.reason}：${v.note}`).join("\n")}\n${index === 2 ? `${iso(-32)} 入院：右下腹痛，病历记录急性阑尾炎。\n${iso(-30)} 腹腔镜阑尾切除术。\n${iso(-25)} 出院：切口无渗液，患者自述无腹痛；出院带药未记录。复诊时携带血常规报告。` : "查体其余信息未记录，待核对。"}` },
          { name: "示例检验.csv", text: "日期,项目,结果,单位,报告参考范围\n" + input.labs.map(l => `${l.date},${l.item},${l.value},${l.unit},${({"血钾":"3.5–5.3","血肌酐":"57–111","HbA1c":"4.0–6.0","空腹血糖":"3.9–6.1","白细胞计数":"3.5–9.5"})[l.item]}`).join("\n") },
          { name: "示例用药与复诊资料.txt", text: `虚构演示记录，不作为治疗建议。\n过敏史：${(input.allergies || []).join("、") || "未记录"}\n当前用药：${input.medications.map(m => `${m.name} ${m.dose} ${m.frequency}`).join("；") || "未记录"}\n${DEMO_KNOWLEDGE[1].text}` },
        ];
        for (const source of sources) {
          if (!this.sessions.get(patient.sessionId).files.some(f => f.name === source.name)) this.sessions.addMaterial(patient.sessionId, source);
        }
      }
      if (index === 1 && !this.followups.list(id).some(job => job.questionnaire)) {
        const job = this.followups.create(id, { name: "示例·血糖控制季度随访", once: false, intervalDays: 90, firstDueAt: new Date(Date.now() + 60000).toISOString(), checklist: ["近期血糖记录", "用药依从性"], questionnaire: {
          title: "示例·复诊资料回收", questions: [{ id: "q1", type: "single", text: "是否已准备近期测量记录？", options: [{label:"已准备"},{label:"尚未准备"}] }, { id: "q2", type: "text", text: "这次希望医生帮助核对什么？" }],
        } });
        const overdue = Date.now() - 2 * DAY;
        // Materialize one occurrence with the normal workflow, then leave the next
        // occurrence in the future so the scheduler cannot duplicate this survey.
        job.nextDue = overdue;
        await this.followups.execute(job);
      }
      if (this.schedule && index === 0) this.own("appointment", "appointment", () => this.schedule.create(id, { date: this.schedule.today(), time: "10:00", reason: "示例·携带测量记录复诊", place: "演示门诊" }));
      if (this.careTasks && index === 2) this.own("tracking", "tracking", () => this.careTasks.create(id, { title: "示例·术后血常规报告跟进", kind: "test", dueAt: new Date(Date.now() + DAY).toISOString(), note: "练习登记结果、医生复核与告知状态，不创建真实检查医嘱。" }));
      if (this.cases) this.own(`case:${index}`, "case", () => this.cases.addCase({ patientId: id, patientName: input.name, sessionId: patient.sessionId, diagnosis: input.diagnoses[0].name, icd10: input.diagnoses[0].code, summary: input.clinicalSummary.text, tags: ["虚构示例"], lessons: "练习保留资料出处，区分已记录事实与待补充信息。", starred: index === 0 }));
    }
    if (this.sessions) {
      const id = this.own("dataset", "session", () => this.sessions.createSession({ title: "示例·科研数据与文件练习" }));
      for (const file of [{ name: "示例研究数据.csv", text: DEMO_CSV }, { name: "示例数据说明.md", text: "# 虚构研究数据\n12 位虚构受试者分为 A/B 两组。subject 是练习编号，group 是分组，age 是年龄（岁），sbp 是收缩压（mmHg），adherent 是依从性分类。用于体验描述统计、组间比较、样本量估计和脱敏导出；不能据此形成真实研究或临床结论。" }]) {
        if (!this.sessions.get(id).files.some(f => f.name === file.name)) this.sessions.addMaterial(id, file);
      }
    }
    if (this.trials) this.own("trial", "trial", () => this.trials.create({ title: "示例·糖尿病随访观察方案（虚构）", version: "演示 v1", recruitment: "虚构练习，不招募", inclusion: "年龄 18–75 岁\n病历已记录2型糖尿病\n愿意提供近期血糖记录", exclusion: "拒绝参与随访\n资料不足以核对患者身份", protocolText: "本方案仅用于练习逐条筛选。未知信息必须标记待补充，不推断符合；不存在真实招募或试验注册。" }));
    if (this.guidelines && !this.guidelines.collections().some(c => c.name === "示例体验资料库")) {
      this.guidelines.saveCollection("示例体验资料库", { expectedRevision: 0, description: "虚构的门诊资料核对手册与复诊准备清单。", whenToUse: "体验知识检索、原文引用、患教改写和流程图生成。", limitations: "仅用于功能练习，不是临床指南。" });
      this.store.db.prepare("INSERT OR REPLACE INTO demo_resources VALUES (?,?,?)").run("collection", "collection", "示例体验资料库");
    }
    if (this.guidelines) for (const [index, doc] of DEMO_KNOWLEDGE.entries()) {
      const key = `knowledge:${index}`;
      const saved = this.resources().find(r => r.key === key);
      if (!saved || !this.exists(saved.kind, saved.id)) {
        const created = await this.guidelines.addDocument({ ...doc, collection: "示例体验资料库", source: "虚构演示", fileName: `${doc.title}.md` });
        this.store.db.prepare("INSERT OR REPLACE INTO demo_resources VALUES (?,?,?)").run(key, "knowledge", created.id);
      }
    }
    const patient = this.status().patients.find(p => p.index === 1 && !p.archived);
    if (this.care && patient) {
      const care = this.care();
      const message = care.ingest({ patientId: patient.id, text: "【虚构示例】我已整理好近期测量记录，复诊还需要准备哪些资料？", channel: "manual", externalId: `demo:${patient.id}:message`, historical: true });
      this.own("reply", "reply", () => care.createReply({ patientId: patient.id, messageId: message.id, channel: "manual", mode: "manual", text: "【示例草稿】复诊前请准备上次就诊记录、近期检验报告和当前用药清单；测量记录请保留日期、数值和单位。", reason: "内置虚构草稿，供编辑和复核体验" }));
      this.own("alert", "alert", () => care.createAlert({ patientId: patient.id, messageId: message.id, level: "attention", reason: "示例·复诊资料需要医生核对", localOnly: true }));
    }
    return this.status();
  }
  async clear() {
    check(!this.clearing, "DEMO_BUSY", "示例正在删除，请稍后重试", 409);
    check(!this.installing, "DEMO_BUSY", "示例正在准备，请完成后再删除", 409);
    this.clearing = true;
    try { return await this.removeOwned(); }
    finally { this.clearing = false; }
  }
  async removeOwned() {
    check(!this.installing, "DEMO_BUSY", "示例正在准备，请完成后再删除", 409);
    const resources = this.resources();
    check(resources.length, "INVALID_INPUT", "没有可删除的示例数据", 404);
    const ids = this.demoIds();
    const sessionIds = [...ids.map(id => this.patients.row(id).sessionId), ...resources.filter(r => r.kind === "session").map(r => r.id)];
    for (const id of sessionIds) check(!this.patients.runtime.active.has(id) && !this.sessions?.service.active.has(id), "RUN_ACTIVE", "示例任务正在执行，请先停止再删除", 409);
    // Remove dependencies before their charts; keep the ledger if any step fails.
    for (const r of resources.filter(r => r.kind !== "patient" && r.kind !== "collection")) {
      if (this.exists(r.kind, r.id)) {
        if (r.kind === "knowledge") await this.guidelines.removeDocument(r.id, { expectedRevision: this.guidelines.docRow(r.id).revision || 0 });
        else if (r.kind === "case") this.cases.removeCase(r.id);
        else if (r.kind === "session") this.sessions.removeSession(r.id);
        else if (r.kind === "trial") {
          for (const table of ["trial_screenings", "trial_enrollments", "trial_batches"]) this.store.db.prepare(`DELETE FROM ${table} WHERE trial_id=?`).run(r.id);
          this.store.db.prepare("DELETE FROM trial_protocols WHERE id=?").run(r.id);
        }
        // Appointments, replies and alerts cascade with their owned patients.
      }
      this.store.db.prepare("DELETE FROM demo_resources WHERE key=?").run(r.key);
    }
    for (const r of resources.filter(r => r.kind === "collection")) {
      // A user may add their own documents to this collection after trying it.
      if (!this.guidelines.list({ collection: r.id }).length) this.store.db.prepare("DELETE FROM knowledge_collections WHERE name=?").run(r.id);
      this.store.db.prepare("DELETE FROM demo_resources WHERE key=?").run(r.key);
    }
    for (const r of resources.filter(r => r.kind === "patient")) {
      this.store.db.prepare("DELETE FROM followup_surveys WHERE patient_id=?").run(r.id);
      if (this.exists(r.kind, r.id)) this.patients.remove(r.id);
      this.store.db.prepare("DELETE FROM demo_resources WHERE key=?").run(r.key);
    }
    return { ...this.status(), removed: ids.length };
  }
}
