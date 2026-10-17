import { createHash, randomUUID } from "node:crypto";
import { check, identifier, string } from "../errors.mjs";
import { sqliteTransaction } from "../sqlite-transaction.mjs";

// Two patient-facing reminders the agenda needs: return-visit appointments
// and lab results the doctor has not looked at yet. Both are bookkeeping;
// nothing here contacts the patient.
export const APPOINTMENT_STATUS = Object.freeze({ scheduled: "已预约", attended: "已到诊", missed: "未到诊", cancelled: "已取消" });
const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const labKey = (lab) => createHash("sha256").update(JSON.stringify([lab.item, lab.value, lab.unit || "", lab.date])).digest("hex").slice(0, 32);
const localDate = (ms) => { const d = new Date(ms); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

export class PatientSchedule {
  constructor(store, patients, { now = Date.now } = {}) {
    this.store = store;
    this.db = store.db;
    this.patients = patients;
    this.now = now;
    const fresh = !this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='lab_reviews'").get();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS appointments(id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE, date TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS appointments_due ON appointments(status, date);
      CREATE TABLE IF NOT EXISTS appointment_requests(patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE, PRIMARY KEY(patient_id, request_id));
      CREATE TABLE IF NOT EXISTS lab_reviews(patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE, key TEXT NOT NULL, reviewed_at TEXT NOT NULL, PRIMARY KEY(patient_id, key));
    `);
    // Labs already in charts when this feature arrives are not "new".
    if (fresh) this.baseline();
  }
  today() { return localDate(this.now()); }
  baseline() {
    const put = this.db.prepare("INSERT OR IGNORE INTO lab_reviews VALUES (?,?,?)"), at = new Date(this.now()).toISOString();
    sqliteTransaction(this.db, () => { for (const p of this.patients.all()) for (const lab of p.labs || []) put.run(p.id, labKey(lab), at); });
  }
  // 建档时就带着的检验不算「新结果」——医生刚看着这批资料整理成档案；
  // 只有此后通过更新进来的检验（复诊报告、微信补传等）才该提醒查看。
  baselinePatient(patient) {
    const labs = (patient && patient.labs) || [];
    if (!labs.length) return;
    const put = this.db.prepare("INSERT OR IGNORE INTO lab_reviews VALUES (?,?,?)"), at = new Date(this.now()).toISOString();
    sqliteTransaction(this.db, () => { for (const lab of labs) put.run(patient.id, labKey(lab), at); });
  }

  // ---------- appointments ----------
  row(id) {
    const row = this.db.prepare("SELECT data FROM appointments WHERE id=?").get(identifier(id));
    check(row, "NOT_FOUND", "复诊预约不存在", 404);
    return JSON.parse(row.data);
  }
  appointments(patientId, { status } = {}) {
    this.patients.row(identifier(patientId));
    const list = this.db.prepare("SELECT data FROM appointments WHERE patient_id=? ORDER BY date, rowid").all(patientId).map((r) => JSON.parse(r.data));
    return { appointments: status ? list.filter((a) => String(status).split(",").includes(a.status)) : list, today: this.today() };
  }
  fields(input, current = {}) {
    const date = input.date ?? current.date, time = input.time === undefined ? current.time ?? null : input.time || null;
    check(DATE.test(date || "") && localDate(Date.parse(`${date}T12:00:00`)) === date, "INVALID_INPUT", "复诊日期须为 YYYY-MM-DD");
    check(time === null || TIME.test(time), "INVALID_INPUT", "时间须为 HH:MM");
    return {
      date, time,
      reason: input.reason !== undefined ? (input.reason ? string(input.reason, "复诊事项", 200) : "") : current.reason || "",
      place: input.place !== undefined ? (input.place ? string(input.place, "地点", 100) : "") : current.place || "",
    };
  }
  create(patientId, input = {}) {
    return sqliteTransaction(this.db, () => {
      const patient = this.patients.row(identifier(patientId));
      const value = this.fields(input);
      const requestId = input.requestId === undefined ? null : identifier(input.requestId);
      const fingerprint = createHash("sha256").update(JSON.stringify(value)).digest("hex");
      if (requestId) {
        const previous = this.db.prepare("SELECT * FROM appointment_requests WHERE patient_id=? AND request_id=?").get(patient.id, requestId);
        if (previous) {
          check(previous.fingerprint === fingerprint, "REQUEST_CONFLICT", "这次预约提交的内容已变化，请先核对已保存的预约；如需另建预约，请取消后重新预约", 409);
          return this.row(previous.appointment_id);
        }
      }
      check(!patient.archived, "PATIENT_ARCHIVED", "已归档患者不能预约复诊", 409);
      check(value.date >= this.today(), "INVALID_INPUT", "复诊日期不能早于今天");
      const at = new Date(this.now()).toISOString();
      const item = { id: randomUUID(), patientId: patient.id, ...value, status: "scheduled", note: "", createdAt: at, updatedAt: at, history: [] };
      this.db.prepare("INSERT INTO appointments VALUES (?,?,?,?,?)").run(item.id, item.patientId, item.date, item.status, JSON.stringify(item));
      if (requestId) this.db.prepare("INSERT INTO appointment_requests VALUES (?,?,?,?)").run(patient.id, requestId, fingerprint, item.id);
      this.store.audit(null, "appointment.created", { patientId: item.patientId, appointmentId: item.id, date: item.date });
      return item;
    });
  }
  // Reschedule (date/time/reason/place) or record the outcome (status + note).
  update(id, input = {}) {
    return sqliteTransaction(this.db, () => {
      const current = this.row(id);
      check(!this.patients.row(current.patientId).archived, "PATIENT_ARCHIVED", "已归档患者不能修改复诊预约", 409);
      if (input.expectedRevision !== undefined) check(input.expectedRevision === (current.revision || 0), "REVISION_CONFLICT", "预约已变化，请重新打开后核对；当前输入已保留", 409);
      const status = input.status ?? current.status;
      if (current.status !== "scheduled" && status !== current.status) check(typeof input.correctionReason === "string" && input.correctionReason.trim(), "INVALID_INPUT", "更正到诊结果须填写原因");
      check(APPOINTMENT_STATUS[status], "INVALID_INPUT", "预约状态须为 scheduled/attended/missed/cancelled");
      const value = this.fields(input, current);
      if (status === "scheduled" && value.date !== current.date) check(value.date >= this.today(), "INVALID_INPUT", "复诊日期不能早于今天");
      if (["attended", "missed"].includes(status) && status !== current.status) check(value.date <= this.today(), "INVALID_INPUT", "复诊日期还没到，不能登记到诊结果");
      const at = new Date(this.now()).toISOString();
      const item = { ...current, ...value, status, revision: (current.revision || 0) + 1, note: input.note !== undefined ? (input.note ? string(input.note, "备注", 500) : "") : current.note, updatedAt: at,
        history: [...current.history, { status: current.status, date: current.date, time: current.time, place: current.place, reason: current.reason, note: current.note, correctionReason: input.correctionReason ? string(input.correctionReason, "更正原因", 500) : "", at }] };
      this.db.prepare("UPDATE appointments SET date=?, status=?, data=? WHERE id=?").run(item.date, item.status, JSON.stringify(item), item.id);
      this.store.audit(null, "appointment.updated", { patientId: item.patientId, appointmentId: item.id, status: item.status });
      return item;
    });
  }
  // Appointments that need attention today: tomorrow (tell the patient),
  // today, and past ones nobody recorded.
  dueAppointments() {
    const today = this.today(), tomorrow = localDate(Date.parse(`${today}T12:00:00`) + 86400000);
    return this.db.prepare("SELECT data FROM appointments WHERE status='scheduled' AND date<=?").all(tomorrow).map((r) => JSON.parse(r.data))
      .map((a) => ({ ...a, when: a.date < today ? "past" : a.date === today ? "today" : "tomorrow" }));
  }

  // ---------- new lab results ----------
  newLabs(patientId) {
    const patient = this.patients.row(identifier(patientId));
    const seen = new Set(this.db.prepare("SELECT key FROM lab_reviews WHERE patient_id=?").all(patient.id).map((r) => r.key));
    return (patient.labs || []).filter((lab) => !seen.has(labKey(lab))).sort((a, b) => b.date.localeCompare(a.date));
  }
  allNewLabs() {
    const seen = new Set(this.db.prepare("SELECT patient_id||char(1)||key k FROM lab_reviews").all().map((r) => r.k));
    const out = [];
    for (const p of this.patients.all()) {
      if (p.archived) continue;
      const labs = (p.labs || []).filter((lab) => !seen.has(`${p.id}\u0001${labKey(lab)}`)).sort((a, b) => b.date.localeCompare(a.date));
      if (labs.length) out.push({ patientId: p.id, labs });
    }
    return out;
  }
  markLabsReviewed(patientId, keys) {
    const patient = this.patients.row(identifier(patientId));
    const current = (patient.labs || []).map(labKey);
    const chosen = Array.isArray(keys) ? keys.filter((k) => current.includes(k)) : current;
    const put = this.db.prepare("INSERT OR IGNORE INTO lab_reviews VALUES (?,?,?)"), at = new Date(this.now()).toISOString();
    sqliteTransaction(this.db, () => { for (const key of chosen) put.run(patient.id, key, at); });
    this.store.audit(null, "labs.reviewed", { patientId: patient.id, count: chosen.length });
    return { reviewed: chosen.length, remaining: this.newLabs(patient.id).length };
  }
}
